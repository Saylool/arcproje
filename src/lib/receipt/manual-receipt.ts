import { createItemId, type Receipt } from "./schema";

/**
 * ANALİZ OLMADAN BAŞLANAN FİŞ.
 *
 * NEDEN VAR: akışın tamamı bir analizin BAŞARILI olmasına bağlıydı. Ekranların
 * hepsi `receipt !== null` şartına bakıyordu ve `receipt` yalnızca sunucudan
 * dönen bir analizle doluyordu. Yani günlük tavan dolduğunda ya da OpenAI'ye
 * ulaşılamadığında uygulama tümüyle duruyordu.
 *
 * Oysa uygulamanın ASIL İŞİ analize bağlı değil: bölüşme, tam sayı borç
 * hesabı ve imzalı ödeme talebi fişin nereden geldiğini bilmez. Editörde ürün
 * ekleme düğmesi zaten vardı; eksik olan yalnızca editöre ULAŞMAKTI.
 *
 * SUNUCUYA HİÇ GİTMEZ. Kota harcanmaz, hiçbir sağlayıcı çağrılmaz — bu yol
 * tam da o çağrıların yapılamadığı durumlar için var.
 */

/**
 * Uygulamanın para birimi. Fişten okunmaz çünkü okunacak bir fiş yoktur;
 * borç hesabının tamamı zaten TRY minor unit üzerinden yürür.
 */
export const MANUAL_RECEIPT_CURRENCY = "TRY";

/**
 * Boş bir fiş.
 *
 * TEK BOŞ SATIRLA başlar: sıfır satırlı bir editör, kullanıcıya nereye
 * yazacağını göstermez. Satırın şekli `ReceiptEditor` içindeki ürün ekleme
 * düğmesinin ürettiğiyle BİREBİR aynıdır; ayrışsalardı elle eklenen ilk
 * satır ötekilerden farklı davranırdı.
 *
 * VERGİ, SERVİS VE İNDİRİM SIFIRDIR ve `included_in_items` işlemiyle gelir.
 * Sıfır tutarda iki işlem de aynı toplamı verir, ama bu seçim kullanıcı
 * sonradan bir vergi yazdığında anlamlı olur: Türkiye'deki fişlerde KDV
 * ürün fiyatlarının İÇİNDEDİR ve toplama tekrar eklenmez. `unknown` ise
 * kullanıcıya, kendi girdiği bir sayı için "fişten anlaşılamadı" demek
 * olurdu — ortada fiş yok.
 *
 * UYARI LİSTESİ BOŞTUR: uyarılar modelin okuma güçlüğünü anlatır. Elle
 * girilen bir fişte okunacak bir şey olmadığı için hiçbiri doğru olmaz.
 */
export function createManualReceipt(): Receipt {
  return {
    merchantName: null,
    currency: MANUAL_RECEIPT_CURRENCY,
    items: [{ id: createItemId(), name: "", totalMinor: 0 }],
    taxMinor: 0,
    taxTreatment: "included_in_items",
    serviceChargeMinor: 0,
    serviceChargeTreatment: "included_in_items",
    discountMinor: 0,
    discountTreatment: "included_in_items",
    totalMinor: 0,
    warnings: [],
  };
}
