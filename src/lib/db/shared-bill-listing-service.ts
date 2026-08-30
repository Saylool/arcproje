import { buildSharedBillPath } from "@/lib/arc/shared-bill";

import type {
  CreatedBillSummary,
  SharedBillRepository,
} from "./shared-bill-repository";

/**
 * OLUŞTURAN KİŞİNİN KENDİ HESAP LİSTESİ.
 *
 * Bu, Google oturumunun bir KAPI olmaktan çıkıp gerçek bir YETKİ olduğu ilk
 * yerdir: satırlar isteğe göre değil, oturumdaki uygulama kullanıcısına göre
 * süzülür. İstemci hangi kullanıcının listesini istediğini SÖYLEYEMEZ; böyle
 * bir parametre hiç yoktur.
 *
 * SAHİPLİK ÖDEME YETKİSİ DEĞİLDİR. Bu liste yalnızca okumadır: bir hesabın
 * sahibi olmak, o hesapta parayı hareket ettirme, borçlu satırını değiştirme
 * ya da alacaklı imzasının yerine geçme hakkı VERMEZ.
 */

/** Tek sayfada dönen üst sınır. Sayfalama yoktur; en yeni hesaplar döner. */
export const MAX_LISTED_BILLS = 50;

/** `app_users.user_id` biçimi. Sürücüye biçimsiz değer GİTMEZ. */
const APP_USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAppUserId(value: string): boolean {
  return APP_USER_ID_PATTERN.test(value);
}

/** Yanıt satırı: özet + paylaşılabilir göreli yol. */
export type CreatedBillListEntry = CreatedBillSummary &
  Readonly<{ path: string }>;

export type SharedBillListingResult =
  | {
      ok: true;
      bills: readonly CreatedBillListEntry[];
      /**
       * Üst sınırdan FAZLA hesap var mı?
       *
       * Sessiz kırpma yapılmaz: liste dolduğunda kullanıcı bunun bir sınır
       * olduğunu görmeli, yoksa eksik listeye bakıp "bir hesabım kaybolmuş"
       * sonucuna varabilir.
       */
      hasMore: boolean;
    }
  | { ok: false; status: number; code: string; message: string };

export async function listSharedBillsCreatedBy(input: {
  /** SUNUCUDAKİ oturumdan gelir; istek gövdesinden veya sorgudan ASLA. */
  createdByUserId: string;
  repository: SharedBillRepository;
}): Promise<SharedBillListingResult> {
  const { createdByUserId, repository } = input;

  /*
   * Biçimsiz kimlikte BOŞ LİSTE DÖNÜLMEZ. "Hiç hesabın yok" demek, hesapları
   * olan birine veri kaybı yaşadığını düşündürürdü; kapalı tarafa düşülür.
   * (Yazma yolunda tercih TERSİDİR: orada atıf düşer ama hesap yine oluşur —
   * hesabın kendisi atıftan daha değerlidir.)
   */
  if (!isAppUserId(createdByUserId)) {
    return {
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message:
        "Hesap listesi şu anda okunamıyor. Lütfen birazdan tekrar dene.",
    };
  }

  /*
   * BİR FAZLASI istenir: dönen satır sayısı sınırı aşıyorsa daha fazlası
   * olduğu KESİN bilinir. Ayrı bir sayım sorgusu gerekmez.
   */
  const listed = await repository.listBillsCreatedBy({
    createdByUserId,
    limit: MAX_LISTED_BILLS + 1,
  });

  if (!listed.ok) {
    return {
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message:
        "Hesap listesi şu anda okunamıyor. Lütfen birazdan tekrar dene.",
    };
  }

  const hasMore = listed.bills.length > MAX_LISTED_BILLS;
  return {
    ok: true,
    hasMore,
    bills: Object.freeze(
      listed.bills
        .slice(0, MAX_LISTED_BILLS)
        .map((bill) =>
          Object.freeze({ ...bill, path: buildSharedBillPath(bill.billId) }),
        ),
    ),
  };
}
