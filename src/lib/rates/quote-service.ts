import {
  fetchUsdcTryObservation,
  type FetchQuoteOptions,
  type ProviderFailureCode,
  type ProviderObservation,
} from "./coingecko";
import {
  QUOTE_BASE_CURRENCY,
  QUOTE_CURRENCY,
  QUOTE_LIFETIME_MS,
  QUOTE_RATE_DECIMALS,
  QUOTE_RATE_DENOMINATOR,
  QUOTE_SOURCE,
  RATE_QUOTE_VERSION,
  validateRateQuote,
  type RateQuote,
  type SignedRateQuote,
} from "./quote";
import { createQuoteId, readQuoteSecret, signRateQuote } from "./quote-auth";

/**
 * Kur teklifi üretimi. YALNIZCA SUNUCU.
 *
 * Sağlayıcı sonucu süreç belleğinde ~60 sn önbelleklenir ve aynı yenileme
 * penceresindeki eşzamanlı istekler tek bir yukarı akış çağrısında birleşir.
 * Amaç, her bileşen render'ı veya her kullanıcı için bir CoinGecko kredisi
 * harcamamaktır.
 *
 * SINIRLAR: Önbellek süreç içidir. Sunucusuz (serverless) ortamda her soğuk
 * başlangıç ve her eşzamanlı örnek kendi önbelleğini tutar; bu yüzden
 * önbellek isabet oranı bir garanti değil, bir iyileştirmedir. Kalıcı veya
 * paylaşılan önbellek bu görevin kapsamı dışındadır (arka uç/veritabanı
 * eklenmiyor). Her teklif, önbellekten gelse bile TAZE basılır: yeni quoteId,
 * yeni issuedAt/expiresAt ve yeni HMAC etiketi alır; bayat bir gözlem
 * `observedAt` üzerinden hâlâ sınırlıdır.
 */

/** Sağlayıcı sonucunun önbellekte kalma süresi. */
export const PROVIDER_CACHE_TTL_MS = 60 * 1000;

type CacheEntry = { observation: ProviderObservation; storedAtMs: number };

let cachedObservation: CacheEntry | null = null;
let inflight: Promise<
  { ok: true; observation: ProviderObservation } | { ok: false; code: ProviderFailureCode }
> | null = null;

/** Testler arasında süreç durumunu sıfırlar. */
export function resetRateQuoteCache(): void {
  cachedObservation = null;
  inflight = null;
}

export type ObservationSource = "cache" | "provider";

export type ObservationResult =
  | { ok: true; observation: ProviderObservation; source: ObservationSource }
  | { ok: false; code: ProviderFailureCode };

/**
 * Önbellekli/tekilleştirilmiş gözlem. Aynı pencerede gelen ikinci istek yeni
 * bir yukarı akış çağrısı başlatmaz, devam edeni bekler.
 */
export async function getUsdcTryObservation(
  nowMs: number,
  options: FetchQuoteOptions = {},
): Promise<ObservationResult> {
  if (
    cachedObservation !== null &&
    nowMs - cachedObservation.storedAtMs < PROVIDER_CACHE_TTL_MS
  ) {
    return { ok: true, observation: cachedObservation.observation, source: "cache" };
  }

  if (inflight === null) {
    inflight = fetchUsdcTryObservation(options)
      .then((result) => {
        if (result.ok) {
          cachedObservation = {
            observation: result.observation,
            storedAtMs: nowMs,
          };
        }
        return result;
      })
      .finally(() => {
        inflight = null;
      });
  }

  const result = await inflight;
  return result.ok
    ? { ok: true, observation: result.observation, source: "provider" }
    : { ok: false, code: result.code };
}

export type QuoteMintFailure = ProviderFailureCode | "secretMissing" | "invalidQuote";

export type QuoteMintResult =
  | { ok: true; signed: SignedRateQuote; source: ObservationSource }
  | { ok: false; code: QuoteMintFailure };

/** "42.123456" -> { numerator: 42123456n, denominator: 1000000n } */
export function rateTextToRational(rateText: string): {
  numerator: string;
  denominator: string;
} | null {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{6})$/.exec(rateText);
  if (match === null) {
    return null;
  }
  const numerator = BigInt(`${match[1]}${match[2]}`);
  if (numerator <= BigInt(0)) {
    return null;
  }
  return {
    numerator: numerator.toString(),
    denominator: QUOTE_RATE_DENOMINATOR.toString(),
  };
}

export type MintOptions = FetchQuoteOptions & {
  /** Testlerde sabit saat vermek için; üretimde geçerli zaman kullanılır. */
  nowMs?: number;
  /** Testlerde belirlenimci kimlik vermek için. */
  quoteId?: string;
};

/**
 * Taze, kimliklendirilmiş bir teklif basar. Gözlem önbellekten gelebilir; ama
 * teklifin kendisi her zaman yeni kimlik ve yeni geçerlilik penceresi alır.
 */
export async function mintUsdcTryQuote(
  options: MintOptions = {},
): Promise<QuoteMintResult> {
  const env = options.env ?? process.env;
  const secret = readQuoteSecret(env);
  if (!secret.ok) {
    return { ok: false, code: "secretMissing" };
  }

  const nowMs = options.nowMs ?? Date.now();
  const observed = await getUsdcTryObservation(nowMs, options);
  if (!observed.ok) {
    return { ok: false, code: observed.code };
  }

  const rational = rateTextToRational(observed.observation.rateText);
  if (rational === null) {
    return { ok: false, code: "invalidRate" };
  }

  const issuedAt = Math.floor(nowMs / 1000);
  const candidate: RateQuote = {
    quoteVersion: RATE_QUOTE_VERSION,
    quoteId: options.quoteId ?? createQuoteId(),
    baseCurrency: QUOTE_BASE_CURRENCY,
    quoteCurrency: QUOTE_CURRENCY,
    source: QUOTE_SOURCE,
    rateNumerator: rational.numerator,
    rateDenominator: rational.denominator,
    observedAt: observed.observation.observedAt,
    issuedAt,
    expiresAt: issuedAt + QUOTE_LIFETIME_MS / 1000,
  };

  // Ürettiğimiz teklif de tükettiğimiz teklifle AYNI katı yoldan geçer.
  const validated = validateRateQuote(candidate, nowMs);
  if (!validated.ok) {
    return { ok: false, code: "invalidQuote" };
  }

  return {
    ok: true,
    signed: Object.freeze({
      quote: validated.quote,
      tag: signRateQuote(validated.quote, secret.secret),
    }),
    source: observed.source,
  };
}

export { QUOTE_RATE_DECIMALS };
