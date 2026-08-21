import { NextResponse } from "next/server";

import {
  extractReceipt,
  isReceiptAnalysisConfigured,
  type ExtractionFailureCode,
} from "@/lib/receipt/extract";

export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
/** multipart gövdesinin dosya dışındaki payı için pay bırakılır. */
const MAX_BODY_SIZE_BYTES = MAX_FILE_SIZE_BYTES + 64 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const FAILURE_RESPONSES: Record<
  ExtractionFailureCode,
  { status: number; message: string }
> = {
  MODEL_REFUSED: {
    status: 422,
    message:
      "Bu görsel analiz edilemedi. Lütfen fişin net ve tam bir fotoğrafını dene.",
  },
  RECEIPT_NOT_READABLE: {
    status: 422,
    message:
      "Fişteki ürünler okunamadı. Daha net, iyi aydınlatılmış ve fişin tamamını gösteren bir fotoğraf dene.",
  },
  INVALID_RECEIPT_DATA: {
    status: 422,
    message: "Fiş verisi beklenen biçimde alınamadı. Lütfen tekrar dene.",
  },
  ANALYSIS_FAILED: {
    status: 502,
    message: "Analiz servisine şu anda ulaşılamıyor. Lütfen birazdan tekrar dene.",
  },
};

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Dosyanın gerçek türünü içeriğinden tespit eder. Client'ın bildirdiği MIME
 * type'a güvenilmez.
 */
function detectImageMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    bytes.length >= pngSignature.length &&
    pngSignature.every((byte, index) => bytes[index] === byte)
  ) {
    return "image/png";
  }

  // "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return errorResponse(
      400,
      "INVALID_CONTENT_TYPE",
      "İstek multipart/form-data biçiminde olmalı.",
    );
  }

  // Büyük gövdeyi belleğe almadan önce ucuz bir ön kontrol.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_SIZE_BYTES) {
    return errorResponse(
      413,
      "FILE_TOO_LARGE",
      "Görsel çok büyük. En fazla 10 MB yükleyebilirsin.",
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "İstek okunamadı. Lütfen tekrar dene.",
    );
  }

  const receiptField = formData.get("receipt");
  if (!(receiptField instanceof File)) {
    return errorResponse(400, "MISSING_FILE", "Fiş görseli bulunamadı.");
  }
  if (receiptField.size === 0) {
    return errorResponse(
      400,
      "EMPTY_FILE",
      "Dosya boş görünüyor. Lütfen başka bir görsel dene.",
    );
  }
  if (receiptField.size > MAX_FILE_SIZE_BYTES) {
    return errorResponse(
      413,
      "FILE_TOO_LARGE",
      "Görsel çok büyük. En fazla 10 MB yükleyebilirsin.",
    );
  }
  if (!ALLOWED_MIME_TYPES.has(receiptField.type)) {
    return errorResponse(
      415,
      "UNSUPPORTED_FILE_TYPE",
      "Yalnızca JPG, PNG ve WEBP dosyaları desteklenir.",
    );
  }

  const bytes = new Uint8Array(await receiptField.arrayBuffer());
  const detectedMimeType = detectImageMimeType(bytes);
  if (detectedMimeType === null || detectedMimeType !== receiptField.type) {
    return errorResponse(
      415,
      "UNSUPPORTED_FILE_TYPE",
      "Dosya geçerli bir JPG, PNG veya WEBP görseli değil.",
    );
  }

  // Key yoksa hiçbir sağlayıcı çağrısı yapılmaz.
  if (!isReceiptAnalysisConfigured()) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Fiş analizi şu anda yapılandırılmamış. Sunucuda OPENAI_API_KEY tanımlı değil.",
    );
  }

  // Görsel yalnızca bellekte tutulur; diske yazılmaz, veritabanına kaydedilmez.
  const imageDataUrl = `data:${detectedMimeType};base64,${Buffer.from(bytes).toString("base64")}`;

  try {
    const result = await extractReceipt(imageDataUrl);
    if (!result.ok) {
      const failure = FAILURE_RESPONSES[result.code];
      return errorResponse(failure.status, result.code, failure.message);
    }
    return NextResponse.json({ receipt: result.receipt }, { status: 200 });
  } catch (error) {
    console.error(
      "[receipt-analyze] Beklenmeyen hata:",
      error instanceof Error ? error.message : "bilinmeyen hata",
    );
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Beklenmeyen bir hata oluştu. Lütfen tekrar dene.",
    );
  }
}
