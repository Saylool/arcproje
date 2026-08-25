import type { AdjustmentKind, Receipt, ReceiptItem } from "./schema";
import { translate } from "../i18n/dictionary";
import { DEFAULT_LOCALE, toIntlLocale, type Locale } from "../i18n/locale";

export type MoneyParseFailureReason =
  | "empty"
  | "invalid"
  | "tooManyDecimals"
  | "negative";

export type MoneyParseResult =
  | { ok: true; minor: number }
  | { ok: false; reason: MoneyParseFailureReason };

/**
 * Kodun kullanıcıya gösterilecek karşılığı.
 *
 * Metin SÖZLÜKTEN gelir; kod MAKİNE OKUNUR kalır ve çevrilmez. `locale`
 * verilmezse Türkçeye düşülür, böylece sunucu tarafındaki çağıranlar
 * (API yanıtları) değişmeden aynı metni üretir.
 */
export function describeMoneyParseFailure(
  reason: MoneyParseFailureReason,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return translate(locale, `errors.money.${reason}`);
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

/**
 * Input alanlarında gösterilecek deterministik biçim: 32050 -> "320,50".
 *
 * YALNIZCA ONDALIK AYRACI dile göre değişir; binlik ayracı EKLENMEZ. Bunun
 * nedeni `parseMoneyToMinor`ın hem `,` hem `.` kabul etmesi ve tek başına
 * geçen bir ayracı ondalık saymasıdır: ayraç değişse de aynı tam sayı geri
 * okunur, yani biçim değişmesi TUTARI DEĞİŞTİRMEZ.
 */
export function formatMinorForInput(
  minor: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const rounded = Math.trunc(minor);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const major = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  const decimal = locale === "en" ? "." : ",";
  return `${sign}${major}${decimal}${fraction}`;
}

/**
 * Salt okunur gösterim. Bölme yalnızca görüntüleme içindir; uygulama state'i
 * minor unit olarak kalır.
 */
export function formatMinorForDisplay(
  minor: number,
  currency: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const value = minor / 100;
  const intl = toIntlLocale(locale);

  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(intl, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      // Tanınmayan ISO kodu: para birimi simgesi olmadan biçimlendir.
    }
  }

  return new Intl.NumberFormat(intl, {
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
