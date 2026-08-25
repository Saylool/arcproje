import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  isLocale,
  localeFromAcceptLanguage,
  parseAcceptLanguage,
  readLocaleCookie,
  resolveLocale,
  serializeLocaleCookie,
  toAppLocale,
  toIntlLocale,
} from "./locale";

/**
 * DİL ÇÖZÜMLEME.
 *
 * Bu testler tarayıcısız ve sunucusuzdur: `resolveLocale` saf olduğu için
 * sunucunun (istek başlıkları) ve istemcinin (belge çerezi) AYNI sonuca
 * varması burada kanıtlanır.
 */

describe("dil etiketi eşleme", () => {
  it("uygulama dillerini tanır", () => {
    expect(toAppLocale("tr")).toBe("tr");
    expect(toAppLocale("en")).toBe("en");
  });

  it("BÖLGESEL varyantları taban dile indirger", () => {
    for (const tag of ["tr-TR", "TR-tr", "tr-Latn-TR"]) {
      expect(toAppLocale(tag), tag).toBe("tr");
    }
    for (const tag of ["en-US", "en-GB", "EN-us", "en-Latn-US"]) {
      expect(toAppLocale(tag), tag).toBe("en");
    }
  });

  it("desteklenmeyen dil ve bozuk girdi için eşleşme yoktur", () => {
    for (const tag of ["de", "fr-FR", "", "  ", "*", 42, null, undefined, {}]) {
      expect(toAppLocale(tag), String(tag)).toBeNull();
    }
  });

  it("yalnızca iki değer geçerlidir", () => {
    expect(isLocale("tr")).toBe(true);
    expect(isLocale("en")).toBe(true);
    for (const value of ["TR", "en-US", "", "de", null, 1, {}]) {
      expect(isLocale(value), String(value)).toBe(false);
    }
  });

  it("Intl karşılığı bölge taşır", () => {
    expect(toIntlLocale("tr")).toBe("tr-TR");
    expect(toIntlLocale("en")).toBe("en-US");
  });
});

describe("Accept-Language ayrıştırma", () => {
  it("AĞIRLIĞA göre sıralar", () => {
    expect(parseAcceptLanguage("de;q=0.5, en;q=0.9, tr;q=0.7")).toEqual([
      "en",
      "tr",
      "de",
    ]);
  });

  it("eşit ağırlıkta ÖZGÜN SIRAYI korur (kararlı sıralama)", () => {
    expect(parseAcceptLanguage("tr, en")).toEqual(["tr", "en"]);
    expect(parseAcceptLanguage("en, tr")).toEqual(["en", "tr"]);
    expect(parseAcceptLanguage("en;q=0.8, tr;q=0.8")).toEqual(["en", "tr"]);
  });

  it("ağırlıksız etiket 1 sayılır ve ağırlıklıyı yener", () => {
    expect(parseAcceptLanguage("tr;q=0.4, en")).toEqual(["en", "tr"]);
  });

  it("q=0 istenmiyor demektir ve elenir", () => {
    expect(parseAcceptLanguage("en;q=0, tr;q=0.5")).toEqual(["tr"]);
  });

  it("BOZUK girdiyi atar, istisna fırlatmaz", () => {
    expect(parseAcceptLanguage(";;;")).toEqual([]);
    expect(parseAcceptLanguage(",,,")).toEqual([]);
    expect(parseAcceptLanguage("*")).toEqual([]);
    expect(parseAcceptLanguage("en;q=abc, tr")).toEqual(["en", "tr"]);
    expect(parseAcceptLanguage("en;q=9, tr;q=0.1")).toEqual(["en", "tr"]);
    expect(parseAcceptLanguage("<script>, tr")).toEqual(["tr"]);
    // Denetim karakteri taşıyan etiket geçerli bir dil etiketi değildir.
    expect(parseAcceptLanguage("tr\u0000, en")).toEqual(["en"]);
  });

  it("metin olmayan ve boş başlık boş liste verir", () => {
    for (const header of ["", null, undefined, 42, {}, []]) {
      expect(parseAcceptLanguage(header), String(header)).toEqual([]);
    }
  });

  it("BELİRLENİMCİDİR: aynı başlık her zaman aynı sonucu verir", () => {
    const header = "fr;q=0.9, en-GB;q=0.8, tr-TR;q=0.8, de";
    const first = parseAcceptLanguage(header);
    for (let index = 0; index < 5; index += 1) {
      expect(parseAcceptLanguage(header)).toEqual(first);
    }
  });

  it("çok uzun başlık sınırlanır ama düşmez", () => {
    const header = `${"de,".repeat(500)}en`;
    expect(() => parseAcceptLanguage(header)).not.toThrow();
    expect(localeFromAcceptLanguage(header)).toBeNull();
  });

  it("desteklenen İLK dili seçer, desteklenmeyeni atlar", () => {
    expect(localeFromAcceptLanguage("de, en;q=0.9, tr;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("de-DE, fr;q=0.9")).toBeNull();
    expect(localeFromAcceptLanguage("en-GB,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("tr-TR,tr;q=0.9,en-US;q=0.8")).toBe("tr");
  });
});

describe("tercih çerezi", () => {
  it("Path, SameSite ve bir yıllık ömür yazar", () => {
    const cookie = serializeLocaleCookie("en");
    expect(cookie).toContain(`${LOCALE_COOKIE_NAME}=en`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`);
    expect(LOCALE_COOKIE_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 365);
    // Hassas veri taşımadığı için HttpOnly kullanılmaz; istemci de yazar.
    expect(cookie).not.toContain("HttpOnly");
  });

  it("ham Cookie başlığından okur", () => {
    expect(readLocaleCookie(`${LOCALE_COOKIE_NAME}=en`)).toBe("en");
    expect(readLocaleCookie(`a=1; ${LOCALE_COOKIE_NAME}=tr; b=2`)).toBe("tr");
    expect(readLocaleCookie(` ${LOCALE_COOKIE_NAME} = en `)).toBe("en");
  });

  it("GEÇERSİZ değer ve bozuk başlık 'tercih yok' demektir", () => {
    for (const header of [
      `${LOCALE_COOKIE_NAME}=de`,
      `${LOCALE_COOKIE_NAME}=`,
      `${LOCALE_COOKIE_NAME}=EN`,
      "hb_locale2=en",
      "garbage",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(readLocaleCookie(header), String(header)).toBeNull();
    }
  });
});

describe("öncelik sırası", () => {
  it("GEÇERLİ çerez her şeyi yener", () => {
    expect(resolveLocale({ cookie: "en", acceptLanguage: "tr-TR" })).toBe("en");
    expect(resolveLocale({ cookie: "tr", acceptLanguage: "en-US,en;q=0.9" })).toBe(
      "tr",
    );
  });

  it("çerez yoksa tarayıcı tercihine bakar", () => {
    expect(resolveLocale({ acceptLanguage: "en-GB,en;q=0.9" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "tr-TR,tr;q=0.9" })).toBe("tr");
  });

  it("GEÇERSİZ çerez çerez yokmuş gibi davranır", () => {
    for (const cookie of ["de", "", "EN", null, undefined, 7, {}]) {
      expect(
        resolveLocale({ cookie, acceptLanguage: "en-US" }),
        String(cookie),
      ).toBe("en");
    }
  });

  it("hiçbir sinyal yoksa TÜRKÇEYE düşer", () => {
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({ cookie: null, acceptLanguage: null })).toBe("tr");
    expect(resolveLocale({ acceptLanguage: "de-DE,fr;q=0.9" })).toBe("tr");
    expect(resolveLocale({ acceptLanguage: ";;;" })).toBe("tr");
    expect(DEFAULT_LOCALE).toBe("tr");
  });

  it("SUNUCU ve İSTEMCİ aynı fonksiyonu kullanır: sonuç ayrışamaz", () => {
    /*
     * Sunucu çerezi başlıktan, istemci `document.cookie`den okur; ikisi de
     * AYNI saf fonksiyona verir. Aynı girdi -> aynı dil.
     */
    const cookieHeader = "theme=dark; hb_locale=en";
    const acceptLanguage = "tr-TR,tr;q=0.9";

    const server = resolveLocale({
      cookie: readLocaleCookie(cookieHeader),
      acceptLanguage,
    });
    const client = resolveLocale({
      cookie: readLocaleCookie(cookieHeader),
      acceptLanguage,
    });
    expect(server).toBe(client);
    expect(server).toBe("en");
  });
});
