import { describe, expect, it } from "vitest";

import { isDatabaseConfigured, readDatabaseUrl } from "./env";

/**
 * Veritabani yapilandirmasinin okunmasi.
 *
 * Bu testler yalnizca VARLIK ve bicim davranisini dogrular; hicbir gercek
 * baglanti dizesi kullanilmaz veya yazdirilmaz.
 */

describe("DATABASE_URL varligi", () => {
  it("tanimsiz veya bos ise yapilandirilmamis sayilir", () => {
    for (const env of [{}, { DATABASE_URL: "" }, { DATABASE_URL: "   " }]) {
      expect(readDatabaseUrl(env), JSON.stringify(env)).toEqual({
        ok: false,
        problem: "missing",
      });
      expect(isDatabaseConfigured(env), JSON.stringify(env)).toBe(false);
    }
  });

  it("dolu ise yapilandirilmis sayilir ve kirpma uygulanir", () => {
    const env = { DATABASE_URL: "  postgres://kullanici@ornek.test/db  " };
    const result = readDatabaseUrl(env);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toBe("postgres://kullanici@ornek.test/db");
    expect(isDatabaseConfigured(env)).toBe(true);
  });

  it("problem tipi baglanti dizesini TASIMAZ", () => {
    const result = readDatabaseUrl({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Yalnizca "missing"; deger veya ipucu yok.
    expect(result.problem).toBe("missing");
    expect(Object.keys(result).sort()).toEqual(["ok", "problem"]);
  });

  it("NEXT_PUBLIC_ onekli bir degisken KULLANILMAZ", () => {
    // Sunucu sirri istemci paketine giremez.
    expect(isDatabaseConfigured({ NEXT_PUBLIC_DATABASE_URL: "x" })).toBe(false);
  });
});
