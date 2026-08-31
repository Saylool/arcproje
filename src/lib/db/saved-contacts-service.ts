import { normalizeWalletAddress } from "@/lib/arc/address";
import { validateCanonicalLabel } from "@/lib/arc/labels";
import { MAX_LABEL_LENGTH } from "@/lib/arc/payment-request";

import { isAppUserId } from "./shared-bill-listing-service";
import type {
  SavedContact,
  SharedBillRepository,
} from "./shared-bill-repository";

/**
 * KAYITLI KİŞİLER — kullanıcının kendi adres defteri.
 *
 * Bu, "kişi adı → cüzdan adresi" eşleşmesinin ASIL kaynağıdır. Geçmişten
 * türetilen öneriler yalnızca burada bulunamayan kişiler için devreye girer.
 *
 * SÜZME OTURUMDAN GELİR. Her işlem `userId` ile sınırlıdır; istemci hangi
 * kullanıcının defterine dokunduğunu SÖYLEYEMEZ.
 *
 * ETİKET BİR YETKİ DEĞİLDİR. Kaydedilen adres, elle yazılmış gibi AYNI
 * doğrulamadan geçer ve imzalamadan önce kullanıcıya tam hâliyle gösterilir.
 */

/** Defter üst sınırı. Kişi başına; sorgunun içinde de uygulanır. */
export const MAX_SAVED_CONTACTS = 200;

export type SavedContactsResult =
  | { ok: true; contacts: readonly SavedContact[] }
  | { ok: false; status: number; code: string; message: string };

export type MutateContactResult =
  | { ok: true; contact: SavedContact }
  | { ok: false; status: number; code: string; message: string };

export type DeleteContactsResult =
  | { ok: true; deleted: number }
  | { ok: false; status: number; code: string; message: string };

const UNAVAILABLE = {
  ok: false as const,
  status: 503,
  code: "SERVICE_UNAVAILABLE",
  message: "Kayıtlı kişiler şu anda okunamıyor. Lütfen birazdan tekrar dene.",
};

function failure(status: number, code: string, message: string) {
  return { ok: false as const, status, code, message };
}

/**
 * Ad ve adresi UYGULAMA SINIRINDA doğrular.
 *
 * Adres burada checksum'lı biçime çevrilir; depoya ham istemci metni GİRMEZ.
 */
function readContactInput(
  label: unknown,
  address: unknown,
):
  | { ok: true; label: string; address: string }
  | { ok: false; status: number; code: string; message: string } {
  const validLabel = validateCanonicalLabel(
    typeof label === "string" ? label.trim() : label,
    MAX_LABEL_LENGTH,
  );
  if (!validLabel.ok) {
    return failure(
      400,
      "INVALID_LABEL",
      "Kişi adı geçersiz. En fazla 40 karakter olabilir ve boş bırakılamaz.",
    );
  }

  const normalized =
    typeof address === "string" ? normalizeWalletAddress(address) : null;
  if (normalized === null) {
    return failure(400, "INVALID_ADDRESS", "Cüzdan adresi geçersiz.");
  }

  return { ok: true, label: validLabel.value, address: normalized };
}

export async function listSavedContacts(input: {
  userId: string;
  repository: SharedBillRepository;
}): Promise<SavedContactsResult> {
  if (!isAppUserId(input.userId)) {
    return UNAVAILABLE;
  }
  const listed = await input.repository.listSavedContacts({
    userId: input.userId,
    limit: MAX_SAVED_CONTACTS,
  });
  return listed.ok ? { ok: true, contacts: listed.contacts } : UNAVAILABLE;
}

export async function saveContact(input: {
  userId: string;
  repository: SharedBillRepository;
  label: unknown;
  address: unknown;
  createContactId: () => string;
}): Promise<MutateContactResult> {
  if (!isAppUserId(input.userId)) {
    return UNAVAILABLE;
  }
  const parsed = readContactInput(input.label, input.address);
  if (!parsed.ok) {
    return parsed;
  }

  const saved = await input.repository.saveContact({
    userId: input.userId,
    contactId: input.createContactId(),
    label: parsed.label,
    address: parsed.address,
    limit: MAX_SAVED_CONTACTS,
  });

  if (saved.ok) {
    return { ok: true, contact: saved.contact };
  }
  if (saved.reason === "duplicateAddress") {
    return failure(
      409,
      "CONTACT_ADDRESS_EXISTS",
      "Bu cüzdan adresi zaten kayıtlı.",
    );
  }
  if (saved.reason === "duplicateLabel") {
    /*
     * İki kişiye aynı ad verilemez: "Ahmet yaz, adresi gelsin" ancak tek bir
     * Ahmet varsa güvenlidir. Belirsizlik burada yanlış adres demektir.
     */
    return failure(
      409,
      "CONTACT_LABEL_EXISTS",
      "Bu ad başka bir kişide kullanılıyor. Farklı bir ad seç.",
    );
  }
  if (saved.reason === "limitReached") {
    return failure(
      409,
      "CONTACT_LIMIT_REACHED",
      "Kayıtlı kişi sınırına ulaştın. Yeni biri için önce birini sil.",
    );
  }
  return UNAVAILABLE;
}

export async function updateSavedContact(input: {
  userId: string;
  repository: SharedBillRepository;
  contactId: string;
  label: unknown;
  address: unknown;
}): Promise<MutateContactResult> {
  if (!isAppUserId(input.userId)) {
    return UNAVAILABLE;
  }
  const parsed = readContactInput(input.label, input.address);
  if (!parsed.ok) {
    return parsed;
  }

  const updated = await input.repository.updateContact({
    userId: input.userId,
    contactId: input.contactId,
    label: parsed.label,
    address: parsed.address,
  });

  if (updated.ok) {
    return { ok: true, contact: updated.contact };
  }
  if (updated.reason === "notFound") {
    return failure(404, "CONTACT_NOT_FOUND", "Kayıtlı kişi bulunamadı.");
  }
  if (updated.reason === "duplicateAddress") {
    return failure(
      409,
      "CONTACT_ADDRESS_EXISTS",
      "Bu cüzdan adresi zaten kayıtlı.",
    );
  }
  if (updated.reason === "duplicateLabel") {
    return failure(
      409,
      "CONTACT_LABEL_EXISTS",
      "Bu ad başka bir kişide kullanılıyor. Farklı bir ad seç.",
    );
  }
  return UNAVAILABLE;
}

export async function deleteSavedContacts(input: {
  userId: string;
  repository: SharedBillRepository;
  /** Verilmezse kullanıcının TÜM defteri silinir. */
  contactId?: string;
}): Promise<DeleteContactsResult> {
  if (!isAppUserId(input.userId)) {
    return UNAVAILABLE;
  }
  const deleted = await input.repository.deleteContacts({
    userId: input.userId,
    contactId: input.contactId,
  });
  return deleted.ok
    ? { ok: true, deleted: deleted.deleted }
    : UNAVAILABLE;
}
