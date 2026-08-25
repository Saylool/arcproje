/**
 * DİL ÇÖZÜMLEME — saf ve test edilebilir.
 *
 * Bu modül hiçbir tarayıcı veya Next.js API'sine DOKUNMAZ; yalnızca metin alır
 * ve dil döndürür. Böylece hem sunucuda (istek başlıkları) hem istemcide
 * (belge çerezi) AYNI mantık çalışır ve sunucu ile istemci aynı dile varır.
 *
 * ÖNCELİK SIRASI:
 *   1. Geçerli bir AÇIK tercih çerezi (`hb_locale`),
 *   2. İsteğin `Accept-Language` tercihi,
 *   3. Türkçe (güvenli varsayılan).
 *
 * Çerez okunamıyorsa, başlık bozuksa veya hiçbir şey eşleşmezse sonuç HER
 * ZAMAN Türkçedir; dil çözümleme hiçbir koşulda uygulamayı düşürmez.
 *
 * Tercih SUNUCUYA KAYIT EDİLMEZ: veritabanına yazılmaz, IP coğrafi konumu
 * kullanılmaz ve üçüncü taraf bir çeviri servisine gönderilmez.
 */

/** Uygulamanın desteklediği diller. Bölgesel varyantlar bunlara indirgenir. */
export type Locale = "tr" | "en";

export const LOCALES = ["tr", "en"] as const;

/** Hiçbir sinyal okunamadığında kullanılan güvenli varsayılan. */
export const DEFAULT_LOCALE: Locale = "tr";

/** Tercih çerezi. Hassas veri TAŞIMAZ; yalnızca "tr" veya "en" değerini alır. */
export const LOCALE_COOKIE_NAME = "hb_locale";

/** Bir yıl. Tercih, oturumlar arasında korunur. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const LOCALE_COOKIE_PATH = "/";
export const LOCALE_COOKIE_SAME_SITE = "Lax";

/** Yalnızca bu iki değer geçerlidir; başka her şey bozuk sayılır. */
export function isLocale(value: unknown): value is Locale {
  return value === "tr" || value === "en";
}

/**
 * Bir dil etiketini uygulama diline indirger.
 *
 * `tr-TR`, `en-US`, `en-GB` gibi BÖLGESEL varyantlar taban dile eşlenir.
 * Eşleşme büyük/küçük harf duyarsızdır ve yalnızca TABAN alt etikete bakar;
 * `en-Latn-US` gibi çok parçalı etiketler de `en` olur. Desteklenmeyen bir
 * dil (`de`, `fr`) `null` döner — bu "eşleşme yok" demektir, hata değil.
 */
export function toAppLocale(tag: unknown): Locale | null {
  if (typeof tag !== "string") {
    return null;
  }
  const base = tag.trim().toLowerCase().split("-")[0] ?? "";
  return isLocale(base) ? base : null;
}

/**
 * Ayrıştırılan `Accept-Language` girdilerinin ÜST SINIRI.
 *
 * Başlık dışarıdan gelir ve çok uzun olabilir. Sınır, bozuk veya kötü niyetli
 * bir başlığın gereksiz iş yaratmasını engeller; gerçek tarayıcılar bu sayının
 * çok altında etiket gönderir.
 */
const MAX_ACCEPT_LANGUAGE_ENTRIES = 32;

/** Aynı nedenle başlığın kendisi de sınırlanır. */
const MAX_ACCEPT_LANGUAGE_LENGTH = 512;

type WeightedTag = { tag: string; quality: number; order: number };

/**
 * `q` ağırlığını okur.
 *
 * Yalnızca `q=<sayı>` biçimi kabul edilir; 0–1 aralığı dışındaki, sayı
 * olmayan veya eksik değerler girdiyi DÜŞÜRMEZ, varsayılan 1'e döner —
 * ağırlığı okunamayan bir etiketi tamamen atmak, tarayıcının asıl tercihini
 * kaybetmek olurdu. Açıkça `q=0` verilmiş etiket ise istenmiyor demektir ve
 * elenir.
 */
function readQuality(parameters: string[]): number | null {
  let quality = 1;
  for (const parameter of parameters) {
    const [rawName, rawValue] = parameter.split("=");
    if (rawName === undefined || rawValue === undefined) {
      continue;
    }
    if (rawName.trim().toLowerCase() !== "q") {
      continue;
    }
    const parsed = Number.parseFloat(rawValue.trim());
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      return 1;
    }
    quality = parsed;
  }
  return quality === 0 ? null : quality;
}

/**
 * `Accept-Language` başlığını ağırlığa göre sıralı etiket listesine çevirir.
 *
 * BELİRLENİMCİ: eşit ağırlıklı etiketler başlıktaki ÖZGÜN SIRAYI korur
 * (kararlı sıralama). Aynı başlık her zaman aynı sonucu verir.
 *
 * Bozuk girdi ATILIR, istisna fırlatılmaz: boş parçalar, `q=abc`, `;;;`,
 * yıldız (`*`) ve tanınmayan bir şey gördüğünde o parça yok sayılır ve
 * kalanlar işlenmeye devam eder.
 */
export function parseAcceptLanguage(header: unknown): string[] {
  if (typeof header !== "string" || header.length === 0) {
    return [];
  }

  const bounded = header.slice(0, MAX_ACCEPT_LANGUAGE_LENGTH);
  const weighted: WeightedTag[] = [];

  const parts = bounded.split(",");
  for (const part of parts) {
    if (weighted.length >= MAX_ACCEPT_LANGUAGE_ENTRIES) {
      break;
    }
    const segments = part.split(";");
    const tag = (segments[0] ?? "").trim();
    if (tag === "" || tag === "*") {
      continue;
    }
    // Dil etiketi yalnızca harf, rakam ve tire içerir; gerisi bozuktur.
    if (!/^[A-Za-z0-9-]+$/.test(tag)) {
      continue;
    }
    const quality = readQuality(segments.slice(1));
    if (quality === null) {
      continue;
    }
    weighted.push({ tag, quality, order: weighted.length });
  }

  return weighted
    .sort((a, b) => (b.quality - a.quality) || (a.order - b.order))
    .map((entry) => entry.tag);
}

/**
 * `Accept-Language` başlığından desteklenen İLK dili seçer.
 *
 * Ağırlık sırası korunur: `de, en;q=0.9, tr;q=0.8` -> `en` (Almanca
 * desteklenmediği için atlanır, sonraki en yüksek ağırlık kazanır).
 */
export function localeFromAcceptLanguage(header: unknown): Locale | null {
  for (const tag of parseAcceptLanguage(header)) {
    const locale = toAppLocale(tag);
    if (locale !== null) {
      return locale;
    }
  }
  return null;
}

/**
 * Etkin dili ÖNCELİK SIRASINA göre çözer.
 *
 * Bağımlılıklar dışarıdan verildiği için bu fonksiyon tarayıcısız,
 * sunucusuz ve belirlenimci biçimde test edilir. Sunucu (istek başlıkları) ve
 * istemci (belge çerezi) AYNI fonksiyonu çağırır; ikisinin ayrışması bu
 * yüzden mümkün değildir.
 */
export function resolveLocale(input: {
  cookie?: unknown;
  acceptLanguage?: unknown;
}): Locale {
  // 1. Açık tercih: kullanıcı bir kez seçtiyse tarayıcı tercihini YENER.
  if (isLocale(input.cookie)) {
    return input.cookie;
  }
  // 2. Tarayıcı tercihi.
  const fromHeader = localeFromAcceptLanguage(input.acceptLanguage);
  if (fromHeader !== null) {
    return fromHeader;
  }
  // 3. Güvenli varsayılan.
  return DEFAULT_LOCALE;
}

/**
 * Tercih çerezinin `Set-Cookie` / `document.cookie` biçimi.
 *
 * Tek yerde tanımlıdır; sunucu ve istemci AYNI öznitelikleri yazar. `HttpOnly`
 * KULLANILMAZ çünkü çerezi istemci tarafındaki dil anahtarı da yazar; çerez
 * hassas veri taşımaz, yalnızca "tr" veya "en" değerini alır.
 */
export function serializeLocaleCookie(locale: Locale): string {
  return [
    `${LOCALE_COOKIE_NAME}=${locale}`,
    `Path=${LOCALE_COOKIE_PATH}`,
    `Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`,
    `SameSite=${LOCALE_COOKIE_SAME_SITE}`,
  ].join("; ");
}

/**
 * Ham `Cookie` başlığından tercih çerezini okur.
 *
 * Bozuk başlık, eksik çerez ve geçersiz değer AYNI sonucu verir: `null`,
 * yani "açık tercih yok" -> bir sonraki sinyale düşülür.
 */
export function readLocaleCookie(cookieHeader: unknown): Locale | null {
  if (typeof cookieHeader !== "string" || cookieHeader === "") {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    if (name !== LOCALE_COOKIE_NAME) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    return isLocale(value) ? value : null;
  }
  return null;
}

/**
 * Uygulama dilinin `Intl` karşılığı.
 *
 * `Intl` biçimlendiricileri BÖLGE ister: ayraçlar ve tarih düzeni bölgeye
 * göre değişir. Eşleme tek yerde tutulur ki sayı, para ve tarih biçimleri
 * uygulamanın her yerinde aynı olsun.
 */
export function toIntlLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : "tr-TR";
}
