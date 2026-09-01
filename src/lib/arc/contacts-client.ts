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
  /** `saved`: kullanicinin kaydettigi kisi. `history`: gecmisten turetilmis. */
  source: "saved" | "history";
  /** Yalnizca `saved` icin; duzenleme ve silme bunun uzerinden yapilir. */
  contactId: string | null;
  label: string;
  /** Checksum'li adres. */
  address: string;
  /** Yalnizca `history` icin; kayitli kisinin yasi anlamsizdir. */
  lastUsedAt: number | null;
}>;

const CONTACT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const { source, contactId, lastUsedAt } = row;

  if (address === null || !label.ok) {
    return null;
  }

  /*
   * KAYNAK, SEKLI BELIRLER. Kayitli bir kisinin kimligi olmali ve yasi
   * olmamalidir; gecmisten gelenin tersi. Karisik bir satir kabul edilseydi
   * arayuz "kaydet" dugmesini kayitli bir kisiye de gosterebilirdi.
   */
  if (source === "saved") {
    if (typeof contactId !== "string" || !CONTACT_ID.test(contactId)) {
      return null;
    }
    return Object.freeze({
      source: "saved" as const,
      contactId,
      label: label.value,
      address,
      lastUsedAt: null,
    });
  }

  if (source === "history") {
    if (
      contactId !== null ||
      typeof lastUsedAt !== "number" ||
      !Number.isSafeInteger(lastUsedAt) ||
      lastUsedAt <= 0
    ) {
      return null;
    }
    return Object.freeze({
      source: "history" as const,
      contactId: null,
      label: label.value,
      address,
      lastUsedAt,
    });
  }

  return null;
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

/* ------------------------------------------------------------------------ */
/* KAYITLI KISI YAZMA ISLEMLERI                                             */
/* ------------------------------------------------------------------------ */

export type ContactWriteResponse =
  | { ok: true }
  | { ok: false; code: string | null };

async function writeContact(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<ContactWriteResponse> {
  try {
    const response = await fetchImpl(url, {
      method,
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    if (response.ok) {
      return { ok: true };
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { ok: false, code: readApiErrorCode(payload) };
  } catch {
    return { ok: false, code: null };
  }
}

export function saveContactOnServer(
  contact: { label: string; address: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ContactWriteResponse> {
  return writeContact(CONTACTS_ENDPOINT, "POST", contact, fetchImpl);
}

export function updateContactOnServer(
  contactId: string,
  contact: { label: string; address: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ContactWriteResponse> {
  /* Kimlik YOLA girer; bicimi once burada dogrulanir. */
  if (!CONTACT_ID.test(contactId)) {
    return Promise.resolve({ ok: false, code: "CONTACT_NOT_FOUND" });
  }
  return writeContact(
    `${CONTACTS_ENDPOINT}/${contactId}`,
    "PATCH",
    contact,
    fetchImpl,
  );
}

export function deleteContactOnServer(
  contactId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ContactWriteResponse> {
  if (!CONTACT_ID.test(contactId)) {
    return Promise.resolve({ ok: false, code: "CONTACT_NOT_FOUND" });
  }
  return writeContact(
    `${CONTACTS_ENDPOINT}/${contactId}`,
    "DELETE",
    undefined,
    fetchImpl,
  );
}

/** TUM defteri siler. Hangi defter oldugunu sunucu oturumdan bilir. */
export function deleteAllContactsOnServer(
  fetchImpl: typeof fetch = fetch,
): Promise<ContactWriteResponse> {
  return writeContact(CONTACTS_ENDPOINT, "DELETE", undefined, fetchImpl);
}
