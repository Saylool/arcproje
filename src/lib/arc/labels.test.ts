import { describe, expect, it } from "vitest";

import {
  prepareLabel,
  toCanonicalLabel,
  validateCanonicalLabel,
} from "./labels";

/**
 * Görünmez karakterler kaynağa doğrudan yazılmaz, kod noktasından kurulur:
 * bir testin neyi denediği gözle okunabilmelidir.
 */
const MAX = 40;

const at = (codePoint: number) => String.fromCodePoint(codePoint);

const ZERO_WIDTH_SPACE = at(0x200b);
const ZERO_WIDTH_NON_JOINER = at(0x200c);
const ZERO_WIDTH_JOINER = at(0x200d);
const WORD_JOINER = at(0x2060);
const BYTE_ORDER_MARK = at(0xfeff);

const RTL_OVERRIDE = at(0x202e);
const LTR_OVERRIDE = at(0x202d);
const LTR_EMBEDDING = at(0x202a);
const FIRST_STRONG_ISOLATE = at(0x2068);
const POP_ISOLATE = at(0x2069);
const RTL_MARK = at(0x200f);

const NULL_CHAR = at(0x0000);
const UNIT_SEPARATOR = at(0x001f);
const DELETE_CHAR = at(0x007f);
const C1_PADDING = at(0x0080);
const TAB = at(0x0009);
const NEWLINE = at(0x000a);

const NBSP = at(0x00a0);
const IDEOGRAPHIC_SPACE = at(0x3000);

/** Birleşen çift nokta ve çengel: "ü" ve "ş" harflerinin ayrık yazımı. */
const COMBINING_DIAERESIS = at(0x0308);
const COMBINING_CEDILLA = at(0x0327);

const DECOMPOSED = `G${"u"}${COMBINING_DIAERESIS}l${"s"}${COMBINING_CEDILLA}ah`;
const COMPOSED = "Gülşah";

describe("sıradan Türkçe isimler geçerlidir", () => {
  it("Türkçe karakterli isimleri kabul eder", () => {
    for (const name of [
      "Ayşe",
      "Şükrü",
      "Ömer Faruk",
      "İlayda",
      "Çağrı",
      "Gülşah",
      "Sen",
      "Ali Rıza Öztürk",
    ]) {
      expect(validateCanonicalLabel(name, MAX), name).toEqual({
        ok: true,
        value: name,
      });
    }
  });

  it("isim içindeki tek boşluk sorun değildir", () => {
    expect(validateCanonicalLabel("Ömer Faruk", MAX).ok).toBe(true);
  });
});

describe("Unicode kanonikliği", () => {
  it("ayrık ve birleşik yazım aynı kanonik metne indirgenir", () => {
    expect(DECOMPOSED).not.toBe(COMPOSED);
    expect(toCanonicalLabel(DECOMPOSED)).toBe(COMPOSED);
    expect(prepareLabel(DECOMPOSED, MAX)).toBe(prepareLabel(COMPOSED, MAX));
  });

  it("kanonik olmayan metni düzeltmez, reddeder", () => {
    // Doğrulama sessizce düzeltseydi imzalanan baytlarla doğrulanan baytlar
    // ayrışır ve geçerli bir imza geçersiz görünürdü.
    expect(validateCanonicalLabel(DECOMPOSED, MAX)).toEqual({
      ok: false,
      problem: "notNormalized",
    });
    expect(validateCanonicalLabel(COMPOSED, MAX).ok).toBe(true);
  });
});

describe("görünmez ve yön değiştiren karakterler reddedilir", () => {
  it("bidi yön değiştirme ve izolasyon karakterlerini reddeder", () => {
    for (const bidi of [
      RTL_OVERRIDE,
      LTR_OVERRIDE,
      LTR_EMBEDDING,
      FIRST_STRONG_ISOLATE,
      POP_ISOLATE,
      RTL_MARK,
    ]) {
      expect(
        validateCanonicalLabel(`Ayşe${bidi}esyA`, MAX),
        JSON.stringify(bidi),
      ).toEqual({ ok: false, problem: "controlCharacter" });
    }
  });

  it("sıfır genişlikli karakterleri reddeder", () => {
    for (const zeroWidth of [
      ZERO_WIDTH_SPACE,
      ZERO_WIDTH_NON_JOINER,
      ZERO_WIDTH_JOINER,
      WORD_JOINER,
      BYTE_ORDER_MARK,
    ]) {
      expect(
        validateCanonicalLabel(`Ay${zeroWidth}şe`, MAX),
        JSON.stringify(zeroWidth),
      ).toEqual({ ok: false, problem: "controlCharacter" });
    }
  });

  it("C0, C1 ve DEL kontrol karakterlerini reddeder", () => {
    for (const control of [
      NULL_CHAR,
      UNIT_SEPARATOR,
      DELETE_CHAR,
      C1_PADDING,
      TAB,
      NEWLINE,
    ]) {
      expect(
        validateCanonicalLabel(`Ayşe${control}`, MAX),
        JSON.stringify(control),
      ).toEqual({ ok: false, problem: "controlCharacter" });
    }
  });
});

describe("boşluk kuralları", () => {
  it("boş metni reddeder", () => {
    expect(validateCanonicalLabel("", MAX)).toEqual({
      ok: false,
      problem: "empty",
    });
  });

  it("yalnızca boşluktan oluşan metni reddeder", () => {
    for (const blank of [" ", "   ", NBSP, `${IDEOGRAPHIC_SPACE}  `]) {
      expect(validateCanonicalLabel(blank, MAX), JSON.stringify(blank)).toEqual({
        ok: false,
        problem: "whitespaceOnly",
      });
    }
  });

  it("baştaki ve sondaki boşluğu reddeder", () => {
    for (const padded of [
      " Ayşe",
      "Ayşe ",
      `${NBSP}Ayşe`,
      `Ayşe${IDEOGRAPHIC_SPACE}`,
    ]) {
      expect(
        validateCanonicalLabel(padded, MAX),
        JSON.stringify(padded),
      ).toEqual({ ok: false, problem: "surroundingWhitespace" });
    }
  });
});

describe("uzunluk sınırı normalleştirme SONRASI uygulanır", () => {
  it("tam sınırdaki ismi kabul eder", () => {
    expect(validateCanonicalLabel("ü".repeat(MAX), MAX).ok).toBe(true);
  });

  it("sınırı aşan ismi reddeder", () => {
    expect(validateCanonicalLabel("ü".repeat(MAX + 1), MAX)).toEqual({
      ok: false,
      problem: "tooLong",
    });
  });

  it("ayrık yazılmış uzun metin, birleştikten sonra sınıra sığıyorsa geçer", () => {
    // 40 x "u + birleşen çift nokta" = 80 kod birimi; NFC sonrası 40 karakter.
    const decomposed = `u${COMBINING_DIAERESIS}`.repeat(MAX);
    expect(decomposed.length).toBe(MAX * 2);

    const canonical = toCanonicalLabel(decomposed);
    expect(canonical.length).toBe(MAX);
    expect(validateCanonicalLabel(canonical, MAX).ok).toBe(true);
  });
});

describe("prepareLabel", () => {
  it("kırpar, kanonikleştirir ve sınıra sığdırır", () => {
    expect(prepareLabel("  Ayşe  ", MAX)).toBe("Ayşe");
    expect(prepareLabel("ü".repeat(60), MAX)).toBe("ü".repeat(MAX));
    expect(prepareLabel(DECOMPOSED, MAX)).toBe(COMPOSED);
  });

  it("kesme işlemi yüzey çiftini ortadan bölmez", () => {
    const emoji = at(0x1f642);
    expect(emoji.length).toBe(2);
    // 5 kod birimlik sınıra 2 emoji sığar; yarım emoji üretilmez.
    const prepared = prepareLabel(emoji.repeat(10), 5);
    expect(prepared).toBe(emoji.repeat(2));
    expect(prepared.length).toBe(4);
  });

  it("hazırlanan metin katı doğrulamayı geçer", () => {
    expect(validateCanonicalLabel(prepareLabel("  Şükrü  ", MAX), MAX)).toEqual({
      ok: true,
      value: "Şükrü",
    });
  });
});
