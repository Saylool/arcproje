import { normalizeWalletAddress, walletAddressesEqual } from "./address";
import {
  convertTryMinorBigIntToMicroUsdc,
  parseSignedRate,
} from "./conversion";
import { toCanonicalLabel, validateCanonicalLabel } from "./labels";
import { ACTIVE_NETWORK_PROFILE } from "./profile";
import { translate } from "../i18n/dictionary";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";
import {
  QUOTE_BASE_CURRENCY,
  QUOTE_CURRENCY,
  QUOTE_ID_HEX_LENGTH,
  QUOTE_LIFETIME_MS,
  QUOTE_MAX_CLOCK_SKEW_MS,
  QUOTE_MAX_OBSERVATION_AGE_MS,
  QUOTE_SOURCE,
  RATE_QUOTE_VERSION,
  isValidQuoteTagFormat,
  type RateQuote,
} from "@/lib/rates/quote";

/**
 * İmzalı ödeme talebi sözleşmesi (EIP-712).
 *
 * Fişi ödeyen kişi, her borç için bu yapıyı kendi cüzdanıyla imzalar. İmza
 * yalnızca TALEBİ oluşturur; hiçbir token transferi yetkisi vermez. Borçlu,
 * talebi kendi cihazında açar, imzayı doğrular ve transferi kendi cüzdanıyla
 * imzalar.
 *
 * Tam sayı alanlar JSON'da güvenle taşınamayacağı için ondalık METİN olarak
 * tutulur; BigInt asla doğrudan JSON'a yazılmaz.
 */

/**
 * Şema 2: kur artık elle girilmez, sunucunun kimliklendirdiği teklife bağlıdır.
 * Şema 1 talepleri (elle girilen kur) bilinçli olarak reddedilir.
 */
export const PAYMENT_REQUEST_SCHEMA_VERSION = 2;
export const LEGACY_MANUAL_RATE_SCHEMA_VERSION = 1;

export const PAYMENT_REQUEST_DOMAIN_NAME = "Hesabi Bol Payment Request";
export const PAYMENT_REQUEST_DOMAIN_VERSION = "1";

/**
 * Talep ömrü sınırları.
 *
 * Talep, dayandığı piyasa teklifinden UZUN YAŞAYAMAZ. Teklif ömrü 5 dakika
 * olduğu için varsayılan talep ömrü de odur; daha uzun bir istek verilse bile
 * bitiş anı teklifin bitişine kırpılır.
 */
export const REQUEST_DEFAULT_LIFETIME_MS = QUOTE_LIFETIME_MS;
export const REQUEST_MAX_LIFETIME_MS = QUOTE_LIFETIME_MS;
/** Saat kaymasına karşı geçmişe tolerans. */
export const REQUEST_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Katı uzunluk sınırları. */
export const MAX_LABEL_LENGTH = 40;
export const MAX_DEBT_KEY_LENGTH = 120;
export const MAX_DECIMAL_STRING_LENGTH = 32;
export const REQUEST_ID_HEX_LENGTH = 64;

/** İmzalanan alanların kanonik sırası. Doğrulama da aynı yapıyı kullanır. */
export const PAYMENT_REQUEST_TYPES = {
  PaymentRequest: [
    { name: "schemaVersion", type: "uint16" },
    { name: "requestId", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "debtor", type: "address" },
    { name: "debtKey", type: "string" },
    { name: "tryMinor", type: "uint256" },
    { name: "rateNumerator", type: "uint256" },
    { name: "rateDenominator", type: "uint256" },
    { name: "microUsdc", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "recipientLabel", type: "string" },
    { name: "debtorLabel", type: "string" },
    // Sunucu teklifi: kurun piyasadan geldiğini kanıtlayan meta veri ve etiket.
    { name: "quoteVersion", type: "uint16" },
    { name: "quoteId", type: "bytes32" },
    { name: "quoteBaseCurrency", type: "string" },
    { name: "quoteCurrency", type: "string" },
    { name: "quoteSource", type: "string" },
    { name: "quoteObservedAt", type: "uint64" },
    { name: "quoteIssuedAt", type: "uint64" },
    { name: "quoteExpiresAt", type: "uint64" },
    { name: "quoteTag", type: "bytes32" },
  ],
} as const;

export type PaymentRequestPayload = Readonly<{
  schemaVersion: number;
  /** 0x + 64 hex; crypto.getRandomValues ile üretilir. */
  requestId: string;
  chainId: number;
  recipient: string;
  debtor: string;
  debtKey: string;
  tryMinor: string;
  rateNumerator: string;
  rateDenominator: string;
  microUsdc: string;
  /** Unix saniye. */
  issuedAt: number;
  expiresAt: number;
  recipientLabel: string;
  debtorLabel: string;
  /** Sunucu teklifi meta verisi. rateNumerator/rateDenominator teklifin kurudur. */
  quoteVersion: number;
  quoteId: string;
  quoteBaseCurrency: string;
  quoteCurrency: string;
  quoteSource: string;
  quoteObservedAt: number;
  quoteIssuedAt: number;
  quoteExpiresAt: number;
  /** Sunucunun HMAC kimlik etiketi (0x + 64 hex). */
  quoteTag: string;
}>;

export type SignedPaymentRequest = Readonly<{
  payload: PaymentRequestPayload;
  /** 0x + 130 hex (65 bayt) EOA imzası. */
  signature: string;
}>;

const ALLOWED_PAYLOAD_KEYS = PAYMENT_REQUEST_TYPES.PaymentRequest.map(
  (field) => field.name as keyof PaymentRequestPayload,
);

export type PaymentRequestProblem =
  | "notAnObject"
  | "unexpectedField"
  | "missingField"
  | "unsupportedSchemaVersion"
  | "outdatedSchemaVersion"
  | "invalidQuote"
  | "requestOutlivesQuote"
  | "invalidRequestId"
  | "invalidChainId"
  | "invalidRecipient"
  | "invalidDebtor"
  | "selfTransfer"
  | "invalidDebtKey"
  | "invalidAmount"
  | "inconsistentAmount"
  | "invalidRate"
  | "invalidLabel"
  | "invalidTimestamps"
  | "expired"
  | "notYetValid"
  | "lifetimeTooLong"
  | "invalidSignatureFormat";

/**
 * Kodun kullanıcıya gösterilecek karşılığı.
 *
 * Metin SÖZLÜKTEN gelir; kod MAKİNE OKUNUR kalır ve çevrilmez. `locale`
 * verilmezse Türkçeye düşülür, böylece sunucu tarafındaki çağıranlar
 * (API yanıtları) değişmeden aynı metni üretir.
 */
export function describePaymentRequestProblem(
  problem: PaymentRequestProblem,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return translate(locale, `errors.paymentRequest.${problem}`);
}

const DECIMAL_STRING = /^(0|[1-9][0-9]*)$/;
const REQUEST_ID = new RegExp(`^0x[0-9a-f]{${REQUEST_ID_HEX_LENGTH}}$`, "i");
const QUOTE_ID_PATTERN = new RegExp(`^0x[0-9a-f]{${QUOTE_ID_HEX_LENGTH}}$`);
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

/**
 * İmzalanan metin alanları Unicode'a duyarlı biçimde doğrulanır: kanonik
 * biçim (NFC) şarttır, kontrol/biçim/bidi/sıfır genişlikli karakterler
 * reddedilir. Ayrıntı ve gerekçe için `./labels`.
 */
function isSafeLabel(value: unknown, maxLength: number): value is string {
  return validateCanonicalLabel(value, maxLength).ok;
}

function isDecimalString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_DECIMAL_STRING_LENGTH &&
    DECIMAL_STRING.test(value)
  );
}

/** Kriptografik olarak rastgele talep kimliği. */
export function createRequestId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export type CreatePayloadInput = {
  recipient: string;
  debtor: string;
  debtKey: string;
  tryMinor: number;
  /** Kur ARTIK elle girilmez: sunucunun kimliklendirdiği tekliften gelir. */
  quote: RateQuote;
  quoteTag: string;
  microUsdc: bigint;
  recipientLabel: string;
  debtorLabel: string;
  /** Test edilebilirlik için dışarıdan verilebilir. */
  nowMs?: number;
  requestId?: string;
  lifetimeMs?: number;
};

export type CreatePayloadResult =
  | { ok: true; payload: PaymentRequestPayload }
  | { ok: false; problem: PaymentRequestProblem };

/**
 * Ondalık metin üretimi. Güvenli tam sayı olmayan veya negatif bir sayı,
 * `isDecimalString`in reddedeceği bir metne dönüşür ("1.5", "-3", "1e+21",
 * "NaN"); kural burada tekrar yazılmaz, doğrulama sınırında uygulanır.
 */
function toDecimalText(value: number | bigint): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}

/**
 * Talebi üretir.
 *
 * Üretim ve tüketim TEK bir katı yoldan geçer: burada yalnızca aday gövde
 * kurulur, kuralların tamamını `validatePaymentRequestPayload` uygular. Böylece
 * "üretirken izin verilen ama okurken reddedilen" (veya tersi) bir alan
 * mümkün değildir; ekonomik tutarlılık, talep kimliği biçimi, etiket
 * kanonikliği ve ondalık sınırları üretilen talep için de zorunludur.
 */
export function createPaymentRequestPayload(
  input: CreatePayloadInput,
): CreatePayloadResult {
  const lifetimeMs = input.lifetimeMs ?? REQUEST_DEFAULT_LIFETIME_MS;
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > REQUEST_MAX_LIFETIME_MS) {
    return { ok: false, problem: "lifetimeTooLong" };
  }

  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    return { ok: false, problem: "invalidTimestamps" };
  }

  const recipient = normalizeWalletAddress(input.recipient);
  if (recipient === null) {
    return { ok: false, problem: "invalidRecipient" };
  }
  const debtor = normalizeWalletAddress(input.debtor);
  if (debtor === null) {
    return { ok: false, problem: "invalidDebtor" };
  }

  const issuedAt = Math.floor(nowMs / 1000);
  /*
   * Talep, teklifinden uzun yaşayamaz: istenen ömür teklifin bitişini aşarsa
   * bitiş anı teklifin bitişine kırpılır.
   */
  const requestedExpiry = Math.floor((nowMs + lifetimeMs) / 1000);
  const expiresAt = Math.min(requestedExpiry, input.quote.expiresAt);

  const candidate: Record<string, unknown> = {
    schemaVersion: PAYMENT_REQUEST_SCHEMA_VERSION,
    requestId: input.requestId ?? createRequestId(),
    chainId: ACTIVE_NETWORK_PROFILE.chainId,
    recipient,
    debtor,
    // Etiketler ve borç kimliği kanonik biçimde saklanır ve öyle imzalanır.
    debtKey: toCanonicalLabel(input.debtKey),
    tryMinor: toDecimalText(input.tryMinor),
    // Kur doğrudan teklifin kurudur; ayrı bir kaynak yoktur.
    rateNumerator: input.quote.rateNumerator,
    rateDenominator: input.quote.rateDenominator,
    microUsdc: toDecimalText(input.microUsdc),
    issuedAt,
    expiresAt,
    recipientLabel: toCanonicalLabel(input.recipientLabel),
    debtorLabel: toCanonicalLabel(input.debtorLabel),
    quoteVersion: input.quote.quoteVersion,
    quoteId: input.quote.quoteId,
    quoteBaseCurrency: input.quote.baseCurrency,
    quoteCurrency: input.quote.quoteCurrency,
    quoteSource: input.quote.source,
    quoteObservedAt: input.quote.observedAt,
    quoteIssuedAt: input.quote.issuedAt,
    quoteExpiresAt: input.quote.expiresAt,
    quoteTag: input.quoteTag,
  };

  return validatePaymentRequestPayload(candidate, nowMs);
}

/**
 * İmzalama ve doğrulama aynı yapıyı kullanır; imza bütünlüğü JSON anahtar
 * sırasına değil bu kanonik tip tanımına bağlıdır.
 */
export function buildTypedData(payload: PaymentRequestPayload) {
  return {
    domain: {
      name: PAYMENT_REQUEST_DOMAIN_NAME,
      version: PAYMENT_REQUEST_DOMAIN_VERSION,
      chainId: ACTIVE_NETWORK_PROFILE.chainId,
    },
    types: PAYMENT_REQUEST_TYPES,
    primaryType: "PaymentRequest" as const,
    message: {
      schemaVersion: payload.schemaVersion,
      requestId: payload.requestId as `0x${string}`,
      chainId: BigInt(payload.chainId),
      recipient: payload.recipient as `0x${string}`,
      debtor: payload.debtor as `0x${string}`,
      debtKey: payload.debtKey,
      tryMinor: BigInt(payload.tryMinor),
      rateNumerator: BigInt(payload.rateNumerator),
      rateDenominator: BigInt(payload.rateDenominator),
      microUsdc: BigInt(payload.microUsdc),
      issuedAt: BigInt(payload.issuedAt),
      expiresAt: BigInt(payload.expiresAt),
      recipientLabel: payload.recipientLabel,
      debtorLabel: payload.debtorLabel,
      quoteVersion: payload.quoteVersion,
      quoteId: payload.quoteId as `0x${string}`,
      quoteBaseCurrency: payload.quoteBaseCurrency,
      quoteCurrency: payload.quoteCurrency,
      quoteSource: payload.quoteSource,
      quoteObservedAt: BigInt(payload.quoteObservedAt),
      quoteIssuedAt: BigInt(payload.quoteIssuedAt),
      quoteExpiresAt: BigInt(payload.quoteExpiresAt),
      quoteTag: payload.quoteTag as `0x${string}`,
    },
  };
}

/**
 * İmzalı gövdeden kanonik sunucu teklifini yeniden kurar.
 *
 * Kur alanları gövdede TEK KEZ bulunur (rateNumerator/rateDenominator) ve
 * teklifin kuru da odur; bu yüzden kuru kurcalamak HMAC etiketini de bozar.
 */
export function extractQuoteFromPayload(payload: PaymentRequestPayload): RateQuote {
  return Object.freeze({
    quoteVersion: payload.quoteVersion,
    quoteId: payload.quoteId,
    baseCurrency: payload.quoteBaseCurrency,
    quoteCurrency: payload.quoteCurrency,
    source: payload.quoteSource,
    rateNumerator: payload.rateNumerator,
    rateDenominator: payload.rateDenominator,
    observedAt: payload.quoteObservedAt,
    issuedAt: payload.quoteIssuedAt,
    expiresAt: payload.quoteExpiresAt,
  });
}

export type ValidatePayloadResult =
  | { ok: true; payload: PaymentRequestPayload }
  | { ok: false; problem: PaymentRequestProblem };

/**
 * Bilinmeyen kaynaktan gelen bir talep gövdesini katı biçimde doğrular.
 * URL'den gelen hiçbir değere doğruluğu varsayılarak güvenilmez.
 */
export function validatePaymentRequestPayload(
  value: unknown,
  nowMs: number,
): ValidatePayloadResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, problem: "notAnObject" };
  }
  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(ALLOWED_PAYLOAD_KEYS as string[]).includes(key)) {
      return { ok: false, problem: "unexpectedField" };
    }
  }
  for (const key of ALLOWED_PAYLOAD_KEYS) {
    if (!(key in record)) {
      return { ok: false, problem: "missingField" };
    }
  }

  if (record.schemaVersion === LEGACY_MANUAL_RATE_SCHEMA_VERSION) {
    // Elle girilen kurlu eski bağlantılar bilinçli olarak kabul edilmez.
    return { ok: false, problem: "outdatedSchemaVersion" };
  }
  if (record.schemaVersion !== PAYMENT_REQUEST_SCHEMA_VERSION) {
    return { ok: false, problem: "unsupportedSchemaVersion" };
  }
  if (typeof record.requestId !== "string" || !REQUEST_ID.test(record.requestId)) {
    return { ok: false, problem: "invalidRequestId" };
  }
  if (record.chainId !== ACTIVE_NETWORK_PROFILE.chainId) {
    return { ok: false, problem: "invalidChainId" };
  }

  const recipient =
    typeof record.recipient === "string"
      ? normalizeWalletAddress(record.recipient)
      : null;
  if (recipient === null) {
    return { ok: false, problem: "invalidRecipient" };
  }
  const debtor =
    typeof record.debtor === "string"
      ? normalizeWalletAddress(record.debtor)
      : null;
  if (debtor === null) {
    return { ok: false, problem: "invalidDebtor" };
  }
  if (walletAddressesEqual(recipient, debtor)) {
    return { ok: false, problem: "selfTransfer" };
  }

  if (!isSafeLabel(record.debtKey, MAX_DEBT_KEY_LENGTH)) {
    return { ok: false, problem: "invalidDebtKey" };
  }
  if (
    !isSafeLabel(record.recipientLabel, MAX_LABEL_LENGTH) ||
    !isSafeLabel(record.debtorLabel, MAX_LABEL_LENGTH)
  ) {
    return { ok: false, problem: "invalidLabel" };
  }

  /*
   * Sunucu teklifi alanları. Buradaki doğrulama YAPISALDIR; etiketin gerçekten
   * sunucudan geldiği ayrıca /api/rates/verify üzerinden kanıtlanır. İstemci
   * sırrı bilmediği için HMAC'i burada doğrulayamaz.
   */
  if (record.quoteVersion !== RATE_QUOTE_VERSION) {
    return { ok: false, problem: "invalidQuote" };
  }
  if (
    typeof record.quoteId !== "string" ||
    !QUOTE_ID_PATTERN.test(record.quoteId)
  ) {
    return { ok: false, problem: "invalidQuote" };
  }
  if (
    record.quoteBaseCurrency !== QUOTE_BASE_CURRENCY ||
    record.quoteCurrency !== QUOTE_CURRENCY ||
    record.quoteSource !== QUOTE_SOURCE
  ) {
    return { ok: false, problem: "invalidQuote" };
  }
  if (!isValidQuoteTagFormat(record.quoteTag)) {
    return { ok: false, problem: "invalidQuote" };
  }

  const quoteObservedAt = record.quoteObservedAt;
  const quoteIssuedAt = record.quoteIssuedAt;
  const quoteExpiresAt = record.quoteExpiresAt;
  if (
    typeof quoteObservedAt !== "number" ||
    typeof quoteIssuedAt !== "number" ||
    typeof quoteExpiresAt !== "number" ||
    !Number.isSafeInteger(quoteObservedAt) ||
    !Number.isSafeInteger(quoteIssuedAt) ||
    !Number.isSafeInteger(quoteExpiresAt) ||
    quoteObservedAt <= 0 ||
    quoteIssuedAt <= 0 ||
    quoteExpiresAt <= quoteIssuedAt ||
    (quoteExpiresAt - quoteIssuedAt) * 1000 > QUOTE_LIFETIME_MS
  ) {
    return { ok: false, problem: "invalidQuote" };
  }

  if (!isDecimalString(record.tryMinor) || BigInt(record.tryMinor) <= BigInt(0)) {
    return { ok: false, problem: "invalidAmount" };
  }
  if (!Number.isSafeInteger(Number(record.tryMinor))) {
    return { ok: false, problem: "invalidAmount" };
  }
  if (!isDecimalString(record.microUsdc) || BigInt(record.microUsdc) <= BigInt(0)) {
    return { ok: false, problem: "invalidAmount" };
  }
  if (
    !isDecimalString(record.rateNumerator) ||
    !isDecimalString(record.rateDenominator)
  ) {
    return { ok: false, problem: "invalidRate" };
  }
  // Kur, elle girilen kurla aynı sınırlara tabidir: kanonik ondalık payda,
  // pozitif pay ve MAX_RATE_VALUE üst sınırı.
  const rate = parseSignedRate(record.rateNumerator, record.rateDenominator);
  if (!rate.ok) {
    return { ok: false, problem: "invalidRate" };
  }

  /*
   * Geçerli bir imza YALNIZCA alanları kimin imzaladığını kanıtlar; bu
   * alanların birbiriyle tutarlı olduğunu kanıtlamaz. Kötü niyetli bir talep
   * oluşturucu, küçük bir TRY borcunu büyük bir USDC tutarıyla eşleştirip
   * kriptografik olarak geçerli biçimde imzalayabilir. Bu yüzden tutar,
   * dürüst üretimin kullandığı BigInt çekirdeğiyle (aynı yarım-yukarı
   * yuvarlama) yeniden hesaplanır ve birebir eşitlik aranır.
   */
  const recomputed = convertTryMinorBigIntToMicroUsdc(
    BigInt(record.tryMinor),
    rate.rate,
  );
  if (!recomputed.ok) {
    return { ok: false, problem: "invalidAmount" };
  }
  if (recomputed.microUsdc !== BigInt(record.microUsdc)) {
    return { ok: false, problem: "inconsistentAmount" };
  }

  const issuedAt = record.issuedAt;
  const expiresAt = record.expiresAt;
  if (
    typeof issuedAt !== "number" ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt <= 0 ||
    expiresAt <= issuedAt
  ) {
    return { ok: false, problem: "invalidTimestamps" };
  }
  if ((expiresAt - issuedAt) * 1000 > REQUEST_MAX_LIFETIME_MS) {
    return { ok: false, problem: "lifetimeTooLong" };
  }

  /*
   * Talep, dayandığı piyasa teklifinden UZUN YAŞAYAMAZ. Aksi hâlde 5 dakikalık
   * bir kurla imzalanmış bir talep günlerce ödenebilir ve gerçek piyasa
   * kurundan kopardı.
   */
  if (expiresAt > quoteExpiresAt) {
    return { ok: false, problem: "requestOutlivesQuote" };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const skewSeconds = Math.floor(REQUEST_MAX_CLOCK_SKEW_MS / 1000);
  const quoteSkewSeconds = Math.floor(QUOTE_MAX_CLOCK_SKEW_MS / 1000);
  const maxObservationAgeSeconds = Math.floor(QUOTE_MAX_OBSERVATION_AGE_MS / 1000);

  // Önce talebin kendi zaman penceresi: kullanıcıya en anlaşılır sinyal budur.
  if (issuedAt - skewSeconds > nowSeconds) {
    return { ok: false, problem: "notYetValid" };
  }
  if (expiresAt <= nowSeconds) {
    return { ok: false, problem: "expired" };
  }

  // Ardından teklifin tazeliği: bayat bir gözlem sessizce kabul edilmez.
  if (quoteObservedAt - quoteSkewSeconds > nowSeconds) {
    return { ok: false, problem: "invalidQuote" };
  }
  if (nowSeconds - quoteObservedAt > maxObservationAgeSeconds) {
    return { ok: false, problem: "invalidQuote" };
  }
  if (quoteIssuedAt - quoteSkewSeconds > nowSeconds) {
    return { ok: false, problem: "invalidQuote" };
  }

  return {
    ok: true,
    payload: Object.freeze({
      schemaVersion: PAYMENT_REQUEST_SCHEMA_VERSION,
      requestId: record.requestId.toLowerCase(),
      chainId: ACTIVE_NETWORK_PROFILE.chainId,
      recipient,
      debtor,
      debtKey: record.debtKey,
      tryMinor: record.tryMinor,
      rateNumerator: record.rateNumerator,
      rateDenominator: record.rateDenominator,
      microUsdc: record.microUsdc,
      issuedAt,
      expiresAt,
      recipientLabel: record.recipientLabel,
      debtorLabel: record.debtorLabel,
      quoteVersion: RATE_QUOTE_VERSION,
      quoteId: record.quoteId,
      quoteBaseCurrency: QUOTE_BASE_CURRENCY,
      quoteCurrency: QUOTE_CURRENCY,
      quoteSource: QUOTE_SOURCE,
      quoteObservedAt,
      quoteIssuedAt,
      quoteExpiresAt,
      quoteTag: record.quoteTag,
    }),
  };
}

export function isValidSignatureFormat(value: unknown): value is string {
  return typeof value === "string" && SIGNATURE.test(value);
}
