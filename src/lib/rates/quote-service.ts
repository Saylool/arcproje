import {
  MAX_RETRY_AFTER_SECONDS,
  fetchUsdcTryObservation,
  type FetchQuoteOptions,
  type ProviderFailureCode,
  type ProviderObservation,
} from "./coingecko";
import {
  QUOTE_BASE_CURRENCY,
  QUOTE_CURRENCY,
  QUOTE_LIFETIME_MS,
  QUOTE_MAX_CLOCK_SKEW_MS,
  QUOTE_MAX_OBSERVATION_AGE_MS,
  QUOTE_MIN_SEND_MARGIN_SECONDS,
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

/**
 * NEGATİF ÖNBELLEK (soğuma).
 *
 * Sağlayıcı 429/5xx/zaman aşımı döndüğünde her istek yeni bir yukarı akış
 * çağrısı üretirse Demo kotası hızla tükenir. Ardışık hatalarda üstel ama
 * sınırlı bir soğuma uygulanır; soğuma boyunca CoinGecko HİÇ çağrılmaz.
 */
export const COOLDOWN_BASE_MS = 5 * 1000;
export const COOLDOWN_MAX_MS = 120 * 1000;

type CacheEntry = { observation: ProviderObservation; storedAtMs: number };

let cachedObservation: CacheEntry | null = null;
let inflight: Promise<
  | { ok: true; observation: ProviderObservation }
  | { ok: false; code: ProviderFailureCode; retryAfterSeconds: number | null }
> | null = null;
let cooldownUntilMs = 0;
let consecutiveFailures = 0;
let lastFailureCode: ProviderFailureCode | null = null;

/** Testler arasında süreç durumunu sıfırlar. */
export function resetRateQuoteCache(): void {
  cachedObservation = null;
  inflight = null;
  cooldownUntilMs = 0;
  consecutiveFailures = 0;
  lastFailureCode = null;
}

/**
 * Gözlemin olumlu önbelleğe alınabilecek kadar taze olup olmadığı.
 *
 * Sağlayıcının bildirdiği `last_updated_at` gelecekteyse veya izin verilen
 * yaştan eskiyse veri geçerli sayılmaz. Bu kontrol teklif doğrulamasıyla AYNI
 * sınırları kullanır; böylece önbelleğe alınıp sonra her seferinde reddedilen
 * bir gözlem oluşamaz.
 */
function isFreshObservation(
  observation: ProviderObservation,
  nowMs: number,
): boolean {
  const nowSeconds = Math.floor(nowMs / 1000);
  const skewSeconds = Math.floor(QUOTE_MAX_CLOCK_SKEW_MS / 1000);
  const maxAgeSeconds = Math.floor(QUOTE_MAX_OBSERVATION_AGE_MS / 1000);
  const { observedAt } = observation;

  if (!Number.isSafeInteger(observedAt) || observedAt <= 0) {
    return false;
  }
  if (observedAt - skewSeconds > nowSeconds) {
    return false;
  }
  return nowSeconds - observedAt <= maxAgeSeconds;
}

/** Yapılandırma eksikliği bir sağlayıcı arızası değildir; soğutulmaz. */
function isCooldownWorthy(code: ProviderFailureCode): boolean {
  return code !== "notConfigured";
}

function nextCooldownMs(retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null) {
    // Sağlayıcının önerisi zaten kırpılmıştır; yine de tavanı uygulanır.
    return Math.min(retryAfterSeconds, MAX_RETRY_AFTER_SECONDS) * 1000;
  }
  const exponent = Math.max(0, consecutiveFailures - 1);
  return Math.min(COOLDOWN_BASE_MS * 2 ** exponent, COOLDOWN_MAX_MS);
}

export type ObservationSource = "cache" | "provider";

export type ObservationResult =
  | { ok: true; observation: ProviderObservation; source: ObservationSource }
  | {
      ok: false;
      code: ProviderFailureCode;
      /** Soğuma nedeniyle sağlayıcıya hiç gidilmediyse true. */
      cooldown: boolean;
      retryAfterSeconds: number | null;
    };

/**
 * Önbellekli/tekilleştirilmiş gözlem. Aynı pencerede gelen ikinci istek yeni
 * bir yukarı akış çağrısı başlatmaz, devam edeni bekler.
 */
export async function getUsdcTryObservation(
  nowMs: number,
  options: FetchQuoteOptions & ClockOptions = {},
): Promise<ObservationResult> {
  const clock = options.clock ?? Date.now;
  /*
   * Önbellek isabeti TEK BAŞINA yeterli değildir. 60 saniyelik depolama TTL'i
   * içinde bile gözlem, izin verilen yaş sınırını geçmiş olabilir; o zaman
   * kayıt atılır ve taze veri çekilir. Aksi hâlde sınırı aşmış bir gözlem
   * TTL boyunca "geçerli" gibi dönerdi.
   */
  if (
    cachedObservation !== null &&
    nowMs - cachedObservation.storedAtMs < PROVIDER_CACHE_TTL_MS
  ) {
    if (isFreshObservation(cachedObservation.observation, nowMs)) {
      return {
        ok: true,
        observation: cachedObservation.observation,
        source: "cache",
      };
    }
    cachedObservation = null;
  }

  // Soğuma penceresindeyken yukarı akışa HİÇ gidilmez.
  if (nowMs < cooldownUntilMs) {
    return {
      ok: false,
      code: lastFailureCode ?? "providerUnavailable",
      cooldown: true,
      retryAfterSeconds: Math.max(1, Math.ceil((cooldownUntilMs - nowMs) / 1000)),
    };
  }

  if (inflight === null) {
    inflight = fetchUsdcTryObservation(options)
      .then((result) => {
        // Çıpa: isteğin başladığı an değil, yanıtın DÖNDÜĞÜ an.
        const settledAtMs = clock();

        if (result.ok && !isFreshObservation(result.observation, settledAtMs)) {
          /*
           * Bayat veya gelecekte görünen bir gözlem BAŞARI SAYILMAZ ve asla
           * olumlu önbelleğe alınmaz: aksi hâlde 60 saniye boyunca her teklif
           * basımı aynı geçersiz veriyle düşerdi.
           */
          const stale = {
            ok: false as const,
            code: "invalidObservation" as const,
            retryAfterSeconds: null,
          };
          consecutiveFailures += 1;
          lastFailureCode = stale.code;
          cooldownUntilMs = settledAtMs + nextCooldownMs(null);
          return stale;
        }

        if (result.ok) {
          cachedObservation = {
            observation: result.observation,
            storedAtMs: settledAtMs,
          };
          consecutiveFailures = 0;
          cooldownUntilMs = 0;
          lastFailureCode = null;
        } else if (isCooldownWorthy(result.code)) {
          consecutiveFailures += 1;
          lastFailureCode = result.code;
          cooldownUntilMs = settledAtMs + nextCooldownMs(result.retryAfterSeconds);
        }
        return result;
      })
      .finally(() => {
        // Zaman aşımından sonra da temizlenir: sonraki istek kilitlenmez.
        inflight = null;
      });
  }

  const result = await inflight;
  return result.ok
    ? { ok: true, observation: result.observation, source: "provider" }
    : {
        ok: false,
        code: result.code,
        cooldown: false,
        retryAfterSeconds: result.retryAfterSeconds,
      };
}

export type QuoteMintFailure = ProviderFailureCode | "secretMissing" | "invalidQuote";

export type QuoteMintResult =
  | { ok: true; signed: SignedRateQuote; source: ObservationSource }
  | {
      ok: false;
      code: QuoteMintFailure;
      cooldown: boolean;
      retryAfterSeconds: number | null;
    };

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

export type ClockOptions = {
  /**
   * Yerleşim (settlement) saati. Önbellek ve soğuma çıpaları, isteğin
   * BAŞLADIĞI ana değil, sağlayıcı yanıtının DÖNDÜĞÜ ana bağlanır; aksi hâlde
   * 5 saniye süren bir çağrıdan sonra TTL ve soğuma 5 saniye kısalırdı.
   */
  clock?: () => number;
};

export type MintOptions = FetchQuoteOptions & ClockOptions & {
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
    return {
      ok: false,
      code: "secretMissing",
      cooldown: false,
      retryAfterSeconds: null,
    };
  }

  const nowMs = options.nowMs ?? Date.now();
  const observed = await getUsdcTryObservation(nowMs, options);
  if (!observed.ok) {
    return {
      ok: false,
      code: observed.code,
      cooldown: observed.cooldown,
      retryAfterSeconds: observed.retryAfterSeconds,
    };
  }

  const rational = rateTextToRational(observed.observation.rateText);
  if (rational === null) {
    return {
      ok: false,
      code: "invalidRate",
      cooldown: false,
      retryAfterSeconds: null,
    };
  }

  const issuedAt = Math.floor(nowMs / 1000);
  /*
   * Teklif ömrü İKİ sınırın küçüğüdür: normal TTL ve gözlemin izin verilen
   * yaşının bittiği an. Bayat bir gözleme dayanan teklif, sırf yeni basıldı
   * diye 5 dakika geçerli sayılamaz.
   */
  const observationHorizon =
    observed.observation.observedAt + QUOTE_MAX_OBSERVATION_AGE_MS / 1000;
  const expiresAt = Math.min(issuedAt + QUOTE_LIFETIME_MS / 1000, observationHorizon);

  /*
   * Gönderim payından kısa ömürlü bir teklif zaten kullanılamaz; üretilmez.
   */
  if (expiresAt - issuedAt < QUOTE_MIN_SEND_MARGIN_SECONDS) {
    return {
      ok: false,
      code: "invalidObservation",
      cooldown: false,
      retryAfterSeconds: null,
    };
  }

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
    expiresAt,
  };

  // Ürettiğimiz teklif de tükettiğimiz teklifle AYNI katı yoldan geçer.
  const validated = validateRateQuote(candidate, nowMs);
  if (!validated.ok) {
    return {
      ok: false,
      code: "invalidQuote",
      cooldown: false,
      retryAfterSeconds: null,
    };
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
