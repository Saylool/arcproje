import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/rates/usdc-try/route";
import { MAX_RETRY_AFTER_SECONDS } from "./coingecko";
import { TEST_QUOTE_SECRET } from "./quote-fixture";
import {
  COOLDOWN_BASE_MS,
  COOLDOWN_MAX_MS,
  getUsdcTryObservation,
  resetRateQuoteCache,
} from "./quote-service";

/**
 * Yukarı akış fırtınası koruması.
 *
 * CoinGecko 429/5xx döndüğünde her istek yeni bir yukarı akış çağrısı üretirse
 * Demo kotası hızla tükenir. Ardışık hatalarda sınırlı bir soğuma uygulanır;
 * soğuma boyunca sağlayıcı HİÇ çağrılmaz.
 */

const NOW = 1_700_000_000_000;
const ENV = {
  COINGECKO_DEMO_API_KEY: "test-key",
  RATE_QUOTE_SECRET: TEST_QUOTE_SECRET,
};

function failure(status = 500, headers: Record<string, string> = {}) {
  return new Response("{}", { status, headers });
}

function success() {
  return new Response(
    JSON.stringify({
      "usd-coin": { try: 42.123456, last_updated_at: Math.floor(NOW / 1000) - 5 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  resetRateQuoteCache();
});

afterEach(() => {
  resetRateQuoteCache();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("negatif önbellek (soğuma)", () => {
  it("soğuma boyunca tekrarlanan istekler tek yukarı akış çağrısı yapar", async () => {
    const fetchImpl = vi.fn(async () => failure(429));

    const first = await getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });
    expect(first).toMatchObject({ ok: false, cooldown: false });

    for (let i = 1; i <= 5; i += 1) {
      const repeat = await getUsdcTryObservation(NOW + i * 100, {
        env: ENV,
        fetchImpl: fetchImpl as never,
      });
      expect(repeat).toMatchObject({ ok: false, cooldown: true });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("soğuma bitince yeniden denenir ve toparlanır", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(failure(500))
      .mockResolvedValueOnce(success());

    await getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });
    const recovered = await getUsdcTryObservation(NOW + COOLDOWN_BASE_MS, {
      env: ENV,
      fetchImpl: fetchImpl as never,
    });
    expect(recovered.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("ardışık hatalarda soğuma büyür ama tavanı aşmaz", async () => {
    const fetchImpl = vi.fn(async () => failure(500));
    let clock = NOW;
    let lastRetryAfter = 0;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await getUsdcTryObservation(clock, {
        env: ENV,
        fetchImpl: fetchImpl as never,
      });
      if (!result.ok && !result.cooldown) {
        lastRetryAfter = result.retryAfterSeconds ?? 0;
      }
      // Bir sonraki denemeye kadar soğumayı geçir.
      clock += COOLDOWN_MAX_MS;
    }
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(lastRetryAfter).toBeLessThanOrEqual(COOLDOWN_MAX_MS / 1000);
  });

  it("geçerli Retry-After başlığına uyulur", async () => {
    const fetchImpl = vi.fn(async () => failure(429, { "retry-after": "45" }));
    await getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });

    // 40 sn sonra hâlâ soğumada.
    const during = await getUsdcTryObservation(NOW + 40_000, {
      env: ENV,
      fetchImpl: fetchImpl as never,
    });
    expect(during).toMatchObject({ ok: false, cooldown: true });

    // 46 sn sonra yeniden denenir.
    await getUsdcTryObservation(NOW + 46_000, { env: ENV, fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("aşırı büyük Retry-After kırpılır", async () => {
    const fetchImpl = vi.fn(async () =>
      failure(429, { "retry-after": "99999999" }),
    );
    await getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });

    // Tavan aşıldıktan hemen sonra yeniden denenebilmeli.
    await getUsdcTryObservation(NOW + (MAX_RETRY_AFTER_SECONDS + 1) * 1000, {
      env: ENV,
      fetchImpl: fetchImpl as never,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("yapılandırma eksikliği soğuma sayılmaz", async () => {
    const fetchImpl = vi.fn();
    const first = await getUsdcTryObservation(NOW, {
      env: { RATE_QUOTE_SECRET: TEST_QUOTE_SECRET },
      fetchImpl: fetchImpl as never,
    });
    expect(first).toMatchObject({ ok: false, code: "notConfigured", cooldown: false });

    // Anahtar sonradan gelirse beklemeden çalışır.
    const second = await getUsdcTryObservation(NOW + 1, {
      env: ENV,
      fetchImpl: (async () => success()) as never,
    });
    expect(second.ok).toBe(true);
  });

  it("başarı soğumayı sıfırlar", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(failure(500))
      .mockResolvedValueOnce(success())
      .mockResolvedValueOnce(failure(500));

    await getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });
    await getUsdcTryObservation(NOW + COOLDOWN_BASE_MS, {
      env: ENV,
      fetchImpl: fetchImpl as never,
    });
    // Başarıdan sonra ilk hata yine taban soğumasıyla başlar (birikmez).
    const afterCache = NOW + COOLDOWN_BASE_MS + 61_000;
    const failed = await getUsdcTryObservation(afterCache, {
      env: ENV,
      fetchImpl: fetchImpl as never,
    });
    expect(failed).toMatchObject({ ok: false, cooldown: false });
    expect(failed.ok === false && failed.retryAfterSeconds).toBeNull();
  });

  it("eşzamanlı hatalar tek yukarı akış çağrısında birleşir", async () => {
    let release: (value: Response) => void = () => undefined;
    const fetchImpl = vi.fn(
      () => new Promise<Response>((resolve) => { release = resolve; }),
    );
    const a = getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });
    const b = getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });
    const c = getUsdcTryObservation(NOW, { env: ENV, fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release(failure(500));
    await Promise.all([a, b, c]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("rota Retry-After başlığı", () => {
  it("soğuma sırasında Retry-After döner ve sağlayıcıya gidilmez", async () => {
    vi.stubEnv("COINGECKO_DEMO_API_KEY", "test-key");
    vi.stubEnv("RATE_QUOTE_SECRET", TEST_QUOTE_SECRET);
    const fetchImpl = vi.fn(async () => failure(429, { "retry-after": "30" }));
    vi.stubGlobal("fetch", fetchImpl);

    const first = await GET();
    expect(first.status).toBe(502);
    expect(first.headers.get("retry-after")).toBe("30");

    const second = await GET();
    expect(second.status).toBe(502);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
    // İkinci istekte yukarı akışa GİDİLMEDİ.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
