/**
 * ANALİZ UYARILARI — metin değil KOD.
 *
 * Model eskiden uyarıları serbest metin olarak, üstelik TÜRKÇE yazıyordu:
 * istem ona açıkça "warnings written in TURKISH" diyordu. Arayüz de bu metni
 * olduğu gibi basıyordu. Sonuç: İngilizce kullanan biri, İngilizce bir
 * ekranın ortasında Türkçe uyarılar görüyordu.
 *
 * Çözüm çeviri değil KOD: model kapalı bir listeden kod döndürür, cümle
 * sözlükten etkin dilde seçilir. Üç faydası var:
 *
 *   1. Uyarı iki dilde de doğru çıkar ve testle sabitlenebilir.
 *   2. Modelin ürettiği serbest metin doğrudan kullanıcıya BASILMAZ.
 *   3. Tanınmayan bir kod sessizce düşer; uydurma bir cümle ekrana gelmez.
 *
 * DİKKAT: fişin kendi içeriği — dükkân adı, ürün adları — çevrilmez. Onlar
 * veridir, mesaj değil; olduğu gibi gösterilir.
 */

/** Modelin döndürebileceği uyarıların TAMAMI. */
export const RECEIPT_WARNING_CODES = [
  /** Genel toplam okunamadı. */
  "TOTAL_UNREADABLE",
  /** Kalemlerin toplamı fişteki genel toplamı tutmuyor. */
  "TOTALS_DO_NOT_MATCH",
  /** Verginin fiyata dahil mi ayrı mı olduğu anlaşılamadı. */
  "TAX_TREATMENT_UNCLEAR",
  /** Servis bedelinin dahil mi ayrı mı olduğu anlaşılamadı. */
  "SERVICE_TREATMENT_UNCLEAR",
  /** İndirimin dahil mi ayrı mı olduğu anlaşılamadı. */
  "DISCOUNT_TREATMENT_UNCLEAR",
  /** En az bir ürünün fiyatı net okunamadı. */
  "ITEM_PRICE_UNCLEAR",
  /** En az bir ürünün adı net okunamadı. */
  "ITEM_NAME_UNCLEAR",
  /** Görselin bir kısmı okunamadı; satır eksik olabilir. */
  "PARTIALLY_UNREADABLE",
  /** Para birimi fişten anlaşılamadı. */
  "CURRENCY_UNCLEAR",
] as const;

export type ReceiptWarningCode = (typeof RECEIPT_WARNING_CODES)[number];

const KNOWN: ReadonlySet<string> = new Set(RECEIPT_WARNING_CODES);

export function isReceiptWarningCode(value: unknown): value is ReceiptWarningCode {
  return typeof value === "string" && KNOWN.has(value);
}

/**
 * Modelden geleni güvenli listeye indirger.
 *
 * Tanınmayan kod ATILIR: modelin uydurduğu bir etiketi çeviri anahtarı diye
 * kullanmak, ekrana ham anahtar basardı. Tekrarlar da düşer, çünkü aynı
 * uyarıyı iki kez göstermenin kullanıcıya söylediği bir şey yok.
 */
export function sanitizeWarningCodes(raw: unknown): ReceiptWarningCode[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<ReceiptWarningCode>();
  for (const entry of raw) {
    if (isReceiptWarningCode(entry)) {
      seen.add(entry);
    }
  }
  /* Sıra SABİTTİR: aynı fiş her açılışta aynı sırayı gösterir. */
  return RECEIPT_WARNING_CODES.filter((code) => seen.has(code));
}
