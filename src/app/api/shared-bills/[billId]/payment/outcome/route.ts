import { NextResponse } from "next/server";

import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";
import { reportClientOutcome } from "@/lib/db/shared-bill-settlement-service";
import { readBoundedBody } from "@/lib/http/bounded-body";
import {
  BODY_READ_DEADLINE_MS,
  MAX_ACCESS_BODY_BYTES,
  NO_STORE_HEADERS,
  errorResponse,
  readBillIdParam,
  readSessionCookie,
} from "@/lib/http/shared-bill-route-helpers";

/**
 * İSTEMCİ SONUCU BİLDİRİMİ.
 *
 * Bildirilebilecek sonuçlar KATI bir enum'dur ve "başarılı" ONLARDAN BİRİ
 * DEĞİLDİR: istemci bir ödemeyi başarılı ilan EDEMEZ. Elinde bir işlem
 * kimliği varsa `submitted` bildirir, sunucu makbuzu kendisi doğrular.
 *
 * KÖTÜ NİYETLİ İSTEMCİ "reddedildi" diye YALAN SÖYLEYEBİLİR ve uygulama
 * düzeyindeki rezervasyonu açtırabilir. Bu ZİNCİR ÜSTÜ BİR GARANTİ DEĞİLDİR;
 * cüzdan her transfer için borçlunun KENDİ onayını istemeye devam eder.
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

  const billId = readBillIdParam((await context.params).billId);
  if (billId === null) {
    return errorResponse(400, "INVALID_BILL_ID", "Hesap kimliği geçersiz.");
  }

  const repository = await createNeonSharedBillRepository();
  if (repository === null) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Paylaşılan hesap servisi yapılandırılmamış. Sunucuda DATABASE_URL tanımlı değil.",
    );
  }

  const reported = await reportClientOutcome({
    bodyText: bounded.text,
    sessionToken: readSessionCookie(request),
    pathBillId: billId,
    repository,
    nowMs: Date.now(),
  });
  if (!reported.ok) {
    return errorResponse(reported.status, reported.code, reported.message);
  }

  return NextResponse.json(reported.report, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}
