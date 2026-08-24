import { NextResponse } from "next/server";

import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";
import {
  readAccessConfig,
  resolveSharedBillAccess,
} from "@/lib/db/shared-bill-access-service";
import { readBoundedBody } from "@/lib/http/bounded-body";
import {
  BODY_READ_DEADLINE_MS,
  MAX_ACCESS_BODY_BYTES,
  NO_STORE_HEADERS,
  buildSessionCookie,
  errorResponse,
  readBillIdParam,
} from "@/lib/http/shared-bill-route-helpers";

/**
 * Meydan okumayı çözer ve KISA ÖMÜRLÜ bir oturum kurar.
 *
 * HAM oturum jetonu YALNIZCA HttpOnly + SameSite=Strict çerezde döner. Yanıt
 * gövdesinde, URL'de, logda veya HTML'de ASLA yer almaz. Depoda yalnızca
 * jetonun SHA-256 özeti saklanır.
 *
 * Yanıt hiçbir hesap verisi taşımaz; borç `GET /me` ile alınır.
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

  const config = readAccessConfig();
  if (!config.ok) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Erişim doğrulaması yapılandırılmamış. Sunucuda APP_ORIGIN ve SHARED_BILL_AUTH_SECRET tanımlı olmalı.",
    );
  }

  const repository = await createNeonSharedBillRepository();
  if (repository === null) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Paylaşılan hesap servisi yapılandırılmamış. Sunucuda DATABASE_URL tanımlı değil.",
    );
  }

  const nowMs = Date.now();
  const resolved = await resolveSharedBillAccess({
    bodyText: bounded.text,
    pathBillId: billId,
    repository,
    nowMs,
    config: config.config,
  });

  if (!resolved.ok) {
    return errorResponse(resolved.status, resolved.code, resolved.message);
  }

  const isProduction = process.env.NODE_ENV === "production";
  const response = NextResponse.json(
    // Gövde BİLEREK boştur: jeton yalnızca çerezdedir.
    { authenticated: true },
    { status: 200, headers: NO_STORE_HEADERS },
  );
  response.headers.set(
    "set-cookie",
    buildSessionCookie(
      resolved.sessionToken,
      Math.floor((resolved.sessionExpiresAtMs - nowMs) / 1000),
      isProduction,
    ),
  );
  return response;
}
