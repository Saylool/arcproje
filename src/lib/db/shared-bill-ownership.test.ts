import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  buildSharedBillTypedData,
  createSharedBill,
  type SharedBillManifest,
} from "@/lib/arc/shared-bill";

import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";
import {
  isAppUserId,
  listSharedBillsCreatedBy,
  MAX_LISTED_BILLS,
} from "./shared-bill-listing-service";
import { createSharedBillFromSubmission } from "./shared-bill-service";

/**
 * HESAP SAHIPLIGI.
 *
 * Iki soru ayri ayri kanitlanir:
 *
 *   1. Atif YAZILIR mi?  — olusturan uygulama kullanicisi kayda gecer.
 *   2. Atif IMZAYI etkiler mi? — ETKILEMEMELIDIR. Manifest, borc taahhudu ve
 *      alacakli imzasi sahiplikten BAGIMSIZ olarak birebir ayni kalir.
 *
 * Ayrica sahipligin bir YETKI olmadigi kanitlanir: listeleme yalnizca okur ve
 * baskasinin satirlari hicbir kosulda donmez.
 */

const NOW = 1_700_000_000_000;
const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

const DEBTOR_A = "0x0000000000000000000000000000000000000aBc";
const DEBTOR_B = "0x00000000000000000000000000000000000000De";

async function prepare(billId: string) {
  const account = privateKeyToAccount(generatePrivateKey());
  const created = createSharedBill({
    recipient: account.address,
    recipientLabel: "Poyraz",
    debts: [
      {
        debtor: DEBTOR_A,
        debtorLabel: "Ada",
        debtKey: "a->p",
        tryMinor: "12345",
      },
      {
        debtor: DEBTOR_B,
        debtorLabel: "Bora",
        debtKey: "b->p",
        tryMinor: "6789",
      },
    ],
    nowMs: NOW,
    billId,
  });
  if (!created.ok) throw new Error(`hesap uretilemedi: ${created.problem}`);

  const typedData = buildSharedBillTypedData(created.manifest);
  const signature = await account.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });

  return {
    manifest: created.manifest,
    signature,
    body: JSON.stringify({
      manifest: created.manifest,
      debts: created.debts,
      signature,
    }),
  };
}

function billIdFor(seed: string) {
  return `0x${seed.repeat(32)}`;
}

describe("atif yazimi", () => {
  it("olusturan uygulama kullanicisi kayda gecer", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare(billIdFor("7a"));

    const result = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
      createdByUserId: OWNER_A,
    });

    expect(result.ok).toBe(true);
    const stored = repository.bills.get(prepared.manifest.billId.toLowerCase());
    expect(stored?.createdByUserId).toBe(OWNER_A);
  });

  it("atif yoksa hesap YINE olusur, yalnizca sahipsiz kalir", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare(billIdFor("7b"));

    const result = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
      createdByUserId: null,
    });

    expect(result.ok).toBe(true);
    const stored = repository.bills.get(prepared.manifest.billId.toLowerCase());
    expect(stored?.createdByUserId).toBeNull();
  });
});

describe("atif IMZALANAN baytlari degistirmez", () => {
  it("sahipli ve sahipsiz yazimda manifest, taahhut ve imza birebir aynidir", async () => {
    const prepared = await prepare(billIdFor("7c"));

    const owned = createFakeSharedBillRepository();
    const anonymous = createFakeSharedBillRepository();

    for (const [repository, createdByUserId] of [
      [owned, OWNER_A],
      [anonymous, null],
    ] as const) {
      const result = await createSharedBillFromSubmission({
        bodyText: prepared.body,
        repository,
        nowMs: NOW,
        createdByUserId,
      });
      expect(result.ok).toBe(true);
    }

    const key = prepared.manifest.billId.toLowerCase();
    const withOwner = owned.bills.get(key);
    const withoutOwner = anonymous.bills.get(key);

    expect(withOwner).toBeDefined();
    expect(withoutOwner).toBeDefined();

    // Imzalanan icerik: bayt bayt ayni.
    expect(JSON.stringify(withOwner?.manifest)).toBe(
      JSON.stringify(withoutOwner?.manifest),
    );
    expect(withOwner?.signature).toBe(withoutOwner?.signature);
    expect(withOwner?.manifest.debtsRoot).toBe(withoutOwner?.manifest.debtsRoot);

    // Sahiplik yalnizca ATIFTA ayrisir.
    expect(withOwner?.createdByUserId).toBe(OWNER_A);
    expect(withoutOwner?.createdByUserId).toBeNull();
  });

  it("manifestin kendisi hicbir sahiplik alani TASIMAZ", async () => {
    const prepared = await prepare(billIdFor("7d"));
    const keys = Object.keys(prepared.manifest as SharedBillManifest);
    for (const forbidden of ["createdByUserId", "owner", "userId", "appUserId"]) {
      expect(keys).not.toContain(forbidden);
    }
    // Imzalanan tipli veri de sahiplik alani tanimlamaz.
    const typed = buildSharedBillTypedData(prepared.manifest);
    // `chainId` BigInt'tir; dizeye cevrilerek taranir.
    const serializedTypedData = JSON.stringify(typed, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(serializedTypedData).not.toMatch(/owner|userId|createdBy/i);
  });
});

describe("tekrar oynatma sahipligi DEVRALAMAZ", () => {
  it("ayni imzali govdeyi baska bir oturum gonderirse sahip DEGISMEZ", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare(billIdFor("7e"));

    const first = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
      createdByUserId: OWNER_A,
    });
    expect(first.ok && first.created).toBe(true);

    const replay = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
      createdByUserId: OWNER_B,
    });
    // Tekrar guvenli sayilir ama YENIDEN YAZILMAZ.
    expect(replay.ok && replay.created).toBe(false);

    const stored = repository.bills.get(prepared.manifest.billId.toLowerCase());
    expect(stored?.createdByUserId).toBe(OWNER_A);

    // B, A'nin hesabini kendi listesinde GOREMEZ.
    const listed = await listSharedBillsCreatedBy({
      createdByUserId: OWNER_B,
      repository,
    });
    expect(listed.ok && listed.bills).toEqual([]);
  });
});

describe("listeleme yalnizca SAHIBIN satirlarini dondurur", () => {
  it("baska kullanicinin hesabi listeye girmez", async () => {
    const repository = createFakeSharedBillRepository();

    for (const [seed, owner] of [
      ["1a", OWNER_A],
      ["1b", OWNER_B],
      ["1c", OWNER_A],
      ["1d", null],
    ] as const) {
      const prepared = await prepare(billIdFor(seed));
      const result = await createSharedBillFromSubmission({
        bodyText: prepared.body,
        repository,
        nowMs: NOW,
        createdByUserId: owner,
      });
      expect(result.ok).toBe(true);
    }

    const listed = await listSharedBillsCreatedBy({
      createdByUserId: OWNER_A,
      repository,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    expect(listed.bills).toHaveLength(2);
    for (const bill of listed.bills) {
      expect([billIdFor("1a"), billIdFor("1c")]).toContain(bill.billId);
    }
    // Sahipsiz hesap KIMSENIN listesinde cikmaz.
    const anonymous = await listSharedBillsCreatedBy({
      createdByUserId: "33333333-3333-4333-8333-333333333333",
      repository,
    });
    expect(anonymous.ok && anonymous.bills).toEqual([]);
  });

  it("en yeni hesap once doner", async () => {
    const repository = createFakeSharedBillRepository();
    for (const seed of ["2a", "2b", "2c"]) {
      const prepared = await prepare(billIdFor(seed));
      await createSharedBillFromSubmission({
        bodyText: prepared.body,
        repository,
        nowMs: NOW,
        createdByUserId: OWNER_A,
      });
    }

    const listed = await listSharedBillsCreatedBy({
      createdByUserId: OWNER_A,
      repository,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.bills.map((bill) => bill.billId)).toEqual([
      billIdFor("2c"),
      billIdFor("2b"),
      billIdFor("2a"),
    ]);
  });

  it("tutarlar KANONIK tam sayi metnidir ve yol kimlikten kurulur", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare(billIdFor("3a"));
    await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
      createdByUserId: OWNER_A,
    });

    const listed = await listSharedBillsCreatedBy({
      createdByUserId: OWNER_A,
      repository,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    const [bill] = listed.bills;
    expect(bill).toBeDefined();
    if (bill === undefined) return;

    // 12345 + 6789, BigInt ile toplanir; kayan nokta hic devreye girmez.
    expect(bill.totalTryMinor).toBe("19134");
    expect(bill.paidTryMinor).toBe("0");
    expect(bill.paidCount).toBe(0);
    expect(bill.debtCount).toBe(2);
    expect(bill.path).toBe(`/pay/${bill.billId}`);

    // Ozet borclu adresi, etiket veya imza TASIMAZ.
    const serialized = JSON.stringify(bill);
    expect(serialized).not.toContain(DEBTOR_A);
    expect(serialized).not.toContain(DEBTOR_B);
    expect(serialized).not.toContain("Ada");
    expect(serialized).not.toContain("Poyraz");
    expect(serialized).not.toContain(prepared.signature);
    expect(serialized).not.toContain(prepared.manifest.debtsRoot);
  });
});

describe("kapali tarafa dusme", () => {
  it("depo erisilemezse BOS LISTE degil, hata doner", async () => {
    const repository = createFakeSharedBillRepository();
    repository.controls.failWithUnavailable = true;

    const listed = await listSharedBillsCreatedBy({
      createdByUserId: OWNER_A,
      repository,
    });
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.status).toBe(503);
  });

  it("bicimsiz kullanici kimligi depoya HIC gitmez", async () => {
    const repository = createFakeSharedBillRepository();
    const before = repository.calls;

    const listed = await listSharedBillsCreatedBy({
      createdByUserId: "app-user",
      repository,
    });
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.status).toBe(503);
    // Depo cagrilmadi: surucuye bicimsiz bir uuid gonderilmedi.
    expect(repository.calls).toBe(before);
  });

  it("uygulama kullanici kimligi bicimi katidir", () => {
    expect(isAppUserId(OWNER_A)).toBe(true);
    for (const invalid of [
      "",
      "app-user",
      "11111111111141118111111111111111",
      `${OWNER_A} `,
      `${OWNER_A}x`,
      "11111111-1111-4111-8111-11111111111g",
    ]) {
      expect(isAppUserId(invalid), invalid).toBe(false);
    }
  });

  it("liste ust siniri sonludur", () => {
    expect(Number.isSafeInteger(MAX_LISTED_BILLS)).toBe(true);
    expect(MAX_LISTED_BILLS).toBeGreaterThan(0);
    expect(MAX_LISTED_BILLS).toBeLessThanOrEqual(200);
  });
});
