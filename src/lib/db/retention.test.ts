import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { createRetentionGet } from "@/app/api/cron/retention/route";
import { SHARED_BILL_MAX_LIFETIME_MS } from "@/lib/arc/shared-bill";

import {
  BILL_RETENTION_AFTER_EXPIRY_MS,
  BILL_RETENTION_DAYS,
  BILL_TOTAL_RETENTION_MS,
  isPastRetention,
  retentionCutoffMs,
} from "./retention";
import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";
import type { SharedBillRepository } from "./shared-bill-repository";

type FakeRepo = ReturnType<typeof createFakeSharedBillRepository>;

/**
 * SAKLAMA SURESI — 1. ADIM: YALNIZCA SAYMA.
 *
 * Bu adimda HICBIR SEY SILINMEZ. Amac, geri donusu olmayan bir temizligi
 * acmadan once kac kaydin etkilenecegini olcmek. Testlerin buyuk kismi tam
 * da bunu, yani "silme YOK" oldugunu sabitler; sonraki adimda silme
 * eklendiginde bu testler bilerek degistirilmek zorunda kalir.
 *
 * Ikinci konu kapidir. Bu adres HERKESE ACIKTIR; korumasiz kalirsa ileride
 * buraya eklenecek silme, yabancilarin tetikleyebilecegi bir dugmeye doner.
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

function repositoryOf(count: number) {
  return vi.fn(
    async () =>
      ({
        countBillsPastRetention: vi.fn(async () => ({
          ok: true as const,
          count,
        })),
      }) as unknown as SharedBillRepository,
  );
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

describe("sayar, SILMEZ", () => {
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

  it("yanit bu adimda SILME OLMADIGINI acikca soyler", async () => {
    const GET = createRetentionGet({
      createRepository: repositoryOf(42),
      readSecret: () => SECRET,
      now: () => NOW,
    });

    const body = (await (await GET(request(`Bearer ${SECRET}`))).json()) as {
      deleted: number;
      mode: string;
    };

    expect(body.deleted).toBe(0);
    expect(body.mode).toBe("count-only");
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
 * "SILME YOK" YAPISAL OLARAK SABITLENIR.
 *
 * Niyet beyani yetmez: sonraki adimda silme eklendiginde bu testlerin
 * BILEREK degistirilmesi gerekir, kazara gecmesi degil.
 */
describe("bu adimda hicbir silme yolu yoktur", () => {
  const route = readFileSync("src/app/api/cron/retention/route.ts", "utf8");
  const retention = readFileSync("src/lib/db/retention.ts", "utf8");
  const neon = readFileSync(
    "src/lib/db/neon-shared-bill-repository.ts",
    "utf8",
  );

  it("uc, silme cagrisi ICERMEZ", () => {
    expect(route).not.toMatch(/\bdelete\b/i);
  });

  it("saklama modulu bir sorgu bile tasimaz", () => {
    expect(retention).not.toMatch(/\bDELETE\b/);
    expect(retention).not.toMatch(/\bSELECT\b/);
  });

  it("shared_bills icin hicbir DELETE sorgusu yoktur", () => {
    const deletes = neon.match(/DELETE FROM \w+/g) ?? [];
    expect(deletes).not.toContain("DELETE FROM shared_bills");
    expect(deletes).not.toContain("DELETE FROM shared_bill_debts");
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
  /* Deponun KENDI yazma yolu; testin ic durumu elle kurmasi olcumu bozardi. */
  async function seed(
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

  it("yalnizca SINIRDAN ONCE suresi dolanlar sayilir", async () => {
    const repository = createFakeSharedBillRepository();
    const cutoff = retentionCutoffMs(NOW);
    await seed(repository, "eski", cutoff - DAY);
    await seed(repository, "tam-sinir", cutoff);
    await seed(repository, "yeni", cutoff + DAY);
    await seed(repository, "acik", NOW + DAY);

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
