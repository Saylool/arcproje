import { NextResponse } from "next/server";

import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";
import { prepareSharedBillPaymentOffer } from "@/lib/db/shared-bill-payment-service";
import {
  NO_STORE_HEADERS,
  errorResponse,
  readBillIdParam,
  readSessionCookie,
} from "@/lib/http/shared-bill-route-helpers";

/**
 * TAZE, SUNUCU KİMLİKLENDİRMELİ ÖDEME TEKLİFİ.
 *
 * İstek GÖVDESİ YOKTUR: istemci tutar, kur, alıcı ya da borç BİLDİREMEZ.
 * Hepsi imzalı manifestten, depodaki borç satırından ve sunucunun kendi kur
 * servisinden gelir.
 *
 * Bu uç nokta BORCU REZERVE ETMEZ ve HİÇBİR CÜZDAN ÇAĞIRMAZ. Rezervasyon
 * ayrı bir adımdır (`/payment/claim`).
 *
 * Yanıt YALNIZCA kimliği doğrulanmış borçlunun KENDİ teklifini taşır ve
 * ASLA önbelleklenmez.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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

  const prepared = await prepareSharedBillPaymentOffer({
    sessionToken: readSessionCookie(request),
    pathBillId: billId,
    repository,
    nowMs: Date.now(),
  });
  if (!prepared.ok) {
    return errorResponse(prepared.status, prepared.code, prepared.message);
  }

  return NextResponse.json(
    { offer: prepared.offer },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
