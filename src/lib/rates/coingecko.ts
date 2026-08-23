import { QUOTE_RATE_DECIMALS } from "./quote";

/**
 * CoinGecko Demo API istemcisi. YALNIZCA SUNUCU.
 *
 * Anahtar `x-cg-demo-api-key` başlığıyla gönderilir; sorgu dizesine ASLA
 * konmaz ve `NEXT_PUBLIC_` bir değişkende tutulmaz. Sağlayıcının gövdesi veya
 * başlıkları hiçbir zaman dışarı verilmez; dışarıya yalnızca kontrollü hata
 * kodları çıkar.
 *
 * USDC, sembolüyle değil CoinGecko kimliğiyle ("usd-coin") istenir; sembol
 * çakışmaları yanlış bir varlığın fiyatını getirebilirdi.
 */

export const COINGECKO_ENDPOINT = "https://api.coingecko.com/api/v3/simple/price";
export const COINGECKO_COIN_ID = "usd-coin";
export const COINGECKO_VS_CURRENCY = "try";

/** İstek üst sınırı. Ağ takılırsa çağrı sonsuza kadar beklemez. */
export const PROVIDER_TIMEOUT_MS = 5000;
/** Bu uç noktanın yanıtı birkaç yüz bayttır; sınır fazlasıyla geniştir. */
export const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024;

/**
 * Makul kur bandı. Sağlayıcı bozuk bir değer döndürürse (0, negatif, devasa)
 * sessizce kabul edilmez. Bant, stablecoin/TRY için fazlasıyla geniştir.
 */
export const MIN_REASONABLE_RATE = 0.01;
export const MAX_REASONABLE_RATE = 1_000_000;

export type ProviderFailureCode =
  | "notConfigured"
  | "timeout"
  | "providerUnavailable"
  | "responseTooLarge"
  | "malformedResponse"
  | "invalidRate"
  | "invalidObservation";

export type ProviderObservation = Readonly<{
  /** Kanonik altı ondalıklı kur metni, ör. "42.123456". */
  rateText: string;
  /** Sağlayıcının bildirdiği gözlem anı (Unix saniye). */
  observedAt: number;
}>;

/** Yalnızca okuduğumuz alanlar; NODE_ENV gibi zorunlu alanlar gerekmez. */
export type RateEnv = Record<string, string | undefined>;

export type ProviderResult =
  | { ok: true; observation: ProviderObservation }
  | {
      ok: false;
      code: ProviderFailureCode;
      /** Sağlayıcının bildirdiği, sınırlanmış bekleme süresi (saniye). */
      retryAfterSeconds: number | null;
    };

/** Retry-After üst sınırı; sağlayıcı devasa bir değer dayatamaz. */
export const MAX_RETRY_AFTER_SECONDS = 300;

/**
 * `Retry-After` başlığını saniyeye çevirir. Yalnızca saniye biçimi kabul
 * edilir ve değer her zaman güvenli bir aralığa kırpılır.
 */
export function parseRetryAfter(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{1,7}$/.test(trimmed)) {
    return null;
  }
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

export function isCoinGeckoConfigured(
  env: RateEnv = process.env,
): boolean {
  return Boolean(env.COINGECKO_DEMO_API_KEY?.trim());
}

/** Uç nokta ve sorgu parametreleri tek yerde kurulur. */
export function buildCoinGeckoUrl(): string {
  const url = new URL(COINGECKO_ENDPOINT);
  url.searchParams.set("ids", COINGECKO_COIN_ID);
  url.searchParams.set("vs_currencies", COINGECKO_VS_CURRENCY);
  url.searchParams.set("include_last_updated_at", "true");
  url.searchParams.set("precision", String(QUOTE_RATE_DECIMALS));
  return url.toString();
}

/** Gövdeyi sınırlı okur: ayrıştırmadan ÖNCE boyut tavanı uygulanır. */
async function readBoundedText(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) {
    return null;
  }
  const body = response.body;
  if (body === null) {
    return "";
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        total += value.byteLength;
        if (total > MAX_PROVIDER_RESPONSE_BYTES) {
          // Kalan gövdeyi çekmeye devam etmeyiz; akış iptal edilir.
          await reader.cancel().catch(() => undefined);
          return null;
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(merged);
}

/**
 * Sağlayıcı sayısını TEK BİR KEZ, bu sınırda kanonik altı ondalıklı metne
 * çevirir. Bundan sonraki tüm aritmetik BigInt/rasyonel yolda yapılır;
 * borç veya mikro-USDC hesabında kayan nokta kullanılmaz.
 */
export function canonicalizeProviderRate(value: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value < MIN_REASONABLE_RATE || value > MAX_REASONABLE_RATE) {
    return null;
  }
  const text = value.toFixed(QUOTE_RATE_DECIMALS);
  return /^(0|[1-9][0-9]*)\.[0-9]{6}$/.test(text) ? text : null;
}

type FetchLike = typeof fetch;

export type FetchQuoteOptions = {
  env?: RateEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

/** Tek bir CoinGecko çağrısı. Önbellek ve tekilleştirme çağıranın işidir. */
export async function fetchUsdcTryObservation(
  options: FetchQuoteOptions = {},
): Promise<ProviderResult> {
  const env = options.env ?? process.env;
  const apiKey = env.COINGECKO_DEMO_API_KEY?.trim();
  if (apiKey === undefined || apiKey === "") {
    return { ok: false, code: "notConfigured", retryAfterSeconds: null };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  /*
   * Zaman aşımı YALNIZCA başlıkları değil, gövdenin tamamının okunmasını da
   * kapsar. Aksi hâlde sunucu başlıkları gönderip gövdeyi sonsuza kadar
   * damlatarak bu süreçteki paylaşılan isteği kilitleyebilirdi.
   */
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? PROVIDER_TIMEOUT_MS);

  const isAbort = (error: unknown): boolean =>
    timedOut ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name: unknown }).name === "AbortError");

  try {
    let response: Response;
    try {
      response = await fetchImpl(buildCoinGeckoUrl(), {
        method: "GET",
        headers: {
          accept: "application/json",
          // Anahtar YALNIZCA bu başlıkta taşınır.
          "x-cg-demo-api-key": apiKey,
        },
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      return {
        ok: false,
        code: isAbort(error) ? "timeout" : "providerUnavailable",
        retryAfterSeconds: null,
      };
    }

    if (!response.ok) {
      // Sağlayıcının gövdesi okunmaz ve dışarı verilmez.
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        code: "providerUnavailable",
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
      };
    }

    let text: string | null;
    try {
      text = await readBoundedText(response);
    } catch (error) {
      // Gövde okunurken düşen abort da zaman aşımıdır, bozuk yanıt değil.
      return {
        ok: false,
        code: isAbort(error) ? "timeout" : "malformedResponse",
        retryAfterSeconds: null,
      };
    }
    if (text === null) {
      return { ok: false, code: "responseTooLarge", retryAfterSeconds: null };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, code: "malformedResponse", retryAfterSeconds: null };
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, code: "malformedResponse", retryAfterSeconds: null };
    }
    const coin = (parsed as Record<string, unknown>)[COINGECKO_COIN_ID];
    if (typeof coin !== "object" || coin === null || Array.isArray(coin)) {
      return { ok: false, code: "malformedResponse", retryAfterSeconds: null };
    }
    const entry = coin as Record<string, unknown>;

    const price = entry[COINGECKO_VS_CURRENCY];
    if (typeof price !== "number") {
      return { ok: false, code: "malformedResponse", retryAfterSeconds: null };
    }
    const rateText = canonicalizeProviderRate(price);
    if (rateText === null) {
      return { ok: false, code: "invalidRate", retryAfterSeconds: null };
    }

    const lastUpdated = entry.last_updated_at;
    if (
      typeof lastUpdated !== "number" ||
      !Number.isSafeInteger(lastUpdated) ||
      lastUpdated <= 0
    ) {
      return { ok: false, code: "invalidObservation", retryAfterSeconds: null };
    }

    return { ok: true, observation: { rateText, observedAt: lastUpdated } };
  } finally {
    // Zamanlayıcı yalnızca gövde tüketimi bittikten (veya düştükten) sonra
    // temizlenir.
    clearTimeout(timeout);
  }
}
