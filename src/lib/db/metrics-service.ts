import {
  BUDGET_CALLS_PER_WINDOW,
  BUDGET_WINDOW_MS,
  COINGECKO_PROVIDER_KEY,
  budgetWindowStart,
} from "@/lib/rates/provider-budget";
import {
  DAILY_ANALYSES_PER_USER,
  DAILY_ANALYSES_TOTAL,
  GLOBAL_QUOTA_KEY,
  quotaDay,
  remainingAfter,
} from "@/lib/receipt/quota";

import { RETENTION_BATCH_LIMIT, retentionCutoffMs } from "./retention";
import type { MetricsCounts, SharedBillRepository } from "./shared-bill-repository";

/**
 * İŞLETME SAYAÇLARI — saf politika. YALNIZCA SUNUCU.
 *
 * Depo yalnızca SAYAR; hangi sayının fazla olduğuna burası karar verir.
 *
 * NEDEN SADECE SAYI DEĞİL, EŞİK DE: ham bir sayı "harekete geç" demez.
 * `pastRetention: 500` tek başına bir bilgi değildir; parti sınırının 500
 * olduğunu bilen biri için "temizlik geriye düşüyor" demektir. Eşiği yanıta
 * gömmek, o bilgiyi hatırlamak zorunda kalmamak demektir.
 *
 * GİZLİLİK: burada da yalnızca toplamlar vardır. Kullanıcı kimliği, cüzdan
 * adresi, hesap kimliği ya da işlem hash'i bu yoldan GEÇMEZ.
 */

/**
 * Günlük tavanın hangi oranında uyarılacağı.
 *
 * Neden %80: tavan dolduğunda öğrenmek geç kalmaktır — o an analiz servisi
 * herkese kapanmıştır. %80, aynı gün içinde tavanı yükseltmeye ya da nedenini
 * araştırmaya yetecek kadar erkendir; daha düşük bir eşik ise yoğun her günü
 * uyarıya çevirir ve uyarıyı anlamsızlaştırır.
 */
export const QUOTA_WARNING_RATIO = 0.8;

/**
 * "İnsan bakmalı" kovasındaki ödeme denemesi durumları.
 *
 * `reverted`: zincir işlemi geri aldı. `unknown`: makbuz okunamadı, yani
 * paranın gidip gitmediği BİLİNMİYOR. İkisi de kendiliğinden çözülmez.
 */
export const ATTENTION_ATTEMPT_STATUSES = ["reverted", "unknown"] as const;

/** Borç satırında elle inceleme isteyen durum. */
export const REVIEW_DEBT_STATUS = "review_required";

export type MetricsReport = Readonly<{
  /** Ölçümün alındığı an, ISO 8601 UTC. */
  observedAt: string;
  users: Readonly<{ total: number; newIn24h: number; newIn7d: number }>;
  bills: Readonly<{
    total: number;
    open: number;
    createdIn24h: number;
    createdIn7d: number;
  }>;
  debts: Readonly<{
    byStatus: Readonly<Record<string, number>>;
    /** Elle incelenmeyi bekleyen borç satırı. */
    needsReview: number;
  }>;
  attempts: Readonly<{
    byStatus: Readonly<Record<string, number>>;
    /** `reverted` + `unknown`; her biri bir insanın bakması gereken kayıt. */
    needsAttention: number;
  }>;
  analyses: Readonly<{
    /** `YYYY-MM-DD`, UTC — sayaçların kendi gün tanımı. */
    day: string;
    used: number;
    limit: number;
    remaining: number;
    activeUsers: number;
    usersAtCap: number;
    userLimit: number;
    /** Tavanın %80'i aşıldı: bugün içinde bakılmalı. */
    warning: boolean;
  }>;
  provider: Readonly<{
    callsIn24h: number;
    /** Bütçesi dolmuş pencere sayısı; her biri reddedilmiş bir çağrıdır. */
    windowsAtCap: number;
    limitPerWindow: number;
  }>;
  retention: Readonly<{
    /** Silinmeye uygun kayıt sayısı. */
    eligible: number;
    /** Bir çalışmada silinebilecek en fazla kayıt. */
    batchLimit: number;
    /**
     * Uygun sayısı parti sınırına ULAŞTIYSA temizlik geriye düşüyor demektir:
     * günlük görev birikmiş kuyruğu kapatamıyor ve tablo büyümeye devam eder.
     */
    behind: boolean;
  }>;
}>;

export type ReadMetricsReportOutcome =
  | { ok: true; report: MetricsReport }
  | { ok: false; reason: "unavailable" };

/** Bilinmeyen bir durum anahtarı sıfır sayılır; eksik olması hata değildir. */
function countOf(
  byStatus: Readonly<Record<string, number>>,
  status: string,
): number {
  return byStatus[status] ?? 0;
}

/** Sayaçları rapora çevirir. Saf: saat ve sınırlar dışarıdan gelir. */
export function toMetricsReport(
  counts: MetricsCounts,
  nowMs: number,
): MetricsReport {
  const attention = ATTENTION_ATTEMPT_STATUSES.reduce(
    (total, status) => total + countOf(counts.attemptsByStatus, status),
    0,
  );
  return {
    observedAt: new Date(nowMs).toISOString(),
    users: counts.users,
    bills: {
      total: counts.bills.total,
      open: counts.bills.open,
      createdIn24h: counts.bills.createdIn24h,
      createdIn7d: counts.bills.createdIn7d,
    },
    debts: {
      byStatus: counts.debtsByStatus,
      needsReview: countOf(counts.debtsByStatus, REVIEW_DEBT_STATUS),
    },
    attempts: {
      byStatus: counts.attemptsByStatus,
      needsAttention: attention,
    },
    analyses: {
      day: quotaDay(nowMs),
      used: counts.analyses.globalUsed,
      limit: DAILY_ANALYSES_TOTAL,
      remaining: remainingAfter(
        counts.analyses.globalUsed,
        DAILY_ANALYSES_TOTAL,
      ),
      activeUsers: counts.analyses.activeUsers,
      usersAtCap: counts.analyses.usersAtCap,
      userLimit: DAILY_ANALYSES_PER_USER,
      warning:
        counts.analyses.globalUsed >=
        DAILY_ANALYSES_TOTAL * QUOTA_WARNING_RATIO,
    },
    provider: {
      callsIn24h: counts.provider.calls,
      windowsAtCap: counts.provider.windowsAtCap,
      limitPerWindow: BUDGET_CALLS_PER_WINDOW,
    },
    retention: {
      eligible: counts.bills.pastRetention,
      batchLimit: RETENTION_BATCH_LIMIT,
      behind: counts.bills.pastRetention >= RETENTION_BATCH_LIMIT,
    },
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Depoyu okur ve raporu üretir.
 *
 * Eşiklerin TAMAMI burada hesaplanır ve depoya parametre olarak verilir:
 * sunucunun saati sorguya bırakılmaz, gün ve pencere hesabı saf işlevlerden
 * gelir ve testlerde belirlenimci kalır.
 */
export async function readMetricsReport(input: {
  repository: SharedBillRepository;
  nowMs: number;
}): Promise<ReadMetricsReportOutcome> {
  const outcome = await input.repository.readMetrics({
    since24hMs: input.nowMs - DAY_MS,
    since7dMs: input.nowMs - 7 * DAY_MS,
    retentionCutoffMs: retentionCutoffMs(input.nowMs),
    quotaDay: quotaDay(input.nowMs),
    globalQuotaKey: GLOBAL_QUOTA_KEY,
    userQuotaLimit: DAILY_ANALYSES_PER_USER,
    providerKey: COINGECKO_PROVIDER_KEY,
    /* Son 24 saatin kovaları; kova hesabı bütçeyle BİREBİR aynı işlevden. */
    providerWindowFrom: budgetWindowStart(input.nowMs - DAY_MS),
    providerLimitPerWindow: BUDGET_CALLS_PER_WINDOW,
  });
  if (!outcome.ok) {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, report: toMetricsReport(outcome.counts, input.nowMs) };
}

/** Pencere genişliği; rapor tüketicisi kovanın ne kadar olduğunu bilsin. */
export const PROVIDER_WINDOW_MS = BUDGET_WINDOW_MS;
