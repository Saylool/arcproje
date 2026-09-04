import { NextResponse } from "next/server";

import {
  authenticateRequest,
  type AuthenticateRequest,
} from "@/lib/auth/session";
import {
  extractReceipt,
  isReceiptAnalysisConfigured,
  type ExtractionFailureCode,
} from "@/lib/receipt/extract";
import {
  resolveImageMimeType,
  type ImageTypeResolution,
} from "@/lib/receipt/image-type";
import {
  appUserStillExists,
  consumeAnalysisQuota,
} from "@/lib/db/analysis-quota-service";
import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";

export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
/** multipart gövdesinin dosya dışındaki payı için pay bırakılır. */
const MAX_BODY_SIZE_BYTES = MAX_FILE_SIZE_BYTES + 64 * 1024;

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
  ANALYSIS_TIMEOUT: {
    status: 504,
    message:
      "Analiz zaman aşımına uğradı. Lütfen tekrar dene; sorun sürerse daha küçük bir görsel deneyebilirsin.",
  },
  ANALYSIS_FAILED: {
    status: 502,
    message: "Analiz servisine şu anda ulaşılamıyor. Lütfen birazdan tekrar dene.",
  },
};

const NO_STORE_HEADERS = {
  "cache-control": "no-store, private, max-age=0",
} as const;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: NO_STORE_HEADERS },
  );
}

const IMAGE_TYPE_MESSAGES: Record<
  Extract<ImageTypeResolution, { ok: false }>["reason"],
  string
> = {
  unsupportedDeclared: "Yalnızca JPG, PNG ve WEBP dosyaları desteklenir.",
  notAnImage: "Dosya geçerli bir JPG, PNG veya WEBP görseli değil.",
  mismatch: "Dosyanın içeriği bildirilen dosya türüyle eşleşmiyor.",
};

type ReceiptRouteDependencies = Readonly<{
  authenticate: AuthenticateRequest;
  configured: typeof isReceiptAnalysisConfigured;
  extract: typeof extractReceipt;
  createRepository: typeof createNeonSharedBillRepository;
  consumeQuota: typeof consumeAnalysisQuota;
  userExists: typeof appUserStillExists;
  now: () => number;
}>;

export function createReceiptAnalyzePost(
  dependencies: Partial<ReceiptRouteDependencies> = {},
) {
  const resolved: ReceiptRouteDependencies = {
    authenticate: dependencies.authenticate ?? authenticateRequest,
    configured: dependencies.configured ?? isReceiptAnalysisConfigured,
    extract: dependencies.extract ?? extractReceipt,
    createRepository:
      dependencies.createRepository ?? createNeonSharedBillRepository,
    consumeQuota: dependencies.consumeQuota ?? consumeAnalysisQuota,
    userExists: dependencies.userExists ?? appUserStillExists,
    now: dependencies.now ?? (() => Date.now()),
  };
  return (request: Request) => receiptAnalyzePost(request, resolved);
}

async function receiptAnalyzePost(
  request: Request,
  dependencies: ReceiptRouteDependencies,
) {
  /*
   * İLK işlem auth'tur. Gövde türüne, boyutuna veya FormData'ya dahi auth
   * sonucundan önce bakılmaz; yetkisiz görsel belleğe alınamaz.
   */
  const authentication = await dependencies.authenticate();
  if (authentication.status === "unavailable") {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Kimlik doğrulama servisi şu anda kullanılamıyor.",
    );
  }
  if (authentication.status === "signedOut") {
    return errorResponse(
      401,
      "AUTH_REQUIRED",
      "Bu işlem için oturum açman gerekiyor.",
    );
  }

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
  const bytes = new Uint8Array(await receiptField.arrayBuffer());
  // Bildirilen MIME type'a tek başına güvenilmez; içerik imzasıyla uzlaştırılır.
  const imageType = resolveImageMimeType(receiptField.type, bytes);
  if (!imageType.ok) {
    return errorResponse(
      415,
      "UNSUPPORTED_FILE_TYPE",
      IMAGE_TYPE_MESSAGES[imageType.reason],
    );
  }

  // Key yoksa hiçbir sağlayıcı çağrısı yapılmaz.
  if (!dependencies.configured()) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Fiş analizi şu anda yapılandırılmamış. Sunucuda OPENAI_API_KEY tanımlı değil.",
    );
  }

  /*
   * KOTA BURADA DÜŞÜLÜR: bütün doğrulamalardan SONRA, sağlayıcıya gitmeden
   * ÖNCE. Bozuk bir dosya yüzünden hak yanmaz; sağlayıcıya ulaşan her deneme
   * ise sayılır, çünkü parayı harcatan odur.
   */
  const repository = await dependencies.createRepository();
  if (repository === null) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Analiz kotası okunamıyor. Sunucuda DATABASE_URL tanımlı değil.",
    );
  }
  /*
   * KULLANICI HÂLÂ VAR MI?
   *
   * Oturum bir JWT'dir ve sunucu onu iptal edemez: hesabını silen biri,
   * çerezi duran BAŞKA bir cihazdan istek göndermeye devam edebilir. Yabancı
   * anahtarı olan tablolarda bu kendiliğinden durur; kota tablosunun yabancı
   * anahtarı YOKTUR, yani para harcayan yol tam da bu kontrolsüz kalan yoldu.
   *
   * Erişilememe "yok" ile karıştırılmaz: 401 dönmek, var olan hesabıyla
   * gelen kullanıcıyı dışarı atardı.
   */
  const exists = await dependencies.userExists({
    userId: authentication.user.id,
    repository,
  });
  if (!exists.ok) {
    return errorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      "Hesap doğrulanamıyor. Lütfen birazdan tekrar dene.",
    );
  }
  if (!exists.exists) {
    return errorResponse(
      401,
      "ACCOUNT_DELETED",
      "Bu hesap silinmiş. Devam etmek için yeniden giriş yapman gerekiyor.",
    );
  }

  const quota = await dependencies.consumeQuota({
    userId: authentication.user.id,
    repository,
    nowMs: dependencies.now(),
  });
  if (!quota.ok) {
    return errorResponse(quota.status, quota.code, quota.message);
  }

  // Görsel yalnızca bellekte tutulur; diske yazılmaz, veritabanına kaydedilmez.
  const imageDataUrl = `data:${imageType.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;

  try {
    const result = await dependencies.extract(imageDataUrl);
    if (!result.ok) {
      const failure = FAILURE_RESPONSES[result.code];
      return errorResponse(failure.status, result.code, failure.message);
    }
    /* Kalan hak yanıtta döner ki kullanıcı kaç analizi kaldığını görsün. */
    return NextResponse.json(
      { receipt: result.receipt, remainingAnalyses: quota.remaining },
      { status: 200 },
    );
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

export const POST = createReceiptAnalyzePost();
