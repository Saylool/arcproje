import { NextResponse } from "next/server";

import { createArcTestnetRpcClient } from "@/lib/arc/arc-rpc";
import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";
import { finalizeSharedBillPayment } from "@/lib/db/shared-bill-settlement-service";
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
 * ZİNCİR ÜSTÜ MUTABAKAT — borç YALNIZCA burada `paid` olur.
 *
 * Gövde YALNIZCA deneme kimliği ve aday işlem hash'i taşır. Tutar, gönderen
 * ve alıcı SAKLANAN denemeden okunur; istemcinin bildirdiği hiçbir ekonomik
 * değer kullanılmaz ve istemcinin "başarılı" iddiası KANIT SAYILMAZ.
 *
 * Sunucu Arc Testnet'e KENDİSİ bağlanır, makbuzu okur, USDC ERC-20
 * sözleşmesinin `Transfer` kayıtlarını katı biçimde çözer ve borçlu → alıcı
 * transferlerinin BigInt TOPLAMININ beklenen tutara BİREBİR eşit olmasını
 * arar.
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

  const finalized = await finalizeSharedBillPayment({
    bodyText: bounded.text,
    sessionToken: readSessionCookie(request),
    pathBillId: billId,
    repository,
    nowMs: Date.now(),
    // Arc Testnet RPC — yalnızca sunucuda, yalnızca resmî uç nokta.
    client: createArcTestnetRpcClient(),
  });
  if (!finalized.ok) {
    return errorResponse(finalized.status, finalized.code, finalized.message);
  }

  return NextResponse.json(finalized.report, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}
