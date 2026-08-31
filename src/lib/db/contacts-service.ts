import type {
  RecentDebtorContact,
  SharedBillRepository,
} from "./shared-bill-repository";
import { isAppUserId } from "./shared-bill-listing-service";
import { listSavedContacts } from "./saved-contacts-service";

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

/**
 * ÖNERİLERİN GERİYE GİTME SINIRI — 12 ay.
 *
 * Sınırın sebebi kolaylık değil GÜVENLİK: insanlar cüzdan değiştirir. Yıllar
 * öncesine ait bir adresin tanıdık bir isimle önerilmesi, kullanıcının
 * kontrol etmeden tıklayacağı durumdur ve yanlış transfer GERİ ALINAMAZ.
 *
 * 12 ay, yılda bir tekrarlayan grupları (tatil, yılbaşı) hâlâ kapsar ama
 * gerçekten eskimiş adresleri düşürür.
 */
export const MAX_CONTACT_AGE_DAYS = 365;

const DAY_MS = 86_400_000;

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
  /** Test edilebilirlik için dışarıdan verilebilir. */
  nowMs?: number;
}): Promise<ContactsResult> {
  const { createdByUserId, repository } = input;
  const nowMs = input.nowMs ?? Date.now();

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
    notUsedBefore: Math.floor(
      (nowMs - MAX_CONTACT_AGE_DAYS * DAY_MS) / 1000,
    ),
  });
  return listed.ok ? { ok: true, contacts: listed.contacts } : UNAVAILABLE;
}

/* ------------------------------------------------------------------------ */
/* BİRLEŞİK DEFTER — kayıtlılar ASIL, geçmiş YEDEK                          */
/* ------------------------------------------------------------------------ */

/**
 * Öneri listesinin tek satırı.
 *
 * `saved`: kullanıcının bilerek kaydettiği kişi. ASIL kaynak budur.
 * `history`: geçmiş hesaplardan türetilmiş, kaydedilmemiş adres. Yalnızca
 * kayıtlılarda bulunamayan kişiler için görünür ve kaydedilebilir.
 */
export type ContactEntry = Readonly<{
  source: "saved" | "history";
  /** Yalnızca `saved` için; düzenleme ve silme bunun üzerinden yapılır. */
  contactId: string | null;
  label: string;
  address: string;
  /** Yalnızca `history` için; kayıtlı kişinin yaşı anlamsızdır. */
  lastUsedAt: number | null;
}>;

export type ContactBookResult =
  | { ok: true; contacts: readonly ContactEntry[] }
  | { ok: false; status: number; code: string; message: string };

/**
 * Kayıtlı kişiler ve geçmiş önerilerini TEK listede birleştirir.
 *
 * KAYITLILAR ÖNCE gelir ve aynı adres geçmişte de görünüyorsa geçmiş satırı
 * DÜŞER: kullanıcı o kişiyi zaten adlandırmıştır, kendi verdiği ad kazanır.
 *
 * Kayıtlılar okunamazsa istek BAŞARISIZ olur; geçmiş okunamazsa yalnızca
 * yedek katman eksilir ve liste yine döner. Sebep: kayıtlı bir kişinin
 * görünmemesi "sildim mi?" sorusunu doğurur, öneri eksikliği ise görünmez.
 */
export async function listContactBook(input: {
  userId: string;
  repository: SharedBillRepository;
  nowMs?: number;
}): Promise<ContactBookResult> {
  const saved = await listSavedContacts({
    userId: input.userId,
    repository: input.repository,
  });
  if (!saved.ok) {
    return saved;
  }

  const entries: ContactEntry[] = saved.contacts.map((contact) =>
    Object.freeze({
      source: "saved" as const,
      contactId: contact.contactId,
      label: contact.label,
      address: contact.address,
      lastUsedAt: null,
    }),
  );

  const savedAddresses = new Set(
    saved.contacts.map((contact) => contact.address.toLowerCase()),
  );

  const history = await listRecentContacts({
    createdByUserId: input.userId,
    repository: input.repository,
    nowMs: input.nowMs,
  });
  if (history.ok) {
    for (const contact of history.contacts) {
      if (savedAddresses.has(contact.address.toLowerCase())) {
        continue;
      }
      entries.push(
        Object.freeze({
          source: "history" as const,
          contactId: null,
          label: contact.label,
          address: contact.address,
          lastUsedAt: contact.lastUsedAt,
        }),
      );
    }
  }

  return { ok: true, contacts: Object.freeze(entries) };
}
