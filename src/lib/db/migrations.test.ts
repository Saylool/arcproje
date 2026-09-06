import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * GEÇİŞ DOSYALARININ NUMARALANDIRMASI.
 *
 * Bu depoda birden fazla dal art arda merge ediliyor. İki dal paralel
 * çalışıp ikisi de `0005_` eklerse, merge sırasında ÇAKIŞMA OLMAZ — iki
 * ayrı dosya sorunsuzca yan yana durur ve hangisinin önce uygulanacağı
 * belirsiz kalır. Git bunu yakalamaz, çünkü ortada metin çakışması yoktur.
 *
 * CI'da çalışan bir Postgres yok; geçişlerin UYGULANDIĞI burada
 * doğrulanamaz. Doğrulanabilen şey sıranın kendisidir.
 */

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

function migrationFiles(): string[] {
  return readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

describe("gecis dosyalari", () => {
  const files = migrationFiles();

  it("en az bir gecis vardir", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("hepsi NNNN_ad.sql bicimindedir", () => {
    const bad = files.filter((name) => !FILE_PATTERN.test(name));
    expect(bad).toEqual([]);
  });

  it("numaralar BENZERSIZDIR", () => {
    /*
     * Iki dalin ayni numarayi kullanmasi, merge'de sessizce gecer. Sira
     * belirsizlesir; birbirine bagli iki gecisten yanlis olani once
     * uygulanabilir.
     */
    const numbers = files.map((name) => name.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("numaralar 0001'den baslar ve BOSLUKSUZ ilerler", () => {
    /*
     * Bosluk, silinmis ya da hic eklenmemis bir gecis demektir; ikisi de
     * uygulanmis semanin dosyalardan turetilemedigi anlamina gelir.
     */
    const numbers = files.map((name) => Number(name.slice(0, 4)));
    expect(numbers).toEqual(
      Array.from({ length: numbers.length }, (_, index) => index + 1),
    );
  });

  it("hicbir gecis BOS degildir", () => {
    for (const name of files) {
      const sql = readFileSync(`migrations/${name}`, "utf8").trim();
      expect(sql.length, `${name} bos`).toBeGreaterThan(0);
    }
  });
});

/**
 * GEÇİŞLERİN BELGELENMESİ.
 *
 * Şema ELLE uygulanıyor: kurulumu yapan kişinin hangi dosyaları, hangi sırayla
 * çalıştıracağını README'den okuması gerekiyor. Bu, sessizce bozulan bir bağ —
 * yeni bir geçiş eklemek README'ye dokunmadan mümkün ve hiçbir şey şikâyet
 * etmez.
 *
 * ÖLÇÜLDÜ: tam olarak bu oldu. Diskte beş geçiş varken README yalnızca ikisinin
 * adını anıyordu ve kurulum komutu tek başına `0001`i uyguluyordu. README'yi
 * izleyerek kurulan bir veritabanında Google girişi, sahiplik, kayıtlı kişiler
 * ve analiz kotası tabloları HİÇ oluşmuyordu. Uygulama yine derleniyor,
 * testler yine geçiyordu; kırılma yalnızca çalışma anında görülüyordu.
 *
 * Bu yüzden bağ artık kapıda tutuluyor.
 */

const MIGRATION_IN_TEXT = /\d{4}_[a-z0-9_]+\.sql/g;

describe("gecisler README'de belgelenir", () => {
  const files = migrationFiles();
  const readme = readFileSync("README.md", "utf8");

  it("HER gecis dosyasi README'de anilir", () => {
    const missing = files.filter((name) => !readme.includes(name));
    expect(missing, "README'de anilmayan gecis").toEqual([]);
  });

  it("README var OLMAYAN bir gecisten soz etmez", () => {
    /*
     * Ters yon: bir gecis yeniden adlandirilir ya da silinirse, README'de
     * kalan eski ad kurulumu yapan kisiyi var olmayan bir dosyaya gonderir.
     */
    const named = new Set(readme.match(MIGRATION_IN_TEXT) ?? []);
    const present = new Set(files);
    const dangling = [...named].filter((name) => !present.has(name)).sort();
    expect(dangling, "README'de anilan ama diskte olmayan gecis").toEqual([]);
  });
});
