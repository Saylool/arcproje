import { NextResponse } from "next/server";

import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";
import {
  SHARED_BILL_SESSION_COOKIE,
  readAuthenticatedDebtView,
} from "@/lib/db/shared-bill-access-service";
import {
  NO_STORE_HEADERS,
  errorResponse,
  readBillIdParam,
} from "@/lib/http/shared-bill-route-helpers";

/**
 * Kimliği doğrulanmış borçlunun TEK satırlık görünümü.
 *
 * Yalnızca imzalı manifest, alıcının açık adresi/etiketi, çağıranın KENDİ borç
 * satırı, o satırın Merkle kanıtı, hesabın bitişi ve hassas olmayan durumu
 * döner. Başka hiçbir borç satırı, adres, etiket veya toplam katılımcı verisi
 * DÖNMEZ.
 *
 * Oturum çerezi olmadan hiçbir hesap verisi verilmez.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Çerezi başlıktan güvenli biçimde okur; ham jeton loglanmaz. */
function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (header === null) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name === SHARED_BILL_SESSION_COOKIE) {
      const value = part.slice(separator + 1).trim();
      return value === "" ? null : value;
    }
  }
  return null;
}

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

  const view = await readAuthenticatedDebtView({
    sessionToken: readSessionCookie(request),
    pathBillId: billId,
    repository,
    nowMs: Date.now(),
  });

  if (!view.ok) {
    return errorResponse(view.status, view.code, view.message);
  }

  return NextResponse.json(
    {
      manifest: view.manifest,
      recipientSignature: view.recipientSignature,
      recipient: view.recipient,
      debt: view.debt,
      proof: view.proof,
      billExpiresAt: view.billExpiresAt,
      status: view.status,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
