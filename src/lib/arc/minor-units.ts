/**
 * KANONİK TAM SAYI GÖSTERİMİ (minor unit).
 *
 * Para tutarları uygulamanın her katmanında TAM SAYI minor unit'tir: TRY
 * kuruş ve mikro USDC. Bu modül o tam sayıların TEK kanonik taşıma biçimini
 * tanımlar: baştaki sıfır taşımayan, işaretsiz, ondalıksız, üstel gösterim
 * içermeyen ONDALIK METİN.
 *
 * NEDEN METİN, NEDEN `number` DEĞİL:
 *
 * Paylaşılan hesap alanı borçları ondalık metin olarak saklar ve depo sütunu
 * `numeric(30, 0)`dır — JavaScript'in güvenli tam sayı aralığından (2^53 - 1)
 * çok daha geniştir. Bir tutarı `number`a indirmek 9007199254740993 gibi bir
 * değeri SESSİZCE 9007199254740992'ye çevirir: gösterilen, tahmin edilen,
 * rezerve edilen ve gönderilen tutar birbirinden ayrılır. Bu yüzden gönderim
 * sınırındaki snapshot da metin taşır ve aritmetiğin tamamı BigInt'tir.
 *
 * `parseFloat`, `Number(...)` ve kayan nokta aritmetiği bu modülde de, bu
 * modülü kullanan yollarda da KULLANILMAZ.
 */

const BIG_ZERO = BigInt(0);

/**
 * İzin verilen en fazla basamak.
 *
 * Depo sütunu `numeric(30, 0)`; sınır onunla aynıdır, böylece uygulamanın
 * kabul ettiği hiçbir tutar veritabanı kısıtına takılmaz ve tersi de doğrudur.
 */
export const MAX_MINOR_UNITS_DIGITS = 30;

/** Kanonik biçim: tek "0" ya da sıfırla başlamayan basamak dizisi. */
const CANONICAL_MINOR_UNITS = /^(0|[1-9][0-9]*)$/;

/** Değer kanonik ondalık tam sayı metni mi? (Sıfır kabul edilir.) */
export function isCanonicalMinorUnits(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_MINOR_UNITS_DIGITS &&
    CANONICAL_MINOR_UNITS.test(value)
  );
}

/**
 * Kanonik metni POZİTİF BigInt'e çevirir.
 *
 * Sıfır, negatif, boşluklu, işaretli, baştaki sıfırlı, ondalıklı, üstel ya da
 * sınırdan uzun her girdi `null` döner. Çağıran bunu fail-closed bir hata
 * koduna çevirir; sessiz bir varsayılana DÜŞÜLMEZ.
 */
export function parsePositiveMinorUnits(value: unknown): bigint | null {
  if (!isCanonicalMinorUnits(value)) {
    return null;
  }
  const parsed = BigInt(value);
  return parsed > BIG_ZERO ? parsed : null;
}

/**
 * Güvenli bir `number` ya da BigInt'i kanonik metne çevirir.
 *
 * `number` girdi YALNIZCA `Number.isSafeInteger` sınırında kabul edilir: bu,
 * fiş/bölüşme katmanından gelen eski sayısal borçların DARALTMA OLMADAN
 * kanonik metne taşındığı SINIRDIR. Güvenli aralığın dışındaki bir `number`
 * sessizce yuvarlanmaz, `null` döner.
 *
 * BigInt girdi doğrudan taşınır; hiçbir aşamada `number`a indirgenmez.
 */
export function toCanonicalMinorUnits(value: number | bigint): string | null {
  if (typeof value === "bigint") {
    return value < BIG_ZERO || value.toString().length > MAX_MINOR_UNITS_DIGITS
      ? null
      : value.toString();
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  // Güvenli tam sayı `toString()` çıktısı her zaman kanoniktir (üstel değil).
  return String(value);
}

/** 1 TRY = 100 kuruş. */
const MINOR_PER_MAJOR = BigInt(100);

/**
 * TRY minor unit'i GÖSTERİM metnine çevirir — TAMAMEN BigInt ile.
 *
 * `Intl.NumberFormat` bir `number` ister ve `minor / 100` kayan noktadır:
 * güvenli tam sayı aralığının üstünde gösterilen tutar, gönderilen tutardan
 * SAPAR. Gösterilen, tahmin edilen, rezerve edilen, gönderilen ve mutabakatı
 * yapılan tutarın hepsi AYNI tam sayıdan türemek zorunda olduğu için
 * biçimlendirme de burada tam sayı üzerinden yapılır.
 *
 * Çıktı Türkçe yazımdır: binlik ayracı ".", ondalık ayracı ",".
 */
export function formatMinorUnitsAsTry(value: unknown): string | null {
  if (!isCanonicalMinorUnits(value)) {
    return null;
  }
  const amount = BigInt(value);
  const whole = (amount / MINOR_PER_MAJOR).toString();
  const fraction = (amount % MINOR_PER_MAJOR).toString().padStart(2, "0");

  let grouped = "";
  for (let index = 0; index < whole.length; index += 1) {
    if (index > 0 && (whole.length - index) % 3 === 0) {
      grouped += ".";
    }
    grouped += whole[index];
  }
  return `${grouped},${fraction} ₺`;
}
