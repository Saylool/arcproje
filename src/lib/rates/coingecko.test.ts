import { describe, expect, it, vi } from "vitest";

import {
  COINGECKO_COIN_ID,
  COINGECKO_VS_CURRENCY,
  MAX_PROVIDER_RESPONSE_BYTES,
  buildCoinGeckoUrl,
  canonicalizeProviderRate,
  fetchUsdcTryObservation,
  isCoinGeckoConfigured,
} from "./coingecko";

/**
 * Sağlayıcı katmanı yalnızca taklit fetch ile test edilir; otomatik test
 * takımı canlı CoinGecko servisine ASLA bağlanmaz.
 */

const KEY = "test-demo-key";
const ENV = { COINGECKO_DEMO_API_KEY: KEY };

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const OK_BODY = {
  [COINGECKO_COIN_ID]: { [COINGECKO_VS_CURRENCY]: 42.123456, last_updated_at: 1_700_000_000 },
};

describe("istek biçimi", () => {
  it("uç nokta usd-coin, try, precision=6 ve include_last_updated_at kullanır", () => {
    const url = new URL(buildCoinGeckoUrl());
    expect(url.origin + url.pathname).toBe(
      "https://api.coingecko.com/api/v3/simple/price",
    );
    expect(url.searchParams.get("ids")).toBe("usd-coin");
    expect(url.searchParams.get("vs_currencies")).toBe("try");
    expect(url.searchParams.get("precision")).toBe("6");
    expect(url.searchParams.get("include_last_updated_at")).toBe("true");
  });

  it("anahtar YALNIZCA x-cg-demo-api-key başlığında taşınır", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_BODY));
    await fetchUsdcTryObservation({ env: ENV, fetchImpl: fetchImpl as never });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(KEY);
    expect(new URL(url).searchParams.get("x_cg_demo_api_key")).toBeNull();
    const headers = init.headers as Record<string, string>;
    expect(headers["x-cg-demo-api-key"]).toBe(KEY);
    // Anahtar başka hiçbir başlıkta görünmez.
    expect(
      Object.entries(headers).filter(([, v]) => v === KEY).map(([k]) => k),
    ).toEqual(["x-cg-demo-api-key"]);
  });
});

describe("yapılandırma", () => {
  it("anahtar yoksa sağlayıcıya hiç gidilmez", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchUsdcTryObservation({
      env: {},
      fetchImpl: fetchImpl as never,
    });
    expect(result).toMatchObject({ ok: false, code: "notConfigured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("isCoinGeckoConfigured boş anahtarı yapılandırılmış saymaz", () => {
    expect(isCoinGeckoConfigured({})).toBe(false);
    expect(
      isCoinGeckoConfigured({ COINGECKO_DEMO_API_KEY: "  " }),
    ).toBe(false);
    expect(isCoinGeckoConfigured(ENV)).toBe(true);
  });
});

describe("başarılı yanıt", () => {
  it("kuru ve gözlem anını okur", async () => {
    const result = await fetchUsdcTryObservation({
      env: ENV,
      fetchImpl: (async () => jsonResponse(OK_BODY)) as never,
    });
    expect(result).toEqual({
      ok: true,
      observation: { rateText: "42.123456", observedAt: 1_700_000_000 },
    });
  });
});

describe("sağlayıcı hataları kontrollü kodlara dönüşür", () => {
  const cases: Array<[string, () => Promise<Response>, string]> = [
    ["2xx olmayan yanıt", async () => jsonResponse({}, { status: 429 }), "providerUnavailable"],
    ["bozuk JSON", async () => new Response("{bozuk", { status: 200 }), "malformedResponse"],
    ["beklenen coin yok", async () => jsonResponse({ other: {} }), "malformedResponse"],
    ["fiyat yok", async () => jsonResponse({ [COINGECKO_COIN_ID]: { last_updated_at: 1 } }), "malformedResponse"],
    [
      "zaman damgası yok",
      async () => jsonResponse({ [COINGECKO_COIN_ID]: { [COINGECKO_VS_CURRENCY]: 42.1 } }),
      "invalidObservation",
    ],
    [
      "sıfır kur",
      async () => jsonResponse({ [COINGECKO_COIN_ID]: { [COINGECKO_VS_CURRENCY]: 0, last_updated_at: 1 } }),
      "invalidRate",
    ],
    [
      "negatif kur",
      async () => jsonResponse({ [COINGECKO_COIN_ID]: { [COINGECKO_VS_CURRENCY]: -3, last_updated_at: 1 } }),
      "invalidRate",
    ],
    [
      "makul olmayan kur",
      async () => jsonResponse({ [COINGECKO_COIN_ID]: { [COINGECKO_VS_CURRENCY]: 1e12, last_updated_at: 1 } }),
      "invalidRate",
    ],
  ];

  for (const [name, responder, expected] of cases) {
    it(`${name} -> ${expected}`, async () => {
      const result = await fetchUsdcTryObservation({
        env: ENV,
        fetchImpl: responder as never,
      });
      expect(result).toMatchObject({ ok: false, code: expected });
    });
  }

  it("aşırı büyük yanıt ayrıştırılmadan reddedilir", async () => {
    const huge = "x".repeat(MAX_PROVIDER_RESPONSE_BYTES + 1024);
    const result = await fetchUsdcTryObservation({
      env: ENV,
      fetchImpl: (async () => new Response(huge, { status: 200 })) as never,
    });
    expect(result).toMatchObject({ ok: false, code: "responseTooLarge" });
  });

  it("zaman aşımı ayrı kodla döner", async () => {
    const slowFetch = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    const result = await fetchUsdcTryObservation({
      env: ENV,
      fetchImpl: slowFetch as never,
      timeoutMs: 10,
    });
    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });

  it("ağ hatası sağlayıcı erişilemez sayılır", async () => {
    const result = await fetchUsdcTryObservation({
      env: ENV,
      fetchImpl: (async () => {
        throw new Error("ağ yok");
      }) as never,
    });
    expect(result).toMatchObject({ ok: false, code: "providerUnavailable" });
  });

  it("sağlayıcı gövdesi veya anahtar hata sonucunda görünmez", async () => {
    const result = await fetchUsdcTryObservation({
      env: ENV,
      fetchImpl: (async () =>
        jsonResponse({ error: "gizli sağlayıcı detayı", key: KEY }, { status: 500 })) as never,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain("gizli sağlayıcı detayı");
  });
});

describe("kanonik altı ondalık normalleştirme", () => {
  it("sağlayıcı sayısını tam altı ondalıklı metne çevirir", () => {
    expect(canonicalizeProviderRate(42.123456)).toBe("42.123456");
    expect(canonicalizeProviderRate(42)).toBe("42.000000");
    expect(canonicalizeProviderRate(0.5)).toBe("0.500000");
  });

  it("geçersiz ve makul olmayan değerleri reddeder", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1e9]) {
      expect(canonicalizeProviderRate(bad), String(bad)).toBeNull();
    }
  });
});
