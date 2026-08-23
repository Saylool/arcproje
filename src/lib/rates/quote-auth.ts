import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { RateEnv } from "./coingecko";
import {
  QUOTE_TAG_HEX_LENGTH,
  isValidQuoteTagFormat,
  serializeQuoteForAuth,
  validateRateQuote,
  type QuoteProblem,
  type RateQuote,
} from "./quote";

/**
 * Kur teklifinin sunucu kimliklendirmesi. YALNIZCA SUNUCU.
 *
 * `RATE_QUOTE_SECRET` istemciye asla verilmez ve bu modül istemci paketine
 * girmez (`node:crypto` import eder). Üretilen etiket bir kimlik etiketidir:
 * imzalı ödeme talebinin içinde taşınabilir, ama onu ancak sırrı bilen sunucu
 * üretebilir.
 */

/** Sır için asgari uzunluk; zayıf bir sır sessizce kabul edilmez. */
export const MIN_QUOTE_SECRET_LENGTH = 32;

export type QuoteSecretProblem = "missing" | "tooShort";

export type QuoteSecretResult =
  | { ok: true; secret: string }
  | { ok: false; problem: QuoteSecretProblem };

/** Sırrı ortamdan okur. Değerin kendisi asla loglanmaz veya döndürülmez. */
export function readQuoteSecret(
  env: RateEnv = process.env,
): QuoteSecretResult {
  const secret = env.RATE_QUOTE_SECRET?.trim();
  if (secret === undefined || secret === "") {
    return { ok: false, problem: "missing" };
  }
  if (secret.length < MIN_QUOTE_SECRET_LENGTH) {
    return { ok: false, problem: "tooShort" };
  }
  return { ok: true, secret };
}

export function isQuoteAuthConfigured(
  env: RateEnv = process.env,
): boolean {
  return readQuoteSecret(env).ok;
}

/** Kriptografik olarak rastgele teklif kimliği (0x + 64 hex). */
export function createQuoteId(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

/** Kanonik metnin HMAC-SHA-256 etiketi. Tek kanonik kodlama: 0x + küçük hex. */
export function signRateQuote(quote: RateQuote, secret: string): string {
  const digest = createHmac("sha256", secret)
    .update(serializeQuoteForAuth(quote), "utf8")
    .digest("hex");
  return `0x${digest}`;
}

export type QuoteAuthResult =
  | { ok: true; quote: RateQuote }
  | { ok: false; problem: QuoteProblem };

/**
 * Teklifi hem şema hem kimlik etiketi açısından doğrular.
 *
 * Karşılaştırma sabit zamanlıdır. Etiket biçimi önce katı desenle kontrol
 * edilir; böylece `timingSafeEqual` her zaman eşit uzunlukta tamponlarla
 * çağrılır ve uzunluk farkı bir yan kanal oluşturmaz.
 */
export function verifyRateQuote(
  value: unknown,
  tag: unknown,
  secret: string,
  nowMs: number,
): QuoteAuthResult {
  const validated = validateRateQuote(value, nowMs);
  if (!validated.ok) {
    return { ok: false, problem: validated.problem };
  }
  if (!isValidQuoteTagFormat(tag)) {
    return { ok: false, problem: "invalidTag" };
  }

  const expected = Buffer.from(
    signRateQuote(validated.quote, secret).slice(2),
    "hex",
  );
  const received = Buffer.from(tag.slice(2), "hex");
  // Desen zaten sabit uzunluk dayattı; yine de savunma amaçlı kontrol edilir.
  if (
    expected.length !== QUOTE_TAG_HEX_LENGTH / 2 ||
    received.length !== QUOTE_TAG_HEX_LENGTH / 2
  ) {
    return { ok: false, problem: "invalidTag" };
  }
  if (!timingSafeEqual(expected, received)) {
    return { ok: false, problem: "invalidTag" };
  }

  return { ok: true, quote: validated.quote };
}
