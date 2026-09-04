import {
  DAILY_ANALYSES_PER_USER,
  DAILY_ANALYSES_TOTAL,
  GLOBAL_QUOTA_KEY,
  quotaDay,
  remainingAfter,
} from "@/lib/receipt/quota";

import { isAppUserId } from "./shared-bill-listing-service";
import type { SharedBillRepository } from "./shared-bill-repository";

/**
 * FİŞ ANALİZİ KOTASININ HARCANMASI.
 *
 * İki sayaç vardır ve SIRA ÖNEMLİDİR: önce GENEL tavan, sonra kullanıcı.
 *
 * Sebebi, anormallik olduğunda hangi yöne sapılacağı. İki sayaç ayrı ayrı
 * atomiktir ama birlikte tek bir işlem değildir; genel geçip kullanıcı
 * takılırsa genel sayaç bir fazla saymış olur. Bu, gereğinden AZ harcamaya
 * yol açar — güvenli yön. Ters sırada olsaydı kullanıcı hakkını kaybederdi
 * ve analiz yine yapılmazdı; iki taraf da kaybederdi.
 *
 * ÇAĞRILMA ANI: bütün doğrulamalardan SONRA, OpenAI'ye gitmeden ÖNCE. Bozuk
 * bir dosya yüzünden hak yanmaz; OpenAI'ye ulaşan her deneme ise sayılır,
 * çünkü parayı harcatan odur.
 */

export type QuotaDecision =
  | {
      ok: true;
      /** Kullanıcının bugün KALAN hakkı; kullanıcıya gösterilir. */
      remaining: number;
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      /** Sınıra ulaşıldıysa 0; erişilemiyorsa bilinmez. */
      remaining: number | null;
    };

const UNAVAILABLE = {
  ok: false as const,
  status: 503,
  code: "SERVICE_UNAVAILABLE",
  message: "Analiz kotası şu anda okunamıyor. Lütfen birazdan tekrar dene.",
  remaining: null,
};

const USER_EXHAUSTED = {
  ok: false as const,
  status: 429,
  code: "DAILY_LIMIT_REACHED",
  message: "Bugünlük analiz hakkın doldu. Yarın yeniden deneyebilirsin.",
  remaining: 0,
};

/*
 * Genel tavan dolduğunda kullanıcının kendi hakkı bitmemiştir; mesaj bunu
 * DOĞRU söyler, yoksa kullanıcı kendi hakkını harcadığını sanır.
 */
const GLOBAL_EXHAUSTED = {
  ok: false as const,
  status: 429,
  code: "SERVICE_BUSY",
  message:
    "Bugün toplam analiz sınırına ulaşıldı. Bu senin hakkınla ilgili değil; yarın yeniden dene.",
  remaining: null,
};

export async function consumeAnalysisQuota(input: {
  userId: string;
  repository: SharedBillRepository;
  nowMs: number;
  /** Sınırlar dışarıdan verilebilir; testler bunu kullanır. */
  perUserLimit?: number;
  totalLimit?: number;
}): Promise<QuotaDecision> {
  if (!isAppUserId(input.userId)) {
    return UNAVAILABLE;
  }
  const perUserLimit = input.perUserLimit ?? DAILY_ANALYSES_PER_USER;
  const totalLimit = input.totalLimit ?? DAILY_ANALYSES_TOTAL;
  const day = quotaDay(input.nowMs);

  /* ÖNCE genel tavan. Dolmuşsa kullanıcının hakkına HİÇ dokunulmaz. */
  const total = await input.repository.consumeAnalysisQuota({
    quotaKey: GLOBAL_QUOTA_KEY,
    day,
    limit: totalLimit,
  });
  if (!total.ok) {
    return total.reason === "exhausted" ? GLOBAL_EXHAUSTED : UNAVAILABLE;
  }

  const own = await input.repository.consumeAnalysisQuota({
    quotaKey: input.userId,
    day,
    limit: perUserLimit,
  });
  if (!own.ok) {
    return own.reason === "exhausted" ? USER_EXHAUSTED : UNAVAILABLE;
  }

  return { ok: true, remaining: remainingAfter(own.used, perUserLimit) };
}

/**
 * Oturumdaki kullanıcı HÂLÂ var mı?
 *
 * Silinen bir hesabın JWT'si, çerezi duran başka bir cihazda süresi dolana
 * kadar geçerli kalır. Yabancı anahtarı olan tablolarda bu kendiliğinden
 * durur; kota tablosunun yabancı anahtarı YOKTUR ve tam da para harcayan yol
 * odur.
 */
export async function appUserStillExists(input: {
  userId: string;
  repository: SharedBillRepository;
}): Promise<
  { ok: true; exists: boolean } | { ok: false; reason: "unavailable" }
> {
  if (!isAppUserId(input.userId)) {
    /* Biçimsiz kimlik sürücüye GİTMEZ; var olmayan sayılır. */
    return { ok: true, exists: false };
  }
  return await input.repository.appUserExists({ userId: input.userId });
}
