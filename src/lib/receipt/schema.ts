import { z } from "zod";

import { RECEIPT_WARNING_CODES } from "./warnings";

/** Para birimi belirlenemediğinde kullanılan değer. */
export const UNKNOWN_CURRENCY = "UNKNOWN";

/**
 * Bir vergi/servis/indirim tutarının genel toplama nasıl yansıdığı.
 *
 * Türkiye'deki fişlerde KDV çoğunlukla ürün satır fiyatlarına dahildir ve
 * fişte yalnızca bilgilendirme amacıyla yazılır. Böyle bir tutarı toplama
 * tekrar eklemek yanlış toplam ve ileride çift borçlandırma üretir.
 */
export const ADJUSTMENT_TREATMENTS = [
  /** Tutar ürün satır fiyatlarının içinde; toplama tekrar uygulanmaz. */
  "included_in_items",
  /** Vergi ve servis ürünlerin üzerine eklenir, indirim ürünlerden düşülür. */
  "separate",
  /** Fişten güvenle anlaşılamadı. */
  "unknown",
] as const;

export const AdjustmentTreatmentSchema = z.enum(ADJUSTMENT_TREATMENTS);
export type AdjustmentTreatment = z.infer<typeof AdjustmentTreatmentSchema>;

/** checkTotals sonucunda hangi kalemin belirsiz olduğunu adlandırmak için. */
export type AdjustmentKind = "tax" | "serviceCharge" | "discount";

/**
 * OpenAI Structured Outputs'a gönderilen şema.
 *
 * Structured Outputs, JSON Schema'nın yalnızca bir alt kümesini kabul eder;
 * `minimum` gibi sayısal kısıtlar reddedilir. Bu yüzden modele giden şema
 * sadece tipleri bildirir. Negatif olmama gibi katı kurallar, cevap alındıktan
 * sonra aşağıdaki `ReceiptSchema` ile uygulanır.
 *
 * Tüm alanlar zorunludur (Structured Outputs optional alan kabul etmez).
 * Item `id`'leri bilerek burada yok: ID'yi modelden istemiyoruz, sunucuda
 * kendimiz üretiyoruz.
 */
export const ReceiptExtractionSchema = z.object({
  merchantName: z.string().nullable(),
  currency: z.string(),
  items: z.array(
    z.object({
      name: z.string(),
      totalMinor: z.number().int(),
    }),
  ),
  taxMinor: z.number().int(),
  taxTreatment: AdjustmentTreatmentSchema,
  serviceChargeMinor: z.number().int(),
  serviceChargeTreatment: AdjustmentTreatmentSchema,
  discountMinor: z.number().int(),
  discountTreatment: AdjustmentTreatmentSchema,
  totalMinor: z.number().int(),
  /*
   * Serbest metin DEĞİL kod. Model kapalı listeden seçer; cümle sözlükten
   * etkin dilde gelir. Şema burada gevşek tutulur (`string`), çünkü tanınmayan
   * kodu reddetmek yerine `sanitizeWarningCodes` sessizce atar — tek bir
   * uydurma etiket yüzünden okunabilir bir fişin tamamı çöpe gitmemeli.
   */
  warnings: z.array(z.string()),
});

export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;

/**
 * Uygulamadaki tüm para değerleri minor unit'tir (1 TL = 100 kuruş).
 * Float ve negatif değerler bilerek reddedilir.
 */
export const MinorUnitSchema = z
  .number()
  .int("Para değeri minor unit cinsinden tam sayı olmalı.")
  .nonnegative("Para değeri negatif olamaz.");

/** Sözlükte karşılığı olan kodlar. Başkası uygulamanın içine giremez. */
export const ReceiptWarningCodeSchema = z.enum(RECEIPT_WARNING_CODES);

export const ReceiptItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  totalMinor: MinorUnitSchema,
});

export const ReceiptSchema = z.object({
  merchantName: z.string().nullable(),
  currency: z.string(),
  items: z.array(ReceiptItemSchema),
  taxMinor: MinorUnitSchema,
  taxTreatment: AdjustmentTreatmentSchema,
  serviceChargeMinor: MinorUnitSchema,
  serviceChargeTreatment: AdjustmentTreatmentSchema,
  discountMinor: MinorUnitSchema,
  discountTreatment: AdjustmentTreatmentSchema,
  totalMinor: MinorUnitSchema,
  /* Uygulamanın içinde artık YALNIZCA geçerli kodlar dolaşır. */
  warnings: z.array(ReceiptWarningCodeSchema),
});

export type Receipt = z.infer<typeof ReceiptSchema>;
export type ReceiptItem = z.infer<typeof ReceiptItemSchema>;

/** ISO 4217 benzeri üç harfli koda indirger, aksi halde UNKNOWN döner. */
export function normalizeCurrency(raw: string): string {
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : UNKNOWN_CURRENCY;
}

/**
 * Ürün ID'si üretir. Modelden ID istenmez; ID her zaman uygulama tarafında
 * eklenir. `crypto.randomUUID` güvenli olmayan bağlamlarda bulunmayabildiği
 * için yedek bir üretici tutulur.
 */
export function createItemId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
