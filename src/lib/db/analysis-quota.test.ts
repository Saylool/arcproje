import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  DAILY_ANALYSES_PER_USER,
  DAILY_ANALYSES_TOTAL,
  GLOBAL_QUOTA_KEY,
  quotaDay,
  remainingAfter,
} from "@/lib/receipt/quota";

import {
  appUserStillExists,
  consumeAnalysisQuota,
} from "./analysis-quota-service";
import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";
import type { SharedBillRepository } from "./shared-bill-repository";

/**
 * FIS ANALIZI KOTASI.
 *
 * Google girisi vardi ama SAYI siniri yoktu: oturum acmis bir kullanici
 * istedigi kadar analiz cagirabiliyordu ve her cagri OpenAI'de gercek para
 * harciyor. Ust siniri olmayan tek maliyet buydu.
 *
 * Uc sey ayri ayri kanitlanir:
 *   1. SINIR TUTAR ve reddedilen istek hak TUKETMEZ.
 *   2. IKI SAYAC ayri islerdir: kullanici basina kota adalet, genel tavan
 *      faturadir. Genel dolunca kullanicinin hakkina DOKUNULMAZ.
 *   3. GUN UTC'dir; sinirin ne zaman sifirlandigi sunucu ayarina birakilmaz.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);

type Repo = ReturnType<typeof createFakeSharedBillRepository>;

async function spend(
  repository: Repo,
  times: number,
  options: { userId?: string; perUserLimit?: number; totalLimit?: number } = {},
) {
  const results = [];
  for (let index = 0; index < times; index += 1) {
    results.push(
      await consumeAnalysisQuota({
        userId: options.userId ?? USER,
        repository,
        nowMs: NOW,
        perUserLimit: options.perUserLimit ?? 3,
        totalLimit: options.totalLimit ?? 100,
      }),
    );
  }
  return results;
}

describe("sinir tutar", () => {
  it("sinira kadar gecer, sonrasinda 429 doner", async () => {
    const repository = createFakeSharedBillRepository();

    const results = await spend(repository, 4);

    expect(results.slice(0, 3).every((r) => r.ok)).toBe(true);
    const last = results[3];
    expect(last?.ok).toBe(false);
    expect(last?.ok === false && last.status).toBe(429);
    expect(last?.ok === false && last.code).toBe("DAILY_LIMIT_REACHED");
  });

  it("KALAN hak dogru sayilir", async () => {
    const repository = createFakeSharedBillRepository();

    const results = await spend(repository, 3);

    expect(results.map((r) => (r.ok ? r.remaining : null))).toEqual([2, 1, 0]);
  });

  it("REDDEDILEN istek hak TUKETMEZ", async () => {
    /*
     * Aksi halde sinira carpan biri, tekrar denedikce kilitli kalirdi ve
     * ertesi gune kadar hicbir hakki geri gelmezdi.
     */
    const repository = createFakeSharedBillRepository();
    await spend(repository, 3);
    const before = repository.analysisQuota.get(`${USER}|${quotaDay(NOW)}`);

    await spend(repository, 5);

    expect(repository.analysisQuota.get(`${USER}|${quotaDay(NOW)}`)).toBe(
      before,
    );
  });

  it("BASKA kullanicinin hakki etkilenmez", async () => {
    const repository = createFakeSharedBillRepository();
    await spend(repository, 3);

    const other = await spend(repository, 1, { userId: OTHER });

    expect(other[0]?.ok).toBe(true);
  });
});

describe("iki sayac, iki farkli is", () => {
  it("genel tavan dolunca 429 doner ama BASKA bir kodla", async () => {
    /*
     * Kullanicinin kendi hakki bitmemistir; mesaj bunu dogru soylemeli,
     * yoksa kisi kendi hakkini harcadigini saniyor.
     */
    const repository = createFakeSharedBillRepository();

    const results = await spend(repository, 3, { totalLimit: 2 });

    const last = results[2];
    expect(last?.ok === false && last.status).toBe(429);
    expect(last?.ok === false && last.code).toBe("SERVICE_BUSY");
    expect(last?.ok === false && last.code).not.toBe("DAILY_LIMIT_REACHED");
  });

  it("genel tavan dolunca KULLANICININ hakkina dokunulmaz", async () => {
    const repository = createFakeSharedBillRepository();
    await spend(repository, 2, { totalLimit: 2 });
    const own = repository.analysisQuota.get(`${USER}|${quotaDay(NOW)}`);

    await spend(repository, 3, { totalLimit: 2 });

    expect(repository.analysisQuota.get(`${USER}|${quotaDay(NOW)}`)).toBe(own);
  });

  it("genel sayac TUM kullanicilari toplar", async () => {
    const repository = createFakeSharedBillRepository();

    await spend(repository, 2, { userId: USER });
    await spend(repository, 2, { userId: OTHER });

    expect(
      repository.analysisQuota.get(`${GLOBAL_QUOTA_KEY}|${quotaDay(NOW)}`),
    ).toBe(4);
  });

  it("genel anahtar bir uuid ile CAKISAMAZ", () => {
    /* Sema de bunu bir CHECK ile zorlar. */
    expect(GLOBAL_QUOTA_KEY.startsWith("@")).toBe(true);
    expect(GLOBAL_QUOTA_KEY).not.toMatch(/^[0-9a-f-]+$/);
  });
});

describe("gun UTC'dir", () => {
  it("ayni gun ayni anahtari verir", () => {
    expect(quotaDay(Date.UTC(2026, 8, 4, 0, 0, 0))).toBe("2026-09-04");
    expect(quotaDay(Date.UTC(2026, 8, 4, 23, 59, 59))).toBe("2026-09-04");
  });

  it("UTC gece yarisinda DEGISIR", () => {
    expect(quotaDay(Date.UTC(2026, 8, 5, 0, 0, 0))).toBe("2026-09-05");
  });

  it("ertesi gun hak YENILENIR", async () => {
    const repository = createFakeSharedBillRepository();
    await spend(repository, 3);

    const tomorrow = await consumeAnalysisQuota({
      userId: USER,
      repository,
      nowMs: NOW + 24 * 60 * 60 * 1000,
      perUserLimit: 3,
      totalLimit: 100,
    });

    expect(tomorrow.ok).toBe(true);
  });
});

describe("sinirlar", () => {
  it("gecersiz kullanici kimligiyle hicbir hak harcanmaz", async () => {
    const repository = createFakeSharedBillRepository();

    for (const bad of ["", "  ", "not-a-uuid", GLOBAL_QUOTA_KEY]) {
      const result = await consumeAnalysisQuota({
        userId: bad,
        repository,
        nowMs: NOW,
      });
      expect(result.ok).toBe(false);
    }
    expect(repository.analysisQuota.size).toBe(0);
  });

  it("depo erisilemezse 429 DEGIL 503 doner", async () => {
    /*
     * Ikisi karistirilirsa kullaniciya "hakkin bitti" denir; oysa hakki
     * duruyordur ve yarina kadar bekletilmis olur.
     */
    const repository = createFakeSharedBillRepository({
      failWithUnavailable: true,
    });

    const result = await consumeAnalysisQuota({
      userId: USER,
      repository,
      nowMs: NOW,
    });

    expect(result.ok === false && result.status).toBe(503);
  });

  it("kalan hak negatif olamaz", () => {
    expect(remainingAfter(30, 25)).toBe(0);
    expect(remainingAfter(25, 25)).toBe(0);
    expect(remainingAfter(1, 25)).toBe(24);
  });

  it("varsayilan sinirlar secilen degerlerdir", () => {
    expect(DAILY_ANALYSES_PER_USER).toBe(25);
    expect(DAILY_ANALYSES_TOTAL).toBe(250);
    /* Genel tavan kisi basindan buyuk olmali, yoksa tek kisi hepsini yer. */
    expect(DAILY_ANALYSES_TOTAL).toBeGreaterThan(DAILY_ANALYSES_PER_USER);
  });
});

/**
 * SQL <-> BELLEK ICI DEPO ESLESMESI.
 *
 * Bu depoda calisan bir Postgres yoktur; SQL metninin dogru semantigi
 * KODLADIGI olculur. Sahte depo yesil kalirken uretimdeki sorgunun farkli
 * davranmasi bu projede daha once yasandi.
 */
describe("kota SQL'i sahte depoyla AYNI seyi yapar", () => {
  const neon = readFileSync(
    "src/lib/db/neon-shared-bill-repository.ts",
    "utf8",
  );
  const between = (from: string, to: string) =>
    neon.slice(neon.indexOf(from), neon.indexOf(to, neon.indexOf(from)));
  const seed = between("const SEED_QUOTA_ROWS = `", "`;");
  const lock = between("const LOCK_QUOTA_ROWS = `", "`;");
  const reserve = between("const RESERVE_ANALYSIS_QUOTA = `", "`;");
  const impl = between(
    "async reserveAnalysisQuota(",
    "async countAllBills(",
  );

  it("iki satiri da SAYAC ARTIRMADAN var eder", () => {
    /* Tohumlama artirsaydi, reddedilen istek bile hak yakardi. */
    expect(seed).toContain("VALUES ($1, $3::date, 0), ($2, $3::date, 0)");
    expect(seed).toContain("ON CONFLICT (quota_key, day) DO NOTHING");
    expect(seed).not.toContain("used + 1");
  });

  it("iki satiri da BELIRLENIMCI sirada kilitler", () => {
    /*
     * Kilitsiz okuma, iki es zamanli istegin son hakki birlikte kullanmasina
     * izin verirdi. Sirasiz kilitleme ise kilitlenmeye (deadlock) acik olurdu.
     */
    expect(lock).toContain("FOR UPDATE");
    expect(lock).toContain("ORDER BY quota_key");
  });

  it("kosul, YAZAN degil OKUYAN CTE'ye dayanir", () => {
    /*
     * Kardes CTE'ler birbirinin yazdigini GORMEZ. Sinir kontrolu yazan
     * CTE'nin kendi icinde olsaydi iki sayac birbirinden habersiz artardi.
     */
    expect(reserve).toContain("FROM before b");
    expect(reserve).toContain("AND b.global_used < $4");
    expect(reserve).toContain("AND b.user_used < $5");
  });

  it("IKISINI BIRDEN artirir ya da HICBIRINI", () => {
    /* Tek UPDATE, iki satira birden dokunur; kismi tuketim imkansizdir. */
    expect(reserve).toContain("SET used = q.used + 1");
    expect(reserve).toContain("AND q.quota_key IN ($1, $2)");
    expect(reserve).toContain("(SELECT count(*) FROM bumped)");
  });

  it("gun UYGULAMADAN gelir, current_date DEGIL", () => {
    /* `current_date` sunucunun saat dilimine baglidir. */
    for (const statement of [seed, lock, reserve]) {
      expect(statement).toContain("$3::date");
      expect(statement).not.toContain("current_date");
      expect(statement).not.toContain("now()");
    }
  });

  it("uc deyim TEK ISLEMDE calisir", () => {
    /*
     * Ayri cagrilar olsaydi kilitler arada birakilir ve atomiklik kaybolurdu.
     */
    expect(impl).toContain("sql.transaction((txn) => [");
    expect(impl).toContain("txn.query(SEED_QUOTA_ROWS, parameters)");
    expect(impl).toContain("txn.query(LOCK_QUOTA_ROWS, parameters)");
    expect(impl).toContain("txn.query(RESERVE_ANALYSIS_QUOTA, parameters)");
  });

  it("SIFIR SATIR tukenme demektir, erisilememe DEGIL", () => {
    /*
     * Bu depoda calisan bir Postgres olmadigi icin Neon uygulamasinin bu
     * dali calistirilamiyor; kaynak duzeyinde sabitlenir.
     */
    const zeroRows = impl.slice(
      impl.indexOf("if (bumped === 0)"),
      impl.indexOf("if (bumped !== 2)"),
    );
    expect(zeroRows).toContain('reason: "globalExhausted"');
    expect(zeroRows).toContain('reason: "userExhausted"');
  });

  it("EXCLUDED ile degil MEVCUT degerden artirir", () => {
    /* `EXCLUDED.used` her zaman sabittir; sayac asla ilerlemezdi. */
    expect(reserve).not.toContain("EXCLUDED");
  });
});

describe("gecis dosyasi", () => {
  const migration = readFileSync(
    "migrations/0005_receipt_analysis_quota.sql",
    "utf8",
  );

  it("birincil anahtar anahtar+gun ciftidir", () => {
    expect(migration).toContain("PRIMARY KEY (quota_key, day)");
  });

  it("anahtar bicimi KISITLIDIR", () => {
    /* Genel satir ile kullanici satirlari birbirine karisamaz. */
    expect(migration).toContain("@global");
    expect(migration).toContain("[0-9a-f]{8}-");
  });

  it("sayac geriye gidemez", () => {
    expect(migration).toContain("CHECK (used >= 0)");
  });
});

/**
 * SILINEN HESAP ANALIZ CAGIRAMAZ.
 *
 * Oturum bir JWT'dir ve sunucu onu IPTAL EDEMEZ: hesabini silen biri, cerezi
 * duran BASKA bir cihazdan istek gondermeye devam edebilir. Yabanci anahtari
 * olan tablolarda bu kendiliginden durur; kota tablosunun yabanci anahtari
 * YOKTUR ve tam da para harcayan yol odur.
 */
describe("silinen hesap analiz cagiramaz", () => {
  it("kullanici yoksa var DEMEZ", async () => {
    const repository = createFakeSharedBillRepository();

    const result = await appUserStillExists({ userId: USER, repository });

    expect(result).toEqual({ ok: true, exists: false });
  });

  it("kullanici duruyorsa var DER", async () => {
    const repository = createFakeSharedBillRepository();
    repository.appUsers.add(USER);

    expect(await appUserStillExists({ userId: USER, repository })).toEqual({
      ok: true,
      exists: true,
    });
  });

  it("bicimsiz kimlik SURUCUYE gitmez", async () => {
    const repository = createFakeSharedBillRepository();
    const before = repository.calls;

    const result = await appUserStillExists({
      userId: "not-a-uuid",
      repository,
    });

    expect(result).toEqual({ ok: true, exists: false });
    expect(repository.calls).toBe(before);
  });

  it("ERISILEMEME, yok ile karistirilmaz", async () => {
    /*
     * Karistirilirsa var olan hesabiyla gelen kullanici 401 alip disari
     * atilirdi.
     */
    const repository = createFakeSharedBillRepository({
      failWithUnavailable: true,
    });

    const result = await appUserStillExists({ userId: USER, repository });

    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("rota: hesap yoksa 401 doner ve KOTA harcanmaz", async () => {
    const consumeQuota = vi.fn();
    const extract = vi.fn();
    const { createReceiptAnalyzePost } = await import(
      "@/app/api/receipts/analyze/route"
    );
    const POST = createReceiptAnalyzePost({
      authenticate: async () => ({
        status: "authenticated" as const,
        user: { id: USER, name: "Ada", image: null },
      }),
      configured: () => true,
      extract,
      createRepository: async () => ({}) as unknown as SharedBillRepository,
      userExists: async () => ({ ok: true as const, exists: false }),
      consumeQuota,
      now: () => NOW,
    });

    const body = new FormData();
    body.append(
      "receipt",
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])], "f.jpg", {
        type: "image/jpeg",
      }),
    );
    const response = await POST(
      new Request("https://ornek.invalid/api/receipts/analyze", {
        method: "POST",
        body,
      }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("ACCOUNT_DELETED");
    /* Silinen hesap ne kota harcar ne de saglayiciya ulasir. */
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it("rota: kontrol ERISILEMEZSE 503 doner, 401 DEGIL", async () => {
    /*
     * 401 donmek, veritabani bir an aksadi diye VAR OLAN hesabiyla gelen
     * kullaniciyi disari atardi. Gecici bir arizanin cezasi hesap kaybi
     * gibi gorunmemeli.
     */
    const consumeQuota = vi.fn();
    const { createReceiptAnalyzePost } = await import(
      "@/app/api/receipts/analyze/route"
    );
    const POST = createReceiptAnalyzePost({
      authenticate: async () => ({
        status: "authenticated" as const,
        user: { id: USER, name: "Ada", image: null },
      }),
      configured: () => true,
      extract: vi.fn(),
      createRepository: async () => ({}) as unknown as SharedBillRepository,
      userExists: async () => ({
        ok: false as const,
        reason: "unavailable" as const,
      }),
      consumeQuota,
      now: () => NOW,
    });

    const body = new FormData();
    body.append(
      "receipt",
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])], "f.jpg", {
        type: "image/jpeg",
      }),
    );
    const response = await POST(
      new Request("https://ornek.invalid/api/receipts/analyze", {
        method: "POST",
        body,
      }),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).not.toBe("ACCOUNT_DELETED");
    expect(consumeQuota).not.toHaveBeenCalled();
  });

  it("Neon: catch dali ERISILEMEME der, yok DEMEZ", () => {
    /*
     * Bu depoda calisan bir Postgres olmadigi icin bu dal calistirilamiyor;
     * kaynak duzeyinde sabitlenir. Karisirsa gecici bir baglanti hatasi,
     * kullaniciya "hesabin silinmis" der.
     */
    const neon = readFileSync(
      "src/lib/db/neon-shared-bill-repository.ts",
      "utf8",
    );
    const impl = neon.slice(
      neon.indexOf("async appUserExists("),
      neon.indexOf("async deleteAppUser("),
    );
    const catchBranch = impl.slice(impl.indexOf("} catch {"));
    expect(catchBranch).toContain('reason: "unavailable"');
    expect(catchBranch).not.toContain("exists:");
  });

  it("rota: varlik kontrolu KOTADAN once yapilir", () => {
    const route = readFileSync(
      "src/app/api/receipts/analyze/route.ts",
      "utf8",
    );
    expect(route.indexOf("dependencies.userExists(")).toBeLessThan(
      route.indexOf("dependencies.consumeQuota("),
    );
  });
});

/**
 * ROTAYA BAGLANMA.
 *
 * Kotanin dogru olmasi yetmez; SAGLAYICIYA gitmeden once cagrilmasi gerekir.
 */
describe("rota kotayi dogru anda harcar", () => {
  const route = readFileSync(
    "src/app/api/receipts/analyze/route.ts",
    "utf8",
  );

  it("kota, cikarma cagrisindan ONCE dusulur", () => {
    const quotaAt = route.indexOf("dependencies.consumeQuota(");
    const extractAt = route.indexOf("dependencies.extract(");
    expect(quotaAt).toBeGreaterThan(-1);
    expect(extractAt).toBeGreaterThan(-1);
    expect(quotaAt).toBeLessThan(extractAt);
  });

  it("kota, DOGRULAMALARDAN sonra dusulur", () => {
    /* Bozuk bir dosya yuzunden hak yanmamali. */
    const quotaAt = route.indexOf("dependencies.consumeQuota(");
    for (const guard of [
      "UNSUPPORTED_FILE_TYPE",
      "FILE_TOO_LARGE",
      "EMPTY_FILE",
      "AUTH_REQUIRED",
    ]) {
      expect(route.indexOf(guard)).toBeLessThan(quotaAt);
    }
  });

  it("kimlik OTURUMDAN gelir", () => {
    expect(route).toContain("userId: authentication.user.id");
  });

  it("kalan hak yanitta doner", () => {
    expect(route).toContain("remainingAnalyses: quota.remaining");
  });

  it("kota reddederse SAGLAYICI hic cagrilmaz", async () => {
    const extract = vi.fn();
    const { createReceiptAnalyzePost } = await import(
      "@/app/api/receipts/analyze/route"
    );
    const POST = createReceiptAnalyzePost({
      authenticate: async () => ({
        status: "authenticated" as const,
        user: { id: USER, name: "Ada", image: null },
      }),
      configured: () => true,
      extract,
      createRepository: async () => ({}) as unknown as SharedBillRepository,
      userExists: async () => ({ ok: true as const, exists: true }),
      consumeQuota: async () => ({
        ok: false as const,
        status: 429,
        code: "DAILY_LIMIT_REACHED",
        message: "doldu",
        remaining: 0,
      }),
      now: () => NOW,
    });

    const body = new FormData();
    body.append(
      "receipt",
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])], "f.jpg", {
        type: "image/jpeg",
      }),
    );
    const response = await POST(
      new Request("https://ornek.invalid/api/receipts/analyze", {
        method: "POST",
        body,
      }),
    );

    expect(response.status).toBe(429);
    expect(extract).not.toHaveBeenCalled();
  });
});

describe("REDDEDILEN istek baska kullanicinin hakkini YIYEMEZ", () => {
  /*
   * BULGU (bagimsiz inceleme). Iki sayac ayri ayri atomikti ama BIRLIKTE
   * atomik degildi: once genel tavan dusuluyor, sonra kullanici sayaci.
   * Kullanicinin hakki dolmussa istek reddediliyor, ama GENEL SAYAC ZATEN
   * ARTMIS oluyordu ve geri alinmiyordu.
   *
   * Sonuc: hakki dolmus TEK bir kullanici, reddedilen isteklerle genel
   * tavani tuketip DIGER HERKESI kilitleyebiliyordu. Hicbir OpenAI cagrisi
   * yapilmadan, yalnizca reddedilen isteklerle.
   */
  const DAY_MS = Date.UTC(2026, 8, 5, 12, 0, 0);
  const ATTACKER = "11111111-1111-4111-8111-111111111111";
  const VICTIM = "22222222-2222-4222-8222-222222222222";
  const PER_USER = 3;
  const TOTAL = 8;

  it("hakki dolan kullanici GENEL tavani tuketemez", async () => {
    const repository = createFakeSharedBillRepository();
    const spend = (userId: string) =>
      consumeAnalysisQuota({
        userId,
        repository,
        nowMs: DAY_MS,
        perUserLimit: PER_USER,
        totalLimit: TOTAL,
      });

    for (let i = 0; i < PER_USER; i += 1) {
      expect((await spend(ATTACKER)).ok, `kabul ${i + 1}`).toBe(true);
    }
    /* Kendi hakki bitti; bundan sonrasi REDDEDILMELI ve HICBIR sayaci artirmamali. */
    for (let i = 0; i < 20; i += 1) {
      const rejected = await spend(ATTACKER);
      expect(rejected.ok).toBe(false);
    }

    const day = quotaDay(DAY_MS);
    expect(repository.analysisQuota.get(`${ATTACKER}|${day}`)).toBe(PER_USER);
    /* KRITIK: genel sayac yalnizca KABUL EDILEN istekler kadar artmalidir. */
    expect(repository.analysisQuota.get(`${GLOBAL_QUOTA_KEY}|${day}`)).toBe(
      PER_USER,
    );
  });

  it("hakki dolan kullanicidan sonra BASKA kullanici hala analiz yapabilir", async () => {
    const repository = createFakeSharedBillRepository();
    const spend = (userId: string) =>
      consumeAnalysisQuota({
        userId,
        repository,
        nowMs: DAY_MS,
        perUserLimit: PER_USER,
        totalLimit: TOTAL,
      });

    for (let i = 0; i < PER_USER; i += 1) await spend(ATTACKER);
    for (let i = 0; i < 20; i += 1) await spend(ATTACKER);

    const victim = await spend(VICTIM);
    expect(victim.ok, "kurbanin ilk istegi kabul edilmeli").toBe(true);
  });
});

describe("BASARISIZ ayirma hicbir sayaci kirletmez", () => {
  const DAY_MS = Date.UTC(2026, 8, 5, 12, 0, 0);
  const WHO = "33333333-3333-4333-8333-333333333333";
  const day = quotaDay(DAY_MS);

  const spend = (repository: SharedBillRepository, limits: [number, number]) =>
    consumeAnalysisQuota({
      userId: WHO,
      repository,
      nowMs: DAY_MS,
      perUserLimit: limits[0],
      totalLimit: limits[1],
    });

  it("GENEL tavan dolduysa kullanicinin hakkina DOKUNULMAZ", async () => {
    const repository = createFakeSharedBillRepository();
    /* Genel tavani baska kullanicilar doldurmus olsun. */
    repository.analysisQuota.set(`${GLOBAL_QUOTA_KEY}|${day}`, 5);

    const outcome = await spend(repository, [10, 5]);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe("SERVICE_BUSY");
    /* Kullanicinin satiri hic OLUSMAMALI: hakki durmali. */
    expect(repository.analysisQuota.get(`${WHO}|${day}`)).toBeUndefined();
    expect(repository.analysisQuota.get(`${GLOBAL_QUOTA_KEY}|${day}`)).toBe(5);
  });

  it("KISISEL hak dolduysa genel tavana DOKUNULMAZ", async () => {
    const repository = createFakeSharedBillRepository();
    repository.analysisQuota.set(`${WHO}|${day}`, 2);
    repository.analysisQuota.set(`${GLOBAL_QUOTA_KEY}|${day}`, 2);

    const outcome = await spend(repository, [2, 50]);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe("DAILY_LIMIT_REACHED");
    expect(repository.analysisQuota.get(`${GLOBAL_QUOTA_KEY}|${day}`)).toBe(2);
    expect(repository.analysisQuota.get(`${WHO}|${day}`)).toBe(2);
  });

  it("DEPO erisilemezse hicbir sayac artmaz", async () => {
    const repository = createFakeSharedBillRepository({
      failWithUnavailable: true,
    });
    const outcome = await spend(repository, [10, 50]);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe("SERVICE_UNAVAILABLE");
    expect(repository.analysisQuota.size).toBe(0);
  });

  it("BASARILI ayirma iki sayaci da TAM BIR kez artirir", async () => {
    const repository = createFakeSharedBillRepository();
    const outcome = await spend(repository, [10, 50]);
    expect(outcome.ok).toBe(true);
    expect(repository.analysisQuota.get(`${WHO}|${day}`)).toBe(1);
    expect(repository.analysisQuota.get(`${GLOBAL_QUOTA_KEY}|${day}`)).toBe(1);
  });
});
