import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COINGECKO_COIN_ID, COINGECKO_VS_CURRENCY } from "./coingecko";
import { QUOTE_MAX_OBSERVATION_AGE_MS } from "./quote";
import { TEST_QUOTE_SECRET } from "./quote-fixture";
import {
  COOLDOWN_BASE_MS,
  PROVIDER_CACHE_TTL_MS,
  getUsdcTryObservation,
  resetRateQuoteCache,
} from "./quote-service";

/**
 * Önbellek ve soğuma çıpaları, isteğin BAŞLADIĞI ana değil sağlayıcı yanıtının
 * DÖNDÜĞÜ ana bağlanır. Aksi hâlde 5 saniye süren bir çağrıdan sonra TTL ve
 * soğuma 5 saniye kısalır; yavaş sağlayıcı korumayı aşındırırdı.
 */

const NOW = 1_700_000_000_000;
const ENV = {
  COINGECKO_DEMO_API_KEY: "test-key",
  RATE_QUOTE_SECRET: TEST_QUOTE_SECRET,
};

function success(observedAtSeconds = Math.floor(NOW / 1000) - 5) {
  return new Response(
    JSON.stringify({
      [COINGECKO_COIN_ID]: {
        [COINGECKO_VS_CURRENCY]: 42.123456,
        last_updated_at: observedAtSeconds,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => resetRateQuoteCache());
afterEach(() => {
  resetRateQuoteCache();
  vi.restoreAllMocks();
});

describe("yerleşim saati çıpası", () => {
  it("önbellek TTL'i yanıtın döndüğü andan başlar", async () => {
    const SLOW_MS = 5000;
    const fetchImpl = vi.fn(async () => success());

    // İstek NOW'da başladı, yanıt NOW+5000'de yerleşti.
    await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW + SLOW_MS,
    });

    /*
     * Yerleşimden 59 sn sonra hâlâ önbellekte olmalı. Çıpa isteğin başlangıcı
     * olsaydı TTL burada dolmuş olurdu.
     */
    const stillCached = await getUsdcTryObservation(
      NOW + SLOW_MS + PROVIDER_CACHE_TTL_MS - 1000,
      { env: ENV, fetchImpl: fetchImpl as never, clock: () => NOW },
    );
    expect(stillCached).toMatchObject({ ok: true, source: "cache" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("soğuma yavaş zaman aşımından sonra yerleşim anından başlar", async () => {
    const SLOW_MS = 5000;
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));

    await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW + SLOW_MS,
    });

    // Yerleşimden 1 sn sonra hâlâ soğumada.
    const during = await getUsdcTryObservation(NOW + SLOW_MS + 1000, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW + SLOW_MS + 1000,
    });
    expect(during).toMatchObject({ ok: false, cooldown: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Taban soğuma dolduktan sonra yeniden denenir.
    const after = NOW + SLOW_MS + COOLDOWN_BASE_MS + 1;
    await getUsdcTryObservation(after, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => after,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("429 sonrası soğuma yerleşim anına göre ölçülür ve toparlanır", async () => {
    const SLOW_MS = 3000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("{}", { status: 429, headers: { "retry-after": "20" } }),
      )
      .mockResolvedValueOnce(success(Math.floor((NOW + 30_000) / 1000) - 5));

    await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW + SLOW_MS,
    });

    // Yerleşim + 19 sn: hâlâ bekleme.
    const during = await getUsdcTryObservation(NOW + SLOW_MS + 19_000, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW + SLOW_MS + 19_000,
    });
    expect(during).toMatchObject({ ok: false, cooldown: true });

    // Yerleşim + 21 sn: toparlanır.
    const recoverAt = NOW + SLOW_MS + 21_000;
    const recovered = await getUsdcTryObservation(recoverAt, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => recoverAt,
    });
    expect(recovered.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("gözlem tazeliği önbellekten önce doğrulanır", () => {
  it("bayat gözlem BAŞARI sayılmaz ve önbelleğe alınmaz", async () => {
    const staleSeconds =
      Math.floor(NOW / 1000) - QUOTE_MAX_OBSERVATION_AGE_MS / 1000 - 60;
    const fetchImpl = vi.fn(async () => success(staleSeconds));

    const result = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW,
    });
    expect(result).toMatchObject({ ok: false, code: "invalidObservation" });

    // Bayat veri önbellekte olsaydı bu istek "cache" derdi; soğumada olmalı.
    const next = await getUsdcTryObservation(NOW + 100, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW + 100,
    });
    expect(next).toMatchObject({ ok: false, cooldown: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gelecekteki gözlem de reddedilir", async () => {
    const futureSeconds = Math.floor(NOW / 1000) + 3600;
    const fetchImpl = vi.fn(async () => success(futureSeconds));
    const result = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW,
    });
    expect(result).toMatchObject({ ok: false, code: "invalidObservation" });
  });

  it("bayat gözlemin soğuması sınırlıdır ve sonra toparlanır", async () => {
    const staleSeconds = Math.floor(NOW / 1000) - 3600;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(success(staleSeconds))
      .mockResolvedValueOnce(success(Math.floor((NOW + 10_000) / 1000) - 5));

    await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW,
    });

    const recoverAt = NOW + COOLDOWN_BASE_MS + 1000;
    const recovered = await getUsdcTryObservation(recoverAt, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => recoverAt,
    });
    expect(recovered).toMatchObject({ ok: true, source: "provider" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("taze gözlem normal biçimde önbelleğe alınır", async () => {
    const fetchImpl = vi.fn(async () => success());
    const first = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW,
    });
    expect(first).toMatchObject({ ok: true, source: "provider" });

    const second = await getUsdcTryObservation(NOW + 1000, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW + 1000,
    });
    expect(second).toMatchObject({ ok: true, source: "cache" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
