import { describe, expect, it } from "vitest";

import {
  checkTotals,
  describeMoneyParseFailure,
  formatMinorForDisplay,
  formatMinorForInput,
  parseMoneyToMinor,
  sumItemsMinor,
} from "./money";
import type { Receipt } from "./schema";

function expectMinor(input: string, minor: number) {
  const result = parseMoneyToMinor(input);
  expect(result, `"${input}" ayrıştırılamadı`).toEqual({ ok: true, minor });
}

function expectFailure(input: string, reason: string) {
  const result = parseMoneyToMinor(input);
  expect(result).toEqual({ ok: false, reason });
}

describe("parseMoneyToMinor", () => {
  it("virgül ondalık ayracını minor unit'e çevirir", () => {
    expectMinor("320,50", 32050);
    expectMinor("0,05", 5);
    expectMinor("12,5", 1250);
  });

  it("nokta ondalık ayracını minor unit'e çevirir", () => {
    expectMinor("320.50", 32050);
    expectMinor("0.05", 5);
    expectMinor("12.5", 1250);
  });

  it("ayraçsız tam sayıyı kuruşa çevirir", () => {
    expectMinor("320", 32000);
    expectMinor("0", 0);
  });

  it("tam kısmı olmayan girdiyi kabul eder", () => {
    expectMinor(",50", 50);
    expectMinor(".5", 50);
  });

  it("boşlukları yok sayar", () => {
    expectMinor(" 320,50 ", 32050);
    expectMinor("1 234,56", 123456);
  });

  it("iki ayraç birlikteyken sondakini ondalık kabul eder", () => {
    expectMinor("1.234,56", 123456);
    expectMinor("1,234.56", 123456);
    expectMinor("1.234.567,89", 123456789);
  });

  it("tekrar eden tek tür ayracı binlik ayracı sayar", () => {
    expectMinor("1.234.567", 123456700);
    expectMinor("1,234,567", 123456700);
  });

  it("boş girdiyi reddeder", () => {
    expectFailure("", "empty");
    expectFailure("   ", "empty");
  });

  it("negatif girdiyi reddeder", () => {
    expectFailure("-5", "negative");
    expectFailure("-320,50", "negative");
  });

  it("sayı olmayan girdiyi reddeder", () => {
    expectFailure("abc", "invalid");
    expectFailure("320 TL", "invalid");
    expectFailure("3a20", "invalid");
    expectFailure(",", "invalid");
    expectFailure("12,34,56", "invalid");
  });

  it("ikiden fazla ondalık basamağı sessizce yuvarlamaz", () => {
    expectFailure("320,555", "tooManyDecimals");
    expectFailure("320.505", "tooManyDecimals");
    expectFailure("0,12345", "tooManyDecimals");
    // Tek ayraç ondalık kabul edildiği için 3 basamak açık hata verir.
    expectFailure("1.234", "tooManyDecimals");
  });

  it("her hata nedeni için Türkçe mesaj üretir", () => {
    for (const reason of [
      "empty",
      "invalid",
      "tooManyDecimals",
      "negative",
    ] as const) {
      expect(describeMoneyParseFailure(reason).length).toBeGreaterThan(0);
    }
  });
});

describe("formatMinorForInput", () => {
  it("minor unit'i iki ondalıklı biçime çevirir", () => {
    expect(formatMinorForInput(32050)).toBe("320,50");
    expect(formatMinorForInput(5)).toBe("0,05");
    expect(formatMinorForInput(0)).toBe("0,00");
    expect(formatMinorForInput(100)).toBe("1,00");
  });

  it("ayrıştırma ile karşılıklı tutarlıdır", () => {
    for (const minor of [0, 5, 100, 32050, 123456789]) {
      const result = parseMoneyToMinor(formatMinorForInput(minor));
      expect(result).toEqual({ ok: true, minor });
    }
  });
});

describe("formatMinorForDisplay", () => {
  it("ISO kodu ile para birimi biçimlendirir", () => {
    expect(formatMinorForDisplay(32050, "TRY")).toContain("320,50");
  });

  it("UNKNOWN para biriminde çökmeden sayı biçimlendirir", () => {
    expect(formatMinorForDisplay(32050, "UNKNOWN")).toContain("320,50");
  });

  it("tanınmayan ISO kodunda çökmez", () => {
    expect(formatMinorForDisplay(32050, "XXY")).toContain("320,50");
  });
});

function buildReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    merchantName: "Test Kafe",
    currency: "TRY",
    items: [
      { id: "a", name: "Çay", totalMinor: 2500 },
      { id: "b", name: "Kek", totalMinor: 7500 },
    ],
    taxMinor: 0,
    taxTreatment: "included_in_items",
    serviceChargeMinor: 0,
    serviceChargeTreatment: "included_in_items",
    discountMinor: 0,
    discountTreatment: "included_in_items",
    totalMinor: 10000,
    warnings: [],
    ...overrides,
  };
}

describe("checkTotals", () => {
  it("ürün toplamını hesaplar", () => {
    expect(sumItemsMinor(buildReceipt().items)).toBe(10000);
  });

  it("KDV ürün fiyatlarına dahilken vergiyi toplama eklemez", () => {
    // Türkiye'deki tipik durum: ürünler = genel toplam, KDV bilgilendirme amaçlı.
    const totals = checkTotals(
      buildReceipt({
        taxMinor: 1800,
        taxTreatment: "included_in_items",
        totalMinor: 10000,
      }),
    );
    expect(totals.status).toBe("match");
    expect(totals.itemsSubtotalMinor).toBe(10000);
  });

  it("vergi ayrı uygulanıyorsa toplama ekler", () => {
    const totals = checkTotals(
      buildReceipt({
        taxMinor: 1800,
        taxTreatment: "separate",
        totalMinor: 11800,
      }),
    );
    expect(totals.status).toBe("match");
  });

  it("servis ücreti ayrı uygulanıyorsa toplama ekler", () => {
    const totals = checkTotals(
      buildReceipt({
        serviceChargeMinor: 1000,
        serviceChargeTreatment: "separate",
        totalMinor: 11000,
      }),
    );
    expect(totals.status).toBe("match");
  });

  it("indirim ayrı uygulanıyorsa toplamdan düşer", () => {
    const totals = checkTotals(
      buildReceipt({
        discountMinor: 800,
        discountTreatment: "separate",
        totalMinor: 9200,
      }),
    );
    expect(totals.status).toBe("match");
  });

  it("ayrı uygulanan kalemleri birlikte hesaplar", () => {
    const totals = checkTotals(
      buildReceipt({
        taxMinor: 1800,
        taxTreatment: "separate",
        serviceChargeMinor: 1000,
        serviceChargeTreatment: "separate",
        discountMinor: 800,
        discountTreatment: "separate",
        totalMinor: 12000,
      }),
    );
    expect(totals.status).toBe("match");
  });

  it("included_in_items olan tutarı ikinci kez uygulamaz", () => {
    // Çift sayılsaydı beklenen toplam 11800 olur ve mismatch üretirdi.
    const included = checkTotals(
      buildReceipt({
        taxMinor: 1800,
        taxTreatment: "included_in_items",
        totalMinor: 10000,
      }),
    );
    expect(included.status).toBe("match");

    const separate = checkTotals(
      buildReceipt({
        taxMinor: 1800,
        taxTreatment: "separate",
        totalMinor: 10000,
      }),
    );
    expect(separate.status).toBe("mismatch");
    if (separate.status === "mismatch") {
      expect(separate.expectedTotalMinor).toBe(11800);
      expect(separate.differenceMinor).toBe(1800);
    }
  });

  it("gerçek uyuşmazlığı farkıyla birlikte bildirir", () => {
    const totals = checkTotals(
      buildReceipt({
        taxMinor: 1800,
        taxTreatment: "separate",
        totalMinor: 11500,
      }),
    );
    expect(totals.status).toBe("mismatch");
    if (totals.status === "mismatch") {
      expect(totals.statedTotalMinor).toBe(11500);
      expect(totals.expectedTotalMinor).toBe(11800);
      expect(totals.differenceMinor).toBe(300);
    }
  });

  it("sıfırdan farklı unknown kalem varsa indeterminate döner", () => {
    const totals = checkTotals(
      buildReceipt({ taxMinor: 1800, taxTreatment: "unknown" }),
    );
    expect(totals.status).toBe("indeterminate");
    if (totals.status === "indeterminate") {
      expect(totals.uncertainAdjustments).toEqual(["tax"]);
    }
  });

  it("birden fazla belirsiz kalemi listeler", () => {
    const totals = checkTotals(
      buildReceipt({
        taxMinor: 1800,
        taxTreatment: "unknown",
        serviceChargeMinor: 1000,
        serviceChargeTreatment: "unknown",
        discountMinor: 800,
        discountTreatment: "unknown",
      }),
    );
    expect(totals.status).toBe("indeterminate");
    if (totals.status === "indeterminate") {
      expect(totals.uncertainAdjustments).toEqual([
        "tax",
        "serviceCharge",
        "discount",
      ]);
    }
  });

  it("değeri sıfır olan unknown kalem belirsizlik yaratmaz", () => {
    const totals = checkTotals(
      buildReceipt({ taxMinor: 0, taxTreatment: "unknown" }),
    );
    expect(totals.status).toBe("match");
  });

  it("kullanıcı treatment'ı değiştirince sonuç anında değişir", () => {
    const base = buildReceipt({
      taxMinor: 1800,
      taxTreatment: "unknown",
      totalMinor: 11800,
    });
    expect(checkTotals(base).status).toBe("indeterminate");

    // Kullanıcı "Ayrı uygula" seçer -> matematik tutar.
    const asSeparate = checkTotals({ ...base, taxTreatment: "separate" });
    expect(asSeparate.status).toBe("match");

    // Kullanıcı "Ürün fiyatlarına dahil" seçer -> 1800 fark ortaya çıkar.
    const asIncluded = checkTotals({
      ...base,
      taxTreatment: "included_in_items",
    });
    expect(asIncluded.status).toBe("mismatch");
    if (asIncluded.status === "mismatch") {
      expect(asIncluded.differenceMinor).toBe(-1800);
    }
  });

  it("hiçbir değeri değiştirmez", () => {
    const receipt = buildReceipt({ totalMinor: 999 });
    checkTotals(receipt);
    expect(receipt.totalMinor).toBe(999);
    expect(receipt.items).toHaveLength(2);
    expect(receipt.taxTreatment).toBe("included_in_items");
  });
});
