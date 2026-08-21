import type { AdjustmentKind, Receipt, ReceiptItem } from "./schema";

export type MoneyParseFailureReason =
  | "empty"
  | "invalid"
  | "tooManyDecimals"
  | "negative";

export type MoneyParseResult =
  | { ok: true; minor: number }
  | { ok: false; reason: MoneyParseFailureReason };

const FAILURE_MESSAGES: Record<MoneyParseFailureReason, string> = {
  empty: "Bir tutar gir.",
  invalid: "Geçerli bir tutar gir (örn. 320,50).",
  tooManyDecimals: "En fazla iki ondalık basamak girebilirsin (örn. 320,50).",
  negative: "Tutar negatif olamaz.",
};

export function describeMoneyParseFailure(
  reason: MoneyParseFailureReason,
): string {
  return FAILURE_MESSAGES[reason];
}

/** Binlik ayraçlı tam sayı: 1.234.567 veya 1,234,567 */
const GROUPED_INTEGER_PATTERN = /^\d{1,3}(?:[.,]\d{3})*$/;

/**
 * Kullanıcı girdisini minor unit'e çevirir (1 TL = 100 kuruş).
 *
 * Kurallar:
 * - Hem `,` hem `.` varsa sondaki ondalık ayracı, diğeri binlik ayracıdır.
 *   `1.234,56` ve `1,234.56` -> 123456
 * - Tek tür ayraç birden fazla kez geçiyorsa binlik ayracıdır: `1.234.567`
 * - Tek tür ayraç bir kez geçiyorsa ondalık ayracıdır: `320,50` ve `320.50` -> 32050
 * - İkiden fazla ondalık basamak sessizce yuvarlanmaz, `tooManyDecimals` döner.
 *   Bu nedenle `1.234` girdisi hata verir; 1234 için ayraçsız yazılmalıdır.
 */
export function parseMoneyToMinor(input: string): MoneyParseResult {
  const compact = input.replace(/\s/g, "");

  if (compact === "") {
    return { ok: false, reason: "empty" };
  }
  if (compact.startsWith("-")) {
    return { ok: false, reason: "negative" };
  }
  if (!/^[\d.,]+$/.test(compact) || !/\d/.test(compact)) {
    return { ok: false, reason: "invalid" };
  }

  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  const hasComma = lastComma !== -1;
  const hasDot = lastDot !== -1;

  let integerPart = compact;
  let fractionPart = "";

  if (hasComma && hasDot) {
    const decimalIndex = Math.max(lastComma, lastDot);
    const grouped = compact.slice(0, decimalIndex);
    if (!GROUPED_INTEGER_PATTERN.test(grouped)) {
      return { ok: false, reason: "invalid" };
    }
    integerPart = grouped.replace(/[.,]/g, "");
    fractionPart = compact.slice(decimalIndex + 1);
  } else if (hasComma || hasDot) {
    const decimalIndex = hasComma ? lastComma : lastDot;
    const separator = compact[decimalIndex];
    const isRepeatedSeparator = compact.indexOf(separator) !== decimalIndex;

    if (isRepeatedSeparator) {
      if (!GROUPED_INTEGER_PATTERN.test(compact)) {
        return { ok: false, reason: "invalid" };
      }
      integerPart = compact.replace(/[.,]/g, "");
      fractionPart = "";
    } else {
      integerPart = compact.slice(0, decimalIndex);
      fractionPart = compact.slice(decimalIndex + 1);
    }
  }

  // ",50" gibi girdilerde tam kısım boş kalır.
  if (integerPart === "") {
    integerPart = "0";
  }
  if (!/^\d+$/.test(integerPart)) {
    return { ok: false, reason: "invalid" };
  }
  if (fractionPart !== "" && !/^\d+$/.test(fractionPart)) {
    return { ok: false, reason: "invalid" };
  }
  if (fractionPart.length > 2) {
    return { ok: false, reason: "tooManyDecimals" };
  }

  const minor = Number(integerPart) * 100 + Number(fractionPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, minor };
}

/** Input alanlarında gösterilecek deterministik biçim: 32050 -> "320,50" */
export function formatMinorForInput(minor: number): string {
  const rounded = Math.trunc(minor);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const major = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${sign}${major},${fraction}`;
}

/**
 * Salt okunur gösterim. Bölme yalnızca görüntüleme içindir; uygulama state'i
 * minor unit olarak kalır.
 */
export function formatMinorForDisplay(minor: number, currency: string): string {
  const value = minor / 100;

  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      // Tanınmayan ISO kodu: para birimi simgesi olmadan biçimlendir.
    }
  }

  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function sumItemsMinor(items: readonly ReceiptItem[]): number {
  return items.reduce((total, item) => total + item.totalMinor, 0);
}

export type TotalsCheckBase = {
  itemsSubtotalMinor: number;
  /** Fişte basılı olan genel toplam */
  statedTotalMinor: number;
};

export type TotalsCheck =
  | (TotalsCheckBase & {
      status: "match";
      /** Ürünler + yalnızca "separate" işaretli düzeltmeler */
      expectedTotalMinor: number;
      differenceMinor: 0;
    })
  | (TotalsCheckBase & {
      status: "mismatch";
      expectedTotalMinor: number;
      differenceMinor: number;
    })
  | (TotalsCheckBase & {
      status: "indeterminate";
      /** Sıfırdan farklı olduğu hâlde nasıl uygulanacağı bilinmeyen kalemler */
      uncertainAdjustments: AdjustmentKind[];
    });

/**
 * Ürün toplamları ile fişteki genel toplamı karşılaştırır. Hiçbir değeri
 * değiştirmez; sonuç yalnızca kullanıcıya gösterilmek üzere raporlanır.
 *
 * Yalnızca "separate" işaretli düzeltmeler uygulanır. "included_in_items"
 * olan bir tutar ürün fiyatlarının içinde zaten sayıldığı için toplama
 * ikinci kez eklenmez.
 *
 * Sıfırdan farklı bir tutarın uygulaması "unknown" ise doğru toplam
 * bilinemez; bu durumda yanlış bir uyuşmazlık iddiası üretmek yerine
 * "indeterminate" döndürülür.
 */
export function checkTotals(receipt: Receipt): TotalsCheck {
  const itemsSubtotalMinor = sumItemsMinor(receipt.items);
  const statedTotalMinor = receipt.totalMinor;

  const uncertainAdjustments: AdjustmentKind[] = [];
  if (receipt.taxTreatment === "unknown" && receipt.taxMinor !== 0) {
    uncertainAdjustments.push("tax");
  }
  if (
    receipt.serviceChargeTreatment === "unknown" &&
    receipt.serviceChargeMinor !== 0
  ) {
    uncertainAdjustments.push("serviceCharge");
  }
  if (receipt.discountTreatment === "unknown" && receipt.discountMinor !== 0) {
    uncertainAdjustments.push("discount");
  }

  if (uncertainAdjustments.length > 0) {
    return {
      status: "indeterminate",
      itemsSubtotalMinor,
      statedTotalMinor,
      uncertainAdjustments,
    };
  }

  let expectedTotalMinor = itemsSubtotalMinor;
  if (receipt.taxTreatment === "separate") {
    expectedTotalMinor += receipt.taxMinor;
  }
  if (receipt.serviceChargeTreatment === "separate") {
    expectedTotalMinor += receipt.serviceChargeMinor;
  }
  if (receipt.discountTreatment === "separate") {
    expectedTotalMinor -= receipt.discountMinor;
  }

  const differenceMinor = expectedTotalMinor - statedTotalMinor;

  if (differenceMinor === 0) {
    return {
      status: "match",
      itemsSubtotalMinor,
      statedTotalMinor,
      expectedTotalMinor,
      differenceMinor: 0,
    };
  }

  return {
    status: "mismatch",
    itemsSubtotalMinor,
    statedTotalMinor,
    expectedTotalMinor,
    differenceMinor,
  };
}
