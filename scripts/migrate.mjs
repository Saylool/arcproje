import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * GEÇİŞ ÇALIŞTIRICISI. YALNIZCA ELLE ÇALIŞTIRILIR.
 *
 *   npm run migrate                      # durum (hiçbir şey uygulamaz)
 *   npm run migrate -- --apply           # bekleyenleri uygular
 *   npm run migrate -- --baseline 0007   # TEK SEFERLİK; aşağıya bak
 *
 * NEDEN VAR: geçişler elle uygulanıyordu ve hangisinin uygulandığını kaydeden
 * hiçbir şey yoktu. Tek öğrenme yolu veritabanına bakıp tahmin etmekti.
 *
 * DAĞITIMDA OTOMATİK ÇALIŞMAZ ve bu bilinçlidir. Kötü bir geçiş siteyi
 * indirir; bu projede şema değişikliği gözden geçirilir ve bilerek uygulanır.
 *
 * DOSYA HER ZAMAN KENDİ İŞLEMİNDEDİR: sarmalayıcı `BEGIN;`/`COMMIT;` satırları
 * çıkarılır ve geçiş İLE kaydı TEK bir işlemde yazılır. Aksi hâlde arada
 * kalan bir çökme, uygulanmış ama kaydedilmemiş bir geçiş bırakırdı.
 *
 * GİZLİLİK: `DATABASE_URL` okunur ama ASLA yazdırılmaz — ne günlüğe, ne hata
 * mesajına. Bağlantı dizesi kullanıcı adı ve parola içerir.
 *
 * Bu dosyanın üst yarısı SAFTIR ve `migrate.test.ts` tarafından test edilir;
 * alt yarısı yalnızca giriş/çıkış yapar.
 */

/* ------------------------------------------------------------- saf kısım */

/** `migrations.test.ts` içindeki kalıpla AYNI olmalıdır. */
export const MIGRATION_FILE_PATTERN = /^([0-9]{4})_[a-z0-9_]+\.sql$/;

/**
 * Kayıt tablosunu getiren geçiş.
 *
 * Tavuk-yumurta: kayıt okunabilmesi için tablonun var olması gerekir, ama
 * tabloyu getiren de bir geçiştir. Çözüm, bu dosyayı her çalışmada ÖNCE ve
 * koşulsuz uygulamaktır — `IF NOT EXISTS` olduğu için tekrarlanabilir.
 */
export const BOOTSTRAP_VERSION = "0008";

/** @param {string} text */
export function checksumOf(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Dosya adından sürüm; geçiş dosyası değilse `null`.
 * @param {string} fileName
 * @returns {string | null}
 */
export function migrationVersion(fileName) {
  const match = MIGRATION_FILE_PATTERN.exec(fileName);
  return match === null ? null : match[1];
}

/**
 * Blok yorumlarını BOŞLUKLA doldurur; satır sayısı ve sütunlar korunur.
 *
 * Silmek yerine doldurmanın nedeni: satır numaraları kaymasın, böylece
 * sarmalayıcı satırları özgün metinde doğru yerden çıkarılabilsin.
 * @param {string} sql
 */
export function blankBlockComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, " "),
  );
}

/**
 * Yorumları temizler. Yalnızca İNCELEME için; çalıştırılacak metin için değil.
 * @param {string} sql
 */
export function stripSqlComments(sql) {
  return blankBlockComments(sql).replace(/--[^\n]*/g, " ");
}

/**
 * Dosyanın OLUŞTURDUĞU tablo adları.
 *
 * `--baseline` doğrulaması için: "bu geçiş zaten uygulandı" iddiası, onun
 * yarattığı tabloların gerçekten var olmasıyla SINANIR. Böylece temel alma
 * bir güven işi olmaktan çıkar.
 *
 * Yorumlar önce temizlenir; dosyaların açıklama bloklarında bu ifade düz
 * metin olarak geçebilir.
 *
 * SINIR: yalnızca `CREATE TABLE` görür. Sadece `ALTER TABLE` yapan bir geçiş
 * (ör. 0003) boş liste döndürür ve doğrulanamaz — bu, sessizce geçmek yerine
 * açıkça bildirilir.
 * @param {string} sql
 * @returns {string[]}
 */
export function createdTableNames(sql) {
  const pattern =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
  const cleaned = stripSqlComments(sql);
  /** @type {string[]} */
  const names = [];
  for (;;) {
    const match = pattern.exec(cleaned);
    if (match === null) {
      break;
    }
    names.push(match[1].toLowerCase());
  }
  return names;
}

/**
 * @typedef {{ ok: true, body: string }
 *   | { ok: false, reason: "empty" | "missingBegin" | "missingCommit" }} WrapperResult
 */

/**
 * Sarmalayıcı `BEGIN;` / `COMMIT;` satırlarını çıkarır.
 *
 * NEDEN: geçiş ile kaydı AYNI işleme koyabilmek için. Dosya kendi işlemini
 * açıp kapatırsa araya kayıt satırı giremez.
 *
 * Noktalı virgülden bölme YAPILMAZ — bu, dize içindeki noktalı virgüllerde
 * bozulan klasik hatadır. Yalnızca kendi satırında duran iki anahtar sözcük
 * çıkarılır ve dosyanın gerçekten böyle sarıldığı DOĞRULANIR.
 * @param {string} sql
 * @returns {WrapperResult}
 */
export function stripTransactionWrapper(sql) {
  const lines = sql.split("\n");
  const probe = blankBlockComments(sql).split("\n");
  /** @type {number[]} */
  const meaningful = [];
  for (let index = 0; index < probe.length; index += 1) {
    const trimmed = probe[index].trim();
    if (trimmed !== "" && !trimmed.startsWith("--")) {
      meaningful.push(index);
    }
  }
  if (meaningful.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const first = meaningful[0];
  const last = meaningful[meaningful.length - 1];
  if (probe[first].trim().toUpperCase() !== "BEGIN;") {
    return { ok: false, reason: "missingBegin" };
  }
  if (first === last || probe[last].trim().toUpperCase() !== "COMMIT;") {
    return { ok: false, reason: "missingCommit" };
  }
  const body = lines
    .filter((_, index) => index !== first && index !== last)
    .join("\n");
  return { ok: true, body };
}

/**
 * @typedef {{ version: string, name: string, checksum: string }} MigrationFile
 * @typedef {{ version: string, name: string, checksum: string }} AppliedMigration
 * @typedef {{ kind: "checksum" | "renamed" | "missingFile" | "outOfOrder",
 *             version: string, detail: string }} MigrationProblem
 * @typedef {{ pending: MigrationFile[], satisfied: MigrationFile[],
 *             problems: MigrationProblem[] }} MigrationPlan
 */

/**
 * Diskteki dosyalarla kayıtlı geçişleri karşılaştırır.
 *
 * HİÇBİR ŞEY UYGULAMAZ ve veritabanına dokunmaz; yalnızca durumu söyler.
 * @param {MigrationFile[]} files
 * @param {AppliedMigration[]} applied
 * @returns {MigrationPlan}
 */
export function planMigrations(files, applied) {
  const sorted = [...files].sort((left, right) =>
    left.version.localeCompare(right.version),
  );
  const byVersion = new Map(applied.map((row) => [row.version, row]));
  /** @type {MigrationFile[]} */
  const pending = [];
  /** @type {MigrationFile[]} */
  const satisfied = [];
  /** @type {MigrationProblem[]} */
  const problems = [];

  for (const file of sorted) {
    const row = byVersion.get(file.version);
    if (row === undefined) {
      pending.push(file);
      continue;
    }
    if (row.checksum !== file.checksum) {
      /*
       * Uygulanmış bir dosya SONRADAN düzenlenmiş. Depoya bakan "bu
       * uygulandı" sanır, oysa veritabanında duran başka bir metindir.
       */
      problems.push({
        kind: "checksum",
        version: file.version,
        detail: `${file.name}: dosya uygulandıktan SONRA değişmiş`,
      });
      continue;
    }
    if (row.name !== file.name) {
      problems.push({
        kind: "renamed",
        version: file.version,
        detail: `${row.name} -> ${file.name}: dosya yeniden adlandırılmış`,
      });
      continue;
    }
    satisfied.push(file);
  }

  const known = new Set(sorted.map((file) => file.version));
  for (const row of applied) {
    if (!known.has(row.version)) {
      /* Kayıtta var, diskte yok: silinmiş ya da hiç merge edilmemiş bir geçiş. */
      problems.push({
        kind: "missingFile",
        version: row.version,
        detail: `${row.name}: kayıtlı ama diskte yok`,
      });
    }
  }

  /*
   * SIRA DIŞI: uygulanmış en yüksek sürümden ÖNCE bekleyen bir geçiş.
   *
   * İki dal paralel çalışıp geç merge edildiğinde olur. Sessizce uygulanırsa
   * şema, hiç kimsenin gözden geçirmediği bir sırayla oluşur.
   */
  const highestApplied = applied.reduce(
    (highest, row) => (row.version > highest ? row.version : highest),
    "",
  );
  if (highestApplied !== "") {
    for (const file of pending) {
      if (file.version < highestApplied) {
        problems.push({
          kind: "outOfOrder",
          version: file.version,
          detail: `${file.name}: ${highestApplied} zaten uygulanmışken sırası geçmiş`,
        });
      }
    }
  }

  problems.sort(
    (left, right) =>
      left.version.localeCompare(right.version) ||
      left.kind.localeCompare(right.kind),
  );
  return { pending, satisfied, problems };
}

/**
 * @typedef {{ kind: "check" } | { kind: "apply" }
 *   | { kind: "baseline", through: string }
 *   | { kind: "usage", message: string }} Mode
 */

/**
 * Komut satırını okur. Varsayılan `--check`: hiçbir şey uygulamaz.
 * @param {string[]} argv
 * @returns {Mode}
 */
export function readMode(argv) {
  const args = argv.filter((value) => value !== "");
  if (args.length === 0 || (args.length === 1 && args[0] === "--check")) {
    return { kind: "check" };
  }
  if (args.length === 1 && args[0] === "--apply") {
    return { kind: "apply" };
  }
  if (args[0] === "--baseline") {
    if (args.length !== 2) {
      return {
        kind: "usage",
        message:
          "--baseline, veritabanında ZATEN uygulanmış son sürümü ister: --baseline 0007",
      };
    }
    if (!/^[0-9]{4}$/.test(args[1])) {
      return { kind: "usage", message: `gecersiz surum: ${args[1]}` };
    }
    return { kind: "baseline", through: args[1] };
  }
  return { kind: "usage", message: `taninmayan secenek: ${args.join(" ")}` };
}

/**
 * Durum raporunun satırları. Yazdırma çağıranın işi.
 * @param {MigrationPlan} plan
 * @returns {string[]}
 */
export function formatPlan(plan) {
  /** @type {string[]} */
  const lines = [];
  lines.push(`uygulanmis : ${plan.satisfied.length}`);
  lines.push(`bekleyen   : ${plan.pending.length}`);
  for (const file of plan.pending) {
    lines.push(`  + ${file.name}`);
  }
  lines.push(`sorun      : ${plan.problems.length}`);
  for (const problem of plan.problems) {
    lines.push(`  ! [${problem.kind}] ${problem.detail}`);
  }
  return lines;
}

/* ----------------------------------------------------------------- kabuk */

const MIGRATIONS_DIRECTORY = new URL("../migrations/", import.meta.url);

const INSERT_RECORD =
  "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)";

const READ_RECORDS =
  "SELECT version, name, checksum FROM schema_migrations ORDER BY version";

/** @returns {MigrationFile[]} */
function readMigrationFiles() {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => migrationVersion(name) !== null)
    .sort()
    .map((name) => {
      const text = readFileSync(new URL(name, MIGRATIONS_DIRECTORY), "utf8");
      return {
        version: /** @type {string} */ (migrationVersion(name)),
        name,
        checksum: checksumOf(text),
      };
    });
}

/** @param {string} name */
function readMigrationText(name) {
  return readFileSync(new URL(name, MIGRATIONS_DIRECTORY), "utf8");
}

/** @param {string[]} argv */
async function main(argv) {
  const mode = readMode(argv);
  if (mode.kind === "usage") {
    console.error(`[migrate] ${mode.message}`);
    console.error(
      "[migrate] kullanim: npm run migrate [-- --apply | --baseline NNNN]",
    );
    process.exitCode = 1;
    return;
  }

  const url = process.env.DATABASE_URL?.trim();
  if (url === undefined || url === "") {
    /* Değerin kendisi ASLA yazdırılmaz; yalnızca yokluğu bildirilir. */
    console.error("[migrate] DATABASE_URL tanimli degil.");
    console.error(
      "[migrate] .env.local ile calistir: npm run migrate -- --apply",
    );
    process.exitCode = 1;
    return;
  }

  const files = readMigrationFiles();
  if (files.length === 0) {
    console.error("[migrate] migrations/ altinda gecis bulunamadi.");
    process.exitCode = 1;
    return;
  }

  const { Client } = await import("@neondatabase/serverless");
  const client = new Client(url);
  await client.connect();
  console.log("[migrate] baglanildi.");

  try {
    /*
     * ÖNYÜKLEME: kayıt tablosu okunabilmesi için önce var olmalı. Dosya
     * `IF NOT EXISTS` kullanır, bu yüzden her çalışmada koşulsuz uygulanabilir.
     */
    const bootstrap = files.find((file) => file.version === BOOTSTRAP_VERSION);
    if (bootstrap === undefined) {
      console.error(
        `[migrate] onyukleme gecisi ${BOOTSTRAP_VERSION} bulunamadi.`,
      );
      process.exitCode = 1;
      return;
    }
    await client.query(readMigrationText(bootstrap.name));

    const recorded = await client.query(READ_RECORDS);
    /** @type {AppliedMigration[]} */
    const applied = recorded.rows.map((row) => ({
      version: String(row.version),
      name: String(row.name),
      checksum: String(row.checksum),
    }));

    const plan = planMigrations(files, applied);
    for (const line of formatPlan(plan)) {
      console.log(`[migrate] ${line}`);
    }

    if (mode.kind === "check") {
      if (plan.problems.length > 0) {
        process.exitCode = 1;
      }
      return;
    }

    if (plan.problems.length > 0) {
      console.error(
        "[migrate] sorunlar giderilmeden hicbir sey uygulanmaz veya kaydedilmez.",
      );
      console.error(
        "[migrate] checksum uyusmazligi KASITLI bir duzenlemeyse, kaydi elle guncelle:",
      );
      console.error(
        "[migrate]   UPDATE schema_migrations SET checksum = '<yeni>' WHERE version = '<NNNN>';",
      );
      process.exitCode = 1;
      return;
    }

    if (mode.kind === "baseline") {
      await runBaseline(client, files, applied, mode.through);
      return;
    }

    await runApply(client, plan.pending);
  } finally {
    await client.end();
  }
}

/**
 * TEK SEFERLİK: hâlihazırda uygulanmış geçişleri ÇALIŞTIRMADAN kaydeder.
 *
 * Bu çalıştırıcı, geçişleri zaten elle uygulanmış bir veritabanına
 * geliyor. Onları yeniden çalıştırmak gerekmez; ama kaydedilmezlerse
 * bekliyor sanılır ve yeniden uygulanmaya kalkılır.
 *
 * SINIR `through` ile ELLE VERİLİR ve varsayılanı yoktur. "Hepsini işaretle"
 * demek, henüz uygulanmamış bir geçişi de uygulanmış saymak olurdu — sessizce
 * atlanan bir tablo, en pahalı hata sınıfıdır.
 *
 * İDDİA SINANIR: işaretlenecek her geçişin YARATTIĞI tabloların gerçekten
 * var olduğu doğrulanır. Yoksa temel alma reddedilir.
 * @param {import("@neondatabase/serverless").Client} client
 * @param {MigrationFile[]} files
 * @param {AppliedMigration[]} applied
 * @param {string} through
 */
async function runBaseline(client, files, applied, through) {
  if (applied.length > 0) {
    console.error(
      `[migrate] kayit tablosunda zaten ${applied.length} satir var; temel alma yalnizca BOS bir kayitla calisir.`,
    );
    process.exitCode = 1;
    return;
  }

  const target = files.filter((file) => file.version <= through);
  if (target.length === 0) {
    console.error(`[migrate] ${through} ve oncesinde gecis yok.`);
    process.exitCode = 1;
    return;
  }

  /* Önce DOĞRULA, sonra yaz. */
  /** @type {string[]} */
  const missing = [];
  for (const file of target) {
    const tables = createdTableNames(readMigrationText(file.name));
    if (tables.length === 0) {
      console.log(
        `[migrate] ${file.name}: dogrulanacak tablo yok (yalnizca ALTER).`,
      );
      continue;
    }
    for (const table of tables) {
      const found = await client.query("SELECT to_regclass($1) AS oid", [
        `public.${table}`,
      ]);
      if (found.rows[0]?.oid === null) {
        missing.push(`${file.name} -> ${table}`);
      }
    }
  }

  if (missing.length > 0) {
    console.error("[migrate] temel alma REDDEDILDI; su tablolar yok:");
    for (const line of missing) {
      console.error(`[migrate]   - ${line}`);
    }
    console.error(
      "[migrate] once eksik gecisleri uygula, sonra dogru sinirla temel al.",
    );
    process.exitCode = 1;
    return;
  }

  await client.query("BEGIN");
  try {
    for (const file of target) {
      await client.query(INSERT_RECORD, [file.version, file.name, file.checksum]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  console.log(
    `[migrate] temel alindi: ${target.length} gecis CALISTIRILMADAN kaydedildi (${through} ve oncesi).`,
  );
  const remaining = files.filter((file) => file.version > through);
  if (remaining.length > 0) {
    console.log(
      `[migrate] hala bekliyor: ${remaining.map((file) => file.name).join(", ")}`,
    );
    console.log("[migrate] uygulamak icin: npm run migrate -- --apply");
  }
}

/**
 * Bekleyen geçişleri SIRAYLA uygular.
 *
 * Her geçiş ve onun kaydı AYNI işlemdedir: yarım kalmış bir çalışma,
 * uygulanmış ama kaydedilmemiş bir geçiş bırakmaz.
 * @param {import("@neondatabase/serverless").Client} client
 * @param {MigrationFile[]} pending
 */
async function runApply(client, pending) {
  if (pending.length === 0) {
    console.log("[migrate] bekleyen gecis yok.");
    return;
  }

  for (const file of pending) {
    const wrapper = stripTransactionWrapper(readMigrationText(file.name));
    if (!wrapper.ok) {
      console.error(
        `[migrate] ${file.name}: dosya BEGIN;/COMMIT; ile sarili degil (${wrapper.reason}).`,
      );
      process.exitCode = 1;
      return;
    }

    await client.query("BEGIN");
    try {
      await client.query(wrapper.body);
      await client.query(INSERT_RECORD, [
        file.version,
        file.name,
        file.checksum,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      console.error(
        `[migrate] ${file.name} UYGULANAMADI; geri alindi:`,
        error instanceof Error ? error.message : "bilinmeyen hata",
      );
      process.exitCode = 1;
      return;
    }
    console.log(`[migrate] uygulandi: ${file.name}`);
  }

  console.log(`[migrate] tamam: ${pending.length} gecis uygulandi.`);
}

/*
 * Yalnızca doğrudan çalıştırıldığında iş yapar; test dosyası bu modülü
 * import ettiğinde hiçbir bağlantı açılmaz.
 */
const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  fileURLToPath(import.meta.url) === invokedPath
) {
  await main(process.argv.slice(2));
}
