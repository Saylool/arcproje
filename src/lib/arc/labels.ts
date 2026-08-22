/**
 * İmzalanan metin alanlarının Unicode sertleştirmesi.
 *
 * Bir etiket, talebi oluşturan kişinin serbestçe yazdığı metindir; imza
 * yalnızca bu metnin değişmediğini kanıtlar, doğruluğunu değil. Görünmez veya
 * yön değiştiren karakterler, borçluya gösterilen ismi imzalanandan farklı
 * gösterebilir. Bu yüzden etiketler tek bir kanonik biçime (NFC) indirgenir ve
 * kontrol/biçim karakterleri reddedilir.
 *
 * Kanonik biçim her yerde aynıdır: saklama, imzalama, doğrulama ve gösterim.
 * Doğrulama NFC olmayan bir metni DÜZELTMEZ, reddeder: doğrulama sırasında
 * değişen bir metin, imzalanan baytlardan farklı baytlar üretir ve geçerli bir
 * imzayı geçersiz gösterirdi.
 *
 * Desenler `new RegExp` ile kurulur; tsconfig hedefi ES2017 olduğu için
 * Unicode özellik kaçışları regex sabiti olarak yazılamaz.
 */

/** Unicode kontrol (Cc) ve biçim (Cf) karakterleri. C0, C1, DEL dâhil. */
const CONTROL_OR_FORMAT = new RegExp("[\\p{Cc}\\p{Cf}]", "u");

/**
 * Bidi yön/izolasyon ve sıfır genişlikli karakterler. Bunlar zaten Cf
 * kümesindedir; ayrı ayrı da listelenir çünkü saldırıda doğrudan kullanılan
 * karakterler bunlardır ve niyetin kodda görünür olması gerekir.
 */
const BIDI_OR_ZERO_WIDTH = new RegExp(
  "[\\u200b\\u200c\\u200d\\u200e\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]",
  "u",
);

const ONLY_WHITESPACE = new RegExp("^\\p{White_Space}+$", "u");
const SURROUNDING_WHITESPACE = new RegExp(
  "^\\p{White_Space}|\\p{White_Space}$",
  "u",
);

export type LabelProblem =
  | "notAString"
  | "empty"
  | "tooLong"
  | "notNormalized"
  | "controlCharacter"
  | "whitespaceOnly"
  | "surroundingWhitespace";

export type LabelResult =
  | { ok: true; value: string }
  | { ok: false; problem: LabelProblem };

/** Kanonik biçim NFC'dir. Üretim tarafı girdiyi bu biçime indirger. */
export function toCanonicalLabel(value: string): string {
  return value.normalize("NFC");
}

/**
 * Kanonik bir etiketi katı biçimde doğrular.
 *
 * Uzunluk sınırı kanonik biçim üzerinde uygulanır: metnin zaten NFC olması
 * şart koşulduğu için buradaki uzunluk, normalleştirme sonrası uzunluktur.
 */
export function validateCanonicalLabel(
  value: unknown,
  maxLength: number,
): LabelResult {
  if (typeof value !== "string") {
    return { ok: false, problem: "notAString" };
  }
  if (value.length === 0) {
    return { ok: false, problem: "empty" };
  }
  if (value !== value.normalize("NFC")) {
    return { ok: false, problem: "notNormalized" };
  }
  if (CONTROL_OR_FORMAT.test(value) || BIDI_OR_ZERO_WIDTH.test(value)) {
    return { ok: false, problem: "controlCharacter" };
  }
  if (ONLY_WHITESPACE.test(value)) {
    return { ok: false, problem: "whitespaceOnly" };
  }
  if (SURROUNDING_WHITESPACE.test(value)) {
    return { ok: false, problem: "surroundingWhitespace" };
  }
  if (value.length > maxLength) {
    return { ok: false, problem: "tooLong" };
  }
  return { ok: true, value };
}

/** Kod noktası sınırında keser; yüzey çifti ortadan bölünmez. */
function truncateAtCodePoint(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  let truncated = "";
  for (const codePoint of value) {
    if (truncated.length + codePoint.length > maxLength) {
      break;
    }
    truncated += codePoint;
  }
  return truncated;
}

/**
 * Üretim tarafı yardımcı: girdiyi NFC'ye indirger, kırpar ve sınıra sığdırır.
 * Sonuç yine katı doğrulamadan geçer; bu adım yalnızca makul girdilerin
 * gereksiz yere reddedilmesini önler, doğrulamanın yerine geçmez.
 */
export function prepareLabel(value: string, maxLength: number): string {
  const canonical = toCanonicalLabel(value).trim();
  return truncateAtCodePoint(canonical, maxLength).trim();
}
