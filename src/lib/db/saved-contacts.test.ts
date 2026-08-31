import { describe, expect, it } from "vitest";

import { listContactBook } from "./contacts-service";
import {
  deleteSavedContacts,
  listSavedContacts,
  MAX_SAVED_CONTACTS,
  saveContact,
  updateSavedContact,
} from "./saved-contacts-service";
import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";

/**
 * KAYITLI KISILER — kullanicinin kendi adres defteri.
 *
 * Iki sey ayri ayri kanitlanir:
 *   1. Defter KISIYE OZELDIR: baskasinin kaydi okunamaz, degistirilemez,
 *      silinemez — kimligi bilinse bile.
 *   2. Belirsizlik YOKTUR: ayni ad iki kisiye, ayni adres iki kayda verilemez.
 *      Burada belirsizlik yanlis adres demektir.
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ADA = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
// Kanonik (EIP-55) bicim: servis adresi checksum'a cevirerek dondurur.
const BORA = "0x00000000000000000000000000000000000000DE";

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `11111111-1111-4111-8111-${String(sequence).padStart(12, "0")}`;
};

function repo() {
  return createFakeSharedBillRepository();
}

async function add(
  repository: ReturnType<typeof repo>,
  userId: string,
  label: string,
  address: string,
) {
  return saveContact({
    userId,
    repository,
    label,
    address,
    createContactId: nextId,
  });
}

describe("kaydetme", () => {
  it("gecerli kisi kaydedilir ve adres CHECKSUM'a cevrilir", async () => {
    const repository = repo();
    const saved = await add(repository, A, "  Ada  ", ADA.toLowerCase());
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    // Ad kirpilir, adres kanonik hale gelir.
    expect(saved.contact.label).toBe("Ada");
    expect(saved.contact.address).toBe(ADA);
  });

  it("gecersiz ad reddedilir", async () => {
    const repository = repo();
    for (const label of ["", "   ", "a".repeat(41), 5, null]) {
      const saved = await add(repository, A, label as string, ADA);
      expect(saved.ok, String(label)).toBe(false);
      if (saved.ok) continue;
      expect(saved.status).toBe(400);
      expect(saved.code).toBe("INVALID_LABEL");
    }
  });

  it("gecersiz adres reddedilir", async () => {
    const repository = repo();
    for (const address of ["0xkisa", "", "merhaba", `${ADA}00`, 42]) {
      const saved = await add(repository, A, "Ada", address as string);
      expect(saved.ok, String(address)).toBe(false);
      if (saved.ok) continue;
      expect(saved.code).toBe("INVALID_ADDRESS");
    }
  });

  it("AYNI ADRES iki kez kaydedilemez", async () => {
    const repository = repo();
    expect((await add(repository, A, "Ada", ADA)).ok).toBe(true);
    const again = await add(repository, A, "Ada Y", ADA.toLowerCase());
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe("CONTACT_ADDRESS_EXISTS");
  });

  it("AYNI AD iki kisiye verilemez", async () => {
    /*
     * "Ahmet yaz, adresi gelsin" ancak TEK bir Ahmet varsa guvenlidir.
     */
    const repository = repo();
    expect((await add(repository, A, "Ada", ADA)).ok).toBe(true);
    const clash = await add(repository, A, "ada", BORA);
    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.code).toBe("CONTACT_LABEL_EXISTS");
  });

  it("ust sinira ulasilinca yeni kayit alinmaz", async () => {
    const repository = repo();
    for (let index = 0; index < MAX_SAVED_CONTACTS; index += 1) {
      const address = `0x${index.toString(16).padStart(40, "0")}`;
      expect((await add(repository, A, `Kisi${index}`, address)).ok).toBe(true);
    }
    const overflow = await add(repository, A, "Fazla", ADA);
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.code).toBe("CONTACT_LIMIT_REACHED");
  });
});

describe("defter KISIYE OZELDIR", () => {
  it("baskasinin kaydi listede gorunmez", async () => {
    const repository = repo();
    await add(repository, A, "Ada", ADA);
    await add(repository, B, "Bora", BORA);

    const own = await listSavedContacts({ userId: A, repository });
    expect(own.ok).toBe(true);
    if (!own.ok) return;
    expect(own.contacts).toHaveLength(1);
    expect(own.contacts[0]?.label).toBe("Ada");
    expect(JSON.stringify(own.contacts)).not.toContain(BORA);
  });

  it("baskasinin kaydi kimligi bilinse bile DEGISTIRILEMEZ", async () => {
    const repository = repo();
    const mine = await add(repository, B, "Bora", BORA);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;

    const stolen = await updateSavedContact({
      userId: A,
      repository,
      contactId: mine.contact.contactId,
      label: "Calindi",
      address: ADA,
    });
    expect(stolen.ok).toBe(false);
    if (stolen.ok) return;
    // Var olmayan ile baskasinin AYNI cevabi verir.
    expect(stolen.status).toBe(404);

    const untouched = await listSavedContacts({ userId: B, repository });
    expect(untouched.ok && untouched.contacts[0]?.label).toBe("Bora");
  });

  it("baskasinin kaydi SILINEMEZ", async () => {
    const repository = repo();
    const mine = await add(repository, B, "Bora", BORA);
    if (!mine.ok) throw new Error("kurulum");

    const removed = await deleteSavedContacts({
      userId: A,
      repository,
      contactId: mine.contact.contactId,
    });
    expect(removed.ok && removed.deleted).toBe(0);

    const still = await listSavedContacts({ userId: B, repository });
    expect(still.ok && still.contacts).toHaveLength(1);
  });

  it("tumunu silmek YALNIZCA kendi defterini bosaltir", async () => {
    const repository = repo();
    await add(repository, A, "Ada", ADA);
    await add(repository, B, "Bora", BORA);

    const removed = await deleteSavedContacts({ userId: A, repository });
    expect(removed.ok && removed.deleted).toBe(1);

    expect((await listSavedContacts({ userId: A, repository })).ok && true).toBe(true);
    const other = await listSavedContacts({ userId: B, repository });
    expect(other.ok && other.contacts).toHaveLength(1);
  });
});

describe("duzenleme", () => {
  it("ad ve adres degistirilebilir", async () => {
    const repository = repo();
    const saved = await add(repository, A, "Ada", ADA);
    if (!saved.ok) throw new Error("kurulum");

    const updated = await updateSavedContact({
      userId: A,
      repository,
      contactId: saved.contact.contactId,
      label: "Ada Yeni",
      address: BORA,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.contact.label).toBe("Ada Yeni");
    expect(updated.contact.address).toBe(BORA);
  });

  it("baska bir kaydin adiyla cakisirsa reddedilir", async () => {
    const repository = repo();
    const first = await add(repository, A, "Ada", ADA);
    await add(repository, A, "Bora", BORA);
    if (!first.ok) throw new Error("kurulum");

    const clash = await updateSavedContact({
      userId: A,
      repository,
      contactId: first.contact.contactId,
      label: "Bora",
      address: ADA,
    });
    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.code).toBe("CONTACT_LABEL_EXISTS");
  });

  it("kendi adini korumak cakisma SAYILMAZ", async () => {
    const repository = repo();
    const saved = await add(repository, A, "Ada", ADA);
    if (!saved.ok) throw new Error("kurulum");

    const updated = await updateSavedContact({
      userId: A,
      repository,
      contactId: saved.contact.contactId,
      label: "Ada",
      address: BORA,
    });
    expect(updated.ok).toBe(true);
  });
});

describe("birlesik defter", () => {
  it("KAYITLILAR once gelir", async () => {
    const repository = repo();
    await add(repository, A, "Ada", ADA);
    const book = await listContactBook({ userId: A, repository });
    expect(book.ok).toBe(true);
    if (!book.ok) return;
    expect(book.contacts[0]?.source).toBe("saved");
    expect(book.contacts[0]?.contactId).not.toBeNull();
    expect(book.contacts[0]?.lastUsedAt).toBeNull();
  });

  it("kayitlilar okunamazsa istek BASARISIZ olur", async () => {
    const repository = repo();
    repository.controls.failWithUnavailable = true;
    const book = await listContactBook({ userId: A, repository });
    expect(book.ok).toBe(false);
    if (book.ok) return;
    expect(book.status).toBe(503);
  });

  it("bicimsiz kimlik depoya HIC gitmez", async () => {
    const repository = repo();
    const before = repository.calls;
    const book = await listContactBook({ userId: "app-user", repository });
    expect(book.ok).toBe(false);
    expect(repository.calls).toBe(before);
  });
});
