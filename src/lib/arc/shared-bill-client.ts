import { SHARED_BILL_ROUTE } from "./shared-bill";
import { readApiErrorCode } from "./../i18n/api-errors";
import { translate } from "./../i18n/dictionary";
import { DEFAULT_LOCALE } from "./../i18n/locale";

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
  | { ok: false; message: string; code?: string };

const GENERIC_FAILURE = translate(DEFAULT_LOCALE, "sharedBill.createFailed");

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
    /*
     * KOD tasinir, METIN tasinmaz: gosterilecek cumleyi arayuz kendi
     * sozlugunden ve etkin dilden secer. Sunucunun hazir metni yalnizca
     * geriye donuk uyumluluk icin `message` alaninda kalir.
     */
    const code = readApiErrorCode(payload);
    const message =
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { error?: { message?: unknown } }).error?.message ===
        "string"
        ? ((payload as { error: { message: string } }).error.message)
        : GENERIC_FAILURE;
    return code === null
      ? { ok: false, message }
      : { ok: false, message, code };
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

/* ------------------------------------------------------------------------ */
/* OLUSTURULAN HESAPLARIN LISTESI                                            */
/* ------------------------------------------------------------------------ */

/**
 * Oturum acmis kullanicinin KENDI olusturdugu hesaplar.
 *
 * Istek hicbir kullanici kimligi TASIMAZ: sunucu suzmeyi kendi oturumundan
 * yapar. Boyle bir parametre gonderilseydi, oturum acmis herkes baskasinin
 * listesini isteyebilirdi.
 *
 * Yanit KATI dogrulanir ve TUMU-YA-DA-HICBIRI kabul edilir: tek bir satir bile
 * beklenen bicimde degilse liste hic gosterilmez. Eksik bir liste, kullanicinin
 * "hesabim kaybolmus" diye yanlis sonuc cikarmasina yol acardi.
 */
export type MyBillSummary = Readonly<{
  billId: string;
  /** Kimlikten YENIDEN kurulur; sunucunun metnine guvenilmez. */
  path: string;
  issuedAt: number;
  expiresAt: number;
  status: "open" | "closed";
  debtCount: number;
  paidCount: number;
  /** KANONIK ondalik tam sayi metni; `number`a indirgenmez. */
  totalTryMinor: string;
  paidTryMinor: string;
}>;

export type ListMyBillsResponse =
  | { ok: true; bills: readonly MyBillSummary[] }
  | { ok: false; message: string; code?: string };

const CANONICAL_MINOR = /^(0|[1-9][0-9]{0,29})$/;
const MAX_DEBTS_PER_BILL = 50;

function isSafeEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function toMyBillSummary(value: unknown): MyBillSummary | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const { billId, issuedAt, expiresAt, status, totalTryMinor, paidTryMinor } =
    row;
  const debtCount = row.debtCount;
  const paidCount = row.paidCount;

  if (
    typeof billId !== "string" ||
    !BILL_ID.test(billId) ||
    !isSafeEpoch(issuedAt) ||
    !isSafeEpoch(expiresAt) ||
    expiresAt <= issuedAt ||
    (status !== "open" && status !== "closed") ||
    typeof debtCount !== "number" ||
    !Number.isSafeInteger(debtCount) ||
    debtCount < 1 ||
    debtCount > MAX_DEBTS_PER_BILL ||
    typeof paidCount !== "number" ||
    !Number.isSafeInteger(paidCount) ||
    paidCount < 0 ||
    paidCount > debtCount ||
    typeof totalTryMinor !== "string" ||
    !CANONICAL_MINOR.test(totalTryMinor) ||
    typeof paidTryMinor !== "string" ||
    !CANONICAL_MINOR.test(paidTryMinor) ||
    BigInt(paidTryMinor) > BigInt(totalTryMinor)
  ) {
    return null;
  }

  return Object.freeze({
    billId,
    // Yol SUNUCUDAN gelen metinden degil, dogrulanmis kimlikten kurulur.
    path: `${SHARED_BILL_ROUTE}/${billId}`,
    issuedAt,
    expiresAt,
    status,
    debtCount,
    paidCount,
    totalTryMinor,
    paidTryMinor,
  });
}

export async function listMyBillsFromServer(
  fetchImpl: typeof fetch = fetch,
): Promise<ListMyBillsResponse> {
  const failure = translate(DEFAULT_LOCALE, "myBills.failed");

  let response: Response;
  try {
    response = await fetchImpl(SHARED_BILLS_ENDPOINT, {
      method: "GET",
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: failure };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, message: failure };
  }

  if (!response.ok) {
    const code = readApiErrorCode(payload);
    return code === null
      ? { ok: false, message: failure }
      : { ok: false, message: failure, code };
  }

  if (typeof payload !== "object" || payload === null) {
    return { ok: false, message: failure };
  }
  const rows = (payload as { bills?: unknown }).bills;
  if (!Array.isArray(rows)) {
    return { ok: false, message: failure };
  }

  const bills: MyBillSummary[] = [];
  for (const row of rows) {
    const summary = toMyBillSummary(row);
    if (summary === null) {
      return { ok: false, message: failure };
    }
    bills.push(summary);
  }
  return { ok: true, bills: Object.freeze(bills) };
}
