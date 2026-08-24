import { NextResponse } from "next/server";

import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";
import { readSharedBillPaymentStatus } from "@/lib/db/shared-bill-settlement-service";
import {
  NO_STORE_HEADERS,
  errorResponse,
  readBillIdParam,
  readSessionCookie,
} from "@/lib/http/shared-bill-route-helpers";

/**
 * Kimliği doğrulanmış borçlunun KENDİ ödeme durumu.
 *
 * Başka bir borç satırı, başka bir katılımcı, tam borç listesi, oturum jetonu
 * ya da veritabanı ayrıntısı DÖNMEZ. Yanıt ASLA önbelleklenmez.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ billId: string }> },
) {
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

  const status = await readSharedBillPaymentStatus({
    sessionToken: readSessionCookie(request),
    pathBillId: billId,
    repository,
    nowMs: Date.now(),
  });
  if (!status.ok) {
    return errorResponse(status.status, status.code, status.message);
  }

  return NextResponse.json(status.status, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}
