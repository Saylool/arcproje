/**
 * TRY kuruş -> USDC mikro birim dönüşümü.
 *
 * Borçlar TRY minor unit (1 TL = 100 kuruş) cinsindendir. USDC ise 6 ondalıklı
 * ERC-20 arayüzüyle gönderilir (1 USDC = 1.000.000 mikro USDC).
 *
 * Kur "1 USDC = X TRY" biçiminde rasyonel tutulur. Değer artık sunucunun
 * CoinGecko'dan alıp HMAC ile kimliklendirdiği teklifden gelir (bkz.
 * `src/lib/rates`); elle girilmez, varsayılmaz, sabit yazılmaz. Tüm aritmetik
 * BigInt ile yapılır; kanonikleştirmeden sonra hiçbir adımda floating-point
 * kullanılmaz.
 */

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_TWO = BigInt(2);
const BIG_TEN = BigInt(10);

/** 1 USDC = 1.000.000 mikro USDC (ERC-20 arayüzü 6 ondalık). */
export const MICRO_USDC_PER_USDC = BigInt(1_000_000);

/** 1 TRY = 100 kuruş. */
const KURUS_PER_TRY = BigInt(100);

/** Kurda izin verilen en fazla ondalık basamak. */
export const MAX_RATE_DECIMALS = 6;

/**
 * Elle girilen kur için sınırlar.
 *
 * Rasyonel aritmetik tam kalır ama sınırsız uzunlukta girdi gereksiz büyük
 * BigInt işlemine yol açar. Bu sınırlar makul bir kur aralığını korurken
 * kaynak tüketimini sabitler.
 */
export const MAX_RATE_INPUT_LENGTH = 24;
/** MAX_RATE_VALUE 13 basamaklı olduğu için sınır değerin kendisi de sığar. */
export const MAX_RATE_INTEGER_DIGITS = 13;
/** 1 USDC = 1.000.000.000.000 TRY üstü değerler kabul edilmez. */
export const MAX_RATE_VALUE = BigInt("1000000000000");

export type RateParseFailure =
  | "empty"
  | "invalid"
  | "ambiguous"
  | "tooManyDecimals"
  | "tooLong"
  | "tooLarge"
  | "notPositive";

/** Kur, kayıpsız olsun diye rasyonel tutulur: X = numerator / denominator. */
export type ParsedRate = { numerator: bigint; denominator: bigint };

export type RateParseResult =
  | { ok: true; rate: ParsedRate }
  | { ok: false; reason: RateParseFailure };

const RATE_FAILURE_MESSAGES: Record<RateParseFailure, string> = {
  empty: "Kur girilmedi.",
  invalid: "Geçerli bir kur gir (örn. 1 USDC = 34,25 TRY).",
  ambiguous:
    "Bu yazım binlik ayracı mı ondalık mı belli değil. Ondalık kısmı 1, 2 veya 4-6 basamak olacak şekilde yaz.",
  tooManyDecimals: `Kurda en fazla ${MAX_RATE_DECIMALS} ondalık basamak kullanabilirsin.`,
  tooLong: `Kur en fazla ${MAX_RATE_INPUT_LENGTH} karakter ve ${MAX_RATE_INTEGER_DIGITS} tam basamak olabilir.`,
  tooLarge: "Girilen kur mantıklı bir aralığın dışında.",
  notPositive: "Kur sıfırdan büyük olmalı.",
};

export function describeRateFailure(reason: RateParseFailure): string {
  return RATE_FAILURE_MESSAGES[reason];
}

/**
 * "1 USDC = X TRY" ifadesindeki X'i ayrıştırır.
 *
 * Belirsizlik tahmin edilmez, reddedilir: hem `,` hem `.` içeren, aynı ayracı
 * birden fazla kez kullanan veya ondalık kısmı tam 3 basamak olan girdiler
 * (Türkçe binlik ayracıyla karışabildiği için) `ambiguous` döner.
 */
export function parseRate(input: string): RateParseResult {
  const compact = input.replace(/\s/g, "");
  if (compact === "") {
    return { ok: false, reason: "empty" };
  }
  if (compact.length > MAX_RATE_INPUT_LENGTH) {
    return { ok: false, reason: "tooLong" };
  }
  if (!/^[0-9.,]+$/.test(compact) || !/[0-9]/.test(compact)) {
    return { ok: false, reason: "invalid" };
  }

  const hasComma = compact.includes(",");
  const hasDot = compact.includes(".");
  if (hasComma && hasDot) {
    return { ok: false, reason: "ambiguous" };
  }

  const separator = hasComma ? "," : hasDot ? "." : null;
  let integerPart = compact;
  let fractionPart = "";

  if (separator !== null) {
    const parts = compact.split(separator);
    if (parts.length !== 2) {
      return { ok: false, reason: "ambiguous" };
    }
    [integerPart, fractionPart] = parts;
    // Tam 3 basamak binlik ayracıyla karışır; tahmin etmek yerine reddedilir.
    if (fractionPart.length === 3) {
      return { ok: false, reason: "ambiguous" };
    }
    if (fractionPart.length > MAX_RATE_DECIMALS) {
      return { ok: false, reason: "tooManyDecimals" };
    }
  }

  if (integerPart === "") {
    integerPart = "0";
  }
  if (!/^\d+$/.test(integerPart) || (fractionPart !== "" && !/^\d+$/.test(fractionPart))) {
    return { ok: false, reason: "invalid" };
  }

  // Baştaki sıfırlar sayılmasın diye kırpılır; "000005" 1 basamak sayılır.
  const significantInteger = integerPart.replace(/^0+/, "");
  if (significantInteger.length > MAX_RATE_INTEGER_DIGITS) {
    return { ok: false, reason: "tooLong" };
  }

  const numerator = BigInt(`${integerPart}${fractionPart}`);
  const denominator = BIG_TEN ** BigInt(fractionPart.length);

  if (numerator <= BIG_ZERO) {
    return { ok: false, reason: "notPositive" };
  }
  // numerator / denominator > MAX_RATE_VALUE  (float kullanmadan)
  if (numerator > MAX_RATE_VALUE * denominator) {
    return { ok: false, reason: "tooLarge" };
  }

  return { ok: true, rate: { numerator, denominator } };
}

/**
 * Kanonik ondalık paydalar: 10^0 .. 10^MAX_RATE_DECIMALS.
 *
 * `parseRate` yalnızca bunları üretebilir. İmzalı gövdede başka bir payda
 * görmek, kurun uygulamanın üretmediği bir yoldan geldiği anlamına gelir.
 */
const CANONICAL_DENOMINATORS: readonly bigint[] = Array.from(
  { length: MAX_RATE_DECIMALS + 1 },
  (_unused, index) => BIG_TEN ** BigInt(index),
);

export function isCanonicalRateDenominator(denominator: bigint): boolean {
  return CANONICAL_DENOMINATORS.some((allowed) => allowed === denominator);
}

/** MAX_RATE_VALUE * 10^MAX_RATE_DECIMALS = 10^18 -> en fazla 19 basamak. */
const MAX_RATE_NUMERATOR_DIGITS = 19;
/** "1000000" -> en fazla 7 basamak. */
const MAX_RATE_DENOMINATOR_DIGITS = MAX_RATE_DECIMALS + 1;

const RATE_COMPONENT = /^(0|[1-9][0-9]*)$/;

/**
 * İmzalı gövdedeki kur alanlarını, elle girilen kurla AYNI sınırlara göre
 * doğrular. Kur, imza tarafından korunsa bile uygulamanın üretebileceği
 * aralığın dışında olamaz; imza yalnızca alanların değişmediğini kanıtlar.
 */
export function parseSignedRate(
  numeratorText: unknown,
  denominatorText: unknown,
): RateParseResult {
  if (typeof numeratorText !== "string" || typeof denominatorText !== "string") {
    return { ok: false, reason: "invalid" };
  }
  if (
    numeratorText.length > MAX_RATE_NUMERATOR_DIGITS ||
    denominatorText.length > MAX_RATE_DENOMINATOR_DIGITS
  ) {
    return { ok: false, reason: "tooLong" };
  }
  if (
    !RATE_COMPONENT.test(numeratorText) ||
    !RATE_COMPONENT.test(denominatorText)
  ) {
    return { ok: false, reason: "invalid" };
  }

  const numerator = BigInt(numeratorText);
  const denominator = BigInt(denominatorText);

  if (!isCanonicalRateDenominator(denominator)) {
    return { ok: false, reason: "invalid" };
  }
  if (numerator <= BIG_ZERO) {
    return { ok: false, reason: "notPositive" };
  }
  if (numerator > MAX_RATE_VALUE * denominator) {
    return { ok: false, reason: "tooLarge" };
  }

  return { ok: true, rate: { numerator, denominator } };
}

/** Negatif olmayan bölme, yarım yukarı yuvarlama. */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * BIG_TWO >= denominator ? quotient + BIG_ONE : quotient;
}

export type ConversionFailure = "notPositiveDebt" | "zeroAmount" | "invalidRate";

export type ConversionResult =
  | { ok: true; microUsdc: bigint; amount: string }
  | { ok: false; reason: ConversionFailure };

/**
 * Dönüşümün BigInt çekirdeği. Tutar doğrulaması ve talep üretimi AYNI bu
 * fonksiyonu çağırır; yuvarlama farkı doğan bir tutarsızlık mümkün değildir.
 *
 *   USDC        = (kurus / 100) / X            , X = numerator / denominator
 *   mikroUSDC   = kurus * denominator * 1e6 / (100 * numerator)
 *
 * Bölüm tam çıkmazsa en yakın mikro USDC'ye yarım yukarı yuvarlanır.
 */
export function convertTryMinorBigIntToMicroUsdc(
  tryMinor: bigint,
  rate: ParsedRate,
): ConversionResult {
  if (rate.numerator <= BIG_ZERO || rate.denominator <= BIG_ZERO) {
    return { ok: false, reason: "invalidRate" };
  }
  if (tryMinor <= BIG_ZERO) {
    return { ok: false, reason: "notPositiveDebt" };
  }

  const numerator = tryMinor * rate.denominator * MICRO_USDC_PER_USDC;
  const denominator = KURUS_PER_TRY * rate.numerator;
  const microUsdc = divideRoundHalfUp(numerator, denominator);

  if (microUsdc <= BIG_ZERO) {
    return { ok: false, reason: "zeroAmount" };
  }

  return { ok: true, microUsdc, amount: formatMicroUsdcAmount(microUsdc) };
}

/**
 * TRY kuruş tutarını mikro USDC'ye çevirir. Sayısal girdi yalnızca güvenli tam
 * sayı sınırında kabul edilir; aritmetiğin tamamı BigInt çekirdekte yapılır.
 */
export function convertTryMinorToMicroUsdc(
  tryMinor: number,
  rate: ParsedRate,
): ConversionResult {
  if (!Number.isSafeInteger(tryMinor) || tryMinor <= 0) {
    return { ok: false, reason: "notPositiveDebt" };
  }
  return convertTryMinorBigIntToMicroUsdc(BigInt(tryMinor), rate);
}

/**
 * Mikro USDC'yi App Kit `amount` alanına uygun ondalık metne çevirir.
 * En fazla 6 ondalık basamak üretir; okunabilirlik için en az 2 basamak tutar.
 */
export function formatMicroUsdcAmount(microUsdc: bigint): string {
  const whole = microUsdc / MICRO_USDC_PER_USDC;
  const fraction = microUsdc % MICRO_USDC_PER_USDC;

  let fractionText = fraction.toString().padStart(MAX_RATE_DECIMALS, "0");
  while (fractionText.length > 2 && fractionText.endsWith("0")) {
    fractionText = fractionText.slice(0, -1);
  }
  return `${whole.toString()}.${fractionText}`;
}

/** Gösterim için: mikro USDC -> "12,345678" biçimi (Türkçe ondalık ayracı). */
export function formatMicroUsdcForDisplay(microUsdc: bigint): string {
  return formatMicroUsdcAmount(microUsdc).replace(".", ",");
}
