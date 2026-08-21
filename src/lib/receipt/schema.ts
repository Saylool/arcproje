import { z } from "zod";

/** Para birimi belirlenemediğinde kullanılan değer. */
export const UNKNOWN_CURRENCY = "UNKNOWN";

/**
 * OpenAI Structured Outputs'a gönderilen şema.
 *
 * Structured Outputs, JSON Schema'nın yalnızca bir alt kümesini kabul eder;
 * `minimum` gibi sayısal kısıtlar reddedilir. Bu yüzden modele giden şema
 * sadece tipleri bildirir. Negatif olmama gibi katı kurallar, cevap alındıktan
 * sonra aşağıdaki `ReceiptSchema` ile uygulanır.
 *
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
  serviceChargeMinor: z.number().int(),
  discountMinor: z.number().int(),
  totalMinor: z.number().int(),
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
  serviceChargeMinor: MinorUnitSchema,
  discountMinor: MinorUnitSchema,
  totalMinor: MinorUnitSchema,
  warnings: z.array(z.string()),
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
