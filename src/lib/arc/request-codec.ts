import { scanForDuplicateKeys } from "./json-duplicate-keys";
import { translate, type TranslationKey } from "../i18n/dictionary";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";
import {
  isValidSignatureFormat,
  validatePaymentRequestPayload,
  type PaymentRequestProblem,
  type SignedPaymentRequest,
} from "./payment-request";

/**
 * Paylaşılabilir ödeme talebi kodlaması.
 *
 * Zarf base64url olarak URL'ye gömülür. Çözümleme tamamen savunmacıdır:
 * boyut önce sınırlanır, ardından biçim, şema, imza biçimi ve son olarak
 * (çağıran tarafta) EIP-712 imzası doğrulanır. URL'den gelen hiçbir değere
 * doğruluğu varsayılarak güvenilmez.
 */

/** URL'ye gömülü zarf için üst sınır. */
export const MAX_ENCODED_REQUEST_LENGTH = 4096;
/** Çözülen JSON metni için üst sınır. */
export const MAX_DECODED_JSON_LENGTH = 4096;

export const PAY_ROUTE = "/pay";
export const REQUEST_QUERY_PARAM = "request";

export type CodecProblem =
  | PaymentRequestProblem
  | "tooLong"
  | "malformedEncoding"
  | "malformedJson"
  | "duplicateKey"
  | "invalidEnvelope";

/** Yalnızca çözücüye ait sorunlar; gerisi talep doğrulayıcısına aittir. */
const CODEC_ONLY: readonly Exclude<CodecProblem, PaymentRequestProblem>[] = [
  "tooLong",
  "malformedEncoding",
  "malformedJson",
  "duplicateKey",
  "invalidEnvelope",
];

/**
 * Kodun kullanıcıya gösterilecek karşılığı.
 *
 * Çözücüye ait olmayan bir sorun, talep doğrulayıcısının sözlüğüne devredilir;
 * böylece aynı sorun her iki yolda da AYNI cümleyle anlatılır.
 */
export function describeCodecProblem(
  problem: CodecProblem,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return translate(locale, codecProblemKey(problem));
}

/**
 * Sorunun SÖZLÜK YOLU.
 *
 * Arayüz metni durumda saklamak yerine bu yolu saklar; cümle her render'da
 * etkin dilde kurulur.
 */
export function codecProblemKey(problem: CodecProblem): TranslationKey {
  const codecOnly = CODEC_ONLY.find((candidate) => candidate === problem);
  return codecOnly !== undefined
    ? (`errors.codec.${codecOnly}` as TranslationKey)
    : (`errors.paymentRequest.${problem as PaymentRequestProblem}` as TranslationKey);
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  if (!BASE64URL_PATTERN.test(value)) {
    return null;
  }
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

const ENVELOPE_KEYS = ["payload", "signature"] as const;

export function encodeSignedRequest(request: SignedPaymentRequest): string {
  return toBase64Url(
    JSON.stringify({ payload: request.payload, signature: request.signature }),
  );
}

export type DecodeResult =
  | { ok: true; request: SignedPaymentRequest }
  | { ok: false; problem: CodecProblem };

/**
 * Zarfı çözer ve şema düzeyinde doğrular. İmzanın kriptografik doğrulaması
 * ayrı bir adımdır (`verifyPaymentRequestSignature`).
 */
export function decodeSignedRequest(
  encoded: string,
  nowMs: number,
): DecodeResult {
  if (typeof encoded !== "string" || encoded.length === 0) {
    return { ok: false, problem: "malformedEncoding" };
  }
  if (encoded.length > MAX_ENCODED_REQUEST_LENGTH) {
    return { ok: false, problem: "tooLong" };
  }

  const json = fromBase64Url(encoded);
  if (json === null) {
    return { ok: false, problem: "malformedEncoding" };
  }
  if (json.length > MAX_DECODED_JSON_LENGTH) {
    return { ok: false, problem: "tooLong" };
  }

  // Yinelenen anahtar taraması AYRIŞTIRMADAN ÖNCE çalışır: `JSON.parse` bu
  // belirsizliği sessizce yutar. Tarama zarfı da gövdeyi de, her nesne
  // kapsamını ayrı ayrı denetler.
  const scan = scanForDuplicateKeys(json);
  if (scan === "duplicate") {
    return { ok: false, problem: "duplicateKey" };
  }
  if (scan === "malformed") {
    return { ok: false, problem: "malformedJson" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, problem: "malformedJson" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problem: "invalidEnvelope" };
  }
  const envelope = parsed as Record<string, unknown>;
  for (const key of Object.keys(envelope)) {
    if (!(ENVELOPE_KEYS as readonly string[]).includes(key)) {
      return { ok: false, problem: "invalidEnvelope" };
    }
  }
  if (!("payload" in envelope) || !("signature" in envelope)) {
    return { ok: false, problem: "invalidEnvelope" };
  }
  if (!isValidSignatureFormat(envelope.signature)) {
    return { ok: false, problem: "invalidSignatureFormat" };
  }

  const validated = validatePaymentRequestPayload(envelope.payload, nowMs);
  if (!validated.ok) {
    return { ok: false, problem: validated.problem };
  }

  return {
    ok: true,
    request: Object.freeze({
      payload: validated.payload,
      signature: envelope.signature,
    }),
  };
}

/** Paylaşılabilir bağlantı. Origin çağıran taraftan gelir. */
export function buildShareUrl(origin: string, encoded: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${PAY_ROUTE}?${REQUEST_QUERY_PARAM}=${encoded}`;
}
