import { describe, expect, it } from "vitest";

import { dropStaleLinks } from "./linked-addresses";
import type { Participant } from "./participants";

/**
 * BAGLANAN ADRESLERIN OMRU.
 *
 * Eslestirme isimle yapilir ama bag bir ADRESE, yani paranin gidecegi yere
 * isaret eder. Isim degisirse bag ANLAMINI kaybeder ve dusmelidir; yoksa
 * odeme adimi "ayse" satirinda "bugra"nin adresini gosterirdi.
 */

const person = (id: string, name: string): Participant =>
  ({ id, name }) as Participant;

const ADA = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const BORA = "0x00000000000000000000000000000000000000De";

describe("bag KORUNUR", () => {
  it("hicbir sey degismediyse ayni nesne doner", () => {
    const before = [person("1", "Ada"), person("2", "Bora")];
    const links = { "1": ADA, "2": BORA };
    expect(dropStaleLinks(links, before, before)).toBe(links);
  });

  it("BASKA bir kisinin adi degistiyse bag korunur", () => {
    const before = [person("1", "Ada"), person("2", "Bora")];
    const after = [person("1", "Ada"), person("2", "Bora Y")];
    const result = dropStaleLinks({ "1": ADA, "2": BORA }, before, after);
    expect(result["1"]).toBe(ADA);
    expect(result["2"]).toBeUndefined();
  });

  it("yeni kisi eklenmesi mevcut baglari etkilemez", () => {
    const before = [person("1", "Ada")];
    const after = [person("1", "Ada"), person("2", "Bora")];
    expect(dropStaleLinks({ "1": ADA }, before, after)["1"]).toBe(ADA);
  });
});

describe("bag DUSER", () => {
  it("kisinin adi degistiyse", () => {
    const before = [person("1", "Bugra")];
    const after = [person("1", "Ayse")];
    expect(dropStaleLinks({ "1": ADA }, before, after)).toEqual({});
  });

  it("adin yalnizca buyuk/kucuk harfi degisse bile", () => {
    /*
     * "bugra" ile "Bugra" ayni kisi OLABILIR ama emin olamayiz. Yanlis adrese
     * giden transfer geri alinamadigi icin kapali tarafa dusulur; kullanici
     * yeniden secer.
     */
    const before = [person("1", "bugra")];
    const after = [person("1", "Bugra")];
    expect(dropStaleLinks({ "1": ADA }, before, after)).toEqual({});
  });

  it("kisi silindiyse", () => {
    const before = [person("1", "Ada"), person("2", "Bora")];
    const after = [person("2", "Bora")];
    const result = dropStaleLinks({ "1": ADA, "2": BORA }, before, after);
    expect(result["1"]).toBeUndefined();
    expect(result["2"]).toBe(BORA);
  });

  it("herkes silindiyse hicbir bag kalmaz", () => {
    const before = [person("1", "Ada"), person("2", "Bora")];
    expect(dropStaleLinks({ "1": ADA, "2": BORA }, before, [])).toEqual({});
  });
});

describe("sinir durumlari", () => {
  it("bos bag kumesi sorun cikarmaz", () => {
    expect(dropStaleLinks({}, [person("1", "Ada")], [])).toEqual({});
  });

  it("bagi olmayan kisinin adi degisse de patlamaz", () => {
    const before = [person("1", "Ada"), person("2", "Bora")];
    const after = [person("1", "Ada"), person("2", "Bora Y")];
    expect(dropStaleLinks({ "1": ADA }, before, after)).toEqual({ "1": ADA });
  });
});
