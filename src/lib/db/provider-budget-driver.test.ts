import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";

/**
 * SAĞLAYICI ÇAĞRI BÜTÇESİ — sürücü davranışı ve SQL eşleşmesi.
 *
 * İki uygulama vardır: üretimdeki Neon SQL'i ve testlerin kullandığı bellek
 * içi sahte depo. İkisi AYNI kuralı uygulamak zorundadır; aksi hâlde testler
 * yeşil kalırken üretim farklı davranır.
 *
 * SINIR: bu depoda çalışan bir Postgres YOKTUR, bu yüzden SQL burada
 * ÇALIŞTIRILAMAZ. Aşağıdaki eşleşme testleri SQL METNİNİN doğru semantiği
 * kodladığını ölçer; gerçek yürütme doğrulaması geçiş uygulandıktan sonra
 * yapılır.
 */

const WINDOW = 28_333_333;

function repo() {
  return createFakeSharedBillRepository();
}

describe("butce ayirma: surucu davranisi", () => {
  it("sinira kadar ayirir, sonra TUKENIR", async () => {
    const repository = repo();
    const reserve = () =>
      repository.reserveProviderCall({
        providerKey: "coingecko",
        windowStart: WINDOW,
        limit: 2,
      });

    expect(await reserve()).toEqual({ ok: true, used: 1 });
    expect(await reserve()).toEqual({ ok: true, used: 2 });
    expect(await reserve()).toEqual({ ok: false, reason: "exhausted" });
  });

  it("tukendikten sonra sayac ARTMAZ", async () => {
    /*
     * Reddedilen istek sayacı artırsaydı, dolu bir pencere kendini
     * sonsuza kadar besler ve sayaç anlamını yitirirdi.
     */
    const repository = repo();
    const input = {
      providerKey: "coingecko",
      windowStart: WINDOW,
      limit: 1,
    };
    await repository.reserveProviderCall(input);
    await repository.reserveProviderCall(input);
    await repository.reserveProviderCall(input);

    /* Pencere ilerleyince yeniden 1'den başlamalı. */
    const next = await repository.reserveProviderCall({
      ...input,
      windowStart: WINDOW + 1,
    });
    expect(next).toEqual({ ok: true, used: 1 });
  });

  it("PENCERELER birbirinden yalitiktir", async () => {
    const repository = repo();
    const base = {
      providerKey: "coingecko",
      limit: 1,
    };
    expect(
      await repository.reserveProviderCall({ ...base, windowStart: WINDOW }),
    ).toEqual({ ok: true, used: 1 });
    expect(
      await repository.reserveProviderCall({ ...base, windowStart: WINDOW + 1 }),
    ).toEqual({ ok: true, used: 1 });
  });

  it("SAGLAYICILAR birbirinden yalitiktir", async () => {
    const repository = repo();
    const base = { windowStart: WINDOW, limit: 1 };
    expect(
      await repository.reserveProviderCall({ ...base, providerKey: "coingecko" }),
    ).toEqual({ ok: true, used: 1 });
    expect(
      await repository.reserveProviderCall({ ...base, providerKey: "other" }),
    ).toEqual({ ok: true, used: 1 });
  });

  it("sinir 1'den kucukse HICBIR cagri ayrilamaz", async () => {
    /*
     * Sınır sıfırsa ilk satır da yazılmamalı. SQL'de bu, `ON CONFLICT`
     * dalının hiç devreye girmediği İLK ekleme için ayrı bir koşul ister.
     */
    const repository = repo();
    expect(
      await repository.reserveProviderCall({
        providerKey: "coingecko",
        windowStart: WINDOW,
        limit: 0,
      }),
    ).toEqual({ ok: false, reason: "exhausted" });
  });

  it("depo erisilemezse TUKENDI demez", async () => {
    /*
     * İkisi karıştırılırsa çağıran yanlış davranır: tükendiğinde beklenir,
     * erişilemediğinde süreç içi korumaya düşülür.
     */
    const repository = repo();
    repository.controls.failWithUnavailable = true;
    expect(
      await repository.reserveProviderCall({
        providerKey: "coingecko",
        windowStart: WINDOW,
        limit: 4,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("butce ayirma: SQL ile bellek ici depo AYNI davranmali", () => {
  const neon = readFileSync("src/lib/db/neon-shared-bill-repository.ts", "utf8");

  function reserveSql(): string {
    const start = neon.indexOf("const RESERVE_PROVIDER_CALL = `");
    const end = neon.indexOf("`;", start);
    expect(start).toBeGreaterThan(-1);
    return neon.slice(start, end);
  }

  it("TEK deyimdir: oku-sonra-yaz yaris acardi", () => {
    /*
     * Eşzamanlı iki örnek `used` değerini ayrı okursa ikisi de "yer var"
     * der ve sınır sessizce aşılır. Atomiklik `ON CONFLICT` ile tek
     * deyimde sağlanmalı.
     */
    const sql = reserveSql();
    expect(sql).toContain("ON CONFLICT (provider_key, window_start) DO UPDATE");
    expect(sql).not.toMatch(/\bBEGIN\b/);
  });

  it("yalnizca sinirin ALTINDA artirir", () => {
    const sql = reserveSql();
    expect(sql).toMatch(/WHERE\s+provider_call_budget\.used\s*<\s*\$3/);
  });

  it("artirma MEVCUT degerin uzerinden yapilir", () => {
    /*
     * `EXCLUDED.used` yazılsaydı sayaç her çakışmada 1'e sabitlenirdi:
     * pencere hiç dolmaz ve sınır hiç uygulanmazdı.
     */
    const sql = reserveSql();
    expect(sql).toMatch(/SET\s+used\s*=\s*provider_call_budget\.used\s*\+\s*1/);
    expect(sql).not.toContain("EXCLUDED");
  });

  it("ILK ekleme de sinira tabidir", () => {
    /*
     * `ON CONFLICT` yalnızca ÇAKIŞMADA çalışır. Sınır 1'den küçükken ilk
     * satır çakışmadan yazılırdı; bu yüzden ekleme dalının kendi koşulu
     * olmalı.
     */
    const sql = reserveSql();
    expect(sql).toMatch(/WHERE\s+\$3::int\s*>=\s*1/);
  });

  it("yeni degeri DONDURUR; sifir satir tukendi demektir", () => {
    const sql = reserveSql();
    expect(sql).toMatch(/RETURNING\s+used/);
  });

  it("kova SQL'de de tam sayidir", () => {
    /*
     * `date_trunc` kullanılsaydı SQL ile TypeScript sunucu saat dilimine
     * göre ayrışabilirdi. İki taraf da aynı tam sayı kovayı kullanır.
     */
    const sql = reserveSql();
    expect(sql).toContain("$2::bigint");
  });
});

describe("gecis dosyasi butce tablosunu tanimlar", () => {
  const migration = readFileSync(
    "migrations/0006_provider_call_budget.sql",
    "utf8",
  );

  it("birincil anahtar SQL'in cakisma hedefiyle AYNIDIR", () => {
    /*
     * `ON CONFLICT (provider_key, window_start)` yalnızca bu ikili bir
     * BENZERSİZLİK kısıtıysa çalışır. Ayrışırlarsa deyim çalışma anında
     * düşer ve bu yalnızca üretimde görülürdü.
     */
    expect(migration).toMatch(
      /PRIMARY KEY \(provider_key,\s*window_start\)/,
    );
  });

  it("sayac negatif olamaz", () => {
    expect(migration).toMatch(/CHECK \(used >= 0\)/);
  });

  it("saglayici anahtarinin sekli kisitlanmistir", () => {
    expect(migration).toContain("provider_key ~ '^[a-z0-9_-]{1,32}$'");
  });
});
