import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * TESTLERİN TOPLANDIĞI KAPI KORUNUR.
 *
 * Bir test dosyasının SESSİZCE ATLANMASI, kapıyı zayıflatan ama hiçbir testi
 * kırmayan bir değişikliktir — `workflow.test.ts`'in CI adımları için
 * kapattığı boşluğun aynısı, bu kez toplama kalıbında.
 *
 * ÖLÇÜLDÜ: kalıp yalnızca `src/**\/*.test.ts` iken, içinde
 * `expect(1).toBe(2)` olan bir `.test.tsx` dosyası diskte dururken
 * `npm test` "105 passed / 2100 passed" diyordu. Hata yok, uyarı yok,
 * "atlandı" bile yok. Dosya hiç görülmemişti.
 *
 * Bu, bir bileşen testi yazan kişinin testinin çalıştığını sanmasına yol
 * açar. Sessizce atlanan bir test, olmayan bir testten daha kötüdür:
 * olmayanın yokluğu görülür, atlananınki görülmez.
 *
 * SINIR: buradaki testler KALIBI ölçer, vitest'in gerçekten ne topladığını
 * değil. Kalıbın kendisi tek başına toplama davranışını belirlediği için bu
 * yeterlidir; ama kalıp dışında bir konuma test konursa (ör. `src/` dışı)
 * bu testler onu göremez.
 */

const config = readFileSync("vitest.config.mts", "utf8");

/** `include: [...]` dizisinin ham metni. */
function includeBlock(): string {
  const start = config.indexOf("include:");
  expect(start).toBeGreaterThan(-1);
  const end = config.indexOf("]", start);
  expect(end).toBeGreaterThan(start);
  return config.slice(start, end + 1);
}

describe("toplama kalibi", () => {
  it("`.ts` VE `.tsx` testlerini toplar", () => {
    const include = includeBlock();
    expect(include).toContain("ts");
    expect(include).toContain("tsx");
  });

  it("yalnizca `.test.ts` ile DARALTILMAMISTIR", () => {
    /*
     * Gerileme tam olarak bu şekli alır: kalıp `.test.ts`e geri çekilir,
     * her şey yeşil kalır ve `.tsx` testleri görünmez olur.
     */
    const include = includeBlock();
    expect(include).not.toMatch(/["']src\/\*\*\/\*\.test\.ts["']/);
  });

  it("`src` altini tarar", () => {
    expect(includeBlock()).toContain("src/");
  });
});

describe("diskteki test dosyalari kalibin ICINDE kalir", () => {
  /**
   * Kalıp doğru olsa bile, kapsanmayan bir KONUMA konan test sessizce
   * atlanır. Bu test, kalıbın taradığı kök dışında test dosyası
   * bırakılmadığını ölçer.
   */
  function testFilesOutside(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      /*
       * Kök "." iken `./src/...` üretilirdi ve `startsWith("src/")` hiçbir
       * zaman tutmazdı: test her dosyayı "dışarıda" sanardı.
       */
      const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        testFilesOutside(path, found);
      } else if (/\.test\.(ts|tsx)$/.test(entry.name) && !path.startsWith("src/")) {
        found.push(path);
      }
    }
    return found;
  }

  it("`src` disinda toplanmayan test dosyasi YOKTUR", () => {
    expect(testFilesOutside(".")).toEqual([]);
  });
});
