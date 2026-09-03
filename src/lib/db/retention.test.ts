import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { createRetentionGet } from "@/app/api/cron/retention/route";
import { SHARED_BILL_MAX_LIFETIME_MS } from "@/lib/arc/shared-bill";

import {
  BILL_RETENTION_AFTER_EXPIRY_MS,
  BILL_RETENTION_DAYS,
  BILL_TOTAL_RETENTION_MS,
  RETENTION_BATCH_LIMIT,
  isPastRetention,
  retentionCutoffMs,
} from "./retention";
import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";
import type { SharedBillRepository } from "./shared-bill-repository";

type FakeRepo = ReturnType<typeof createFakeSharedBillRepository>;

/**
 * SAKLAMA SURESI — TEMIZLIK.
 *
 * Bu is once YALNIZCA SAYAN haliyle yayina alindi ve uretimde olculdu: tablo
 * bos DEGILKEN uygun sayisi sifir dondu. Bu, esigin geleceye kaymadigini —
 * yani her kaydi eslestiren bozuk bir olcut olmadigini — kanitlar. Silme,
 * ayni esigi kullandigi icin o olcum bu adima da gecerlidir; bir test bu
 * esitligi zorluyor.
 *
 * Uc konu ayri ayri kanitlanir:
 *   1. ESIK: sinirin kendisi henuz uygun degildir, gelecege kayamaz.
 *   2. KAPI: adres herkese aciktir ve arkasinda GERI ALINAMAZ bir silme
 *      durur; sir yoksa uc hic calismaz.
 *   3. SILMENIN SEKLI: cocuktan ebeveyne sirali, tek islemde ve butun
 *      deyimler AYNI hedef kumesini kullanarak.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const SECRET = "cok-uzun-rastgele-bir-dizge-0123456789";

const request = (authorization?: string) =>
  ({
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? (authorization ?? null) : null,
    },
  }) as unknown as NextRequest;

function repositoryOf(
  count: number,
  options: { deleted?: number; total?: number } = {},
) {
  const deleteBillsPastRetention = vi.fn(
    async (input: { cutoffMs: number; limit: number }) => {
      void input;
      return { ok: true as const, deleted: options.deleted ?? count };
    },
  );
  const factory = vi.fn(
    async () =>
      ({
        countBillsPastRetention: vi.fn(async () => ({
          ok: true as const,
          count,
        })),
        countAllBills: vi.fn(async () => ({
          ok: true as const,
          count: options.total ?? count,
        })),
        deleteBillsPastRetention,
      }) as unknown as SharedBillRepository,
  );
  return Object.assign(factory, { deleteBillsPastRetention });
}

/**
 * Kayitli bir ortak hesap.
 *
 * Deponun KENDI yazma yolu kullanilir; testin ic durumu elle kurmasi,
 * "silme sonrasi kayit hala orada mi" sorusunu anlamsizlastirirdi.
 */
async function seedAt(
  repository: FakeRepo,
  billId: string,
  expiresAtMs: number,
) {
  const written = await repository.createSharedBill(
    {
      manifest: {
        billId,
        chainId: 5042002,
        recipient: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        recipientLabel: "Poyraz",
        debtsRoot: `0x${"1".repeat(64)}`,
        debtCount: 0,
        issuedAt: Math.floor((expiresAtMs - DAY) / 1000),
        expiresAt: Math.floor(expiresAtMs / 1000),
        schemaVersion: 1,
      } as never,
      debts: [],
      signature: `0x${"2".repeat(130)}`,
    },
    { createdByUserId: null },
  );
  expect(written.ok).toBe(true);
}

describe("sinir dogru hesaplanir", () => {
  it("saklama, hesabin OMRUNDEN sonra baslar", () => {
    expect(BILL_TOTAL_RETENTION_MS).toBe(
      SHARED_BILL_MAX_LIFETIME_MS + BILL_RETENTION_AFTER_EXPIRY_MS,
    );
    /* Politikadaki gun sayisi bu toplamdan turer, elle yazilmaz. */
    expect(BILL_RETENTION_DAYS).toBe(BILL_TOTAL_RETENTION_MS / DAY);
  });

  it("sinir GECMISTEDIR, gelecekte degil", () => {
    /* Ileri bir sinir, suresi HENUZ dolmamis kayitlari da kapsardi. */
    expect(retentionCutoffMs(NOW)).toBeLessThan(NOW);
    expect(NOW - retentionCutoffMs(NOW)).toBe(BILL_RETENTION_AFTER_EXPIRY_MS);
  });

  it("daha yeni suresi dolan kayit UYGUN DEGILDIR", () => {
    const expiredYesterday = NOW - DAY;
    expect(isPastRetention(expiredYesterday, NOW)).toBe(false);
  });

  it("saklama suresini gecmis kayit uygundur", () => {
    const longExpired = NOW - BILL_RETENTION_AFTER_EXPIRY_MS - DAY;
    expect(isPastRetention(longExpired, NOW)).toBe(true);
  });

  it("SINIRIN KENDISI henuz uygun degildir", () => {
    /* Esit an gecmis sayilmaz; bir gunluk kayma burada yakalanir. */
    expect(isPastRetention(retentionCutoffMs(NOW), NOW)).toBe(false);
    expect(isPastRetention(retentionCutoffMs(NOW) - 1, NOW)).toBe(true);
  });

  it("suresi HENUZ dolmamis kayit hicbir kosulda uygun olamaz", () => {
    const future = NOW + DAY;
    expect(isPastRetention(future, NOW)).toBe(false);
  });
});

describe("kapi: bu adres herkese acik", () => {
  it("sir tanimli degilse uc CALISMAZ", async () => {
    const createRepository = repositoryOf(0);
    const GET = createRetentionGet({
      createRepository,
      readSecret: () => undefined,
      now: () => NOW,
    });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    /* Sessizce korumasiz calismaktansa hic calismamalidir. */
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("BOS sir de yapilandirilmamis sayilir", async () => {
    const createRepository = repositoryOf(0);
    const GET = createRetentionGet({
      createRepository,
      readSecret: () => "",
      now: () => NOW,
    });

    expect((await GET(request("Bearer "))).status).toBe(503);
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("basliksiz istek reddedilir ve depo YARATILMAZ", async () => {
    const createRepository = repositoryOf(0);
    const GET = createRetentionGet({
      createRepository,
      readSecret: () => SECRET,
      now: () => NOW,
    });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("yanlis sir reddedilir", async () => {
    const GET = createRetentionGet({
      createRepository: repositoryOf(0),
      readSecret: () => SECRET,
      now: () => NOW,
    });

    for (const wrong of [
      "Bearer yanlis",
      SECRET,
      `Bearer ${SECRET} `,
      `bearer ${SECRET}`,
      `Basic ${SECRET}`,
    ]) {
      expect((await GET(request(wrong))).status).toBe(401);
    }
  });

  it("dogru sirla gecer", async () => {
    const GET = createRetentionGet({
      createRepository: repositoryOf(3),
      readSecret: () => SECRET,
      now: () => NOW,
    });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
  });
});

describe("once sayar, sonra siler", () => {
  it("hicbir kayit uygun degilse SILME HIC CAGRILMAZ", async () => {
    /*
     * Bos bir temizlik zararsiz olurdu; cagrilmamasi, gunlukteki
     * "0 uygun -> 0 silindi" satirinin gercekten bir sey yapilmadigini
     * gostermesini saglar.
     */
    const createRepository = repositoryOf(0);
    const GET = createRetentionGet({
      createRepository,
      readSecret: () => SECRET,
      now: () => NOW,
    });

    const body = (await (await GET(request(`Bearer ${SECRET}`))).json()) as {
      deleted: number;
    };

    expect(createRepository.deleteBillsPastRetention).not.toHaveBeenCalled();
    expect(body.deleted).toBe(0);
  });

  it("uygun kayit varsa silme AYNI sinirla cagrilir", async () => {
    /* Sayimda olculen esik ile silinen esik ayrisamaz. */
    const createRepository = repositoryOf(4);
    const GET = createRetentionGet({
      createRepository,
      readSecret: () => SECRET,
      now: () => NOW,
    });

    await GET(request(`Bearer ${SECRET}`));

    expect(createRepository.deleteBillsPastRetention).toHaveBeenCalledTimes(1);
    const call = createRepository.deleteBillsPastRetention.mock.calls[0]?.[0];
    expect(call?.cutoffMs).toBe(retentionCutoffMs(NOW));
    expect(call?.limit).toBe(RETENTION_BATCH_LIMIT);
  });

  it("silme dusrse basarili sayilmaz", async () => {
    const GET = createRetentionGet({
      createRepository: vi.fn(
        async () =>
          ({
            countBillsPastRetention: vi.fn(async () => ({
              ok: true as const,
              count: 3,
            })),
            countAllBills: vi.fn(async () => ({ ok: true as const, count: 9 })),
            deleteBillsPastRetention: vi.fn(async () => ({
              ok: false as const,
              reason: "unavailable" as const,
            })),
          }) as unknown as SharedBillRepository,
      ),
      readSecret: () => SECRET,
      now: () => NOW,
    });

    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(503);
  });

  it("yanit sayiyi ve sinirlari bildirir", async () => {
    const GET = createRetentionGet({
      createRepository: repositoryOf(42),
      readSecret: () => SECRET,
      now: () => NOW,
    });

    const response = await GET(request(`Bearer ${SECRET}`));
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.eligible).toBe(42);
    expect(body.retentionDays).toBe(BILL_RETENTION_DAYS);
    expect(body.cutoff).toBe(new Date(retentionCutoffMs(NOW)).toISOString());
  });

  it("TOPLAM da bildirilir", async () => {
    /*
     * Uygun sayisi sifirken toplam da sifirsa, olcutun gercekten bir sey
     * bulup bulamadigi BILINEMEZ. Ikisi birlikte anlamlidir.
     */
    const GET = createRetentionGet({
      createRepository: repositoryOf(0, { total: 12 }),
      readSecret: () => SECRET,
      now: () => NOW,
    });

    const body = (await (await GET(request(`Bearer ${SECRET}`))).json()) as {
      total: number;
      eligible: number;
    };

    expect(body.total).toBe(12);
    expect(body.eligible).toBe(0);
  });

  it("toplam okunamazsa temizlik yine de surer", async () => {
    /* Tanisal bir sayidir; isin kendisini engellememelidir. */
    const GET = createRetentionGet({
      createRepository: vi.fn(
        async () =>
          ({
            countBillsPastRetention: vi.fn(async () => ({
              ok: true as const,
              count: 0,
            })),
            countAllBills: vi.fn(async () => ({
              ok: false as const,
              reason: "unavailable" as const,
            })),
            deleteBillsPastRetention: vi.fn(),
          }) as unknown as SharedBillRepository,
      ),
      readSecret: () => SECRET,
      now: () => NOW,
    });

    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { total: number | null }).total).toBeNull();
  });

  it("depo okunamazsa BASARILI sayilmaz", async () => {
    const GET = createRetentionGet({
      createRepository: vi.fn(
        async () =>
          ({
            countBillsPastRetention: vi.fn(async () => ({
              ok: false as const,
              reason: "unavailable" as const,
            })),
          }) as unknown as SharedBillRepository,
      ),
      readSecret: () => SECRET,
      now: () => NOW,
    });

    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(503);
  });

  it("yanit ONBELLEGE ALINMAZ", async () => {
    const GET = createRetentionGet({
      createRepository: repositoryOf(1),
      readSecret: () => SECRET,
      now: () => NOW,
    });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

/**
 * SILMENIN SEKLI YAPISAL OLARAK SABITLENIR.
 *
 * Bu blok bir onceki adimda "hicbir silme yolu yoktur" diyordu ve o gun
 * dogruydu. Silme eklenirken BILEREK degistirildi; simdi silmenin dogru
 * bicimde — sirali, tek islemde ve sayimla ayni esikle — yapildigini zorluyor.
 */
describe("silme dogru bicimde yapilir", () => {
  const route = readFileSync("src/app/api/cron/retention/route.ts", "utf8");
  const retention = readFileSync("src/lib/db/retention.ts", "utf8");
  const neon = readFileSync(
    "src/lib/db/neon-shared-bill-repository.ts",
    "utf8",
  );

  it("uc, silmeyi UYGUN KAYIT VARSA cagirir", () => {
    expect(route).toContain("if (counted.count > 0)");
    expect(route).toContain("deleteBillsPastRetention({");
  });

  it("saklama modulu bir sorgu bile tasimaz", () => {
    /* Sinirlar burada, sorgular depo katmaninda durur. */
    expect(retention).not.toMatch(/\bDELETE\b/);
    expect(retention).not.toMatch(/\bSELECT\b/);
  });

  it("silme sirasi COCUKTAN EBEVEYNE ve hicbir tablo atlanmaz", () => {
    /*
     * Cascade'e GUVENILMEZ: shared_bill_payment_attempts, teklifleri
     * ON DELETE RESTRICT ile referansliyor. Tek bir cascade'li silme, sira
     * yuzunden yabanci anahtar hatasiyla dusebilir.
     */
    const start = neon.indexOf("const RETENTION_DELETE_ORDER = [");
    const order = neon.slice(start, neon.indexOf("] as const;", start));

    const expected = [
      "shared_bill_payment_attempts",
      "shared_bill_payment_offers",
      "shared_bill_sessions",
      "shared_bill_auth_nonces",
      "shared_bill_debts",
    ];
    const positions = expected.map((table) => order.indexOf(`"${table}"`));
    expect(positions.every((position) => position > -1)).toBe(true);
    /* Sira ARTAN olmali: denemeler tekliflerden ONCE gider. */
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    /* Ebeveyn en sonda, ayri deyimde. */
    expect(neon).toContain("const DELETE_RETENTION_BILLS = `");
    expect(order).not.toContain('"shared_bills"');
  });

  it("butun silmeler AYNI hedef kumesini kullanir", () => {
    /*
     * Farkli kumeler, borc satirlari silinmis ama kendisi DURAN bir hesap
     * birakabilirdi. Bu yuzden olcut tek yerde tanimlanip her deyime
     * gomulur.
     */
    const start = neon.indexOf("const RETENTION_TARGETS = `");
    const targets = neon.slice(start, neon.indexOf("`;", start));

    expect(targets).toContain("FROM shared_bills");
    expect(targets).toContain("WHERE expires_at <");
    /* Belirlenimci secim: siralama olmadan LIMIT her deyimde kayabilir. */
    expect(targets).toContain("ORDER BY");
    expect(targets).toContain("LIMIT $2");

    /* Cocuklar ve ebeveyn, ayni ifadeyi ENTERPOLE eder. */
    expect(neon).toContain("WHERE bill_id IN (${RETENTION_TARGETS})");
  });

  it("silme esigi SAYMA esigiyle birebir aynidir", () => {
    /*
     * Uretimde olculen sey sayimdi; silmenin ondan ayrilmasi, olcumu
     * gecersiz kilardi.
     */
    const countStart = neon.indexOf("const COUNT_BILLS_PAST_RETENTION = `");
    const count = neon.slice(countStart, neon.indexOf("`;", countStart));
    const targetStart = neon.indexOf("const RETENTION_TARGETS = `");
    const targets = neon.slice(targetStart, neon.indexOf("`;", targetStart));

    const predicate = "expires_at < to_timestamp($1 / 1000.0)";
    expect(count).toContain(predicate);
    expect(targets).toContain(predicate);
  });

  it("silme TEK ISLEMDE yapilir", () => {
    /* Yarim temizlenmis bir hesap kalmamalidir. */
    const start = neon.indexOf("async deleteBillsPastRetention(");
    const body = neon.slice(start, start + 1400);
    expect(body).toContain("sql.transaction(");
  });

  it("sayma sorgusu gercekten SAYAR", () => {
    const start = neon.indexOf("const COUNT_BILLS_PAST_RETENTION = `");
    const sql = neon.slice(start, neon.indexOf("`;", start));
    expect(sql).toContain("SELECT count(*)");
    expect(sql).toContain("FROM shared_bills");
    /* Sinir SORGUNUN icindedir; cagirana birakilmaz. */
    expect(sql).toContain("WHERE expires_at <");
    expect(sql).toContain("$1");
  });
});

/**
 * SAHTE DEPO ile SQL AYNI SINIRI kullanmalidir.
 *
 * Bu depoda calisan bir Postgres yok. Sahte deponun gevsek davranmasi,
 * gercek sorgudaki bir gunluk kaymayi gizlerdi.
 */
describe("sayma: sahte depo SQL ile ayni olcutu uygular", () => {
  it("yalnizca SINIRDAN ONCE suresi dolanlar sayilir", async () => {
    const repository = createFakeSharedBillRepository();
    const cutoff = retentionCutoffMs(NOW);
    await seedAt(repository, "eski", cutoff - DAY);
    await seedAt(repository, "tam-sinir", cutoff);
    await seedAt(repository, "yeni", cutoff + DAY);
    await seedAt(repository, "acik", NOW + DAY);

    const counted = await repository.countBillsPastRetention({
      cutoffMs: cutoff,
    });

    /* Yalnizca "eski". Sinirin KENDISI dahil degildir. */
    expect(counted).toEqual({ ok: true, count: 1 });
  });

  it("hic kayit yoksa sifir doner, hata degil", async () => {
    const repository = createFakeSharedBillRepository();

    expect(
      await repository.countBillsPastRetention({
        cutoffMs: retentionCutoffMs(NOW),
      }),
    ).toEqual({ ok: true, count: 0 });
  });

  it("silme: yalnizca SINIRDAN ONCE suresi dolanlar gider", async () => {
    const repository = createFakeSharedBillRepository();
    const cutoff = retentionCutoffMs(NOW);
    await seedAt(repository, "eski", cutoff - DAY);
    await seedAt(repository, "tam-sinir", cutoff);
    await seedAt(repository, "acik", NOW + DAY);

    const removed = await repository.deleteBillsPastRetention({
      cutoffMs: cutoff,
      limit: 100,
    });

    expect(removed).toEqual({ ok: true, deleted: 1 });
    expect(repository.bills.has("eski")).toBe(false);
    /* Sinirin KENDISI ve acik hesap DURUR. */
    expect(repository.bills.has("tam-sinir")).toBe(true);
    expect(repository.bills.has("acik")).toBe(true);
  });

  it("silme UST SINIRA uyar", async () => {
    const repository = createFakeSharedBillRepository();
    const cutoff = retentionCutoffMs(NOW);
    await seedAt(repository, "a", cutoff - 3 * DAY);
    await seedAt(repository, "b", cutoff - 2 * DAY);
    await seedAt(repository, "c", cutoff - DAY);

    const removed = await repository.deleteBillsPastRetention({
      cutoffMs: cutoff,
      limit: 2,
    });

    expect(removed).toEqual({ ok: true, deleted: 2 });
    expect(repository.bills.size).toBe(1);
    /* EN ESKI olanlar once gider; secim belirlenimcidir. */
    expect(repository.bills.has("c")).toBe(true);
  });

  it("silme, kalan cagrilarda kaldigi yerden surer", async () => {
    const repository = createFakeSharedBillRepository();
    const cutoff = retentionCutoffMs(NOW);
    await seedAt(repository, "a", cutoff - 3 * DAY);
    await seedAt(repository, "b", cutoff - 2 * DAY);

    await repository.deleteBillsPastRetention({ cutoffMs: cutoff, limit: 1 });
    const second = await repository.deleteBillsPastRetention({
      cutoffMs: cutoff,
      limit: 1,
    });

    expect(second).toEqual({ ok: true, deleted: 1 });
    expect(repository.bills.size).toBe(0);
  });

  it("silme: uygun kayit yoksa hicbir sey gitmez", async () => {
    const repository = createFakeSharedBillRepository();
    await seedAt(repository, "acik", NOW + DAY);

    const removed = await repository.deleteBillsPastRetention({
      cutoffMs: retentionCutoffMs(NOW),
      limit: 100,
    });

    expect(removed).toEqual({ ok: true, deleted: 0 });
    expect(repository.bills.size).toBe(1);
  });

  it("silme: depo erisilemezse basarili sayilmaz", async () => {
    const repository = createFakeSharedBillRepository({
      failWithUnavailable: true,
    });

    const removed = await repository.deleteBillsPastRetention({
      cutoffMs: retentionCutoffMs(NOW),
      limit: 100,
    });

    expect(removed.ok).toBe(false);
  });

  it("depo erisilemezse sifir DEGIL, hata doner", async () => {
    /* Sifirla karistirilirsa "silinecek yok" sanilir. */
    const repository = createFakeSharedBillRepository({
      failWithUnavailable: true,
    });

    const counted = await repository.countBillsPastRetention({
      cutoffMs: retentionCutoffMs(NOW),
    });

    expect(counted.ok).toBe(false);
  });
});

/**
 * ZAMANLANMIS GOREV.
 *
 * Hobby planinda cron GUNDE BIR KEZ calisabilir; daha sik bir ifade
 * DEPLOY'U DUSURUR. Yani yanlis ifade uygulamayi yayindan alir.
 */
describe("cron yapilandirmasi", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: { path: string; schedule: string }[];
  };

  it("ucu dogru adrese baglar", () => {
    expect(config.crons).toHaveLength(1);
    expect(config.crons[0]?.path).toBe("/api/cron/retention");
  });

  it("gunde BIR KEZ calisir", () => {
    /*
     * Saat ve dakika alanlari sabit olmali; "*" ya da adim ifadesi gunde
     * birden fazla calisma demektir ve deploy hatasi verir.
     */
    const [minute, hour] = (config.crons[0]?.schedule ?? "").split(" ");
    expect(minute).toMatch(/^\d+$/);
    expect(hour).toMatch(/^\d+$/);
  });
});
