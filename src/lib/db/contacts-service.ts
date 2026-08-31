import type {
  RecentDebtorContact,
  SharedBillRepository,
} from "./shared-bill-repository";
import { isAppUserId } from "./shared-bill-listing-service";

/**
 * ADRES REHBERİ — geçmişten türetilir, AYRI BİR DEPO DEĞİLDİR.
 *
 * Kişinin daha önce kendi oluşturduğu hesaplarda kullandığı borçlu adresleri
 * okunur. Yeni bir tablo yoktur, yeni bir gizlilik yüzeyi açılmaz: veri zaten
 * oradaydı ve zaten bu kişiye aitti.
 *
 * SÜZME OTURUMDAN GELİR. İstemci hangi kullanıcının rehberini istediğini
 * SÖYLEYEMEZ; böyle bir parametre yoktur.
 *
 * ÖNERİ BİR YETKİ DEĞİLDİR. Kabul edilen adres, elle yazılmış gibi AYNI
 * doğrulamadan geçer (checksum, ağ, biçim) ve imzalamadan önce kullanıcıya tam
 * hâliyle gösterilir. Etiket yalnızca hatırlatmadır; adresin yerine ASLA
 * geçmez. Yanlış adrese giden transfer geri alınamaz.
 */

/** Tek seferde dönen üst sınır. Sayfalama yoktur. */
export const MAX_CONTACTS = 50;

export type ContactsResult =
  | { ok: true; contacts: readonly RecentDebtorContact[] }
  | { ok: false; status: number; code: string; message: string };

const UNAVAILABLE = {
  ok: false as const,
  status: 503,
  code: "SERVICE_UNAVAILABLE",
  message: "Kayıtlı kişiler şu anda okunamıyor. Lütfen birazdan tekrar dene.",
};

export async function listRecentContacts(input: {
  /** SUNUCUDAKİ oturumdan gelir; istekten ASLA. */
  createdByUserId: string;
  repository: SharedBillRepository;
}): Promise<ContactsResult> {
  const { createdByUserId, repository } = input;

  /*
   * Biçimsiz kimlik sürücüye GİTMEZ. Burada boş liste dönmek de kabul
   * edilebilirdi (öneri eksikliği zararsızdır) ama sessiz başarısızlık bir
   * hatayı gizler; kontrollü hata görünür kalır.
   */
  if (!isAppUserId(createdByUserId)) {
    return UNAVAILABLE;
  }

  const listed = await repository.listRecentDebtorsFor({
    createdByUserId,
    limit: MAX_CONTACTS,
  });
  return listed.ok ? { ok: true, contacts: listed.contacts } : UNAVAILABLE;
}
