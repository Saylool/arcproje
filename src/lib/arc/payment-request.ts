import { normalizeWalletAddress, walletAddressesEqual } from "./address";
import { ACTIVE_NETWORK_PROFILE } from "./profile";

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

export const PAYMENT_REQUEST_SCHEMA_VERSION = 1;

export const PAYMENT_REQUEST_DOMAIN_NAME = "Hesabi Bol Payment Request";
export const PAYMENT_REQUEST_DOMAIN_VERSION = "1";

/** Talep ömrü sınırları. */
export const REQUEST_DEFAULT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const REQUEST_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
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
  | "invalidRequestId"
  | "invalidChainId"
  | "invalidRecipient"
  | "invalidDebtor"
  | "selfTransfer"
  | "invalidDebtKey"
  | "invalidAmount"
  | "invalidRate"
  | "invalidLabel"
  | "invalidTimestamps"
  | "expired"
  | "notYetValid"
  | "lifetimeTooLong"
  | "invalidSignatureFormat";

const PROBLEM_MESSAGES: Record<PaymentRequestProblem, string> = {
  notAnObject: "Ödeme talebi okunamadı.",
  unexpectedField: "Ödeme talebinde beklenmeyen alan var.",
  missingField: "Ödeme talebinde eksik alan var.",
  unsupportedSchemaVersion: "Bu ödeme talebi sürümü desteklenmiyor.",
  invalidRequestId: "Talep kimliği geçersiz.",
  invalidChainId: "Talep Arc Testnet için oluşturulmamış.",
  invalidRecipient: "Alıcı adresi geçersiz.",
  invalidDebtor: "Borçlu adresi geçersiz.",
  selfTransfer: "Gönderen ve alıcı aynı adres olamaz.",
  invalidDebtKey: "Borç kimliği geçersiz.",
  invalidAmount: "Talepteki tutar geçersiz.",
  invalidRate: "Talepteki kur geçersiz.",
  invalidLabel: "Talepteki isim alanı geçersiz.",
  invalidTimestamps: "Talebin zaman bilgisi geçersiz.",
  expired: "Bu ödeme talebinin süresi dolmuş.",
  notYetValid: "Bu ödeme talebi henüz geçerli değil.",
  lifetimeTooLong: "Talebin geçerlilik süresi izin verilenden uzun.",
  invalidSignatureFormat: "Talep imzası geçersiz biçimde.",
};

export function describePaymentRequestProblem(
  problem: PaymentRequestProblem,
): string {
  return PROBLEM_MESSAGES[problem];
}

/** Kontrol karakterleri (C0 aralığı ve DEL) etiketlerde kabul edilmez. */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");
const DECIMAL_STRING = /^(0|[1-9][0-9]*)$/;
const REQUEST_ID = new RegExp(`^0x[0-9a-f]{${REQUEST_ID_HEX_LENGTH}}$`, "i");
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

function isSafeLabel(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !CONTROL_CHARS.test(value)
  );
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
  rateNumerator: bigint;
  rateDenominator: bigint;
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

export function createPaymentRequestPayload(
  input: CreatePayloadInput,
): CreatePayloadResult {
  const recipient = normalizeWalletAddress(input.recipient);
  if (recipient === null) {
    return { ok: false, problem: "invalidRecipient" };
  }
  const debtor = normalizeWalletAddress(input.debtor);
  if (debtor === null) {
    return { ok: false, problem: "invalidDebtor" };
  }
  if (walletAddressesEqual(recipient, debtor)) {
    return { ok: false, problem: "selfTransfer" };
  }
  if (!isSafeLabel(input.debtKey, MAX_DEBT_KEY_LENGTH)) {
    return { ok: false, problem: "invalidDebtKey" };
  }
  if (
    !isSafeLabel(input.recipientLabel, MAX_LABEL_LENGTH) ||
    !isSafeLabel(input.debtorLabel, MAX_LABEL_LENGTH)
  ) {
    return { ok: false, problem: "invalidLabel" };
  }
  if (!Number.isSafeInteger(input.tryMinor) || input.tryMinor <= 0) {
    return { ok: false, problem: "invalidAmount" };
  }
  if (input.microUsdc <= BigInt(0)) {
    return { ok: false, problem: "invalidAmount" };
  }
  if (input.rateNumerator <= BigInt(0) || input.rateDenominator <= BigInt(0)) {
    return { ok: false, problem: "invalidRate" };
  }

  const lifetimeMs = input.lifetimeMs ?? REQUEST_DEFAULT_LIFETIME_MS;
  if (lifetimeMs <= 0 || lifetimeMs > REQUEST_MAX_LIFETIME_MS) {
    return { ok: false, problem: "lifetimeTooLong" };
  }

  const nowMs = input.nowMs ?? Date.now();
  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = Math.floor((nowMs + lifetimeMs) / 1000);

  return {
    ok: true,
    payload: Object.freeze({
      schemaVersion: PAYMENT_REQUEST_SCHEMA_VERSION,
      requestId: input.requestId ?? createRequestId(),
      chainId: ACTIVE_NETWORK_PROFILE.chainId,
      recipient,
      debtor,
      debtKey: input.debtKey,
      tryMinor: String(input.tryMinor),
      rateNumerator: input.rateNumerator.toString(),
      rateDenominator: input.rateDenominator.toString(),
      microUsdc: input.microUsdc.toString(),
      issuedAt,
      expiresAt,
      recipientLabel: input.recipientLabel,
      debtorLabel: input.debtorLabel,
    }),
  };
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
    },
  };
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
    !isDecimalString(record.rateDenominator) ||
    BigInt(record.rateNumerator) <= BigInt(0) ||
    BigInt(record.rateDenominator) <= BigInt(0)
  ) {
    return { ok: false, problem: "invalidRate" };
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

  const nowSeconds = Math.floor(nowMs / 1000);
  const skewSeconds = Math.floor(REQUEST_MAX_CLOCK_SKEW_MS / 1000);
  if (issuedAt - skewSeconds > nowSeconds) {
    return { ok: false, problem: "notYetValid" };
  }
  if (expiresAt <= nowSeconds) {
    return { ok: false, problem: "expired" };
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
    }),
  };
}

export function isValidSignatureFormat(value: unknown): value is string {
  return typeof value === "string" && SIGNATURE.test(value);
}
