import { NextResponse } from "next/server";

import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";
import { claimSharedBillPayment } from "@/lib/db/shared-bill-claim-service";
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
 * ATOMİK REZERVASYON — `kit.send` çağrılabilmesinden HEMEN ÖNCE.
 *
 * Gövde YALNIZCA teklif kimliği taşır. Tutar, kur, alıcı ve borç istemciden
 * KABUL EDİLMEZ; hepsi saklanan tekliften ve borç satırından okunur ve
 * mikro USDC burada YENİDEN türetilip birebir karşılaştırılır.
 *
 * Başarılı yanıt, gönderim sınırına verilecek YETKİLİ ve DEĞİŞMEZ snapshot'ı
 * döndürür. Bu uç nokta hiçbir cüzdan çağırmaz ve hiçbir işlem göndermez.
 *
 * SINIR: veritabanı bir AKILLI SÖZLEŞME DEĞİLDİR. Rezervasyon, uygulama
 * üzerinden yinelenen denemeyi engeller; kullanıcının uygulama DIŞINDA
 * ikinci bir transfer göndermesini engelleyemez.
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

  const claimed = await claimSharedBillPayment({
    bodyText: bounded.text,
    sessionToken: readSessionCookie(request),
    pathBillId: billId,
    repository,
    nowMs: Date.now(),
  });
  if (!claimed.ok) {
    return errorResponse(claimed.status, claimed.code, claimed.message);
  }

  return NextResponse.json(
    {
      attemptId: claimed.claim.attemptId,
      offerId: claimed.claim.offerId,
      reservedAt: claimed.claim.reservedAt,
      snapshot: claimed.claim.snapshot,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
