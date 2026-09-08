import { describe, expect, it } from "vitest";

import {
  BUDGET_CALLS_PER_WINDOW,
  COINGECKO_PROVIDER_KEY,
  budgetWindowStart,
} from "@/lib/rates/provider-budget";
import {
  DAILY_ANALYSES_PER_USER,
  DAILY_ANALYSES_TOTAL,
  GLOBAL_QUOTA_KEY,
  quotaDay,
} from "@/lib/receipt/quota";

import {
  QUOTA_WARNING_RATIO,
  readMetricsReport,
  toMetricsReport,
} from "./metrics-service";
import { RETENTION_BATCH_LIMIT, retentionCutoffMs } from "./retention";
import type {
  MetricsCounts,
  SharedBillRepository,
} from "./shared-bill-repository";

/**
 * İŞLETME SAYAÇLARI — eşik politikası.
 *
 * Depo yalnızca sayar; hangi sayının FAZLA olduğuna burası karar verir. Bu
 * testlerin işi o kararın sınırlarını sabitlemek: ham bir sayı "harekete geç"
 * demez, eşik der.
 */

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function counts(overrides: Partial<MetricsCounts> = {}): MetricsCounts {
  return {
    users: { total: 0, newIn24h: 0, newIn7d: 0 },
    bills: {
      total: 0,
      open: 0,
      createdIn24h: 0,
      createdIn7d: 0,
      pastRetention: 0,
    },
    debtsByStatus: {},
    attemptsByStatus: {},
    analyses: { globalUsed: 0, activeUsers: 0, usersAtCap: 0 },
    provider: { calls: 0, windowsAtCap: 0 },
    ...overrides,
  };
}

/** Depoya HANGI eşiklerin verildiğini görebilmek için. */
function stubRepository(value: MetricsCounts | "unavailable") {
  const seen: Record<string, unknown>[] = [];
  const repository = {
    async readMetrics(input: Record<string, unknown>) {
      seen.push(input);
      return value === "unavailable"
        ? { ok: false as const, reason: "unavailable" as const }
        : { ok: true as const, counts: value };
    },
  } as unknown as SharedBillRepository;
  return { repository, seen };
}

describe("gunluk tavan uyarisi", () => {
  it("tam %80'de UYARIR", () => {
    /*
     * Sınırın kendisi uyarı içindedir. Tavan dolduğunda öğrenmek geç
     * kalmaktır: o an analiz servisi herkese kapanmıştır.
     */
    const atThreshold = Math.ceil(DAILY_ANALYSES_TOTAL * QUOTA_WARNING_RATIO);
    const report = toMetricsReport(
      counts({ analyses: { globalUsed: atThreshold, activeUsers: 5, usersAtCap: 0 } }),
      NOW,
    );
    expect(report.analyses.warning).toBe(true);
  });

  it("esigin ALTINDA uyarmaz", () => {
    const below = Math.ceil(DAILY_ANALYSES_TOTAL * QUOTA_WARNING_RATIO) - 1;
    const report = toMetricsReport(
      counts({ analyses: { globalUsed: below, activeUsers: 5, usersAtCap: 0 } }),
      NOW,
    );
    expect(report.analyses.warning).toBe(false);
  });

  it("kalan hak NEGATIF olmaz", () => {
    const report = toMetricsReport(
      counts({
        analyses: {
          globalUsed: DAILY_ANALYSES_TOTAL + 10,
          activeUsers: 1,
          usersAtCap: 1,
        },
      }),
      NOW,
    );
    expect(report.analyses.remaining).toBe(0);
  });

  it("sinirlar KODDAKI sabitlerden gelir", () => {
    /*
     * Rapor kendi sayısını uydurursa, tavan değiştiği gün ölçüm eski sınırı
     * göstermeye devam eder ve sessizce yanlış olur.
     */
    const report = toMetricsReport(counts(), NOW);
    expect(report.analyses.limit).toBe(DAILY_ANALYSES_TOTAL);
    expect(report.analyses.userLimit).toBe(DAILY_ANALYSES_PER_USER);
    expect(report.provider.limitPerWindow).toBe(BUDGET_CALLS_PER_WINDOW);
    expect(report.retention.batchLimit).toBe(RETENTION_BATCH_LIMIT);
  });
});

describe("temizlik geriye dusuyor mu", () => {
  it("uygun sayisi parti SINIRINA ULASTIYSA geride demektir", () => {
    /*
     * Günlük görev bir çalışmada en fazla `RETENTION_BATCH_LIMIT` kayıt
     * siler. Uygun sayısı ona eşit ya da fazlaysa kuyruk kapanmıyor ve tablo
     * büyümeye devam eder.
     */
    const behind = toMetricsReport(
      counts({
        bills: {
          total: 9,
          open: 1,
          createdIn24h: 0,
          createdIn7d: 0,
          pastRetention: RETENTION_BATCH_LIMIT,
        },
      }),
      NOW,
    );
    expect(behind.retention.behind).toBe(true);
    expect(behind.retention.eligible).toBe(RETENTION_BATCH_LIMIT);

    const keepingUp = toMetricsReport(
      counts({
        bills: {
          total: 9,
          open: 1,
          createdIn24h: 0,
          createdIn7d: 0,
          pastRetention: RETENTION_BATCH_LIMIT - 1,
        },
      }),
      NOW,
    );
    expect(keepingUp.retention.behind).toBe(false);
  });
});

describe("insan bakmali kovasi", () => {
  it("reverted VE unknown birlikte sayilir", () => {
    /*
     * `reverted`: zincir işlemi geri aldı. `unknown`: makbuz okunamadı, yani
     * paranın gidip gitmediği bilinmiyor. İkisi de kendiliğinden çözülmez.
     */
    const report = toMetricsReport(
      counts({
        attemptsByStatus: {
          settled: 40,
          reverted: 2,
          unknown: 3,
          reserved: 1,
        },
      }),
      NOW,
    );
    expect(report.attempts.needsAttention).toBe(5);
    /* Ham kırılım da aynen taşınır; toplam onun yerine geçmez. */
    expect(report.attempts.byStatus.settled).toBe(40);
  });

  it("olmayan durum SIFIR sayilir, hata degil", () => {
    const report = toMetricsReport(counts({ attemptsByStatus: {} }), NOW);
    expect(report.attempts.needsAttention).toBe(0);
    expect(report.debts.needsReview).toBe(0);
  });

  it("review_required borc satiri ayrica sayilir", () => {
    const report = toMetricsReport(
      counts({ debtsByStatus: { paid: 10, review_required: 4 } }),
      NOW,
    );
    expect(report.debts.needsReview).toBe(4);
  });
});

describe("esikler depoya DOGRU verilir", () => {
  it("gun, pencere ve saklama siniri SAF islevlerden gelir", async () => {
    /*
     * Hiçbiri sorguda hesaplanmaz: sunucunun saatine ve saat dilimine bağlı
     * bir sayım, testlerde belirlenimci olmaz ve üretimde sessizce kayar.
     */
    const { repository, seen } = stubRepository(counts());
    const outcome = await readMetricsReport({ repository, nowMs: NOW });
    expect(outcome.ok).toBe(true);
    expect(seen).toHaveLength(1);

    expect(seen[0]).toMatchObject({
      since24hMs: NOW - DAY_MS,
      since7dMs: NOW - 7 * DAY_MS,
      retentionCutoffMs: retentionCutoffMs(NOW),
      quotaDay: quotaDay(NOW),
      globalQuotaKey: GLOBAL_QUOTA_KEY,
      userQuotaLimit: DAILY_ANALYSES_PER_USER,
      providerKey: COINGECKO_PROVIDER_KEY,
      /* Kova hesabı bütçeyle BİREBİR aynı işlevden. */
      providerWindowFrom: budgetWindowStart(NOW - DAY_MS),
      providerLimitPerWindow: BUDGET_CALLS_PER_WINDOW,
    });
  });

  it("gun UTC'dir", () => {
    const report = toMetricsReport(counts(), NOW);
    expect(report.analyses.day).toBe(new Date(NOW).toISOString().slice(0, 10));
    expect(report.observedAt).toBe(new Date(NOW).toISOString());
  });

  it("depo erisilemezse rapor URETILMEZ", async () => {
    /*
     * Erişilemezliği sıfırlarla dolu bir rapora çevirmek, boş bir grafiğe
     * bakıp "sorun yok" dedirtirdi.
     */
    const { repository } = stubRepository("unavailable");
    expect(await readMetricsReport({ repository, nowMs: NOW })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
