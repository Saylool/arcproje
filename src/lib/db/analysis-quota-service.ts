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
 * İki sayaç vardır ve İKİSİ BİRLİKTE, TEK İŞLEMDE ayrılır: ya ikisi de
 * düşülür ya da hiçbiri.
 *
 * Eskiden ikisi ayrı ayrı düşülüyordu ve sıranın "güvenli yöne saptığı"
 * yazıyordu. Yanlıştı: genel tavan ÖNCE düşüldüğü için, hakkı dolmuş bir
 * kullanıcının reddedilen her isteği genel sayacı artırıyordu. O kullanıcı
 * tek başına genel tavanı tüketip DİĞER HERKESİ kilitleyebiliyordu — hiç
 * OpenAI çağrısı yapmadan. Bu bir erişilebilirlik kusuruydu.
 *
 * Sırayı ters çevirmek çözüm değildi: o zaman da genel tavan dolduğunda
 * kullanıcı hakkı boşuna yanardı. Doğru cevap tek atomik ayırma.
 *
 * ÇAĞRILMA ANI: bütün doğrulamalardan SONRA, OpenAI'ye gitmeden ÖNCE. Bozuk
 * bir dosya yüzünden hak yanmaz; OpenAI'ye ulaşan her deneme ise sayılır,
 * çünkü parayı harcatan odur.
 *
 * SAĞLAYICI HATASI İADE ETTİRMEZ: kabul edilmiş bir istek OpenAI tarafında
 * düşerse hak geri verilmez. Bu bilinçli ve DEĞİŞMEYEN ürün kararıdır;
 * burada yalnızca REDDEDİLEN isteklerin yalıtımı düzeltilmiştir.
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

/**
 * Hesap AYIRMA ANINDA yoktu.
 *
 * Varlık kontrolü ayrı bir istekte yapılıyordu ve arada hesap silinebiliyordu.
 * O aralıkta silinmiş bir hesap adına kota satırı yaratılıyor ve — asıl zararı
 * bu — istek sağlayıcıya gidip PARA harcatıyordu. Kontrol artık ayırmanın
 * içinde; bu kod o yarışın kapandığı yerdir.
 *
 * 429 DEĞİL 401: "yarın gel" demek yanlış olurdu, dönecek bir hesap yok.
 */
const ACCOUNT_DELETED = {
  ok: false as const,
  status: 401,
  code: "ACCOUNT_DELETED",
  message: "Bu hesap silinmiş. Devam etmek için yeniden giriş yapman gerekiyor.",
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

  const reserved = await input.repository.reserveAnalysisQuota({
    globalKey: GLOBAL_QUOTA_KEY,
    userKey: input.userId,
    day,
    globalLimit: totalLimit,
    userLimit: perUserLimit,
  });

  if (!reserved.ok) {
    if (reserved.reason === "userMissing") {
      return ACCOUNT_DELETED;
    }
    if (reserved.reason === "globalExhausted") {
      return GLOBAL_EXHAUSTED;
    }
    if (reserved.reason === "userExhausted") {
      return USER_EXHAUSTED;
    }
    return UNAVAILABLE;
  }

  return { ok: true, remaining: remainingAfter(reserved.userUsed, perUserLimit) };
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
