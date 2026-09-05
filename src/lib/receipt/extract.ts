import OpenAI, { APIConnectionTimeoutError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  ReceiptExtractionSchema,
  ReceiptSchema,
  createItemId,
  normalizeCurrency,
  type Receipt,
} from "./schema";
import { sanitizeWarningCodes } from "./warnings";

const DEFAULT_RECEIPT_MODEL = "gpt-5.6-luna";

/** Demoda beklemeyi öngörülebilir tutmak için tek denemede 30 saniye sınır. */
export const ANALYSIS_TIMEOUT_MS = 30_000;

/**
 * Otomatik retry kapalı. SDK varsayılanı 2 denemedir; 30 saniyelik timeout ile
 * birlikte bu, en kötü durumda 90 saniyeye çıkar ve demo akışını kilitler.
 * Kullanıcı zaten "Tekrar dene" ile isteği yineleyebiliyor.
 */
const MAX_RETRIES = 0;

const SYSTEM_PROMPT = `You extract structured data from a photograph of a retail or restaurant receipt.

Hard rules:
- Only extract what is clearly visible in the image. Never invent a merchant, product, or amount.
- Receipts may be in Turkish or any other language. Handle both.
- Decimal separators differ by locale: "1.234,56" and "1,234.56" both mean one thousand two hundred thirty four point five six. Read each receipt's own convention correctly.
- Convert every monetary amount to an INTEGER in the currency's minor unit (1 TRY = 100 kurus, 1 USD = 100 cents). "12,50 TL" becomes 1250. Never emit a decimal number for money.
- All monetary fields must be non-negative integers. A discount printed as "-50,00" is 5000 in discountMinor.

items:
- Include only purchased product or service lines.
- Exclude subtotal ("ARA TOPLAM", "SUBTOTAL"), tax ("KDV", "VAT", "TAX"), service charge ("SERVIS", "SERVICE"), discount ("INDIRIM", "DISCOUNT"), grand total ("TOPLAM", "GENEL TOPLAM", "TOTAL"), payment and change lines ("NAKIT", "KREDI KARTI", "PARA USTU", "CASH", "CHANGE"), and loyalty or point lines.
- Use the printed LINE TOTAL as the item price, not the unit price. If a line shows "2 x 45,00 = 90,00", the item total is 9000.

Treatment fields (taxTreatment, serviceChargeTreatment, discountTreatment):
These say whether an amount must still be applied on top of the item lines when computing the grand total. Decide each one from the arithmetic that is actually VISIBLE on the receipt.
- "included_in_items": the amount is already contained in the item line prices. Applying it again would double count it.
- "separate": the amount is added on top of the item lines (tax, service) or subtracted from them (discount).
- "unknown": the receipt does not let you tell.

How to decide:
- The mere presence of a "KDV" or "VAT" line does NOT mean the tax is added on top. It is very often printed only as information about tax already contained in the prices.
- Compare the numbers: if the item line totals already equal the printed grand total, then tax (and any other listed amount) is "included_in_items".
- If item line totals plus the amount equal the printed grand total, that amount is "separate".
- In Turkey KDV is usually included in the displayed prices, but do NOT assume this blindly. Use the receipt's own arithmetic.
- Apply the same reasoning to service charge and discount independently. They can differ from each other.
- If the visible arithmetic does not settle it, return "unknown" and add the matching warning code (TAX_TREATMENT_UNCLEAR, SERVICE_TREATMENT_UNCLEAR or DISCOUNT_TREATMENT_UNCLEAR).
- When an amount is 0 because the receipt has no such line, "included_in_items" or "unknown" are both acceptable; the value is 0 either way.

Other fields:
- totalMinor: the grand total PRINTED on the receipt. Do not recompute it from the items, even if the items do not add up.
- taxMinor, serviceChargeMinor, discountMinor: use 0 when the receipt does not show that line.
- currency: the ISO 4217 code (TRY, USD, EUR, ...). "TL" and the lira sign both mean TRY. Use "UNKNOWN" when it cannot be determined.
- merchantName: the business name, or null when it is not legible.
- warnings: codes only, chosen from this exact list. Never write prose here; the app renders each code in the reader's own language.
    TOTAL_UNREADABLE           the printed grand total cannot be read
    TOTALS_DO_NOT_MATCH        the item lines do not add up to the printed total
    TAX_TREATMENT_UNCLEAR      cannot tell whether tax is included or added
    SERVICE_TREATMENT_UNCLEAR  same, for the service charge
    DISCOUNT_TREATMENT_UNCLEAR same, for the discount
    ITEM_PRICE_UNCLEAR         at least one item price is not clearly legible
    ITEM_NAME_UNCLEAR          at least one item name is not clearly legible
    PARTIALLY_UNREADABLE       part of the image is unreadable, lines may be missing
    CURRENCY_UNCLEAR           the currency cannot be determined
  Add a code instead of guessing. Use an empty array when everything is clear.
  Any value outside this list is discarded, so an inexact code is worse than none.

If the image is not a receipt or is too unreadable to extract line items, return an empty items array, zeros for the amounts, and PARTIALLY_UNREADABLE in warnings.`;

const USER_PROMPT =
  "Bu fiş görselindeki verileri çıkar. Yalnızca görselde açıkça görünen bilgileri kullan.";

export function getReceiptModel(): string {
  const configured = process.env.OPENAI_RECEIPT_MODEL?.trim();
  return configured ? configured : DEFAULT_RECEIPT_MODEL;
}

/** API key yalnızca sunucuda okunur; istemciye hiçbir biçimde sızdırılmaz. */
export function isReceiptAnalysisConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export type ExtractionFailureCode =
  | "MODEL_REFUSED"
  | "RECEIPT_NOT_READABLE"
  | "INVALID_RECEIPT_DATA"
  | "ANALYSIS_TIMEOUT"
  | "ANALYSIS_FAILED";

export type ExtractionResult =
  | { ok: true; receipt: Receipt }
  | { ok: false; code: ExtractionFailureCode };

function toLogMessage(error: unknown): string {
  return error instanceof Error ? error.message : "bilinmeyen hata";
}

export async function extractReceipt(
  imageDataUrl: string,
): Promise<ExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    // Çağıranın önceden kontrol etmesi beklenir; yine de istek yapmadan dön.
    return { ok: false, code: "ANALYSIS_FAILED" };
  }

  const client = new OpenAI({
    apiKey,
    timeout: ANALYSIS_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });

  let response;
  try {
    response = await client.responses.parse({
      model: getReceiptModel(),
      store: false,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: USER_PROMPT },
            { type: "input_image", detail: "high", image_url: imageDataUrl },
          ],
        },
      ],
      text: { format: zodTextFormat(ReceiptExtractionSchema, "receipt") },
    });
  } catch (error) {
    // Metin eşleştirmesi yerine SDK'nın kendi timeout sınıfı kullanılır.
    if (error instanceof APIConnectionTimeoutError) {
      console.error("[receipt-analyze] OpenAI isteği zaman aşımına uğradı.");
      return { ok: false, code: "ANALYSIS_TIMEOUT" };
    }
    // Sağlayıcı hatasının ayrıntısı yalnızca sunucu logunda kalır.
    console.error("[receipt-analyze] OpenAI isteği başarısız:", toLogMessage(error));
    return { ok: false, code: "ANALYSIS_FAILED" };
  }

  for (const item of response.output) {
    if (item.type !== "message") {
      continue;
    }
    for (const part of item.content) {
      if (part.type === "refusal") {
        console.error("[receipt-analyze] Model isteği reddetti.");
        return { ok: false, code: "MODEL_REFUSED" };
      }
    }
  }

  const parsed = response.output_parsed;
  if (!parsed) {
    console.error(
      "[receipt-analyze] output_parsed boş döndü. status:",
      response.status ?? "bilinmiyor",
    );
    return { ok: false, code: "ANALYSIS_FAILED" };
  }

  if (parsed.items.length === 0) {
    console.error("[receipt-analyze] Model hiç ürün satırı çıkaramadı.");
    return { ok: false, code: "RECEIPT_NOT_READABLE" };
  }

  /*
   * Modelin döndürdüğü her şey kapalı listeye indirgenir; uydurulmuş bir
   * etiket çeviri anahtarı olarak kullanılamaz.
   */
  const warnings = sanitizeWarningCodes(parsed.warnings);
  if (parsed.totalMinor === 0 && !warnings.includes("TOTAL_UNREADABLE")) {
    warnings.push("TOTAL_UNREADABLE");
  }

  // ID'ler modelden istenmez, burada güvenli biçimde eklenir.
  const candidate = {
    merchantName: parsed.merchantName,
    currency: normalizeCurrency(parsed.currency),
    items: parsed.items.map((item) => ({
      id: createItemId(),
      name: item.name,
      totalMinor: item.totalMinor,
    })),
    taxMinor: parsed.taxMinor,
    taxTreatment: parsed.taxTreatment,
    serviceChargeMinor: parsed.serviceChargeMinor,
    serviceChargeTreatment: parsed.serviceChargeTreatment,
    discountMinor: parsed.discountMinor,
    discountTreatment: parsed.discountTreatment,
    totalMinor: parsed.totalMinor,
    warnings,
  };

  const validated = ReceiptSchema.safeParse(candidate);
  if (!validated.success) {
    console.error("[receipt-analyze] Model çıktısı veri sözleşmesine uymadı.");
    return { ok: false, code: "INVALID_RECEIPT_DATA" };
  }

  return { ok: true, receipt: validated.data };
}
