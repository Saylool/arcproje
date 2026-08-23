import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COINGECKO_COIN_ID, COINGECKO_VS_CURRENCY } from "./coingecko";
import { QUOTE_MAX_OBSERVATION_AGE_MS } from "./quote";
import { TEST_QUOTE_SECRET } from "./quote-fixture";
import {
  COOLDOWN_BASE_MS,
  PROVIDER_CACHE_TTL_MS,
  getUsdcTryObservation,
  mintUsdcTryQuote,
  resetRateQuoteCache,
} from "./quote-service";
import { QUOTE_LIFETIME_MS, QUOTE_MIN_SEND_MARGIN_SECONDS } from "./quote";
import { TEST_QUOTE_SECRET as SECRET } from "./quote-fixture";

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

describe("önbellek isabetinde tazelik yeniden doğrulanır", () => {
  it("depolama TTL'i içinde bile bayatlayan kayıt ATILIR", async () => {
    /*
     * Gözlem, izin verilen yaşın 30 sn öncesinde. Depolama TTL'i (60 sn)
     * dolmadan yaş sınırı aşılır: kayıt yalnızca TTL'e bakılarak dönmemeli.
     */
    const observedAt =
      Math.floor(NOW / 1000) - QUOTE_MAX_OBSERVATION_AGE_MS / 1000 + 30;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(success(observedAt))
      .mockResolvedValueOnce(success(Math.floor((NOW + 40_000) / 1000) - 5));

    const first = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW,
    });
    expect(first).toMatchObject({ ok: true, source: "provider" });

    // 40 sn sonra: depolama TTL'i (60 sn) HÂLÂ geçerli ama gözlem bayatladı.
    const later = NOW + 40_000;
    const second = await getUsdcTryObservation(later, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => later,
    });
    expect(second).toMatchObject({ ok: true, source: "provider" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("taze kayıt TTL içinde önbellekten döner", async () => {
    const fetchImpl = vi.fn(async () => success());
    await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => NOW,
    });
    const soon = NOW + 10_000;
    const second = await getUsdcTryObservation(soon, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      clock: () => soon,
    });
    expect(second).toMatchObject({ ok: true, source: "cache" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("teklif ömrü gözlem tazeliğiyle sınırlanır", () => {
  const MINT_ENV = { ...ENV, RATE_QUOTE_SECRET: SECRET };

  it("taze gözlemde normal TTL uygulanır", async () => {
    const minted = await mintUsdcTryQuote({
      env: MINT_ENV,
      fetchImpl: (async () => success()) as never,
      nowMs: NOW,
      clock: () => NOW,
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.signed.quote.expiresAt - minted.signed.quote.issuedAt).toBe(
      QUOTE_LIFETIME_MS / 1000,
    );
  });

  it("yaşlanmış gözlemde bitiş gözlem ufkuna kırpılır", async () => {
    // Gözlem, izin verilen yaşın bitimine 120 sn kala.
    const observedAt =
      Math.floor(NOW / 1000) - QUOTE_MAX_OBSERVATION_AGE_MS / 1000 + 120;
    const minted = await mintUsdcTryQuote({
      env: MINT_ENV,
      fetchImpl: (async () => success(observedAt)) as never,
      nowMs: NOW,
      clock: () => NOW,
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    const life = minted.signed.quote.expiresAt - minted.signed.quote.issuedAt;
    expect(life).toBeLessThan(QUOTE_LIFETIME_MS / 1000);
    expect(life).toBeLessThanOrEqual(120);
  });

  it("gönderim payından kısa ömürlü teklif ÜRETİLMEZ", async () => {
    // Gözlem ufkuna yalnızca 30 sn kaldı; 60 sn'lik pay karşılanamaz.
    const observedAt =
      Math.floor(NOW / 1000) - QUOTE_MAX_OBSERVATION_AGE_MS / 1000 + 30;
    const minted = await mintUsdcTryQuote({
      env: MINT_ENV,
      fetchImpl: (async () => success(observedAt)) as never,
      nowMs: NOW,
      clock: () => NOW,
    });
    expect(minted).toMatchObject({ ok: false, code: "invalidObservation" });
    expect(QUOTE_MIN_SEND_MARGIN_SECONDS).toBe(60);
  });
});

describe("teklif YERLEŞİM anına çıpalanır", () => {
  const MINT_ENV = { ...ENV, RATE_QUOTE_SECRET: SECRET };
  const NOW_SECONDS = Math.floor(NOW / 1000);
  const MAX_AGE_SECONDS = QUOTE_MAX_OBSERVATION_AGE_MS / 1000;

  /**
   * Sağlayıcı yanıtı `slowMs` kadar sürer ve bu sırada saat ilerler.
   * `nowMs` isteğin BAŞLADIĞI an; saat yerleşim anını verir.
   */
  function slowProvider(observedAt: number, slowMs: number) {
    let nowRef = NOW;
    const fetchImpl = vi.fn(async () => {
      nowRef = NOW + slowMs;
      return success(observedAt);
    });
    return { fetchImpl, clock: () => nowRef };
  }

  it("issuedAt isteğin başlangıcı DEĞİL, yanıtın döndüğü andır", async () => {
    const SLOW_MS = 10_000;
    const { fetchImpl, clock } = slowProvider(NOW_SECONDS - 5, SLOW_MS);

    const minted = await mintUsdcTryQuote({
      env: MINT_ENV,
      fetchImpl: fetchImpl as never,
      nowMs: NOW,
      clock,
    });

    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    // Çıpa başlangıç olsaydı issuedAt NOW_SECONDS olurdu.
    expect(minted.signed.quote.issuedAt).toBe(NOW_SECONDS + SLOW_MS / 1000);
  });

  it("expiresAt de yerleşim anından hesaplanır", async () => {
    const SLOW_MS = 7000;
    const { fetchImpl, clock } = slowProvider(NOW_SECONDS - 5, SLOW_MS);

    const minted = await mintUsdcTryQuote({
      env: MINT_ENV,
      fetchImpl: fetchImpl as never,
      nowMs: NOW,
      clock,
    });

    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    const settledSeconds = NOW_SECONDS + SLOW_MS / 1000;
    expect(minted.signed.quote.issuedAt).toBe(settledSeconds);
    expect(minted.signed.quote.expiresAt).toBe(
      settledSeconds + QUOTE_LIFETIME_MS / 1000,
    );
    // İstemciye ulaşan teklif söz verilen tam ömre sahiptir.
    expect(
      minted.signed.quote.expiresAt - minted.signed.quote.issuedAt,
    ).toBe(QUOTE_LIFETIME_MS / 1000);
  });

  it("YAVAŞ sağlayıcı payı yerse teklif BASILMAZ", async () => {
    /*
     * Gözlem ufkuna başlangıçta 65 sn var: eski (başlangıca çıpalı) hesapla
     * 65 >= 60 olduğu için teklif basılırdı. Yanıt 10 sn sürdüğü için
     * yerleşim anında yalnızca 55 sn kalır ve teklif ÜRETİLMEMELİDİR.
     */
    const observedAt = NOW_SECONDS - MAX_AGE_SECONDS + 65;
    const { fetchImpl, clock } = slowProvider(observedAt, 10_000);

    const minted = await mintUsdcTryQuote({
      env: MINT_ENV,
      fetchImpl: fetchImpl as never,
      nowMs: NOW,
      clock,
    });

    expect(minted).toMatchObject({ ok: false, code: "invalidObservation" });
  });

  it("aynı gözlem HIZLI dönerse teklif basılır (sınırın diğer yanı)", async () => {
    // Tek fark yanıt süresi: 1 sn'de dönerse 64 sn kalır ve pay karşılanır.
    const observedAt = NOW_SECONDS - MAX_AGE_SECONDS + 65;
    const { fetchImpl, clock } = slowProvider(observedAt, 1000);

    const minted = await mintUsdcTryQuote({
      env: MINT_ENV,
      fetchImpl: fetchImpl as never,
      nowMs: NOW,
      clock,
    });

    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(
      minted.signed.quote.expiresAt - minted.signed.quote.issuedAt,
    ).toBe(64);
  });

  it("pay sınırında (tam 60 sn) teklif hâlâ basılır", async () => {
    const observedAt = NOW_SECONDS - MAX_AGE_SECONDS + 65;
    const { fetchImpl, clock } = slowProvider(observedAt, 5000);

    const minted = await mintUsdcTryQuote({
      env: MINT_ENV,
      fetchImpl: fetchImpl as never,
      nowMs: NOW,
      clock,
    });

    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(
      minted.signed.quote.expiresAt - minted.signed.quote.issuedAt,
    ).toBe(QUOTE_MIN_SEND_MARGIN_SECONDS);
  });

  it("payın bir saniye altında teklif basılmaz", async () => {
    const observedAt = NOW_SECONDS - MAX_AGE_SECONDS + 65;
    const { fetchImpl, clock } = slowProvider(observedAt, 6000);

    const minted = await mintUsdcTryQuote({
      env: MINT_ENV,
      fetchImpl: fetchImpl as never,
      nowMs: NOW,
      clock,
    });

    expect(minted).toMatchObject({ ok: false, code: "invalidObservation" });
  });

  it("basılan HİÇBİR teklif söz verilen paydan kısa ömürle çıkmaz", async () => {
    // Ufka kalan süre ve yanıt gecikmesi taranır; ok olan her sonuç pay tutar.
    for (const remaining of [60, 61, 65, 90, 120, 300]) {
      for (const slowMs of [0, 1000, 5000, 12_000, 30_000]) {
        resetRateQuoteCache();
        const observedAt = NOW_SECONDS - MAX_AGE_SECONDS + remaining;
        const { fetchImpl, clock } = slowProvider(observedAt, slowMs);

        const minted = await mintUsdcTryQuote({
          env: MINT_ENV,
          fetchImpl: fetchImpl as never,
          nowMs: NOW,
          clock,
        });

        if (!minted.ok) continue;
        const life = minted.signed.quote.expiresAt - minted.signed.quote.issuedAt;
        expect(life, `${remaining}s / ${slowMs}ms`).toBeGreaterThanOrEqual(
          QUOTE_MIN_SEND_MARGIN_SECONDS,
        );
        // Ömür yerleşim anından ölçülür; gözlem ufku aşılamaz.
        expect(
          minted.signed.quote.expiresAt,
          `${remaining}s / ${slowMs}ms`,
        ).toBeLessThanOrEqual(minted.signed.quote.observedAt + MAX_AGE_SECONDS);
      }
    }
  });

  it("gözlem yanıt dönerken tamamen bayatlarsa teklif basılmaz", async () => {
    // Başlangıçta taze, yerleşimde izin verilen yaşı aşmış bir gözlem.
    const observedAt = NOW_SECONDS - MAX_AGE_SECONDS + 5;
    const { fetchImpl, clock } = slowProvider(observedAt, 30_000);

    const minted = await mintUsdcTryQuote({
      env: MINT_ENV,
      fetchImpl: fetchImpl as never,
      nowMs: NOW,
      clock,
    });

    expect(minted.ok).toBe(false);
  });
});
