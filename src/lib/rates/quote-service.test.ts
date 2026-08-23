import { beforeEach, describe, expect, it, vi } from "vitest";

import { COINGECKO_COIN_ID, COINGECKO_VS_CURRENCY } from "./coingecko";
import {
  QUOTE_LIFETIME_MS,
  QUOTE_RATE_DENOMINATOR,
  formatQuoteRate,
  validateRateQuote,
} from "./quote";
import { verifyRateQuote } from "./quote-auth";
import { TEST_QUOTE_SECRET } from "./quote-fixture";
import {
  PROVIDER_CACHE_TTL_MS,
  getUsdcTryObservation,
  mintUsdcTryQuote,
  rateTextToRational,
  resetRateQuoteCache,
} from "./quote-service";

const NOW = 1_700_000_000_000;
const OBSERVED_AT = Math.floor(NOW / 1000) - 10;

const ENV = {
  COINGECKO_DEMO_API_KEY: "test-demo-key",
  RATE_QUOTE_SECRET: TEST_QUOTE_SECRET,
};

function okResponse(rate = 42.123456) {
  return new Response(
    JSON.stringify({
      [COINGECKO_COIN_ID]: {
        [COINGECKO_VS_CURRENCY]: rate,
        last_updated_at: OBSERVED_AT,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  resetRateQuoteCache();
});

describe("önbellek ve tekilleştirme", () => {
  it("aynı pencerede ikinci istek sağlayıcıya gitmez", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const first = await getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });
    const second = await getUsdcTryObservation(NOW + 1000, {
      env: ENV,
      fetchImpl: fetchImpl as never,
    });

    expect(first.ok && first.source).toBe("provider");
    expect(second.ok && second.source).toBe("cache");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("önbellek süresi dolunca yeniden çekilir", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });
    const after = await getUsdcTryObservation(NOW + PROVIDER_CACHE_TTL_MS, {
      env: ENV,
      fetchImpl: fetchImpl as never,
    });

    expect(after.ok && after.source).toBe("provider");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("eşzamanlı istekler tek yukarı akış çağrısında birleşir", async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const a = getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });
    const b = getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });
    const c = getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFetch(okResponse());
    const results = await Promise.all([a, b, c]);
    for (const result of results) {
      expect(result.ok).toBe(true);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("başarısız çağrı önbelleklenmez", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(okResponse());

    const first = await getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });
    expect(first.ok).toBe(false);
    const second = await getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });
    expect(second.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("kanonik rasyonel dönüşüm", () => {
  it("altı ondalıklı metni paya çevirir, payda her zaman 10^6", () => {
    expect(rateTextToRational("42.123456")).toEqual({
      numerator: "42123456",
      denominator: QUOTE_RATE_DENOMINATOR.toString(),
    });
    expect(rateTextToRational("0.000001")).toEqual({
      numerator: "1",
      denominator: QUOTE_RATE_DENOMINATOR.toString(),
    });
  });

  it("kanonik olmayan metni reddeder", () => {
    for (const bad of ["42", "42.12345", "42.1234567", "0.000000", "", "-1.000000"]) {
      expect(rateTextToRational(bad), bad).toBeNull();
    }
  });
});

describe("teklif basımı", () => {
  it("geçerli, kimliklendirilmiş ve altı ondalıklı teklif üretir", async () => {
    const minted = await mintUsdcTryQuote({
      env: ENV,
      fetchImpl: (async () => okResponse()) as never,
      nowMs: NOW,
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;

    const { quote, tag } = minted.signed;
    expect(quote.baseCurrency).toBe("USDC");
    expect(quote.quoteCurrency).toBe("TRY");
    expect(quote.source).toBe("coingecko");
    expect(quote.rateDenominator).toBe("1000000");
    expect(formatQuoteRate(quote)).toBe("42.123456");
    expect(quote.expiresAt - quote.issuedAt).toBe(QUOTE_LIFETIME_MS / 1000);
    expect(validateRateQuote(quote, NOW).ok).toBe(true);
    expect(verifyRateQuote(quote, tag, TEST_QUOTE_SECRET, NOW).ok).toBe(true);
  });

  it("her basım yeni kimlik ve yeni etiket alır", async () => {
    const options = {
      env: ENV,
      fetchImpl: (async () => okResponse()) as never,
      nowMs: NOW,
    };
    const first = await mintUsdcTryQuote(options);
    const second = await mintUsdcTryQuote(options);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.signed.quote.quoteId).not.toBe(second.signed.quote.quoteId);
    expect(first.signed.tag).not.toBe(second.signed.tag);
  });

  it("sır yoksa teklif basılmaz", async () => {
    const result = await mintUsdcTryQuote({
      env: { COINGECKO_DEMO_API_KEY: "k" },
      fetchImpl: (async () => okResponse()) as never,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, code: "secretMissing" });
  });

  it("sağlayıcı hatası sessiz bir manuel kura düşmez", async () => {
    const result = await mintUsdcTryQuote({
      env: ENV,
      fetchImpl: (async () => new Response("{}", { status: 502 })) as never,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, code: "providerUnavailable" });
  });

  it("sonuçta anahtar veya sır görünmez", async () => {
    const minted = await mintUsdcTryQuote({
      env: ENV,
      fetchImpl: (async () => okResponse()) as never,
      nowMs: NOW,
    });
    const serialized = JSON.stringify(minted);
    expect(serialized).not.toContain(TEST_QUOTE_SECRET);
    expect(serialized).not.toContain("test-demo-key");
  });
});
