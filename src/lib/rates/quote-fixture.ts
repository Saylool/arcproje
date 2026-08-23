import {
  QUOTE_BASE_CURRENCY,
  QUOTE_CURRENCY,
  QUOTE_LIFETIME_MS,
  QUOTE_RATE_DENOMINATOR,
  QUOTE_SOURCE,
  RATE_QUOTE_VERSION,
  type RateQuote,
  type SignedRateQuote,
} from "./quote";
import { signRateQuote } from "./quote-auth";

/**
 * YALNIZCA TEST içindir. Uygulama kodu bu modülü import ETMEZ.
 *
 * Belirlenimci, sunucu-kimliklendirmeli bir kur teklifi üretir; böylece ödeme
 * talebi testleri canlı CoinGecko'ya veya gerçek bir sırra bağlı olmaz.
 */

/** Testlerde kullanılan sabit sır. Gerçek bir sır DEĞİLDİR. */
export const TEST_QUOTE_SECRET =
  "test-only-rate-quote-secret-0000000000000000";

export type TestQuoteOptions = {
  nowMs: number;
  /** Tam sayı TRY kuru, ör. 40 -> 1 USDC = 40.000000 TRY. */
  wholeRate?: number;
  /** Doğrudan pay verilmek istenirse (payda her zaman 10^6). */
  rateNumerator?: bigint;
  quoteId?: string;
  observedAt?: number;
  secret?: string;
  lifetimeMs?: number;
};

export function buildTestQuote(options: TestQuoteOptions): SignedRateQuote {
  const issuedAt = Math.floor(options.nowMs / 1000);
  const numerator =
    options.rateNumerator ??
    BigInt(options.wholeRate ?? 40) * QUOTE_RATE_DENOMINATOR;

  const quote: RateQuote = Object.freeze({
    quoteVersion: RATE_QUOTE_VERSION,
    quoteId: options.quoteId ?? `0x${"5a".repeat(32)}`,
    baseCurrency: QUOTE_BASE_CURRENCY,
    quoteCurrency: QUOTE_CURRENCY,
    source: QUOTE_SOURCE,
    rateNumerator: numerator.toString(),
    rateDenominator: QUOTE_RATE_DENOMINATOR.toString(),
    observedAt: options.observedAt ?? issuedAt - 5,
    issuedAt,
    expiresAt:
      issuedAt + (options.lifetimeMs ?? QUOTE_LIFETIME_MS) / 1000,
  });

  return Object.freeze({
    quote,
    tag: signRateQuote(quote, options.secret ?? TEST_QUOTE_SECRET),
  });
}
