import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";

/**
 * PAYLAŞILAN KUR ÖNBELLEĞİ — sürücü davranışı ve SQL eşleşmesi.
 *
 * İki uygulama vardır: üretimdeki Neon SQL'i ve testlerin kullandığı bellek
 * içi sahte depo. İkisi AYNI kuralı uygulamak zorundadır; aksi hâlde testler
 * yeşil kalırken üretim farklı davranır. Bu depoda tam olarak bu yaşandı,
 * bu yüzden eşleşme ayrıca ölçülür.
 *
 * SINIR: bu depoda çalışan bir Postgres YOKTUR, bu yüzden SQL burada
 * ÇALIŞTIRILAMAZ. Aşağıdaki eşleşme testleri SQL METNİNİN doğru semantiği
 * kodladığını ölçer; gerçek yürütme doğrulaması geçiş uygulandıktan sonra
 * yapılır.
 */

const KEY = "coingecko";
const RATE = "42.123456";
const OBSERVED_AT = 1_700_000_000;
const STORED_AT_MS = 1_700_000_000_000;

function repo() {
  return createFakeSharedBillRepository();
}

describe("kur onbellegi: surucu davranisi", () => {
  it("hic yazilmamissa MISSING doner, unavailable DEGIL", async () => {
    /*
     * İkisi karıştırılırsa çağıran yanlış davranır: "henüz kimse yazmamış"
     * soğuk bir dağıtımda normaldir ve olay üretmemeli; "depoya ulaşamadım"
     * ise bir olaydır ve görülmelidir.
     */
    const repository = repo();
    expect(await repository.readProviderRateCache({ providerKey: KEY })).toEqual(
      { ok: false, reason: "missing" },
    );
  });

  it("yazilan gozlem AYNEN geri okunur", async () => {
    const repository = repo();
    await repository.writeProviderRateCache({
      providerKey: KEY,
      rateText: RATE,
      observedAt: OBSERVED_AT,
      storedAtMs: STORED_AT_MS,
    });
    expect(await repository.readProviderRateCache({ providerKey: KEY })).toEqual(
      {
        ok: true,
        observation: {
          rateText: RATE,
          observedAt: OBSERVED_AT,
          storedAtMs: STORED_AT_MS,
        },
      },
    );
  });

  it("okuma TAZELIK OLCMEZ; satiri oldugu gibi verir", async () => {
    /*
     * Tazelik kararı çağıranındır ve süreç içi önbellekle BİREBİR aynı
     * ölçütle verilir. Depo burada "yardımcı olmaya" kalkarsa, üretimde
     * olmayan bir filtre testlerde varmış gibi görünür.
     */
    const repository = repo();
    await repository.writeProviderRateCache({
      providerKey: KEY,
      rateText: RATE,
      observedAt: 1,
      storedAtMs: 1,
    });
    const read = await repository.readProviderRateCache({ providerKey: KEY });
    expect(read.ok).toBe(true);
  });

  it("DAHA YENI gozlem uzerine yazar", async () => {
    const repository = repo();
    await repository.writeProviderRateCache({
      providerKey: KEY,
      rateText: RATE,
      observedAt: OBSERVED_AT,
      storedAtMs: STORED_AT_MS,
    });
    expect(
      await repository.writeProviderRateCache({
        providerKey: KEY,
        rateText: "43.000000",
        observedAt: OBSERVED_AT + 60,
        storedAtMs: STORED_AT_MS + 60_000,
      }),
    ).toEqual({ ok: true, stored: true });

    const read = await repository.readProviderRateCache({ providerKey: KEY });
    expect(read.ok && read.observation.rateText).toBe("43.000000");
  });

  it("DAHA ESKI gozlem uzerine YAZMAZ", async () => {
    /*
     * Yavaş dönen bir yanıt, o sırada başka bir örneğin yazdığı taze veriyi
     * ezmemelidir. Bu bir hata değildir; `stored: false` ile bildirilir.
     */
    const repository = repo();
    await repository.writeProviderRateCache({
      providerKey: KEY,
      rateText: RATE,
      observedAt: OBSERVED_AT,
      storedAtMs: STORED_AT_MS,
    });
    expect(
      await repository.writeProviderRateCache({
        providerKey: KEY,
        rateText: "1.000000",
        observedAt: OBSERVED_AT - 60,
        storedAtMs: STORED_AT_MS + 60_000,
      }),
    ).toEqual({ ok: true, stored: false });

    const read = await repository.readProviderRateCache({ providerKey: KEY });
    expect(read.ok && read.observation.rateText).toBe(RATE);
  });

  it("AYNI gozlem yeniden dogrulanirsa yazma ani TAZELENIR", async () => {
    /*
     * CoinGecko aynı `last_updated_at` değerini dakikalarca döndürebilir.
     * Eşitlikte yazma atlansaydı `stored_at` hiç ilerlemez, TTL hep dolmuş
     * görünür ve her örnek boşuna yeniden çağrı yapardı.
     */
    const repository = repo();
    await repository.writeProviderRateCache({
      providerKey: KEY,
      rateText: RATE,
      observedAt: OBSERVED_AT,
      storedAtMs: STORED_AT_MS,
    });
    expect(
      await repository.writeProviderRateCache({
        providerKey: KEY,
        rateText: RATE,
        observedAt: OBSERVED_AT,
        storedAtMs: STORED_AT_MS + 60_000,
      }),
    ).toEqual({ ok: true, stored: true });

    const read = await repository.readProviderRateCache({ providerKey: KEY });
    expect(read.ok && read.observation.storedAtMs).toBe(STORED_AT_MS + 60_000);
  });

  it("ayni gozlem ESKI bir yazma aniyla geriye ALINMAZ", async () => {
    const repository = repo();
    await repository.writeProviderRateCache({
      providerKey: KEY,
      rateText: RATE,
      observedAt: OBSERVED_AT,
      storedAtMs: STORED_AT_MS,
    });
    expect(
      await repository.writeProviderRateCache({
        providerKey: KEY,
        rateText: RATE,
        observedAt: OBSERVED_AT,
        storedAtMs: STORED_AT_MS - 1,
      }),
    ).toEqual({ ok: true, stored: false });
  });

  it("SAGLAYICILAR birbirinden yalitiktir", async () => {
    const repository = repo();
    await repository.writeProviderRateCache({
      providerKey: KEY,
      rateText: RATE,
      observedAt: OBSERVED_AT,
      storedAtMs: STORED_AT_MS,
    });
    expect(
      await repository.readProviderRateCache({ providerKey: "other" }),
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("depo erisilemezse MISSING demez", async () => {
    /*
     * `missing` görülseydi çağıran "henüz yazılmamış" diye düşünür ve
     * kesintiyi hiç fark etmezdi.
     */
    const repository = repo();
    repository.controls.failWithUnavailable = true;
    expect(await repository.readProviderRateCache({ providerKey: KEY })).toEqual(
      { ok: false, reason: "unavailable" },
    );
    expect(
      await repository.writeProviderRateCache({
        providerKey: KEY,
        rateText: RATE,
        observedAt: OBSERVED_AT,
        storedAtMs: STORED_AT_MS,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("kur onbellegi: SQL ile bellek ici depo AYNI davranmali", () => {
  const neon = readFileSync("src/lib/db/neon-shared-bill-repository.ts", "utf8");

  function sqlBlock(name: string): string {
    const start = neon.indexOf(`const ${name} = \``);
    expect(start, name).toBeGreaterThan(-1);
    const end = neon.indexOf("`;", start);
    return neon.slice(start, end);
  }

  it("okuma TEK satiri birincil anahtardan alir", () => {
    const sql = sqlBlock("READ_PROVIDER_RATE_CACHE");
    expect(sql).toMatch(/FROM\s+provider_rate_cache/);
    expect(sql).toMatch(/WHERE\s+provider_key\s*=\s*\$1/);
  });

  it("okuma her uc alani da getirir", () => {
    /*
     * Eksik bir alan sessizce `undefined` olur ve çağıran onu sayıya
     * çevirmeye kalkar; sonuç `NaN` ile bozulmuş bir TTL hesabıdır.
     */
    const sql = sqlBlock("READ_PROVIDER_RATE_CACHE");
    for (const column of ["rate_text", "observed_at", "stored_at"]) {
      expect(sql, column).toContain(column);
    }
  });

  it("yazma TEK deyimdir: oku-sonra-yaz yaris acardi", () => {
    /*
     * İki örnek `observed_at` değerini ayrı okuyup ayrı karşılaştırsaydı,
     * eski olan yeniyi ezebilirdi. Monotonluk tek deyimde, `ON CONFLICT`
     * koşuluyla sağlanmalı.
     */
    const sql = sqlBlock("WRITE_PROVIDER_RATE_CACHE");
    expect(sql).toContain("ON CONFLICT (provider_key) DO UPDATE");
    expect(sql).not.toMatch(/\bBEGIN\b/);
  });

  it("yazma MONOTONDUR: gozlem ani geriye gidemez", () => {
    const sql = sqlBlock("WRITE_PROVIDER_RATE_CACHE");
    expect(sql).toMatch(
      /WHERE\s+provider_rate_cache\.observed_at\s*<\s*excluded\.observed_at/,
    );
  });

  it("esitlikte yazma ani ILERLEYEBILIR ama geriye gidemez", () => {
    const sql = sqlBlock("WRITE_PROVIDER_RATE_CACHE");
    expect(sql).toMatch(
      /provider_rate_cache\.observed_at\s*=\s*excluded\.observed_at/,
    );
    expect(sql).toMatch(
      /provider_rate_cache\.stored_at\s*<\s*excluded\.stored_at/,
    );
  });

  it("yazma gercek olduysa satir DONDURUR", () => {
    /*
     * Sıfır satır "daha eskiydi, yazılmadı" demektir. Dönüş olmasaydı
     * çağıran atlanan yazmayı başarılıdan ayıramazdı.
     */
    const sql = sqlBlock("WRITE_PROVIDER_RATE_CACHE");
    expect(sql).toMatch(/RETURNING\s+stored_at/);
  });

  it("zaman damgalari SQL'de de tam sayidir", () => {
    /*
     * `timestamptz` + dönüşüm kullanılsaydı SQL ile TypeScript sunucu saat
     * dilimine göre ayrışabilirdi. İki taraf da aynı tam sayıyı kullanır.
     */
    const sql = sqlBlock("WRITE_PROVIDER_RATE_CACHE");
    expect(sql).toContain("$3::bigint");
    expect(sql).toContain("$4::bigint");
  });
});

describe("gecis dosyasi kur onbellegi tablosunu tanimlar", () => {
  const migration = readFileSync(
    "migrations/0007_provider_rate_cache.sql",
    "utf8",
  );

  it("birincil anahtar SQL'in cakisma hedefiyle AYNIDIR", () => {
    /*
     * `ON CONFLICT (provider_key)` yalnızca bu sütun bir BENZERSİZLİK
     * kısıtıysa çalışır. Ayrışırlarsa deyim çalışma anında düşer ve bu
     * yalnızca üretimde görülürdü.
     */
    expect(migration).toMatch(/PRIMARY KEY \(provider_key\)/);
  });

  it("kur bicimi UYGULAMA SINIRIYLA ayni ifadedir", () => {
    /*
     * `canonicalizeProviderRate` ile kısıt ayrışırsa, uygulamanın kabul
     * ettiği bir değer veritabanınca reddedilir (ya da tersi) ve yazma
     * yalnızca üretimde düşer.
     */
    const pattern = "^(0|[1-9][0-9]*)\\.[0-9]{6}$";
    const coingecko = readFileSync("src/lib/rates/coingecko.ts", "utf8");
    expect(coingecko).toContain(pattern);
    expect(migration).toContain(pattern);
  });

  it("zaman damgalari POZITIFTIR", () => {
    expect(migration).toMatch(/CHECK \(observed_at > 0\)/);
    expect(migration).toMatch(/CHECK \(stored_at > 0\)/);
  });

  it("saglayici anahtari 0006 ile AYNI sekildedir", () => {
    /*
     * İki tablo aynı `COINGECKO_PROVIDER_KEY` değerini alır; şekil kısıtı
     * ayrışırsa biri kabul ettiğini öteki reddeder.
     */
    const budget = readFileSync(
      "migrations/0006_provider_call_budget.sql",
      "utf8",
    );
    const shape = "^[a-z0-9_-]{1,32}$";
    expect(budget).toContain(shape);
    expect(migration).toContain(shape);
  });

  it("TEMIZLIK GOREVI gerektirmez: satir eklenmez, yerine yazilir", () => {
    /*
     * 0005 ve 0006 zaman kovası başına satır biriktirdiği için saklama
     * temizliğine muhtaçtı. Burada sağlayıcı başına tek satır vardır; bir
     * gün sütunu eklenirse bu test düşer ve temizlik sorusu yeniden sorulur.
     */
    expect(migration).not.toMatch(/CREATE INDEX/);
    expect(migration).toMatch(/PRIMARY KEY \(provider_key\)/);
  });
});
