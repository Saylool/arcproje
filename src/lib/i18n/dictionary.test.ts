import { describe, expect, it } from "vitest";

import { en } from "./en";
import {
  dictionaryFor,
  flattenKeys,
  interpolate,
  splitTemplate,
  translate,
  translatePlural,
  type TranslationKey,
} from "./dictionary";
import { LOCALES } from "./locale";
import { tr } from "./tr";

/**
 * SÖZLÜK VE ÇEVİRİ MOTORU.
 *
 * Anahtar eşliği DERLEME zamanında da zorunludur (`en.ts` `Dictionary` tipiyle
 * bildirilir), burada ayrıca ÇALIŞMA zamanında kanıtlanır: tip bir gün
 * gevşetilirse bu testler düşer.
 */

describe("anahtar eşliği", () => {
  it("iki dil BİREBİR aynı anahtar kümesine sahiptir", () => {
    const turkish = flattenKeys(tr).sort();
    const english = flattenKeys(en).sort();

    expect(english).toEqual(turkish);
    expect(turkish.length).toBeGreaterThan(300);
  });

  it("İngilizcede eksik anahtar yoktur", () => {
    const missing = flattenKeys(tr).filter(
      (key) => !flattenKeys(en).includes(key),
    );
    expect(missing).toEqual([]);
  });

  it("İngilizcede FAZLADAN anahtar yoktur", () => {
    const extra = flattenKeys(en).filter(
      (key) => !flattenKeys(tr).includes(key),
    );
    expect(extra).toEqual([]);
  });

  it("hiçbir metin boş değildir", () => {
    for (const locale of LOCALES) {
      const dictionary = dictionaryFor(locale);
      for (const key of flattenKeys(dictionary)) {
        /*
         * Tek istisna: İngilizcede borç satırının tutardan sonraki eki yoktur
         * ("Ali owes Ayşe" cümlesi kendi başına tamdır). Boş olduğunda
         * arayüz o parçayı hiç basmaz.
         */
        if (key === "debts.owesSuffix") {
          continue;
        }
        const value = translate(locale, key as TranslationKey);
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
      }
    }
  });

  it("Türkçe metinler hiçbir yerde İngilizceyle AYNI bırakılmamıştır", () => {
    /*
     * Marka adı, jeton kodu, sağlayıcı adı ve dil adları gibi ÇEVRİLMEYEN
     * değerler dışında iki dilin metni farklı olmalıdır. Aynı kalan bir
     * metin, çevrilmeyi unutulmuş bir kayıt işaretidir.
     */
    const allowedIdentical = new Set([
      "language.tr",
      "language.en",
      "common.dash",
      "common.faucet",
      "sharedPay.rateSourceName",
      "request.coingeckoAttribution",
      "common.addressPlaceholder",
      "sharedPay.notOnArcNetwork",
      "editor.itemNamePlaceholder",
    ]);
    const suspicious = flattenKeys(tr).filter((key) => {
      if (allowedIdentical.has(key)) return false;
      const turkish = translate("tr", key as TranslationKey);
      const english = translate("en", key as TranslationKey);
      return turkish === english && turkish.trim() !== "";
    });
    expect(suspicious).toEqual([]);
  });
});

describe("değişken yerleştirme GÜVENLİDİR", () => {
  it("yer tutucuyu değerle değiştirir", () => {
    expect(interpolate("Merhaba {name}!", { name: "Ayşe" })).toBe(
      "Merhaba Ayşe!",
    );
    expect(interpolate("{a} + {b}", { a: 1, b: 2 })).toBe("1 + 2");
  });

  it("İŞARETLEME ÜRETMEZ: değer düz metin olarak konur", () => {
    const injected = interpolate("Merhaba {name}.", {
      name: "<script>alert(1)</script>",
    });
    // Metin AYNEN korunur; ayrıştırılmaz, çalıştırılmaz, kaçış eklenmez.
    expect(injected).toBe("Merhaba <script>alert(1)</script>.");
    // React bu metni metin düğümü olarak basar; etiket olarak yorumlanmaz.
    expect(injected).not.toContain("&lt;");
  });

  it("yerine konan metin YENİDEN TARANMAZ", () => {
    // İçinde yer tutucu geçen bir değer ikinci bir değişime yol açmaz.
    expect(interpolate("{a}{b}", { a: "{b}", b: "X" })).toBe("{b}X");
    // `$&` gibi değiştirme dizileri yorumlanmaz.
    expect(interpolate("{a}", { a: "$&$1$`" })).toBe("$&$1$`");
  });

  it("karşılığı olmayan yer tutucu GÖRÜNÜR kalır", () => {
    expect(interpolate("Merhaba {name}!", {})).toBe("Merhaba {name}!");
    expect(interpolate("Merhaba {name}!")).toBe("Merhaba {name}!");
  });

  it("gerçek bir anahtarla çalışır", () => {
    expect(translate("tr", "upload.previewAlt", { name: "fis.jpg" })).toContain(
      "fis.jpg",
    );
    expect(translate("en", "upload.previewAlt", { name: "fis.jpg" })).toContain(
      "fis.jpg",
    );
  });

  it("sözlükteki hiçbir metin HTML etiketi içermez", () => {
    for (const locale of LOCALES) {
      const dictionary = dictionaryFor(locale);
      for (const key of flattenKeys(dictionary)) {
        const value = translate(locale, key as TranslationKey);
        expect(value, `${locale}:${key}`).not.toMatch(/<[a-zA-Z/][^>]*>/);
      }
    }
  });
});

describe("bilinmeyen anahtar", () => {
  it("İSTİSNA FIRLATMAZ", () => {
    expect(() =>
      translate("tr", "boyle.bir.anahtar.yok" as TranslationKey),
    ).not.toThrow();
  });

  it("anahtarın kendisini döner; ham sunucu metni sızmaz", () => {
    expect(translate("en", "boyle.bir.anahtar.yok" as TranslationKey)).toBe(
      "boyle.bir.anahtar.yok",
    );
    expect(translate("en", "app" as TranslationKey)).toBe("app");
  });

  it("dilinde eksik olan bir anahtar TÜRKÇEYE düşer", () => {
    /*
     * Tip sistemi bunu engeller; yine de bir gün eksik kalırsa kullanıcı boş
     * ekran değil Türkçe metin görür.
     */
    const partial = { app: { name: "Only Turkish" } } as never;
    expect(flattenKeys(partial)).toEqual(["app.name"]);
  });
});

describe("çoğul biçimler", () => {
  it("İngilizcede tekil ve çoğul AYRILIR", () => {
    expect(translatePlural("en", "sharedBetween", 1)).toContain("1 participant.");
    expect(translatePlural("en", "sharedBetween", 3)).toContain("3 participants");
    expect(translatePlural("en", "itemsUnassigned", 1)).toContain("1 item is");
    expect(translatePlural("en", "itemsUnassigned", 4)).toContain("4 items are");
  });

  it("Türkçede ad tekil kalır", () => {
    expect(translatePlural("tr", "itemsUnassigned", 1)).toContain("1 ürün");
    expect(translatePlural("tr", "itemsUnassigned", 4)).toContain("4 ürün");
  });

  it("sıfır 'other' biçimini kullanır", () => {
    expect(translatePlural("en", "sharedBetween", 0)).toContain("0 participants");
  });

  it("{count} her zaman doldurulur", () => {
    for (const locale of LOCALES) {
      expect(translatePlural(locale, "needParticipants", 2)).not.toContain(
        "{count}",
      );
    }
  });
});

describe("şablon parçalama (cümle içine düğüm koyma)", () => {
  it("metin ve yuvaları sırayla ayırır", () => {
    expect(splitTemplate("{from} owes {to}")).toEqual([
      { kind: "slot", name: "from" },
      { kind: "text", value: " owes " },
      { kind: "slot", name: "to" },
    ]);
  });

  it("yuvasız şablon tek parçadır", () => {
    expect(splitTemplate("düz metin")).toEqual([
      { kind: "text", value: "düz metin" },
    ]);
  });

  it("boş şablon boş liste verir", () => {
    expect(splitTemplate("")).toEqual([]);
  });

  it("ARDIŞIK çağrılarda durum taşımaz", () => {
    const template = "{a} ve {b}";
    const first = splitTemplate(template);
    expect(splitTemplate(template)).toEqual(first);
    expect(splitTemplate(template)).toEqual(first);
  });

  it("metin parçaları İŞARETLEME olarak yorumlanmaz", () => {
    // Şablon metni olduğu gibi taşınır; ayrıştırma yapılmaz.
    expect(splitTemplate("a <b>x</b> {y}")).toEqual([
      { kind: "text", value: "a <b>x</b> " },
      { kind: "slot", name: "y" },
    ]);
  });
});
