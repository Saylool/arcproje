import { NextResponse } from "next/server";

import {
  issueAccessChallenge,
  readAccessConfig,
} from "@/lib/db/shared-bill-access-service";
import { readBoundedBody } from "@/lib/http/bounded-body";
import {
  BODY_READ_DEADLINE_MS,
  MAX_ACCESS_BODY_BYTES,
  NO_STORE_HEADERS,
  errorResponse,
  readBillIdParam,
} from "@/lib/http/shared-bill-route-helpers";
import { scanForDuplicateKeys } from "@/lib/arc/json-duplicate-keys";

/**
 * Borçlu erişimi için meydan okuma üretir.
 *
 * ÜYELİK SIZDIRMAZ: hesabın var olup olmadığına BAKMAZ ve veritabanına
 * DOKUNMAZ. Geçerli biçimde bir hesap kimliği ve adres verildiği sürece her
 * zaman bir meydan okuma döner; gerçek doğrulama `resolve` adımındadır.
 *
 * Hiçbir hesap verisi dönmez.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ billId: string }> },
) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return errorResponse(
      400,
      "INVALID_CONTENT_TYPE",
      "İstek application/json biçiminde olmalı.",
    );
  }

  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_ACCESS_BODY_BYTES) {
    return errorResponse(413, "BODY_TOO_LARGE", "İstek gövdesi çok büyük.");
  }

  const bounded = await readBoundedBody(
    request,
    MAX_ACCESS_BODY_BYTES,
    BODY_READ_DEADLINE_MS,
  );
  if (bounded.status === "tooLarge") {
    return errorResponse(413, "BODY_TOO_LARGE", "İstek gövdesi çok büyük.");
  }
  if (bounded.status !== "ok") {
    return errorResponse(400, "INVALID_REQUEST", "İstek okunamadı.");
  }

  const scan = scanForDuplicateKeys(bounded.text);
  if (scan === "duplicate") {
    return errorResponse(
      400,
      "DUPLICATE_FIELD",
      "İstek gövdesinde yinelenen alan var.",
    );
  }
  if (scan === "malformed") {
    return errorResponse(400, "MALFORMED_JSON", "İstek gövdesi okunamadı.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bounded.text);
  } catch {
    return errorResponse(400, "MALFORMED_JSON", "İstek gövdesi okunamadı.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return errorResponse(400, "INVALID_BODY", "İstek gövdesi beklenen biçimde değil.");
  }
  const body = parsed as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (key !== "debtor") {
      return errorResponse(
        400,
        "UNEXPECTED_FIELD",
        "İstek gövdesinde beklenmeyen alan var.",
      );
    }
  }

  const billId = readBillIdParam((await context.params).billId);
  if (billId === null) {
    return errorResponse(400, "INVALID_BILL_ID", "Hesap kimliği geçersiz.");
  }

  /*
   * Hedef (audience) YALNIZCA sunucu değişkeninden gelir. Host, Origin,
   * Referer ve X-Forwarded-Host başlıklarına ASLA bakılmaz.
   */
  const config = readAccessConfig();
  if (!config.ok) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Erişim doğrulaması yapılandırılmamış. Sunucuda APP_ORIGIN ve SHARED_BILL_AUTH_SECRET tanımlı olmalı.",
    );
  }

  const issued = issueAccessChallenge({
    billId,
    debtor: body.debtor,
    nowMs: Date.now(),
    config: config.config,
  });
  if (!issued.ok) {
    return errorResponse(issued.status, issued.code, issued.message);
  }

  return NextResponse.json(
    { challenge: issued.challenge, tag: issued.tag },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
