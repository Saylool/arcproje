import { beforeEach, describe, expect, it, vi } from "vitest";

import { COINGECKO_COIN_ID, COINGECKO_VS_CURRENCY } from "./coingecko";
import type { ProviderObservation } from "./coingecko";
import { QUOTE_LIFETIME_MS, QUOTE_MAX_OBSERVATION_AGE_MS } from "./quote";
import { TEST_QUOTE_SECRET } from "./quote-fixture";
import {
  PROVIDER_CACHE_TTL_MS,
  getUsdcTryObservation,
  mintUsdcTryQuote,
  resetRateQuoteCache,
  type SharedRateCacheEntry,
  type SharedRateCacheReadResult,
} from "./quote-service";

/**
 * PAYLAŞILAN KUR ÖNBELLEĞİ (L2) — kur servisinin davranışı.
 *
 * DÜZELTİLEN ARIZA: 0006 ile yukarı akış çağrılarının SAYISI bütün örnekler
 * adına sınırlandı, ama SONUÇ paylaşılmıyordu. Vercel'de her eşzamanlı örnek
 * kendi belleğini taşıdığı için, penceredeki krediyi kapamayan örnekler —
 * taze kur yan taraftaki örneğin belleğinde dururken — `exhausted` görüp
 * kullanıcıya "kur alınamadı" döndürüyordu. Limit paylaşılıp sonuç
 * paylaşılmayınca korumanın bedelini önbellek isabeti değil KULLANICI ödüyordu.
 *
 * Aşağıdaki testler bu davranışın geri gelmesini engeller.
 */

const NOW = 1_700_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);

const ENV = {
  COINGECKO_DEMO_API_KEY: "test-demo-key",
  RATE_QUOTE_SECRET: TEST_QUOTE_SECRET,
};

/** Yerleşim saatini testin kontrol ettiği saate bağlar. */
const at = (ms: number) => ({ clock: () => ms });

const OBSERVATION: ProviderObservation = {
  rateText: "42.123456",
  observedAt: NOW_SECONDS - 10,
};

function sharedHit(
  entry: Partial<SharedRateCacheEntry> = {},
): SharedRateCacheReadResult {
  return {
    ok: true,
    entry: {
      observation: entry.observation ?? OBSERVATION,
      storedAtMs: entry.storedAtMs ?? NOW,
    },
  };
}

function providerResponse(rate = 7.000001, observedAt = NOW_SECONDS - 5) {
  return new Response(
    JSON.stringify({
      [COINGECKO_COIN_ID]: {
        [COINGECKO_VS_CURRENCY]: rate,
        last_updated_at: observedAt,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Bütçe bu dosyada hep vardır; ölçülen şey ona GİDİLİP gidilmediği. */
const grantingReserver = () =>
  vi.fn(async () => ({ ok: true as const, used: 1 }));

beforeEach(() => {
  resetRateQuoteCache();
});

describe("L2 isabeti", () => {
  it("saglayiciya GITMEZ ve kredi HARCAMAZ", async () => {
    const fetchImpl = vi.fn();
    const reserve = grantingReserver();
    const readSharedRateCache = vi.fn(async () => sharedHit());

    const result = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: reserve,
      readSharedRateCache,
      ...at(NOW),
    });

    expect(result.ok && result.source).toBe("shared");
    expect(result.ok && result.observation).toEqual(OBSERVATION);
    expect(fetchImpl).not.toHaveBeenCalled();
    /*
     * KREDİYE HİÇ GİDİLMEZ. Sayaç kullanıcı isteğiyle değil, gerçekten
     * harcanan krediyle orantılı olmalı; paylaşılan önbellek isabeti
     * hiçbir kredi harcamaz.
     */
    expect(reserve).not.toHaveBeenCalled();
  });

  it("L1'e de yazilir; ayni ornegin ikinci istegi SORGU YAPMAZ", async () => {
    const readSharedRateCache = vi.fn(async () => sharedHit());
    const options = {
      env: ENV,
      fetchImpl: vi.fn() as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache,
    };

    await getUsdcTryObservation(NOW, { ...options, ...at(NOW) });
    const second = await getUsdcTryObservation(NOW + 1_000, {
      ...options,
      ...at(NOW + 1_000),
    });

    expect(second.ok && second.source).toBe("cache");
    expect(readSharedRateCache).toHaveBeenCalledTimes(1);
  });

  it("L1 cipasi paylasilan kaydin KENDI yazma anidir, 'simdi' degil", async () => {
    /*
     * Çıpa "şimdi" olsaydı L1, paylaşılan TTL'in ötesine uzardı: örnek
     * kendini taze sanar, tazelemeyi bırakır ve kur sessizce yaşlanırdı.
     */
    const storedAtMs = NOW - (PROVIDER_CACHE_TTL_MS - 10_000);
    const readSharedRateCache = vi.fn(async () => sharedHit({ storedAtMs }));
    const options = {
      env: ENV,
      fetchImpl: (async () => providerResponse()) as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache,
    };

    await getUsdcTryObservation(NOW, { ...options, ...at(NOW) });
    /* Paylaşılan kaydın yaşı TTL'i geçtiği an L1 de düşmeli. */
    await getUsdcTryObservation(NOW + 20_000, {
      ...options,
      ...at(NOW + 20_000),
    });

    expect(readSharedRateCache).toHaveBeenCalledTimes(2);
  });
});

describe("L2 tazelik olcutu L1 ile AYNIDIR", () => {
  it("TTL'i gecmis kayit kullanilmaz; yeniden cekilir", async () => {
    const fetchImpl = vi.fn(async () => providerResponse());
    const readSharedRateCache = vi.fn(async () =>
      sharedHit({ storedAtMs: NOW - PROVIDER_CACHE_TTL_MS }),
    );

    const result = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache,
      writeSharedRateCache: async () => undefined,
      ...at(NOW),
    });

    expect(result.ok && result.source).toBe("provider");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("YAS SINIRINI asmis kayit, TTL icinde olsa bile kullanilmaz", async () => {
    /*
     * Paylaşılan olması hiçbir doğrulamayı gevşetmez.
     * `QUOTE_MAX_OBSERVATION_AGE_MS` L2'ye de aynen uygulanır.
     */
    const fetchImpl = vi.fn(async () => providerResponse());
    const tooOld: ProviderObservation = {
      rateText: "42.123456",
      observedAt: NOW_SECONDS - QUOTE_MAX_OBSERVATION_AGE_MS / 1000 - 1,
    };
    const readSharedRateCache = vi.fn(async () =>
      sharedHit({ observation: tooOld, storedAtMs: NOW }),
    );

    const result = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache,
      writeSharedRateCache: async () => undefined,
      ...at(NOW),
    });

    expect(result.ok && result.source).toBe("provider");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("GELECEK tarihli kayit kullanilmaz", async () => {
    const fetchImpl = vi.fn(async () => providerResponse());
    const readSharedRateCache = vi.fn(async () =>
      sharedHit({
        observation: { rateText: "42.123456", observedAt: NOW_SECONDS + 3_600 },
        storedAtMs: NOW,
      }),
    );

    const result = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache,
      writeSharedRateCache: async () => undefined,
      ...at(NOW),
    });

    expect(result.ok && result.source).toBe("provider");
  });
});

describe("DUZELTILEN ARIZA: limit paylasilip sonuc paylasilmayinca", () => {
  it("butce reddi yuzunden sogumaya girmis ornek, paylasilan kuru YINE DE verir", async () => {
    /*
     * SENARYO — akşam zirvesi, sekiz eşzamanlı örnek:
     *
     *   1-4. örnekler krediyi kapar, CoinGecko'ya gider, kuru alır.
     *   5. örnek `exhausted` görür ve soğumaya girer.
     *
     * ESKİ DAVRANIŞ: 5. örnek o pencerenin geri kalanında kendisine gelen
     * HERKESE hata döndürürdü — taze kur 1. örneğin belleğinde dururken.
     *
     * YENİ DAVRANIŞ: kazanan örnek kuru L2'ye yazdığı an, 5. örnek onu
     * okuyup kullanıcıya verir. Soğuma yukarı akışı durdurur; paylaşılan
     * önbellekten okumayı DEĞİL.
     */
    const fetchImpl = vi.fn();
    const reserve = vi.fn(async () => ({
      ok: false as const,
      reason: "exhausted" as const,
    }));
    let shared: SharedRateCacheReadResult = { ok: false, reason: "missing" };
    const readSharedRateCache = vi.fn(async () => shared);
    const options = {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: reserve,
      readSharedRateCache,
    };

    /* Kredi yok, paylaşılan önbellek de henüz boş: bugünkü hata. */
    const denied = await getUsdcTryObservation(NOW, { ...options, ...at(NOW) });
    expect(denied.ok).toBe(false);

    /* Kazanan örnek kuru yazdı. Bu örnek HÂLÂ soğumada. */
    shared = sharedHit({ storedAtMs: NOW + 200 });
    const served = await getUsdcTryObservation(NOW + 1_000, {
      ...options,
      ...at(NOW + 1_000),
    });

    expect(served.ok && served.source).toBe("shared");
    /* İkinci istekte krediye HİÇ gidilmedi: L2 soğumadan ÖNCE okunuyor. */
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("saglayici SOGUMASINDA da paylasilan kur servis edilir", async () => {
    /*
     * CoinGecko kesintisinde de aynı kazanç: soğuma yukarı akışı korur,
     * ama elde taze bir gözlem varsa kullanıcı hata görmemeli.
     */
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    let shared: SharedRateCacheReadResult = { ok: false, reason: "missing" };
    const options = {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache: async () => shared,
      writeSharedRateCache: async () => undefined,
    };

    const failed = await getUsdcTryObservation(NOW, { ...options, ...at(NOW) });
    expect(failed.ok).toBe(false);

    shared = sharedHit({ storedAtMs: NOW + 200 });
    const served = await getUsdcTryObservation(NOW + 1_000, {
      ...options,
      ...at(NOW + 1_000),
    });

    expect(served.ok && served.source).toBe("shared");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("L2'ye yazma", () => {
  it("basarili cekme paylasilan onbellege YAZAR", async () => {
    /*
     * Bu satır olmadan çekilen kur yalnızca bu örneğin belleğinde kalır ve
     * düzeltmenin tamamı anlamsızlaşır.
     */
    const writeSharedRateCache = vi.fn(async () => undefined);

    await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: (async () => providerResponse(7.000001, NOW_SECONDS - 5)) as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache: async () => ({ ok: false, reason: "missing" }),
      writeSharedRateCache,
      ...at(NOW),
    });

    expect(writeSharedRateCache).toHaveBeenCalledTimes(1);
    expect(writeSharedRateCache).toHaveBeenCalledWith({
      observation: { rateText: "7.000001", observedAt: NOW_SECONDS - 5 },
      /* Çıpa yerleşim anıdır: isteğin başladığı an değil, yanıtın döndüğü an. */
      storedAtMs: NOW,
    });
  });

  it("BASARISIZ cekme yazmaz", async () => {
    const writeSharedRateCache = vi.fn(async () => undefined);

    await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: (async () => new Response("{}", { status: 502 })) as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache: async () => ({ ok: false, reason: "missing" }),
      writeSharedRateCache,
      ...at(NOW),
    });

    expect(writeSharedRateCache).not.toHaveBeenCalled();
  });

  it("BAYAT gozlem yazmaz", async () => {
    /*
     * Yaş sınırını aşmış bir gözlem paylaşılsaydı, bütün örnekler TTL
     * boyunca aynı geçersiz veriyi okur ve her teklif basımı düşerdi.
     */
    const writeSharedRateCache = vi.fn(async () => undefined);
    const stale = NOW_SECONDS - QUOTE_MAX_OBSERVATION_AGE_MS / 1000 - 1;

    await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: (async () => providerResponse(7.000001, stale)) as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache: async () => ({ ok: false, reason: "missing" }),
      writeSharedRateCache,
      ...at(NOW),
    });

    expect(writeSharedRateCache).not.toHaveBeenCalled();
  });

  it("yazma HATASI istegi bozmaz", async () => {
    /*
     * Kur elde edilmiştir; paylaşamamak bir sonraki isteği pahalılaştırır,
     * bu isteği bozmaz.
     */
    const result = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: (async () => providerResponse()) as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache: async () => ({ ok: false, reason: "missing" }),
      writeSharedRateCache: async () => {
        throw new Error("depo yok");
      },
      ...at(NOW),
    });

    expect(result.ok && result.source).toBe("provider");
  });
});

describe("L2 yoksa eski davranisa dusulur", () => {
  it("okuma ULASILAMAZSA saglayiciya gidilir", async () => {
    /*
     * Geçiş henüz uygulanmamışsa tablo yoktur ve buraya düşülür. Servis
     * bugünkü tek örneklik davranışına döner; hiçbir şey kırılmaz. Dağıtım
     * sırasının serbest olması buna bağlı.
     */
    const result = await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: (async () => providerResponse()) as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache: async () => ({ ok: false, reason: "unavailable" }),
      writeSharedRateCache: async () => undefined,
      log: () => undefined,
      ...at(NOW),
    });

    expect(result.ok && result.source).toBe("provider");
  });

  it("ULASILAMAZLIK pencere basina BIR KEZ gunluge duser", async () => {
    /*
     * Kesinti sırasında her istek satır yazsaydı günlük kullanılmaz hâle
     * gelirdi. Pencere değişince yeniden yazılır, böylece SÜREN bir kesinti
     * görünmez olmaz.
     *
     * Sağlayıcı da BİLEREK düşürülüyor: başarılı bir çekme L1'i doldurur ve
     * sonraki istekler paylaşılan okumaya hiç ulaşmazdı — o zaman ölçülen
     * şey günlük değil, önbellek isabeti olurdu.
     */
    const lines: string[] = [];
    const options = {
      env: ENV,
      fetchImpl: (async () => new Response("{}", { status: 500 })) as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache: async () => ({
        ok: false as const,
        reason: "unavailable" as const,
      }),
      writeSharedRateCache: async () => undefined,
      log: (line: string) => lines.push(line),
    };

    await getUsdcTryObservation(NOW, { ...options, ...at(NOW) });
    expect(lines).toHaveLength(1);

    /* Aynı pencere (60 sn kova): ikinci satır YAZILMAZ. */
    await getUsdcTryObservation(NOW + 1_000, {
      ...options,
      ...at(NOW + 1_000),
    });
    expect(lines).toHaveLength(1);

    /* İki kova sonrası: yeniden yazılır. */
    await getUsdcTryObservation(NOW + 120_000, {
      ...options,
      ...at(NOW + 120_000),
    });
    expect(lines).toHaveLength(2);
  });

  it("YAPILANDIRILMAMIS depo olay uretmez", async () => {
    /*
     * `DATABASE_URL` yokluğu yerelde ve testlerde normaldir; her istekte
     * satır yazsaydı günlük kullanılmaz hâle gelirdi.
     */
    const lines: string[] = [];

    await getUsdcTryObservation(NOW, {
      env: ENV,
      fetchImpl: (async () => providerResponse()) as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache: async () => ({
        ok: false,
        reason: "unconfigured",
      }),
      writeSharedRateCache: async () => undefined,
      log: (line: string) => lines.push(line),
      ...at(NOW),
    });

    expect(lines).toEqual([]);
  });
});

describe("tek ucus L2 eklendikten sonra da korunur", () => {
  it("eszamanli istekler TEK okuma, TEK kredi ve TEK cagriya birlesir", async () => {
    /*
     * L2 okuması uçuşun İÇİNDEDİR. Dışarıda beklenseydi, bekleyen ikinci
     * istek de `inflight === null` görür ve ikinci bir kredi ayırırdı —
     * bugün var olan bir garanti sessizce kaybolurdu.
     */
    let release: (value: Response) => void = () => undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const reserve = grantingReserver();
    const readSharedRateCache = vi.fn(async () => ({
      ok: false as const,
      reason: "missing" as const,
    }));
    const options = {
      env: ENV,
      fetchImpl: fetchImpl as never,
      reserveProviderCall: reserve,
      readSharedRateCache,
      writeSharedRateCache: async () => undefined,
      ...at(NOW),
    };

    const a = getUsdcTryObservation(NOW, options);
    const b = getUsdcTryObservation(NOW, options);
    const c = getUsdcTryObservation(NOW, options);

    await new Promise((resolve) => setTimeout(resolve, 0));
    release(providerResponse());
    const results = await Promise.all([a, b, c]);

    for (const result of results) {
      expect(result.ok).toBe(true);
    }
    expect(readSharedRateCache).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("TTL uzatmasi teklif omrunden HICBIR SEY goturmez", () => {
  /*
   * Teklif ömrü iki sınırın küçüğüdür:
   *   min(QUOTE_LIFETIME_MS, QUOTE_MAX_OBSERVATION_AGE_MS − gözlem yaşı)
   *   = min(300 sn, 600 sn − yaş)
   *
   * Yani 300 saniyeye kadar eskimiş bir gözlem hâlâ TAM ömür verir.
   * `PROVIDER_CACHE_TTL_MS` bu eşiğin ALTINDA kalmalıdır; kalmazsa
   * önbellekten karşılanan bazı teklifler kısa ömürle çıkar.
   */
  const fullLifetimeSeconds = QUOTE_LIFETIME_MS / 1000;
  const breakEvenSeconds =
    (QUOTE_MAX_OBSERVATION_AGE_MS - QUOTE_LIFETIME_MS) / 1000;

  it("TTL, tam omur esiginin ALTINDADIR", () => {
    expect(PROVIDER_CACHE_TTL_MS / 1000).toBeLessThanOrEqual(breakEvenSeconds);
  });

  it("TTL kadar eskimis bir gozlemle basilan teklif TAM omurlu olur", async () => {
    const ageSeconds = PROVIDER_CACHE_TTL_MS / 1000;
    const minted = await mintUsdcTryQuote({
      env: ENV,
      fetchImpl: vi.fn() as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache: async () =>
        sharedHit({
          observation: {
            rateText: "42.123456",
            observedAt: NOW_SECONDS - ageSeconds,
          },
          storedAtMs: NOW - PROVIDER_CACHE_TTL_MS + 1_000,
        }),
      nowMs: NOW,
      ...at(NOW),
    });

    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.signed.quote.expiresAt - minted.signed.quote.issuedAt).toBe(
      fullLifetimeSeconds,
    );
    expect(minted.source).toBe("shared");
  });

  it("TAM OMUR ESIGINDEKI gozlem hala tam omur verir", async () => {
    /* Sınırın kendisi: 300 saniye yaş → 600 − 300 = 300 saniye ömür. */
    const minted = await mintUsdcTryQuote({
      env: ENV,
      fetchImpl: vi.fn() as never,
      reserveProviderCall: grantingReserver(),
      readSharedRateCache: async () =>
        sharedHit({
          observation: {
            rateText: "42.123456",
            observedAt: NOW_SECONDS - breakEvenSeconds,
          },
          storedAtMs: NOW - 1_000,
        }),
      nowMs: NOW,
      ...at(NOW),
    });

    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.signed.quote.expiresAt - minted.signed.quote.issuedAt).toBe(
      fullLifetimeSeconds,
    );
  });
});
