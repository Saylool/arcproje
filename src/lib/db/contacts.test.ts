import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  buildSharedBillTypedData,
  createSharedBill,
} from "@/lib/arc/shared-bill";

import {
  listRecentContacts,
  MAX_CONTACT_AGE_DAYS,
  MAX_CONTACTS,
} from "./contacts-service";
import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";

/**
 * ADRES REHBERI — gecmisten turetilen oneriler.
 *
 * Rehber AYRI BIR DEPO DEGILDIR: kisinin kendi olusturdugu hesaplardaki
 * borclular okunur. Bu yuzden iki sey ayri ayri kanitlanir: baskasinin
 * adresleri ASLA donmez ve adres basina TEK, EN GUNCEL satir doner.
 */

const NOW = 1_700_000_000_000;
const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ADA = "0x0000000000000000000000000000000000000aBc";
const BORA = "0x00000000000000000000000000000000000000De";

type Debt = { debtor: string; debtorLabel: string; debtKey: string; tryMinor: string };

async function writeBill(
  repository: ReturnType<typeof createFakeSharedBillRepository>,
  seed: string,
  debts: Debt[],
  owner: string | null,
) {
  const account = privateKeyToAccount(generatePrivateKey());
  const created = createSharedBill({
    recipient: account.address,
    recipientLabel: "Poyraz",
    debts,
    nowMs: NOW,
    billId: `0x${seed.repeat(32)}`,
  });
  if (!created.ok) throw new Error(created.problem);
  const typed = buildSharedBillTypedData(created.manifest);
  const signature = await account.signTypedData({
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
  });
  const stored = await repository.createSharedBill(
    { manifest: created.manifest, debts: created.debts, signature },
    { createdByUserId: owner },
  );
  expect(stored.ok).toBe(true);
}

describe("rehber YALNIZCA kendi gecmisini gosterir", () => {
  it("baska kullanicinin borclusu donmez", async () => {
    const repository = createFakeSharedBillRepository();
    await writeBill(repository, "1a", [
      { debtor: ADA, debtorLabel: "Ada", debtKey: "a->p", tryMinor: "100" },
    ], OWNER_A);
    await writeBill(repository, "1b", [
      { debtor: BORA, debtorLabel: "Bora", debtKey: "b->p", tryMinor: "200" },
    ], OWNER_B);

    const result = await listRecentContacts({
      createdByUserId: OWNER_A,
      repository,
      nowMs: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.label).toBe("Ada");
    // B'nin borclusu HICBIR kosulda gorunmez.
    expect(JSON.stringify(result.contacts)).not.toContain(BORA.toLowerCase());
  });

  it("sahipsiz hesaplar kimsenin rehberine girmez", async () => {
    const repository = createFakeSharedBillRepository();
    await writeBill(repository, "2a", [
      { debtor: ADA, debtorLabel: "Ada", debtKey: "a->p", tryMinor: "100" },
    ], null);

    const result = await listRecentContacts({
      createdByUserId: OWNER_A,
      repository,
      nowMs: NOW,
    });
    expect(result.ok && result.contacts).toEqual([]);
  });
});

describe("adres basina TEK ve EN GUNCEL satir", () => {
  it("ayni adres iki kez kullanildiysa SON etiket kalir", async () => {
    const repository = createFakeSharedBillRepository();
    await writeBill(repository, "3a", [
      { debtor: ADA, debtorLabel: "Ada", debtKey: "a->p", tryMinor: "100" },
    ], OWNER_A);
    await writeBill(repository, "3b", [
      { debtor: ADA, debtorLabel: "Ada Y", debtKey: "a->p", tryMinor: "150" },
    ], OWNER_A);

    const result = await listRecentContacts({
      createdByUserId: OWNER_A,
      repository,
      nowMs: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.label).toBe("Ada Y");
  });

  it("en son kullanilan once doner", async () => {
    const repository = createFakeSharedBillRepository();
    await writeBill(repository, "4a", [
      { debtor: ADA, debtorLabel: "Ada", debtKey: "a->p", tryMinor: "100" },
    ], OWNER_A);
    await writeBill(repository, "4b", [
      { debtor: BORA, debtorLabel: "Bora", debtKey: "b->p", tryMinor: "200" },
    ], OWNER_A);

    const result = await listRecentContacts({
      createdByUserId: OWNER_A,
      repository,
      nowMs: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contacts.map((c) => c.label)).toEqual(["Bora", "Ada"]);
  });
});

describe("kapali tarafa dusme", () => {
  it("depo erisilemezse BOS LISTE degil hata doner", async () => {
    const repository = createFakeSharedBillRepository();
    repository.controls.failWithUnavailable = true;

    const result = await listRecentContacts({
      createdByUserId: OWNER_A,
      repository,
      nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(503);
  });

  it("bicimsiz kimlik depoya HIC gitmez", async () => {
    const repository = createFakeSharedBillRepository();
    const before = repository.calls;

    const result = await listRecentContacts({
      createdByUserId: "app-user",
      repository,
      nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    expect(repository.calls).toBe(before);
  });

  it("ust sinir sonludur", () => {
    expect(Number.isSafeInteger(MAX_CONTACTS)).toBe(true);
    expect(MAX_CONTACTS).toBeGreaterThan(0);
    expect(MAX_CONTACTS).toBeLessThanOrEqual(200);
  });
});

describe("YAS SINIRI — bayat adres onerilmez", () => {
  const DAY_MS = 86_400_000;

  async function contactsAt(nowMs: number) {
    const repository = createFakeSharedBillRepository();
    await writeBill(repository, "5a", [
      { debtor: ADA, debtorLabel: "Ada", debtKey: "a->p", tryMinor: "100" },
    ], OWNER_A);
    return listRecentContacts({
      createdByUserId: OWNER_A,
      repository,
      nowMs,
    });
  }

  it("sinirin ICINDEKI kullanim onerilir", async () => {
    // Hesabin bir gun sonrasi: taptaze.
    const result = await contactsAt(NOW + DAY_MS);
    expect(result.ok && result.contacts).toHaveLength(1);
  });

  it("tam sinirin bir gun ONCESI hala onerilir", async () => {
    const result = await contactsAt(NOW + (MAX_CONTACT_AGE_DAYS - 1) * DAY_MS);
    expect(result.ok && result.contacts).toHaveLength(1);
  });

  it("sinirin OTESINDEKI kullanim DUSER", async () => {
    const result = await contactsAt(NOW + (MAX_CONTACT_AGE_DAYS + 1) * DAY_MS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contacts).toEqual([]);
  });

  it("cok eski kullanimlar hicbir kosulda gelmez", async () => {
    const result = await contactsAt(NOW + 5 * 365 * DAY_MS);
    expect(result.ok && result.contacts).toEqual([]);
  });

  it("sinir 12 aydir ve sonludur", () => {
    expect(MAX_CONTACT_AGE_DAYS).toBe(365);
    expect(Number.isSafeInteger(MAX_CONTACT_AGE_DAYS)).toBe(true);
  });

  it("servis depoya KESIM ANINI gecirir, depo kendi karar vermez", async () => {
    const repository = createFakeSharedBillRepository();
    let seen: number | null = null;
    const spy = {
      ...repository,
      async listRecentDebtorsFor(input: {
        createdByUserId: string;
        limit: number;
        notUsedBefore: number;
      }) {
        seen = input.notUsedBefore;
        return { ok: true as const, contacts: [] };
      },
    };
    await listRecentContacts({
      createdByUserId: OWNER_A,
      repository: spy,
      nowMs: NOW,
    });
    expect(seen).toBe(
      Math.floor((NOW - MAX_CONTACT_AGE_DAYS * DAY_MS) / 1000),
    );
  });
});
