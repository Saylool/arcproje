import { describe, expect, it } from "vitest";

import {
  convertTryMinorToMicroUsdc,
  formatMicroUsdcAmount,
  formatMicroUsdcForDisplay,
  parseRate,
} from "@/lib/arc/conversion";
import { formatMinorUnitsAsTry } from "@/lib/arc/minor-units";
import {
  formatMinorForDisplay,
  formatMinorForInput,
  parseMoneyToMinor,
} from "@/lib/receipt/money";

import {
  formatFileSize,
  formatTryMinor,
  formatUsdcAmount,
  localeSeparators,
  formatRelativeAge,
} from "./format";
import { LOCALES } from "./locale";

/**
 * BİÇİMLENDİRME YALNIZCA GÖSTERİMİ ETKİLER.
 *
 * Bu dosyanın asıl işi bir DEĞİŞMEZİ kanıtlamaktır: dil değişse de altta yatan
 * tam sayı (minor unit / mikro USDC) AYNI KALIR. Gönderilen, imzalanan,
 * saklanan ve karşılaştırılan tutar hiçbir koşulda dile bağlı değildir.
 */

const AMOUNTS = [0, 1, 5, 99, 100, 12345, 100000, 123456789, 9007199254740991];

describe("ayraçlar", () => {
  it("Türkçe ve İngilizce ayraçları farklıdır", () => {
    expect(localeSeparators("tr")).toEqual({ decimal: ",", group: "." });
    expect(localeSeparators("en")).toEqual({ decimal: ".", group: "," });
  });
});

describe("TRY gösterimi", () => {
  it("Türkçe biçim MEVCUT davranışla birebir aynıdır", () => {
    expect(formatMinorUnitsAsTry("123456")).toBe("1.234,56 ₺");
    expect(formatMinorUnitsAsTry("123456", "tr")).toBe("1.234,56 ₺");
    expect(formatMinorUnitsAsTry("5")).toBe("0,05 ₺");
  });

  it("İngilizce biçim İngilizce ayraçları kullanır", () => {
    expect(formatMinorUnitsAsTry("123456", "en")).toBe("₺1,234.56");
    expect(formatTryMinor("123456", "en")).toBe("₺1,234.56");
    expect(formatTryMinor("123456", "tr")).toBe("1.234,56 ₺");
  });

  it("kanonik olmayan girdi HER İKİ dilde de reddedilir", () => {
    for (const locale of LOCALES) {
      expect(formatTryMinor("01", locale), locale).toBeNull();
      expect(formatTryMinor("-5", locale), locale).toBeNull();
      expect(formatTryMinor("1.5", locale), locale).toBeNull();
      expect(formatTryMinor(123, locale), locale).toBeNull();
      expect(formatMinorUnitsAsTry("01", locale), locale).toBeNull();
    }
  });

  it("gösterim yalnızca AYRAÇLARDA farklıdır: basamaklar aynıdır", () => {
    for (const minor of ["0", "7", "123456", "99999999999999999999"]) {
      const turkish = formatTryMinor(minor, "tr") ?? "";
      const english = formatTryMinor(minor, "en") ?? "";
      const digitsOf = (text: string) => text.replace(/[^0-9]/g, "");
      expect(digitsOf(turkish), minor).toBe(digitsOf(english));
    }
  });

  it("BÜYÜK tutarlar BigInt ile işlenir; kayan noktaya düşülmez", () => {
    // 2^53'ten büyük: `Number` ile bozulurdu.
    expect(formatTryMinor("900719925474099100", "tr")).toBe(
      "9.007.199.254.740.991,00 ₺",
    );
    expect(formatTryMinor("900719925474099100", "en")).toBe(
      "₺9,007,199,254,740,991.00",
    );
  });
});

describe("USDC gösterimi", () => {
  it("PROTOKOL biçimlendiricileri DİLE DUYARLI DEĞİLDİR", () => {
    /*
     * `formatMicroUsdcAmount` / `formatMicroUsdcForDisplay` sunucunun ürettiği
     * `amount` / `displayAmount` metinlerini istemcide YENİDEN üretip birebir
     * karşılaştırmak için kullanılır. Dile göre değişselerdi doğrulama
     * düşerdi. Bu yüzden tek argümanlıdırlar ve öyle kalmalıdırlar.
     */
    expect(formatMicroUsdcAmount).toHaveLength(1);
    expect(formatMicroUsdcForDisplay).toHaveLength(1);
    expect(formatMicroUsdcAmount(BigInt(12345678))).toBe("12.345678");
    expect(formatMicroUsdcForDisplay(BigInt(12345678))).toBe("12,345678");
  });

  it("gösterim biçimlendiricisi Türkçede protokol biçimiyle AYNI çıkar", () => {
    for (const micro of [0, 1, 1000000, 12345678, 999999999999]) {
      const value = BigInt(micro);
      expect(formatUsdcAmount(value, "tr"), String(micro)).toBe(
        formatMicroUsdcForDisplay(value),
      );
    }
  });

  it("İngilizcede yalnızca ondalık ayracı değişir", () => {
    for (const micro of [0, 1, 1000000, 12345678, 999999999999]) {
      const value = BigInt(micro);
      expect(formatUsdcAmount(value, "en"), String(micro)).toBe(
        formatMicroUsdcAmount(value),
      );
      expect(
        formatUsdcAmount(value, "en").replace(".", ","),
        String(micro),
      ).toBe(formatUsdcAmount(value, "tr"));
    }
  });
});

describe("fiş tutarları", () => {
  it("gösterim dile göre biçimlenir", () => {
    expect(formatMinorForDisplay(123456, "TRY", "tr")).toContain("1.234,56");
    expect(formatMinorForDisplay(123456, "TRY", "en")).toContain("1,234.56");
    // Varsayılan Türkçedir: mevcut davranış korunur.
    expect(formatMinorForDisplay(123456, "TRY")).toBe(
      formatMinorForDisplay(123456, "TRY", "tr"),
    );
  });

  it("para birimi KODU çevrilmez", () => {
    for (const locale of LOCALES) {
      expect(formatMinorForDisplay(100, "USD", locale), locale).toMatch(
        /\$|USD/,
      );
    }
  });

  it("giriş alanı biçimi yalnızca ondalık ayracını değiştirir", () => {
    expect(formatMinorForInput(32050, "tr")).toBe("320,50");
    expect(formatMinorForInput(32050, "en")).toBe("320.50");
    expect(formatMinorForInput(32050)).toBe("320,50");
  });
});

describe("DEĞİŞMEZ: dil tutarı DEĞİŞTİRMEZ", () => {
  it("giriş alanı biçimi iki dilde de AYNI tam sayıya geri okunur", () => {
    for (const minor of AMOUNTS) {
      const turkish = parseMoneyToMinor(formatMinorForInput(minor, "tr"));
      const english = parseMoneyToMinor(formatMinorForInput(minor, "en"));
      expect(turkish.ok, String(minor)).toBe(true);
      expect(english.ok, String(minor)).toBe(true);
      if (!turkish.ok || !english.ok) continue;
      expect(turkish.minor, String(minor)).toBe(minor);
      expect(english.minor, String(minor)).toBe(minor);
      expect(turkish.minor, String(minor)).toBe(english.minor);
    }
  });

  it("TRY -> USDC dönüşümü dilden BAĞIMSIZDIR", () => {
    const rate = parseRate("34,25");
    expect(rate.ok).toBe(true);
    if (!rate.ok) return;

    for (const minor of [1, 100, 12345, 987654321]) {
      const converted = convertTryMinorToMicroUsdc(minor, rate.rate);
      expect(converted.ok, String(minor)).toBe(true);
      if (!converted.ok) continue;

      // Aynı tam sayı; yalnızca gösterim metni dile göre değişir.
      const turkish = formatUsdcAmount(converted.microUsdc, "tr");
      const english = formatUsdcAmount(converted.microUsdc, "en");
      expect(turkish.replace(",", "."), String(minor)).toBe(english);
      // Gönderilecek `amount` alanı DİLDEN BAĞIMSIZ kalır.
      expect(converted.amount, String(minor)).toBe(
        formatMicroUsdcAmount(converted.microUsdc),
      );
    }
  });

  it("aynı borç iki dilde AYNI mikro USDC üretir", () => {
    const rate = parseRate("41.5");
    expect(rate.ok).toBe(true);
    if (!rate.ok) return;
    const first = convertTryMinorToMicroUsdc(250075, rate.rate);
    const second = convertTryMinorToMicroUsdc(250075, rate.rate);
    expect(first).toEqual(second);
    expect(first.ok && first.microUsdc).toBe(second.ok && second.microUsdc);
  });
});

describe("dosya boyutu", () => {
  it("dile göre biçimlenir ama BİRİM aynıdır", () => {
    expect(formatFileSize(512, "tr")).toBe("512 B");
    expect(formatFileSize(512, "en")).toBe("512 B");
    expect(formatFileSize(2048, "tr")).toBe("2 KB");
    expect(formatFileSize(1024 * 1024 * 3.5, "tr")).toBe("3,5 MB");
    expect(formatFileSize(1024 * 1024 * 3.5, "en")).toBe("3.5 MB");
  });
});

describe("formatRelativeAge", () => {
  const DAY = 86_400_000;
  const now = 1_800_000_000_000;
  const secondsAgo = (days: number) => Math.floor((now - days * DAY) / 1000);

  it("gun, ay ve yila yuvarlar", () => {
    expect(formatRelativeAge(secondsAgo(0), now, "tr")).toBe("bugün");
    expect(formatRelativeAge(secondsAgo(1), now, "tr")).toBe("dün");
    expect(formatRelativeAge(secondsAgo(5), now, "tr")).toContain("5");
    // 29 gun hala GUN; 30. gunde AY olur.
    expect(formatRelativeAge(secondsAgo(29), now, "tr")).toContain("29");
    expect(formatRelativeAge(secondsAgo(30), now, "tr")).toContain("ay");
    expect(formatRelativeAge(secondsAgo(364), now, "tr")).toContain("ay");
    expect(formatRelativeAge(secondsAgo(365), now, "tr")).toContain("yıl");
  });

  it("dile gore bicimlenir", () => {
    expect(formatRelativeAge(secondsAgo(90), now, "en")).toMatch(/mo/);
    expect(formatRelativeAge(secondsAgo(90), now, "tr")).toContain("ay");
  });

  it("gelecekteki bir an negatife DUSMEZ", () => {
    // Saat kaymasi ya da bozuk veri "-2 gun sonra" gibi bir metin uretmemeli.
    expect(formatRelativeAge(secondsAgo(-2), now, "tr")).toBe("bugün");
  });

  it("bozuk girdide sessizce bos doner", () => {
    expect(formatRelativeAge(Number.NaN, now, "tr")).toBe("");
  });
});
