import { beforeEach, describe, expect, it, vi } from "vitest";

import { COINGECKO_COIN_ID, COINGECKO_VS_CURRENCY } from "./coingecko";
import {
  BUDGET_CALLS_PER_WINDOW,
  BUDGET_WINDOW_MS,
  COINGECKO_PROVIDER_KEY,
  budgetWindowStart,
  windowRetryAfterSeconds,
  type ProviderBudgetOutcome,
} from "./provider-budget";
import { TEST_QUOTE_SECRET } from "./quote-fixture";
import { getUsdcTryObservation, resetRateQuoteCache } from "./quote-service";

/**
 * PAYLAŞILAN ÇAĞRI BÜTÇESİ.
 *
 * `quote-service.ts` içindeki önbellek, tek uçuş ve soğuma SÜREÇ İÇİDİR:
 * Vercel'de her sunucusuz örnek kendi kopyasını taşır, bu yüzden toplam
 * CoinGecko hızını hiçbir şey sınırlamaz. Bu testler, paylaşılan sayacın o
 * boşluğu gerçekten kapattığını ölçer.
 */

const NOW = 1_700_000_000_000;
const OBSERVED_AT = Math.floor(NOW / 1000) - 10;

const ENV = {
  COINGECKO_DEMO_API_KEY: "test-demo-key",
  RATE_QUOTE_SECRET: TEST_QUOTE_SECRET,
};
const CLOCK = { clock: () => NOW };

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

/** Sayacı taklit eden enjekte edilebilir sürücü. */
function reserver(outcome: ProviderBudgetOutcome) {
  return vi.fn(async () => outcome);
}

beforeEach(() => {
  resetRateQuoteCache();
});

describe("kova hesabi", () => {
  it("ayni pencerede AYNI kovaya duser", () => {
    /*
     * Kova BAŞINDAN ölçülür. `NOW` pencere sınırında değildir; ona
     * `windowMs - 1` eklemek bir sonraki kovaya geçer ve bu testi
     * anlamsızlaştırırdı.
     */
    const base = budgetWindowStart(NOW) * BUDGET_WINDOW_MS;
    const start = budgetWindowStart(base);
    expect(budgetWindowStart(base + 1)).toBe(start);
    expect(budgetWindowStart(base + BUDGET_WINDOW_MS - 1)).toBe(start);
  });

  it("pencere sinirinda kova ILERLER", () => {
    const base = budgetWindowStart(NOW) * BUDGET_WINDOW_MS;
    expect(budgetWindowStart(base + BUDGET_WINDOW_MS)).toBe(
      budgetWindowStart(base) + 1,
    );
  });

  it("kova SAAT DILIMINDEN bagimsizdir", () => {
    /*
     * Tam sayı bölme kullanılmasının sebebi bu: SQL tarafı da aynı hesabı
     * yapar. `date_trunc` kullansaydık iki taraf sunucu saat dilimine göre
     * ayrışabilirdi ve bu yalnızca üretimde görünürdü.
     */
    expect(budgetWindowStart(0)).toBe(0);
    expect(budgetWindowStart(BUDGET_WINDOW_MS * 3 + 5)).toBe(3);
  });

  it("bekleme suresi ASLA sifir olmaz", () => {
    /* Sıfır saniye beklemek çağıranı hemen geri getirirdi. */
    const atBoundary = budgetWindowStart(NOW) * BUDGET_WINDOW_MS;
    expect(windowRetryAfterSeconds(atBoundary)).toBeGreaterThanOrEqual(1);
    expect(
      windowRetryAfterSeconds(atBoundary + BUDGET_WINDOW_MS - 1),
    ).toBeGreaterThanOrEqual(1);
  });

  it("saglayici anahtari tablodaki sekil kisitina uyar", () => {
    /* Geçiş dosyasındaki CHECK ile aynı kalıp. */
    expect(COINGECKO_PROVIDER_KEY).toMatch(/^[a-z0-9_-]{1,32}$/);
    expect(BUDGET_CALLS_PER_WINDOW).toBeGreaterThanOrEqual(1);
  });
});

describe("butce tukendiginde saglayiciya HIC gidilmez", () => {
  it("yukari akis cagrisi YAPILMAZ", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const reserve = reserver({ ok: false, reason: "exhausted" });

    const result = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: reserve,
      ...CLOCK,
    });

    /* ASIL İDDİA: kredi harcanmadı. */
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });

  it("cagirana pencere sonuna kadar bekleme suresi verir", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const result = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: reserver({ ok: false, reason: "exhausted" }),
      ...CLOCK,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.retryAfterSeconds).toBe(windowRetryAfterSeconds(NOW));
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(
      BUDGET_WINDOW_MS / 1000,
    );
  });

  it("USTEL SOGUMAYI tetiklemez", async () => {
    /*
     * Bütçe reddi bir SAĞLAYICI HATASI DEĞİLDİR. Ardışık hata sayacını
     * artırsaydı, dolu bir pencere sağlayıcıyı arızalı sanıp soğumayı
     * dakikalarca uzatırdı — sağlayıcı sapasağlamken.
     */
    const fetchImpl = vi.fn(async () => okResponse());
    const denied = reserver({ ok: false, reason: "exhausted" });

    await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: denied,
      ...CLOCK,
    });

    /* Pencere geçtikten sonra ilk istek sağlayıcıya GİDEBİLMELİ. */
    const nextWindow = NOW + BUDGET_WINDOW_MS;
    const allowed = await getUsdcTryObservation(nextWindow, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: reserver({ ok: true, used: 1 }),
      clock: () => nextWindow,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(allowed.ok).toBe(true);
  });
});

describe("sayaca ulasilamadiginda", () => {
  it("ENGELLENMEZ: bugunku surec ici korumaya dusulur", async () => {
    /*
     * Bilinçli karar. Bugün zaten örnekler arası koruma yok; kesinti
     * sırasında bugünkü davranışa düşmek bir GERİLEME değildir. Kur
     * servisini kapatmak ise DB hıçkırığını ödeme akışının durmasına
     * çevirirdi.
     */
    const fetchImpl = vi.fn(async () => okResponse());
    const log = vi.fn();

    const result = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: reserver({ ok: false, reason: "unavailable" }),
      log,
      ...CLOCK,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("SESSIZ kalmaz: gunluge duser", async () => {
    const log = vi.fn();
    await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: (async () => okResponse()) as never,
      reserveProviderCall: reserver({ ok: false, reason: "unavailable" }),
      log,
      ...CLOCK,
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain("butce");
  });

  it("YAPILANDIRILMAMIS olmak olay sayilmaz", async () => {
    /*
     * `DATABASE_URL` yokken her istek satır yazsaydı yerel geliştirme ve
     * testler günlüğü kullanılmaz hâle getirirdi. Bu bilinen bir dağıtım
     * durumudur, bir olay değil.
     */
    const log = vi.fn();
    const result = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: (async () => okResponse()) as never,
      reserveProviderCall: reserver({ ok: false, reason: "unconfigured" }),
      log,
      ...CLOCK,
    });

    expect(result.ok).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("butce tek ucusla birlikte calisir", () => {
  it("esZAMANLI istekler TEK kredi harcar", async () => {
    /*
     * EN KRİTİK İDDİA. Ayırma `inflight` atamasının DIŞINDA `await`
     * edilseydi, beklerken giren ikinci istek de `inflight === null` görür
     * ve aynı pencere için ikinci bir kredi ayırırdı. Sayaç, örnek başına
     * değil ÇAĞRI başına artmalı.
     */
    let release: (value: Response) => void = () => undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const reserve = reserver({ ok: true, used: 1 });

    const a = getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: reserve,
      ...CLOCK,
    });
    const b = getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: reserve,
      ...CLOCK,
    });
    const c = getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: reserve,
      ...CLOCK,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    release(okResponse());
    await Promise.all([a, b, c]);

    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ONBELLEKTEN karsilanan istek kredi HARCAMAZ", async () => {
    /*
     * Sayaç kullanıcı isteğiyle değil, gerçekten harcanan krediyle orantılı
     * olmalı. Aksi hâlde önbelleğin bütün anlamı kaybolurdu.
     */
    const fetchImpl = vi.fn(async () => okResponse());
    const reserve = reserver({ ok: true, used: 1 });
    const options = {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: reserve,
      ...CLOCK,
    };

    const first = await getUsdcTryObservation(NOW, options);
    const second = await getUsdcTryObservation(NOW + 1_000, {
      ...options,
      clock: () => NOW + 1_000,
    });

    expect(first.ok && first.source).toBe("provider");
    expect(second.ok && second.source).toBe("cache");
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
