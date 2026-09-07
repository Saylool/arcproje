import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_VERSION,
  MIGRATION_FILE_PATTERN,
  checksumOf,
  createdTableNames,
  formatPlan,
  migrationVersion,
  planMigrations,
  readMode,
  stripTransactionWrapper,
} from "../../../scripts/migrate.mjs";

/**
 * GEÇİŞ ÇALIŞTIRICISININ SAF YARISI.
 *
 * Çalıştırıcı elle çalıştırılan bir araçtır ve CI'da bir Postgres yoktur; yani
 * gerçek uygulama burada SINANAMAZ. Sınanabilen — ve yanlış olursa üretimde
 * şemayı bozacak olan — KARAR mantığıdır: hangi geçiş bekliyor, hangisi
 * uygulanmış sayılıyor, hangi durum bir sorun.
 *
 * Bu ayrım bilinçlidir: `scripts/migrate.mjs` dosyasının üst yarısı hiçbir
 * giriş/çıkış yapmaz, alt yarısı hiçbir karar vermez.
 */

const FILES = [
  { version: "0001", name: "0001_a.sql", checksum: "a".repeat(64) },
  { version: "0002", name: "0002_b.sql", checksum: "b".repeat(64) },
  { version: "0003", name: "0003_c.sql", checksum: "c".repeat(64) },
];

describe("plan: bos veritabani", () => {
  it("HEPSI bekliyor", () => {
    const plan = planMigrations(FILES, []);
    expect(plan.pending.map((file) => file.version)).toEqual([
      "0001",
      "0002",
      "0003",
    ]);
    expect(plan.satisfied).toEqual([]);
    expect(plan.problems).toEqual([]);
  });

  it("sira DOSYA ADINDAN gelir, dizinin sirasindan degil", () => {
    /*
     * `readdirSync` sırası dosya sistemine bağlıdır ve garanti değildir.
     * Geçişler yanlış sırada uygulanırsa yabancı anahtarlar tutmaz.
     */
    const shuffled = [FILES[2], FILES[0], FILES[1]];
    const plan = planMigrations(shuffled, []);
    expect(plan.pending.map((file) => file.version)).toEqual([
      "0001",
      "0002",
      "0003",
    ]);
  });
});

describe("plan: kayitli gecisler", () => {
  it("esleseni UYGULANMIS sayar, tekrar uygulamaz", () => {
    const plan = planMigrations(FILES, [FILES[0], FILES[1]]);
    expect(plan.satisfied.map((file) => file.version)).toEqual([
      "0001",
      "0002",
    ]);
    expect(plan.pending.map((file) => file.version)).toEqual(["0003"]);
    expect(plan.problems).toEqual([]);
  });

  it("CHECKSUM degistiyse sorun bildirir ve uygulanmis SAYMAZ", () => {
    /*
     * Uygulandıktan sonra düzenlenmiş bir dosya, depo ile veritabanının
     * sessizce ayrışması demektir: dosyaya bakan "bu uygulandı" sanır, oysa
     * veritabanında duran başka bir metindir. Başka hiçbir kontrol bunu
     * görmez.
     */
    const plan = planMigrations(FILES, [
      { ...FILES[0], checksum: "d".repeat(64) },
    ]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0].kind).toBe("checksum");
    expect(plan.satisfied).toEqual([]);
    /* Sorunlu geçiş bekleyene de DÜŞMEZ; yeniden uygulanacak bir şey yok. */
    expect(plan.pending.map((file) => file.version)).toEqual(["0002", "0003"]);
  });

  it("YENIDEN ADLANDIRMA sorun bildirir", () => {
    /*
     * Sürüm aynı kaldığı için fark yalnızca ad karşılaştırmasında görünür.
     */
    const plan = planMigrations(FILES, [
      { ...FILES[0], name: "0001_eski_ad.sql" },
    ]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0].kind).toBe("renamed");
  });

  it("kayitli ama DISKTE OLMAYAN gecis sorun bildirir", () => {
    const plan = planMigrations(FILES, [
      ...FILES,
      { version: "0009", name: "0009_yok.sql", checksum: "e".repeat(64) },
    ]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0].kind).toBe("missingFile");
  });

  it("SIRA DISI bekleyen gecis sorun bildirir", () => {
    /*
     * İki dal paralel çalışıp geç merge edildiğinde olur: 0003 uygulanmışken
     * 0002 sonradan gelir. Sessizce uygulanırsa şema, kimsenin gözden
     * geçirmediği bir sırayla oluşur.
     */
    const plan = planMigrations(FILES, [FILES[0], FILES[2]]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0].kind).toBe("outOfOrder");
    expect(plan.problems[0].version).toBe("0002");
  });

  it("SONDAKI bekleyen gecis sira disi SAYILMAZ", () => {
    const plan = planMigrations(FILES, [FILES[0], FILES[1]]);
    expect(plan.problems).toEqual([]);
  });
});

describe("komut satiri", () => {
  it("varsayilan CHECK'tir; argumansiz calisma hicbir sey uygulamaz", () => {
    /*
     * En önemli varsayılan bu. Yanlışlıkla çalıştırılan bir komut şema
     * değiştirmemeli.
     */
    expect(readMode([])).toEqual({ kind: "check" });
    expect(readMode(["--check"])).toEqual({ kind: "check" });
  });

  it("--apply ve --baseline taninir", () => {
    expect(readMode(["--apply"])).toEqual({ kind: "apply" });
    expect(readMode(["--baseline", "0007"])).toEqual({
      kind: "baseline",
      through: "0007",
    });
  });

  it("--baseline SURUM ISTER; varsayilani yoktur", () => {
    /*
     * "Hepsini işaretle" demek, henüz uygulanmamış bir geçişi de uygulanmış
     * saymak olurdu. Sınırı insan söyler.
     */
    expect(readMode(["--baseline"]).kind).toBe("usage");
    expect(readMode(["--baseline", "7"]).kind).toBe("usage");
    expect(readMode(["--baseline", "abcd"]).kind).toBe("usage");
  });

  it("taninmayan veya KARISIK secenek uygulamaya DUSMEZ", () => {
    /*
     * Belirsiz bir komut satırının sessizce `--apply` sayılması, en kötü
     * varsayılan olurdu.
     */
    expect(readMode(["--yaz"]).kind).toBe("usage");
    expect(readMode(["--apply", "--baseline"]).kind).toBe("usage");
    expect(readMode(["--check", "--apply"]).kind).toBe("usage");
  });
});

describe("islem sarmalayicisi", () => {
  const wrapped = "-- baslik\nBEGIN;\n\nCREATE TABLE t (a text);\n\nCOMMIT;\n";

  it("BEGIN; ve COMMIT; satirlarini cikarir, govdeyi korur", () => {
    const result = stripTransactionWrapper(wrapped);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toContain("CREATE TABLE t (a text);");
    expect(result.body).not.toMatch(/^\s*BEGIN;\s*$/m);
    expect(result.body).not.toMatch(/^\s*COMMIT;\s*$/m);
  });

  it("govdedeki NOKTALI VIRGULLERE dokunmaz", () => {
    /*
     * Klasik hata: SQL'i noktalı virgülden bölmek. Dize içindeki bir noktalı
     * virgül dosyayı ortadan ikiye böler ve yarısı sessizce kaybolur. Burada
     * bölme YAPILMAZ, yalnızca iki satır çıkarılır.
     */
    const tricky =
      "BEGIN;\nCREATE TABLE t (a text CHECK (a ~ '^x;y$'));\nINSERT INTO t VALUES ('a;b');\nCOMMIT;\n";
    const result = stripTransactionWrapper(tricky);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toContain("'^x;y$'");
    expect(result.body).toContain("'a;b'");
  });

  it("BLOK YORUMU sarmalayiciyi gizlemez", () => {
    const commented = "/* uzun\n   aciklama */\nBEGIN;\nSELECT 1;\nCOMMIT;\n";
    expect(stripTransactionWrapper(commented).ok).toBe(true);
  });

  it("sarilmamis dosyayi REDDEDER", () => {
    expect(stripTransactionWrapper("CREATE TABLE t (a text);\n")).toEqual({
      ok: false,
      reason: "missingBegin",
    });
    expect(stripTransactionWrapper("BEGIN;\nSELECT 1;\n")).toEqual({
      ok: false,
      reason: "missingCommit",
    });
    expect(stripTransactionWrapper("-- yalnizca yorum\n")).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(stripTransactionWrapper("BEGIN;\n")).toEqual({
      ok: false,
      reason: "missingCommit",
    });
  });
});

describe("olusturulan tablo adlari", () => {
  it("CREATE TABLE [IF NOT EXISTS] yakalar", () => {
    const sql = "BEGIN;\nCREATE TABLE IF NOT EXISTS a (x text);\nCREATE TABLE b (y text);\nCOMMIT;";
    expect(createdTableNames(sql)).toEqual(["a", "b"]);
  });

  it("YORUM icindeki ifadeyi saymaz", () => {
    /*
     * Bu depodaki geçiş dosyaları uzun açıklama blokları taşır ve bu ifade
     * orada düz metin olarak geçer. Sayılsaydı, var olmayan bir tablo
     * aranır ve temel alma haksız yere reddedilirdi.
     */
    const sql =
      "-- CREATE TABLE IF NOT EXISTS hayalet (...)\n/* CREATE TABLE ikinci_hayalet */\nBEGIN;\nCREATE TABLE gercek (x text);\nCOMMIT;";
    expect(createdTableNames(sql)).toEqual(["gercek"]);
  });

  it("yalnizca ALTER yapan gecis BOS liste dondurur", () => {
    const sql = "BEGIN;\nALTER TABLE t ADD COLUMN y text;\nCOMMIT;";
    expect(createdTableNames(sql)).toEqual([]);
  });
});

describe("rapor", () => {
  it("bekleyen ve sorunlarin ikisini de sayar", () => {
    const plan = planMigrations(FILES, [
      { ...FILES[0], checksum: "d".repeat(64) },
    ]);
    const text = formatPlan(plan).join("\n");
    expect(text).toContain("bekleyen   : 2");
    expect(text).toContain("sorun      : 1");
    expect(text).toContain("[checksum]");
  });
});

describe("DEPODAKI gercek gecis dosyalari", () => {
  const names = readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort();

  it("dosya adi kalibi migrations.test.ts ile AYNI DAVRANIR", () => {
    /*
     * İki ayrı yerde iki kalıp var. Ayrışırlarsa biri geçerli saydığı dosyayı
     * öteki görmez: kapı testi dosyayı doğrular, çalıştırıcı onu sessizce
     * atlar — ya da tersi.
     *
     * Karşılaştırma METİN üzerinden DEĞİL davranış üzerinden yapılır: `\d{4}`
     * ile `[0-9]{4}` aynı şeydir, metinleri farklıdır. Metni karşılaştıran bir
     * test, aynı anlamı taşıyan iki kalıpta boşuna düşerdi.
     */
    const guard = readFileSync("src/lib/db/migrations.test.ts", "utf8");
    const declared = /const FILE_PATTERN = (\/.+\/);/.exec(guard);
    expect(declared, "migrations.test.ts icinde FILE_PATTERN yok").not.toBeNull();
    const guardPattern = new RegExp(declared![1].slice(1, -1));

    const samples = [
      "0001_shared_bills.sql",
      "0008_schema_migrations.sql",
      "1_a.sql",
      "0001_A.sql",
      "0001-a.sql",
      "0001_a.txt",
      "README.md",
      "0001_a.sql.bak",
    ];
    for (const sample of samples) {
      expect(guardPattern.test(sample), sample).toBe(
        MIGRATION_FILE_PATTERN.test(sample),
      );
    }
  });

  it("HEPSI cozumlenebilir bir surum tasir", () => {
    for (const name of names) {
      expect(migrationVersion(name), name).not.toBeNull();
    }
  });

  it("HEPSI BEGIN;/COMMIT; ile sarilidir", () => {
    /*
     * `--apply` yolu bunu şart koşar. Sarılmamış bir dosya eklenirse burada
     * görülür — üretimde uygulama anında değil.
     */
    for (const name of names) {
      const sql = readFileSync(`migrations/${name}`, "utf8");
      expect(stripTransactionWrapper(sql).ok, name).toBe(true);
    }
  });

  it("olusturulan tablolar BEKLENEN kumedir", () => {
    /*
     * `--baseline` doğrulaması bu çıkarıma dayanır. Beklenen listeyi burada
     * sabitlemek, yorum ayıklamanın gerçek dosyalarda da doğru çalıştığını
     * ölçer — uydurma örneklerde değil.
     */
    const expected: Record<string, string[]> = {
      "0001_shared_bills.sql": [
        "shared_bill_auth_nonces",
        "shared_bill_debts",
        "shared_bill_payment_attempts",
        "shared_bill_payment_offers",
        "shared_bill_sessions",
        "shared_bills",
      ],
      "0002_app_users.sql": ["app_users"],
      "0003_shared_bill_owner.sql": [],
      "0004_saved_contacts.sql": ["saved_contacts"],
      "0005_receipt_analysis_quota.sql": ["receipt_analysis_quota"],
      "0006_provider_call_budget.sql": ["provider_call_budget"],
      "0007_provider_rate_cache.sql": ["provider_rate_cache"],
      "0008_schema_migrations.sql": ["schema_migrations"],
    };
    expect(Object.keys(expected).sort()).toEqual(names);
    for (const name of names) {
      const sql = readFileSync(`migrations/${name}`, "utf8");
      expect(createdTableNames(sql).sort(), name).toEqual(expected[name]);
    }
  });

  it("onyukleme gecisi KAYIT TABLOSUNU getirir", () => {
    /*
     * Çalıştırıcı bu dosyayı, kaydı okuyabilmek için koşulsuz uygular.
     * Numarası değişirse ya da içeriği başka bir şey yaratırsa, kayıt
     * okunamaz hâle gelirdi.
     */
    const bootstrap = names.find(
      (name) => migrationVersion(name) === BOOTSTRAP_VERSION,
    );
    expect(bootstrap, "onyukleme gecisi yok").toBeDefined();
    const sql = readFileSync(`migrations/${bootstrap}`, "utf8");
    expect(createdTableNames(sql)).toContain("schema_migrations");
  });

  it("checksum icerige duyarli ve KARARLIDIR", () => {
    const sql = readFileSync(`migrations/${names[0]}`, "utf8");
    expect(checksumOf(sql)).toBe(checksumOf(sql));
    expect(checksumOf(sql)).toMatch(/^[0-9a-f]{64}$/);
    expect(checksumOf(sql)).not.toBe(checksumOf(`${sql} `));
  });
});
