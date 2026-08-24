import { SHARED_BILL_ROUTE } from "./shared-bill";

/**
 * Paylasilan hesap olusturma API'sinin ISTEMCI tarafi.
 *
 * Yanit KATI biçimde dogrulanir: sunucudan gelen bir metin dogrudan
 * kullaniciya baglanti olarak gosterilmez. Yalnizca beklenen sekil ve beklenen
 * kimlik bicimi kabul edilir.
 */

export const SHARED_BILLS_ENDPOINT = "/api/shared-bills";

const BILL_ID = /^0x[0-9a-f]{64}$/;

export type CreateSharedBillResponse =
  | { ok: true; billId: string; path: string; expiresAt: number }
  | { ok: false; message: string };

const GENERIC_FAILURE =
  "Paylasilan hesap olusturulamadi. Lutfen tekrar dene.";

export async function createSharedBillOnServer(
  body: { manifest: unknown; debts: unknown; signature: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CreateSharedBillResponse> {
  let response: Response;
  try {
    response = await fetchImpl(SHARED_BILLS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: GENERIC_FAILURE };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, message: GENERIC_FAILURE };
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { error?: { message?: unknown } }).error?.message ===
        "string"
        ? ((payload as { error: { message: string } }).error.message)
        : GENERIC_FAILURE;
    return { ok: false, message };
  }

  if (typeof payload !== "object" || payload === null) {
    return { ok: false, message: GENERIC_FAILURE };
  }
  const record = payload as Record<string, unknown>;
  const billId = record.billId;
  const expiresAt = record.expiresAt;
  if (
    typeof billId !== "string" ||
    !BILL_ID.test(billId) ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= 0
  ) {
    return { ok: false, message: GENERIC_FAILURE };
  }

  /*
   * Yol SUNUCUDAN gelen metinden degil, dogrulanmis kimlikten YENIDEN kurulur.
   * Boylece sunucu yanlis veya kotucul bir yol dondurse bile kullaniciya
   * gosterilen baglanti her zaman beklenen bicimdedir.
   */
  return {
    ok: true,
    billId,
    path: `${SHARED_BILL_ROUTE}/${billId}`,
    expiresAt,
  };
}
