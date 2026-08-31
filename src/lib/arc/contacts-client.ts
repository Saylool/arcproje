import { readApiErrorCode } from "../i18n/api-errors";
import { translate } from "../i18n/dictionary";
import { DEFAULT_LOCALE } from "../i18n/locale";

import { normalizeWalletAddress } from "./address";
import { validateCanonicalLabel } from "./labels";
import { MAX_LABEL_LENGTH } from "./payment-request";

/**
 * REHBER API'sinin ISTEMCI tarafi.
 *
 * Istek hicbir kullanici kimligi TASIMAZ: sunucu suzmeyi kendi oturumundan
 * yapar.
 *
 * SUNUCUNUN ADRESINE KORU KORUNE GUVENILMEZ. Donen her adres burada YENIDEN
 * `normalizeWalletAddress`ten gecirilir; gecmeyen satir sessizce atilir. Bir
 * oneri en fazla kaybolur — ama gecersiz bir adres asla giris alanina
 * yazilmaz.
 */

export const CONTACTS_ENDPOINT = "/api/contacts";

export type Contact = Readonly<{
  /** Checksum'li adres. */
  address: string;
  label: string;
  /** Unix saniye. */
  lastUsedAt: number;
}>;

export type ListContactsResponse =
  | { ok: true; contacts: readonly Contact[] }
  | { ok: false; message: string; code?: string };

function toContact(value: unknown): Contact | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const rawAddress = row.address;
  const address =
    typeof rawAddress === "string" ? normalizeWalletAddress(rawAddress) : null;
  const label = validateCanonicalLabel(row.label, MAX_LABEL_LENGTH);
  const lastUsedAt = row.lastUsedAt;

  if (
    address === null ||
    !label.ok ||
    typeof lastUsedAt !== "number" ||
    !Number.isSafeInteger(lastUsedAt) ||
    lastUsedAt <= 0
  ) {
    return null;
  }
  return Object.freeze({ address, label: label.value, lastUsedAt });
}

export async function listContactsFromServer(
  fetchImpl: typeof fetch = fetch,
): Promise<ListContactsResponse> {
  const failure = translate(DEFAULT_LOCALE, "contacts.failed");

  let response: Response;
  try {
    response = await fetchImpl(CONTACTS_ENDPOINT, {
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
  const rows = (payload as { contacts?: unknown }).contacts;
  if (!Array.isArray(rows)) {
    return { ok: false, message: failure };
  }

  /*
   * Bozuk satir TUM listeyi dusurmez: eksik bir oneri gorunmez ve zararsizdir,
   * kullanici adresi elle yazar. (Hesap listesinde tercih TERSIDIR.)
   */
  const contacts: Contact[] = [];
  for (const row of rows) {
    const contact = toContact(row);
    if (contact !== null) {
      contacts.push(contact);
    }
  }
  return { ok: true, contacts: Object.freeze(contacts) };
}
