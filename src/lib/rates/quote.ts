/**
 * Sunucu tarafından imzalanan piyasa kuru teklifi (quote).
 *
 * Sorun: talebi oluşturan kişi kendi cüzdanıyla imza atabildiği için, elle
 * yazdığı bir kuru da "imzalı" gösterebilirdi. EIP-712 imzası yalnızca alanları
 * KİMİN imzaladığını kanıtlar; kurun piyasadan geldiğini kanıtlamaz.
 *
 * Çözüm: kuru sunucu gözlemler, kanonik bir yapıya koyar ve HMAC-SHA-256 ile
 * kimliklendirir. Oluşturucu bu teklifi değiştiremez; değiştirirse doğrulama
 * sunucuda düşer. HMAC bir SIR değil, bir KİMLİK ETİKETİDİR: imzalı ödeme
 * talebinin içinde taşınabilir.
 *
 * Bu modül saftır ve `node:crypto` içermez; hem sunucuda hem istemcide
 * kullanılabilir. İmzalama/doğrulama `./quote-auth` (yalnızca sunucu) içindedir.
 */

import { translate } from "../i18n/dictionary";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";

import {
  MAX_RATE_VALUE,
  isCanonicalRateDenominator,
  type ParsedRate,
} from "@/lib/arc/conversion";

export const RATE_QUOTE_VERSION = 1;

/** Sabit piyasa çifti ve kaynak. Başka bir değer kabul edilmez. */
export const QUOTE_BASE_CURRENCY = "USDC";
export const QUOTE_CURRENCY = "TRY";
export const QUOTE_SOURCE = "coingecko";

/** Teklif ömrü kısa ve açıktır. */
export const QUOTE_LIFETIME_MS = 5 * 60 * 1000;
/** Saat kaymasına karşı ileri tolerans. */
export const QUOTE_MAX_CLOCK_SKEW_MS = 60 * 1000;
/**
 * Sağlayıcı gözlem yaşı üst sınırı. CoinGecko Demo verisi ~60 sn tazeliktedir;
 * bu sınır bayat veriyi sessizce kabul etmeyi engeller.
 */
export const QUOTE_MAX_OBSERVATION_AGE_MS = 10 * 60 * 1000;

/**
 * Cüzdan akışı açılmadan önce gereken asgari kalan süre.
 *
 * Teklif basımı da bunu gözetir: bu paydan daha kısa ömürlü bir teklif zaten
 * kullanılamaz, üretilmesi anlamsızdır.
 */
export const QUOTE_MIN_SEND_MARGIN_SECONDS = 60;

/** Kanonik kur her zaman altı ondalıktır: payda tam olarak 10^6. */
export const QUOTE_RATE_DECIMALS = 6;
export const QUOTE_RATE_DENOMINATOR = BigInt(10) ** BigInt(QUOTE_RATE_DECIMALS);

/** quoteId: 32 rastgele bayt, 0x + 64 hex. */
export const QUOTE_ID_HEX_LENGTH = 64;
/** HMAC-SHA-256 etiketi: 32 bayt, 0x + 64 hex. */
export const QUOTE_TAG_HEX_LENGTH = 64;

const QUOTE_ID = new RegExp(`^0x[0-9a-f]{${QUOTE_ID_HEX_LENGTH}}$`);
const QUOTE_TAG = new RegExp(`^0x[0-9a-f]{${QUOTE_TAG_HEX_LENGTH}}$`);
const DECIMAL_STRING = /^(0|[1-9][0-9]*)$/;
/** MAX_RATE_VALUE * 10^6 = 10^18 -> en fazla 19 basamak. */
const MAX_RATE_NUMERATOR_DIGITS = 19;

/**
 * Sunucunun ürettiği teklif. Tüm sayısal alanlar JSON'da güvenle taşınabilsin
 * diye ondalık METİN veya Unix saniye tam sayısıdır.
 */
export type RateQuote = Readonly<{
  quoteVersion: number;
  quoteId: string;
  baseCurrency: string;
  quoteCurrency: string;
  source: string;
  rateNumerator: string;
  rateDenominator: string;
  /** Sağlayıcının fiyatı gözlediği an (Unix saniye). */
  observedAt: number;
  /** Sunucunun teklifi ürettiği an. */
  issuedAt: number;
  expiresAt: number;
}>;

export type SignedRateQuote = Readonly<{
  quote: RateQuote;
  /** HMAC-SHA-256 kimlik etiketi (0x + 64 hex). */
  tag: string;
}>;

export type QuoteProblem =
  | "notAnObject"
  | "unexpectedField"
  | "missingField"
  | "unsupportedQuoteVersion"
  | "invalidQuoteId"
  | "invalidCurrencyPair"
  | "invalidSource"
  | "invalidRate"
  | "invalidTimestamps"
  | "observationTooOld"
  | "observationInFuture"
  | "lifetimeTooLong"
  | "notYetValid"
  | "expired"
  | "invalidTag";

/**
 * Kodun kullanıcıya gösterilecek karşılığı.
 *
 * Metin SÖZLÜKTEN gelir; kod MAKİNE OKUNUR kalır ve çevrilmez. `locale`
 * verilmezse Türkçeye düşülür, böylece sunucu tarafındaki çağıranlar
 * (API yanıtları) değişmeden aynı metni üretir.
 */
export function describeQuoteProblem(
  problem: QuoteProblem,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return translate(locale, `errors.quote.${problem}`);
}

/** İmzalanan alanların kanonik SIRASI. Doğrulama da bu sırayı kullanır. */
export const QUOTE_FIELD_ORDER = [
  "quoteVersion",
  "quoteId",
  "baseCurrency",
  "quoteCurrency",
  "source",
  "rateNumerator",
  "rateDenominator",
  "observedAt",
  "issuedAt",
  "expiresAt",
] as const satisfies readonly (keyof RateQuote)[];

/**
 * HMAC'in üzerine hesaplandığı kanonik metin.
 *
 * Rastgele anahtar sırasına sahip bir nesne DEĞİL, açıkça sıralanmış ve
 * ayraçla bölünmüş sabit bir dize kimliklendirilir. Alanların hiçbiri satır
 * sonu içeremez (hepsi katı desenlerle doğrulanır), bu yüzden ayraç güvenlidir.
 */
export function serializeQuoteForAuth(quote: RateQuote): string {
  return [
    "arc-rate-quote",
    String(RATE_QUOTE_VERSION),
    ...QUOTE_FIELD_ORDER.map((field) => String(quote[field])),
  ].join("\n");
}

export type QuoteValidationResult =
  | { ok: true; quote: RateQuote }
  | { ok: false; problem: QuoteProblem };

/**
 * Bilinmeyen kaynaktan gelen bir teklif gövdesini katı biçimde doğrular.
 * Zaman kontrolleri `nowMs` ile yapılır; testlerde sabit saat verilebilir.
 */
export function validateRateQuote(
  value: unknown,
  nowMs: number,
): QuoteValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, problem: "notAnObject" };
  }
  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(QUOTE_FIELD_ORDER as readonly string[]).includes(key)) {
      return { ok: false, problem: "unexpectedField" };
    }
  }
  for (const key of QUOTE_FIELD_ORDER) {
    if (!(key in record)) {
      return { ok: false, problem: "missingField" };
    }
  }

  if (record.quoteVersion !== RATE_QUOTE_VERSION) {
    return { ok: false, problem: "unsupportedQuoteVersion" };
  }
  if (typeof record.quoteId !== "string" || !QUOTE_ID.test(record.quoteId)) {
    return { ok: false, problem: "invalidQuoteId" };
  }
  if (
    record.baseCurrency !== QUOTE_BASE_CURRENCY ||
    record.quoteCurrency !== QUOTE_CURRENCY
  ) {
    return { ok: false, problem: "invalidCurrencyPair" };
  }
  if (record.source !== QUOTE_SOURCE) {
    return { ok: false, problem: "invalidSource" };
  }

  const rate = parseQuoteRate(record.rateNumerator, record.rateDenominator);
  if (!rate.ok) {
    return { ok: false, problem: "invalidRate" };
  }

  const { observedAt, issuedAt, expiresAt } = record;
  if (
    typeof observedAt !== "number" ||
    typeof issuedAt !== "number" ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(observedAt) ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    observedAt <= 0 ||
    issuedAt <= 0 ||
    expiresAt <= issuedAt
  ) {
    return { ok: false, problem: "invalidTimestamps" };
  }
  if ((expiresAt - issuedAt) * 1000 > QUOTE_LIFETIME_MS) {
    return { ok: false, problem: "lifetimeTooLong" };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const skewSeconds = Math.floor(QUOTE_MAX_CLOCK_SKEW_MS / 1000);
  const maxAgeSeconds = Math.floor(QUOTE_MAX_OBSERVATION_AGE_MS / 1000);

  if (observedAt - skewSeconds > nowSeconds) {
    return { ok: false, problem: "observationInFuture" };
  }
  if (nowSeconds - observedAt > maxAgeSeconds) {
    return { ok: false, problem: "observationTooOld" };
  }
  if (issuedAt - skewSeconds > nowSeconds) {
    return { ok: false, problem: "notYetValid" };
  }
  if (expiresAt <= nowSeconds) {
    return { ok: false, problem: "expired" };
  }

  return {
    ok: true,
    quote: Object.freeze({
      quoteVersion: RATE_QUOTE_VERSION,
      quoteId: record.quoteId,
      baseCurrency: QUOTE_BASE_CURRENCY,
      quoteCurrency: QUOTE_CURRENCY,
      source: QUOTE_SOURCE,
      rateNumerator: record.rateNumerator as string,
      rateDenominator: record.rateDenominator as string,
      observedAt,
      issuedAt,
      expiresAt,
    }),
  };
}

export type QuoteRateResult =
  | { ok: true; rate: ParsedRate }
  | { ok: false };

/**
 * Teklifteki kur alanlarını doğrular.
 *
 * Payda kanonik ondalık olmak zorundadır ve teklif üretimi her zaman 10^6
 * kullanır. Üst sınır elle girilen kurla aynıdır (MAX_RATE_VALUE).
 */
export function parseQuoteRate(
  numeratorText: unknown,
  denominatorText: unknown,
): QuoteRateResult {
  if (
    typeof numeratorText !== "string" ||
    typeof denominatorText !== "string" ||
    numeratorText.length > MAX_RATE_NUMERATOR_DIGITS ||
    denominatorText.length > QUOTE_RATE_DECIMALS + 1 ||
    !DECIMAL_STRING.test(numeratorText) ||
    !DECIMAL_STRING.test(denominatorText)
  ) {
    return { ok: false };
  }

  const numerator = BigInt(numeratorText);
  const denominator = BigInt(denominatorText);

  if (!isCanonicalRateDenominator(denominator)) {
    return { ok: false };
  }
  if (numerator <= BigInt(0)) {
    return { ok: false };
  }
  if (numerator > MAX_RATE_VALUE * denominator) {
    return { ok: false };
  }
  return { ok: true, rate: { numerator, denominator } };
}

export function isValidQuoteTagFormat(value: unknown): value is string {
  return typeof value === "string" && QUOTE_TAG.test(value);
}

/** Gösterim: "42.123456" — her zaman tam altı ondalık. */
export function formatQuoteRate(quote: RateQuote): string {
  const numerator = BigInt(quote.rateNumerator);
  const denominator = BigInt(quote.rateDenominator);
  const scaled = (numerator * QUOTE_RATE_DENOMINATOR) / denominator;
  const whole = scaled / QUOTE_RATE_DENOMINATOR;
  const fraction = (scaled % QUOTE_RATE_DENOMINATOR)
    .toString()
    .padStart(QUOTE_RATE_DECIMALS, "0");
  return `${whole.toString()}.${fraction}`;
}
