import { describe, expect, it } from "vitest";

import {
  MAX_RATE_INPUT_LENGTH,
  MAX_RATE_INTEGER_DIGITS,
  MAX_RATE_DECIMALS,
  MICRO_USDC_PER_USDC,
  convertTryMinorToMicroUsdc,
  describeRateFailure,
  formatMicroUsdcAmount,
  formatMicroUsdcForDisplay,
  parseRate,
  type ParsedRate,
} from "./conversion";

function rateOf(input: string): ParsedRate {
  const result = parseRate(input);
  if (!result.ok) {
    throw new Error(`kur ayrıştırılamadı: ${input} (${result.reason})`);
  }
  return result.rate;
}

function microOf(tryMinor: number, rateInput: string): bigint {
  const result = convertTryMinorToMicroUsdc(tryMinor, rateOf(rateInput));
  if (!result.ok) {
    throw new Error(`dönüşüm başarısız: ${result.reason}`);
  }
  return result.microUsdc;
}

describe("parseRate", () => {
  it("virgül ve nokta ondalık ayracını kabul eder", () => {
    expect(rateOf("34,25")).toEqual({ numerator: BigInt(3425), denominator: BigInt(100) });
    expect(rateOf("34.25")).toEqual({ numerator: BigInt(3425), denominator: BigInt(100) });
  });

  it("tam sayı kuru kabul eder", () => {
    expect(rateOf("40")).toEqual({ numerator: BigInt(40), denominator: BigInt(1) });
  });

  it("boşlukları yok sayar", () => {
    expect(rateOf("  34,25 ")).toEqual({ numerator: BigInt(3425), denominator: BigInt(100) });
  });

  it("altı ondalığa kadar izin verir", () => {
    expect(rateOf("34,123456")).toEqual({
      numerator: BigInt(34123456),
      denominator: BigInt(1000000),
    });
  });

  it("boş girdiyi reddeder", () => {
    expect(parseRate("")).toEqual({ ok: false, reason: "empty" });
    expect(parseRate("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("sayı olmayan girdiyi reddeder", () => {
    expect(parseRate("abc")).toEqual({ ok: false, reason: "invalid" });
    expect(parseRate("34 TRY")).toEqual({ ok: false, reason: "invalid" });
    expect(parseRate(",")).toEqual({ ok: false, reason: "invalid" });
  });

  it("Türkçe binlik/ondalık belirsizliğini tahmin etmeden reddeder", () => {
    // Hem virgül hem nokta.
    expect(parseRate("1.234,56")).toEqual({ ok: false, reason: "ambiguous" });
    expect(parseRate("1,234.56")).toEqual({ ok: false, reason: "ambiguous" });
    // Tam üç basamak: binlik ayracı mı ondalık mı belirsiz.
    expect(parseRate("1.234")).toEqual({ ok: false, reason: "ambiguous" });
    expect(parseRate("1,234")).toEqual({ ok: false, reason: "ambiguous" });
    // Aynı ayraç birden fazla kez.
    expect(parseRate("1.234.567")).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("aşırı hassasiyeti reddeder", () => {
    expect(parseRate("34,1234567")).toEqual({
      ok: false,
      reason: "tooManyDecimals",
    });
  });

  it("sıfır ve sıfıra eşdeğer kuru reddeder", () => {
    expect(parseRate("0")).toEqual({ ok: false, reason: "notPositive" });
    expect(parseRate("0,00")).toEqual({ ok: false, reason: "notPositive" });
  });

  it("negatif kuru reddeder", () => {
    // Eksi işareti izinli karakter kümesinde değil.
    expect(parseRate("-5")).toEqual({ ok: false, reason: "invalid" });
  });

  it("her hata için Türkçe mesaj üretir", () => {
    for (const reason of [
      "empty",
      "invalid",
      "ambiguous",
      "tooManyDecimals",
      "notPositive",
    ] as const) {
      expect(describeRateFailure(reason).length).toBeGreaterThan(0);
    }
    expect(describeRateFailure("tooManyDecimals")).toContain(
      String(MAX_RATE_DECIMALS),
    );
  });
});

describe("convertTryMinorToMicroUsdc", () => {
  it("tam bölünen dönüşümü kayıpsız yapar", () => {
    // 100,00 TRY / 40 = 2,5 USDC = 2.500.000 mikro
    expect(microOf(10000, "40")).toBe(BigInt(2_500_000));
  });

  it("ondalıklı kurda doğru sonuç verir", () => {
    // 34,25 TRY / 34,25 = 1 USDC
    expect(microOf(3425, "34,25")).toBe(MICRO_USDC_PER_USDC);
  });

  it("yarım yukarı yuvarlar", () => {
    // 1 kuruş / 3 TRY = 0,003333... USDC -> 3333,33 mikro -> 3333
    expect(microOf(1, "3")).toBe(BigInt(3333));
    // Tam yarım sınırı: 3 kuruş / 2 TRY = 0,015 USDC = 15000 mikro (tam)
    expect(microOf(3, "2")).toBe(BigInt(15_000));
  });

  it("yarım sınırında yukarı yuvarladığını gösterir", () => {
    // 1 kuruş, kur 0,8 -> 1/100/0,8 = 0,0125 USDC = 12500 mikro (tam)
    expect(microOf(1, "0,8")).toBe(BigInt(12_500));
    // 1 kuruş, kur 1,6 -> 0,00625 USDC = 6250 mikro
    expect(microOf(1, "1,6")).toBe(BigInt(6_250));
    // Yarım kalan: 3 kuruş / 4,8 -> 6250,0 ... tam
    expect(microOf(1, "0,16")).toBe(BigInt(62_500));
  });

  it("çok küçük borçlarda bile sıfıra düşmez", () => {
    // 1 kuruş, kur 1 -> 0,01 USDC = 10.000 mikro
    expect(microOf(1, "1")).toBe(BigInt(10_000));
  });

  it("çok büyük ama güvenli borçlarda BigInt ile taşmaz", () => {
    const huge = Number.MAX_SAFE_INTEGER; // kuruş
    const micro = microOf(huge, "40");
    // Beklenen: huge * 1e6 / (100 * 40) = huge * 250
    expect(micro).toBe(BigInt(huge) * BigInt(250));
    // Number ile yapılsaydı hassasiyet kaybolurdu.
    expect(micro > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("sıfır veya negatif borcu reddeder", () => {
    expect(convertTryMinorToMicroUsdc(0, rateOf("40"))).toEqual({
      ok: false,
      reason: "notPositiveDebt",
    });
    expect(convertTryMinorToMicroUsdc(-1, rateOf("40"))).toEqual({
      ok: false,
      reason: "notPositiveDebt",
    });
  });

  it("güvenli olmayan borcu reddeder", () => {
    expect(
      convertTryMinorToMicroUsdc(Number.MAX_SAFE_INTEGER + 2, rateOf("40")),
    ).toEqual({ ok: false, reason: "notPositiveDebt" });
  });

  it("floating-point sapması üretmez", () => {
    // 0,07 gibi ikili tabanda tam gösterilemeyen değerlerde Number aritmetiği
    // sapma üretirdi; BigInt yolu tam sonucu verir.
    const micro = microOf(7, "0,07");
    expect(micro).toBe(MICRO_USDC_PER_USDC);
  });
});

describe("formatMicroUsdcAmount", () => {
  it("App Kit için en fazla 6 ondalıklı metin üretir", () => {
    expect(formatMicroUsdcAmount(MICRO_USDC_PER_USDC)).toBe("1.00");
    expect(formatMicroUsdcAmount(BigInt(2_500_000))).toBe("2.50");
    expect(formatMicroUsdcAmount(BigInt(1_234_567))).toBe("1.234567");
    expect(formatMicroUsdcAmount(BigInt(3_333))).toBe("0.003333");
    expect(formatMicroUsdcAmount(BigInt(0))).toBe("0.00");
  });

  it("ondalık basamak sayısı 6'yı aşmaz", () => {
    for (const micro of [1, 10, 999_999, 1_000_001, 123_456_789]) {
      const text = formatMicroUsdcAmount(BigInt(micro));
      const decimals = text.split(".")[1] ?? "";
      expect(decimals.length).toBeLessThanOrEqual(6);
      expect(decimals.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("gösterimde Türkçe ondalık ayracı kullanır", () => {
    expect(formatMicroUsdcForDisplay(BigInt(1_234_567))).toBe("1,234567");
  });
});

describe("yarım yukarı yuvarlama — gerçek berabere", () => {
  const rateOf = (text: string) => {
    const parsed = parseRate(text);
    if (!parsed.ok) {
      throw new Error(`kur ayrıştırılamadı: ${text}`);
    }
    return parsed.rate;
  };

  it("tam .5 beraberliğinde yukarı yuvarlar", () => {
    // 1 kuruş, 1 USDC = 32 TRY  ->  1_000_000 / 3200 = 312.5 mikro USDC
    const result = convertTryMinorToMicroUsdc(1, rateOf("32"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.microUsdc).toBe(BigInt(313));
    }
  });

  it("beraberliğin hemen altında aşağı yuvarlar", () => {
    // 1_000_000 / 3300 = 303.0303…
    const result = convertTryMinorToMicroUsdc(1, rateOf("33"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.microUsdc).toBe(BigInt(303));
    }
  });

  it("beraberliğin hemen üstünde yukarı yuvarlar", () => {
    // 1_000_000 / 3100 = 322.58…
    const result = convertTryMinorToMicroUsdc(1, rateOf("31"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.microUsdc).toBe(BigInt(323));
    }
  });

  it("tam bölünen değerde yuvarlama yapmaz", () => {
    const result = convertTryMinorToMicroUsdc(2, rateOf("32"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.microUsdc).toBe(BigInt(625));
    }
  });
});

describe("kur sınırları", () => {
  it("çok uzun girdiyi reddeder", () => {
    const long = "1".repeat(MAX_RATE_INPUT_LENGTH + 1);
    expect(parseRate(long)).toEqual({ ok: false, reason: "tooLong" });
  });

  it("çok fazla tam basamağı reddeder", () => {
    const many = "9".repeat(MAX_RATE_INTEGER_DIGITS + 1);
    expect(parseRate(many)).toEqual({ ok: false, reason: "tooLong" });
  });

  it("baştaki sıfırları basamak saymaz", () => {
    expect(parseRate("0000000000000000005").ok).toBe(true);
  });

  it("makul üst sınırın üstündeki kuru reddeder", () => {
    expect(parseRate("1000000000001")).toEqual({ ok: false, reason: "tooLarge" });
  });

  it("sınırdaki değeri kabul eder", () => {
    expect(parseRate("1000000000000").ok).toBe(true);
  });

  it("her hata nedeni için Türkçe mesaj üretir", () => {
    for (const reason of [
      "empty",
      "invalid",
      "ambiguous",
      "tooManyDecimals",
      "tooLong",
      "tooLarge",
      "notPositive",
    ] as const) {
      expect(describeRateFailure(reason).length).toBeGreaterThan(0);
    }
  });
});
