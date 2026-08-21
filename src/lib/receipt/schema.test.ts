import { describe, expect, it } from "vitest";

import {
  ADJUSTMENT_TREATMENTS,
  AdjustmentTreatmentSchema,
  MinorUnitSchema,
  ReceiptExtractionSchema,
  ReceiptItemSchema,
  ReceiptSchema,
  UNKNOWN_CURRENCY,
  createItemId,
  normalizeCurrency,
  type Receipt,
} from "./schema";

function buildReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    merchantName: "Test Kafe",
    currency: "TRY",
    items: [{ id: "a", name: "Çay", totalMinor: 2500 }],
    taxMinor: 450,
    taxTreatment: "included_in_items",
    serviceChargeMinor: 0,
    serviceChargeTreatment: "included_in_items",
    discountMinor: 0,
    discountTreatment: "included_in_items",
    totalMinor: 2950,
    warnings: [],
    ...overrides,
  };
}

describe("MinorUnitSchema", () => {
  it("negatif olmayan tam sayıları kabul eder", () => {
    expect(MinorUnitSchema.safeParse(0).success).toBe(true);
    expect(MinorUnitSchema.safeParse(32050).success).toBe(true);
  });

  it("negatif değerleri reddeder", () => {
    expect(MinorUnitSchema.safeParse(-1).success).toBe(false);
    expect(MinorUnitSchema.safeParse(-32050).success).toBe(false);
  });

  it("ondalıklı (floating-point) değerleri reddeder", () => {
    expect(MinorUnitSchema.safeParse(320.5).success).toBe(false);
    expect(MinorUnitSchema.safeParse(0.01).success).toBe(false);
  });

  it("sayı olmayan ve sonlu olmayan değerleri reddeder", () => {
    expect(MinorUnitSchema.safeParse("320").success).toBe(false);
    expect(MinorUnitSchema.safeParse(Number.NaN).success).toBe(false);
    expect(MinorUnitSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(
      false,
    );
  });
});

describe("ReceiptItemSchema", () => {
  it("geçerli ürünü kabul eder", () => {
    expect(
      ReceiptItemSchema.safeParse({ id: "a", name: "Çay", totalMinor: 2500 })
        .success,
    ).toBe(true);
  });

  it("ID'siz ürünü reddeder", () => {
    expect(
      ReceiptItemSchema.safeParse({ name: "Çay", totalMinor: 2500 }).success,
    ).toBe(false);
    expect(
      ReceiptItemSchema.safeParse({ id: "", name: "Çay", totalMinor: 2500 })
        .success,
    ).toBe(false);
  });

  it("negatif ürün tutarını reddeder", () => {
    expect(
      ReceiptItemSchema.safeParse({ id: "a", name: "Çay", totalMinor: -1 })
        .success,
    ).toBe(false);
  });
});

describe("ReceiptSchema", () => {
  it("geçerli fişi kabul eder", () => {
    expect(ReceiptSchema.safeParse(buildReceipt()).success).toBe(true);
  });

  it("merchantName null olabilir", () => {
    expect(
      ReceiptSchema.safeParse(buildReceipt({ merchantName: null })).success,
    ).toBe(true);
  });

  it("boş ürün dizisini şema düzeyinde kabul eder", () => {
    // Boş liste "okunamadı" durumudur; kontrollü hataya route katmanında dönüşür.
    expect(ReceiptSchema.safeParse(buildReceipt({ items: [] })).success).toBe(
      true,
    );
  });

  it("negatif toplamı reddeder", () => {
    expect(
      ReceiptSchema.safeParse(buildReceipt({ totalMinor: -100 })).success,
    ).toBe(false);
    expect(
      ReceiptSchema.safeParse(buildReceipt({ discountMinor: -1 })).success,
    ).toBe(false);
  });

  it("floating-point toplamı reddeder", () => {
    expect(
      ReceiptSchema.safeParse(buildReceipt({ totalMinor: 29.5 })).success,
    ).toBe(false);
    expect(ReceiptSchema.safeParse(buildReceipt({ taxMinor: 4.5 })).success).toBe(
      false,
    );
  });

  it("eksik alanları reddeder", () => {
    const withoutWarnings: Record<string, unknown> = { ...buildReceipt() };
    delete withoutWarnings.warnings;
    expect(ReceiptSchema.safeParse(withoutWarnings).success).toBe(false);
  });
});

describe("ReceiptExtractionSchema", () => {
  it("modelden ID beklemez", () => {
    const parsed = ReceiptExtractionSchema.safeParse({
      merchantName: "Kafe",
      currency: "TRY",
      items: [{ name: "Çay", totalMinor: 2500 }],
      taxMinor: 0,
      taxTreatment: "included_in_items",
      serviceChargeMinor: 0,
      serviceChargeTreatment: "separate",
      discountMinor: 0,
      discountTreatment: "unknown",
      totalMinor: 2500,
      warnings: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("ondalıklı para değerini reddeder", () => {
    const parsed = ReceiptExtractionSchema.safeParse({
      merchantName: null,
      currency: "TRY",
      items: [{ name: "Çay", totalMinor: 25.5 }],
      taxMinor: 0,
      taxTreatment: "included_in_items",
      serviceChargeMinor: 0,
      serviceChargeTreatment: "included_in_items",
      discountMinor: 0,
      discountTreatment: "included_in_items",
      totalMinor: 25.5,
      warnings: [],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("normalizeCurrency", () => {
  it("ISO kodlarını büyük harfe çevirir", () => {
    expect(normalizeCurrency("try")).toBe("TRY");
    expect(normalizeCurrency(" usd ")).toBe("USD");
    expect(normalizeCurrency("EUR")).toBe("EUR");
  });

  it("ISO olmayan değerleri UNKNOWN yapar", () => {
    expect(normalizeCurrency("TL")).toBe(UNKNOWN_CURRENCY);
    expect(normalizeCurrency("₺")).toBe(UNKNOWN_CURRENCY);
    expect(normalizeCurrency("")).toBe(UNKNOWN_CURRENCY);
    expect(normalizeCurrency("TURKISH LIRA")).toBe(UNKNOWN_CURRENCY);
  });
});

describe("adjustment treatment", () => {
  it("yalnızca üç bilinen değeri kabul eder", () => {
    expect(ADJUSTMENT_TREATMENTS).toEqual([
      "included_in_items",
      "separate",
      "unknown",
    ]);
    for (const treatment of ADJUSTMENT_TREATMENTS) {
      expect(AdjustmentTreatmentSchema.safeParse(treatment).success).toBe(true);
    }
  });

  it("tanınmayan değeri reddeder", () => {
    expect(AdjustmentTreatmentSchema.safeParse("included").success).toBe(false);
    expect(AdjustmentTreatmentSchema.safeParse("").success).toBe(false);
    expect(AdjustmentTreatmentSchema.safeParse(null).success).toBe(false);
  });

  it("ReceiptSchema'da treatment alanları zorunludur", () => {
    for (const field of [
      "taxTreatment",
      "serviceChargeTreatment",
      "discountTreatment",
    ]) {
      const withoutField: Record<string, unknown> = { ...buildReceipt() };
      delete withoutField[field];
      expect(
        ReceiptSchema.safeParse(withoutField).success,
        `${field} eksikken kabul edildi`,
      ).toBe(false);
    }
  });

  it("ReceiptExtractionSchema'da treatment alanları zorunludur", () => {
    const base: Record<string, unknown> = {
      merchantName: null,
      currency: "TRY",
      items: [{ name: "Çay", totalMinor: 2500 }],
      taxMinor: 0,
      taxTreatment: "included_in_items",
      serviceChargeMinor: 0,
      serviceChargeTreatment: "included_in_items",
      discountMinor: 0,
      discountTreatment: "included_in_items",
      totalMinor: 2500,
      warnings: [],
    };
    expect(ReceiptExtractionSchema.safeParse(base).success).toBe(true);

    const withoutTreatment = { ...base };
    delete withoutTreatment.taxTreatment;
    expect(ReceiptExtractionSchema.safeParse(withoutTreatment).success).toBe(
      false,
    );
  });

  it("geçersiz treatment değerini reddeder", () => {
    expect(
      ReceiptSchema.safeParse(
        buildReceipt({
          taxTreatment: "maybe" as unknown as Receipt["taxTreatment"],
        }),
      ).success,
    ).toBe(false);
  });
});

describe("createItemId", () => {
  it("boş olmayan ve benzersiz ID üretir", () => {
    const ids = new Set(Array.from({ length: 200 }, () => createItemId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
    }
  });
});
