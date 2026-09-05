import type { Receipt } from "@/lib/receipt/schema";

/**
 * TUTAR ALANLARININ KİMLİĞİ — ve hangisinin İLERLEMEYİ ENGELLEDİĞİ.
 *
 * Sorun şuydu: bir tutar alanına geçersiz bir şey yazıldığında (üç ondalık
 * basamak, boş metin, harf) alan kırmızıya dönüyor ama HESAP DEĞİŞMİYORDU.
 * `Receipt` içindeki sayı son GEÇERLİ değerde kalıyor — ki bu doğru, sayı
 * tipinin "kullanıcı bozuk bir şey yazdı" diye bir hâli yok. Yanlış olan,
 * bu ayrışmanın kimseye SÖYLENMEMESİYDİ: kullanıcı hatayı görüp devam
 * edebiliyor ve borçlar EKRANDA GÖRDÜĞÜNDEN başka bir tutardan
 * hesaplanıyordu.
 *
 * Çözüm, geçersizliği alanın kendi içinden yukarı taşımak. Bu dosya o
 * taşımanın veri tarafı: alanların kimliği ve "hangileri hâlâ engelliyor"
 * kararı. Karar SAF tutulur, çünkü asıl incelik silinen alanlarda:
 *
 *   Bozuk tutarlı bir ürün SİLİNİRSE o alan artık ekranda yoktur ve
 *   engellememelidir. Geçersiz kimlikleri sadece biriktirmek, kullanıcının
 *   düzeltemeyeceği görünmez bir engel bırakırdı.
 *
 * Bu yüzden engel her seferinde YAŞAYAN alanlarla kesiştirilerek okunur;
 * bileşenin silme anını ayrıca haber vermesi gerekmez.
 */

/**
 * Alan kimliği MARKALIDIR: gelişigüzel bir metin geçirilemez.
 *
 * Sessiz kalma biçimi şuydu: bir alan, bu dosyanın tanımadığı bir kimlik
 * bildirseydi `blockingAmountFields` onu ELEYECEK ve engel hiç kurulmayacaktı
 * — yani kusur, hiçbir test kırılmadan geri gelirdi. Marka bunu derleme
 * zamanında imkânsız kılar: kimlik ya aşağıdaki dört sabitten biridir ya da
 * `itemAmountField` ile üretilmiştir.
 */
declare const amountFieldBrand: unique symbol;
export type AmountFieldId = string & { readonly [amountFieldBrand]: true };

const field = (name: string): AmountFieldId => name as AmountFieldId;

export const TAX_AMOUNT_FIELD = field("tax");
export const SERVICE_AMOUNT_FIELD = field("serviceCharge");
export const DISCOUNT_AMOUNT_FIELD = field("discount");
export const TOTAL_AMOUNT_FIELD = field("total");

/** Ürün satırındaki tutar alanının kimliği. `item:` öneki ad çakışmasını keser. */
export function itemAmountField(itemId: string): AmountFieldId {
  return field(`item:${itemId}`);
}

/**
 * Fişteki BÜTÜN tutar alanları, EKRANDAKİ sırayla.
 *
 * Sıra rastgele değil: "ilk bozuk alan" derken kastedilen, kullanıcının
 * yukarıdan aşağı okurken ilk göreceği alandır.
 */
export function amountFieldIds(receipt: Receipt): AmountFieldId[] {
  return [
    ...receipt.items.map((item) => itemAmountField(item.id)),
    TAX_AMOUNT_FIELD,
    SERVICE_AMOUNT_FIELD,
    DISCOUNT_AMOUNT_FIELD,
    TOTAL_AMOUNT_FIELD,
  ];
}

/**
 * Geçersiz alanlardan HÂLÂ EKRANDA OLANLAR, ekran sırasında.
 *
 * Boş dizi "ilerlenebilir" demektir.
 */
export function blockingAmountFields(
  invalid: Iterable<AmountFieldId>,
  receipt: Receipt,
): AmountFieldId[] {
  const reported = new Set<string>(invalid);
  return amountFieldIds(receipt).filter((id) => reported.has(id));
}

/**
 * Geçersizlik kümesinin bir sonraki hâli.
 *
 * Değişiklik yoksa AYNI küme döner: React'te yeni bir küme üretmek gereksiz
 * render zinciri başlatırdı ve her tuş vuruşunda bu olurdu.
 */
export function updateInvalidAmountFields(
  current: ReadonlySet<AmountFieldId>,
  fieldId: AmountFieldId,
  valid: boolean,
): ReadonlySet<AmountFieldId> {
  if (valid !== current.has(fieldId)) {
    return current;
  }
  const next = new Set(current);
  if (valid) {
    next.delete(fieldId);
  } else {
    next.add(fieldId);
  }
  return next;
}

export type AmountReadability =
  | { ok: true }
  /** Odaklanılacak alan: ekranda EN ÜSTTEKİ bozuk alan. */
  | { ok: false; focusField: AmountFieldId };

/**
 * Kişi adımına geçilebilir mi?
 *
 * `checkReceiptReadyForSplit` bu soruyu CEVAPLAYAMAZ: okunamayan metin fişe
 * hiç işlenmediği için fiş kendi başına tutarlı görünür. Ayrı bir kontrol
 * olmasının sebebi bu.
 */
export function checkAmountsReadable(
  invalid: Iterable<AmountFieldId>,
  receipt: Receipt,
): AmountReadability {
  const blocking = blockingAmountFields(invalid, receipt);
  return blocking.length === 0
    ? { ok: true }
    : { ok: false, focusField: blocking[0] };
}

/**
 * Alanın DOM kimliği.
 *
 * İlerleme engellendiğinde odak ilk bozuk alana taşınır. Uzun bir fişte
 * hata satırı ekranın dışında kalabilir; "bir yerde bir hata var" deyip
 * kullanıcıyı aramaya bırakmak, engellemenin faydasını götürürdü.
 */
export function amountFieldDomId(fieldId: AmountFieldId): string {
  return `amount-${fieldId}`;
}
