/**
 * DİLE DUYARLI BİÇİMLENDİRME — YALNIZCA GÖSTERİM.
 *
 * ================== BU DOSYA HİÇBİR TUTARI DEĞİŞTİRMEZ ==================
 *
 * Buradaki fonksiyonlar yalnızca EKRANDA görünen metni üretir. Gönderilen,
 * imzalanan, saklanan, karşılaştırılan veya mutabakatı yapılan tutar HER ZAMAN
 * tam sayı minor unit / BigInt olarak kalır ve bu dosyadan geçmez.
 *
 * Özellikle `formatMicroUsdcAmount` ve `formatMicroUsdcForDisplay`
 * (`@/lib/arc/conversion`) PROTOKOL biçimlendiricileridir: sunucunun ürettiği
 * `amount` / `displayAmount` metinleri istemcide bunlarla YENİDEN üretilip
 * birebir karşılaştırılır. Bu yüzden onlar dile duyarlı YAPILMAZ; dile duyarlı
 * gösterim buradaki ayrı fonksiyonlarla, kanonik tam sayıdan türetilir.
 *
 * Türkçe çıktılar mevcut davranışla BİREBİR aynıdır; İngilizce yalnızca
 * ayraçları ve sembol yerleşimini değiştirir.
 */

import { formatMicroUsdcAmount } from "@/lib/arc/conversion";

import { toIntlLocale, type Locale } from "./locale";

const MINOR_PER_MAJOR = BigInt(100);

type Separators = { decimal: string; group: string };

const FALLBACK: Record<Locale, Separators> = {
  tr: { decimal: ",", group: "." },
  en: { decimal: ".", group: "," },
};

/**
 * Dilin ondalık ve binlik ayraçları.
 *
 * `Intl` üzerinden okunur ki ayraçlar tek bir yerde, platformun kendi
 * verisinden gelsin. `Intl` yoksa veya hata verirse sabit karşılıklara
 * düşülür; biçimlendirme hiçbir koşulda istisna fırlatmaz.
 */
export function localeSeparators(locale: Locale): Separators {
  try {
    const parts = new Intl.NumberFormat(toIntlLocale(locale)).formatToParts(
      12345.6,
    );
    const decimal = parts.find((part) => part.type === "decimal")?.value;
    const group = parts.find((part) => part.type === "group")?.value;
    if (decimal === undefined || group === undefined) {
      return FALLBACK[locale];
    }
    return { decimal, group };
  } catch {
    return FALLBACK[locale];
  }
}

/** Tam sayıyı binlik ayraçlarıyla yazar. `BigInt` daraltılmaz. */
function groupInteger(value: bigint, locale: Locale): string {
  const digits = (value < BigInt(0) ? -value : value).toString();
  const { group } = localeSeparators(locale);
  let grouped = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) {
      grouped += group;
    }
    grouped += digits[index];
  }
  return value < BigInt(0) ? `-${grouped}` : grouped;
}

/**
 * Mikro USDC'yi GÖSTERİM için biçimlendirir.
 *
 * Basamaklar kanonik protokol metninden alınır; yalnızca ondalık ayracı dile
 * göre değişir. Türkçe çıktı `formatMicroUsdcForDisplay` ile birebir aynıdır.
 * Gruplama EKLENMEZ: gönderilen tutarla göz karşılaştırması yapılabilsin diye
 * basamak dizisi aynı kalır.
 */
export function formatUsdcAmount(microUsdc: bigint, locale: Locale): string {
  const canonical = formatMicroUsdcAmount(microUsdc);
  const { decimal } = localeSeparators(locale);
  return canonical.replace(".", decimal);
}

/**
 * Kanonik minor unit metnini TRY olarak biçimlendirir.
 *
 * Girdi metindir ve `BigInt` ile işlenir: kayan noktaya HİÇ düşülmez.
 * Türkçe: `1.234,56 ₺` (mevcut biçim). İngilizce: `₺1,234.56`.
 * Girdi kanonik değilse `null` döner ve çağıran "—" gösterir.
 */
export function formatTryMinor(value: unknown, locale: Locale): string | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return null;
  }
  const amount = BigInt(value);
  const whole = groupInteger(amount / MINOR_PER_MAJOR, locale);
  const fraction = (amount % MINOR_PER_MAJOR).toString().padStart(2, "0");
  const { decimal } = localeSeparators(locale);
  return locale === "en"
    ? `₺${whole}${decimal}${fraction}`
    : `${whole}${decimal}${fraction} ₺`;
}

/** Tarih + saat. Yalnızca sunum katmanında kullanılır. */
export function formatDateTime(epochSeconds: number, locale: Locale): string {
  try {
    return new Date(epochSeconds * 1000).toLocaleString(toIntlLocale(locale));
  } catch {
    return String(epochSeconds);
  }
}

/**
 * "Ne kadar önce" — göreli yaş.
 *
 * ŞİMDİ DIŞARIDAN VERİLİR (`asOfMs`). Render sırasında `Date.now()` okumak
 * saf olmazdı: aynı veri farklı çıktı üretir ve React uyarır. Çağıran, verinin
 * OKUNDUĞU anı geçirir.
 *
 * Birim, en büyük anlamlı ölçüye yuvarlanır: gün → ay → yıl. "3 ay önce"
 * demek, "94 gün önce" demekten hem kısa hem okunaklıdır.
 */
export function formatRelativeAge(
  epochSeconds: number,
  asOfMs: number,
  locale: Locale,
): string {
  try {
    const elapsedDays = Math.floor((asOfMs - epochSeconds * 1000) / 86_400_000);
    const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
      elapsedDays >= 365
        ? [Math.floor(elapsedDays / 365), "year"]
        : elapsedDays >= 30
          ? [Math.floor(elapsedDays / 30), "month"]
          : [Math.max(0, elapsedDays), "day"];

    return new Intl.RelativeTimeFormat(toIntlLocale(locale), {
      numeric: "auto",
      style: "narrow",
    }).format(-value, unit);
  } catch {
    return "";
  }
}

/** Yalnızca saat. */
export function formatTime(epochSeconds: number, locale: Locale): string {
  try {
    return new Date(epochSeconds * 1000).toLocaleTimeString(
      toIntlLocale(locale),
    );
  } catch {
    return String(epochSeconds);
  }
}

/**
 * Dosya boyutu. Para DEĞİLDİR; yalnızca yükleme ekranında bilgi amaçlıdır,
 * bu yüzden burada kayan nokta kullanmak güvenlidir.
 */
export function formatFileSize(bytes: number, locale: Locale): string {
  const intl = toIntlLocale(locale);
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toLocaleString(intl, { maximumFractionDigits: 0 })} KB`;
  }
  return `${(kilobytes / 1024).toLocaleString(intl, {
    maximumFractionDigits: 1,
  })} MB`;
}
