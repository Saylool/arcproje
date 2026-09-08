import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * FONKSİYONLAR VERİTABANIYLA AYNI BÖLGEDE ÇALIŞIR.
 *
 * Neon veritabanı **Frankfurt**tadır (`eu-central-1`). Vercel fonksiyonları
 * ise `regions` verilmediğinde `iad1`e (Washington) düşer — belgelenmiş
 * varsayılan budur. O hâlde her SQL gidiş-dönüşü Atlantik'i geçer.
 *
 * ÖLÇÜ: ödeme hazırlama yolunda 5-7 ARDIŞIK veritabanı gidiş-dönüşü var
 * (oturum okuma, paylaşılan kur önbelleği, teklif yazma, fırsatçı temizlik).
 * Kıtalar arası her gidiş-dönüş ~90 ms, aynı bölgede birkaç ms. Yani yalnızca
 * ağ beklemesi yarım saniyeye yakın bir farktır ve bu, kullanıcı cüzdanı
 * açmayı beklerken yaşanır.
 *
 * `fra1` aynı zamanda kullanıcılara da yakındır (Türkiye), bu yüzden kazanç
 * iki yönlüdür: hem fonksiyon↔veritabanı hem kullanıcı↔fonksiyon.
 *
 * SINIR — BU TEST NEYİ KANITLAMAZ: veritabanının GERÇEKTEN Frankfurt'ta
 * olduğunu doğrulayamaz; o bilgi `DATABASE_URL` içindedir ve bu depoda
 * OKUNMAZ. Burada ölçülen şey NİYETİN yazılı ve sabit kalmasıdır. İki taraf
 * ayrışırsa (veritabanı taşınır, bölge değişmez) bunu ancak üretimdeki
 * gecikme söyler — bu yüzden Neon bölgesi README'ye de yazılmıştır.
 */

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  regions?: unknown;
  functions?: Record<string, { regions?: unknown }>;
};

/** Neon'un Frankfurt bölgesiyle eşleşen Vercel bölge kodu. */
const DATABASE_REGION = "fra1";

describe("fonksiyon bolgesi", () => {
  it("ACIKCA tanimlidir", () => {
    /*
     * Alan hiç yoksa Vercel `iad1` kullanır ve bunu hiçbir yerde
     * söylemez: yapılandırma eksikliği sessizce en kötü seçeneği verir.
     */
    expect(config.regions).toBeDefined();
  });

  it("veritabaniyla AYNI bolgedir", () => {
    expect(config.regions).toEqual([DATABASE_REGION]);
  });

  it("TEK bolgedir", () => {
    /*
     * İki gerekçe. Birincisi plan: Hobby yalnızca TEK bölge seçtirir, ikinci
     * girdi dağıtımı düşürür. İkincisi amaç: ikinci bir bölge, o bölgedeki
     * fonksiyonları veritabanından uzağa koyar — düzeltilen sorunun aynısını
     * geri getirir.
     */
    expect(Array.isArray(config.regions) && config.regions.length).toBe(1);
  });

  it("hicbir fonksiyon bolgeyi TEK BASINA degistirmez", () => {
    /*
     * `functions` altında bölge geçersiz kılınabilir. Bugün böyle bir girdi
     * yok; bir gün eklenirse veritabanından uzaklaşmadığı burada görülsün.
     */
    for (const [pattern, options] of Object.entries(config.functions ?? {})) {
      if (options.regions !== undefined) {
        expect(options.regions, pattern).toEqual([DATABASE_REGION]);
      }
    }
  });
});

describe("bolge secimi BELGELENIR", () => {
  const readme = readFileSync("README.md", "utf8");

  it("README bolge kodunu ve veritabaninin yerini soyler", () => {
    /*
     * Bölge kodu tek başına anlamsızdır: `fra1`in neden doğru olduğunu
     * yalnızca veritabanının nerede olduğu açıklar. İkisi ayrı yerlerde
     * dururken biri değişirse, ötekinin yanlış olduğu görülmez.
     */
    expect(readme).toContain(DATABASE_REGION);
    expect(readme.toLowerCase()).toContain("frankfurt");
  });
});
