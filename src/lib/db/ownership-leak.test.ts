import { describe, expect, it } from "vitest";

import { readAuthenticatedDebtView } from "./shared-bill-access-service";
import { claimSharedBillPayment } from "./shared-bill-claim-service";
import {
  fakeMint,
  PAYMENT_BILL_ID,
  PAYMENT_NOW,
  seedPaidBill,
  type SeededBill,
} from "./shared-bill-payment.fixture";
import { prepareSharedBillPaymentOffer } from "./shared-bill-payment-service";

/**
 * SAHIPLIK BORCLUYA SIZIYOR MU? — CALISMA ZAMANI OLCUMU.
 *
 * Kaynak tarayan sinir testi "bu dosyalar sahiplik alanini import etmiyor"
 * der. Bu dosya daha gucluyu iddia eder: hesabin bir SAHIBI VARKEN borclu
 * akisi bastan sona kosturulur ve o kimligin hicbir yanitin icinde
 * gecmedigi olculur.
 *
 * Ayrica geriye donuk uyum: sahibi `null` olan (gecisten ONCE olusmus)
 * hesaplarda akisin AYNI sekilde calistigi gosterilir.
 */

const OWNER = "77777777-7777-4777-8777-777777777777";
const OFFER_ID = `0x${"a1".repeat(32)}`;
const ATTEMPT_ID = `0x${"b2".repeat(32)}`;

function setOwner(seeded: SeededBill, owner: string | null): void {
  const stored = seeded.repository.bills.get(seeded.billId.toLowerCase());
  if (stored === undefined) throw new Error("hesap bulunamadi");
  stored.createdByUserId = owner;
}

/** Borclu akisinin TUM adimlarini kosturur ve ciktilari dizeye cevirir. */
async function runDebtorFlow(seeded: SeededBill): Promise<string[]> {
  const outputs: string[] = [];

  const view = await readAuthenticatedDebtView({
    sessionToken: seeded.sessionTokens[0] ?? null,
    pathBillId: PAYMENT_BILL_ID,
    repository: seeded.repository,
    nowMs: PAYMENT_NOW,
  });
  expect(view.ok, "borclu gorunumu okunamadi").toBe(true);
  outputs.push(JSON.stringify(view));

  const prepared = await prepareSharedBillPaymentOffer({
    sessionToken: seeded.sessionTokens[0] ?? null,
    pathBillId: PAYMENT_BILL_ID,
    repository: seeded.repository,
    nowMs: PAYMENT_NOW,
    mintQuote: fakeMint(),
    offerId: OFFER_ID,
  });
  expect(prepared.ok, "teklif basilamadi").toBe(true);
  outputs.push(JSON.stringify(prepared));

  const claimed = await claimSharedBillPayment({
    bodyText: JSON.stringify({ offerId: OFFER_ID }),
    sessionToken: seeded.sessionTokens[0] ?? null,
    pathBillId: PAYMENT_BILL_ID,
    repository: seeded.repository,
    nowMs: PAYMENT_NOW,
    attemptId: ATTEMPT_ID,
  });
  expect(claimed.ok, "rezervasyon yapilamadi").toBe(true);
  outputs.push(JSON.stringify(claimed));

  const session = await seeded.repository.readSession({
    sessionHash: "yok",
    nowMs: PAYMENT_NOW,
  });
  outputs.push(JSON.stringify(session));

  return outputs;
}

describe("sahiplik borclu akisina SIZMAZ", () => {
  it("hesabin sahibi varken bile kimlik hicbir yanitta gecmez", async () => {
    const seeded = await seedPaidBill({ billId: PAYMENT_BILL_ID });
    setOwner(seeded, OWNER);

    const outputs = await runDebtorFlow(seeded);

    // Once verinin GERCEKTEN yazili oldugunu dogrula: aksi halde bu test bos olurdu.
    expect(
      seeded.repository.bills.get(PAYMENT_BILL_ID.toLowerCase())
        ?.createdByUserId,
    ).toBe(OWNER);

    expect(outputs).toHaveLength(4);
    for (const [index, output] of outputs.entries()) {
      expect(output.length, `cikti ${index} bos`).toBeGreaterThan(2);
      expect(output, `cikti ${index}`).not.toContain(OWNER);
      expect(output, `cikti ${index}`).not.toMatch(
        /createdByUserId|created_by_user_id/,
      );
    }
  });

  it("depodan okunan hesap nesnesi sahiplik alani TASIMAZ", async () => {
    const seeded = await seedPaidBill({ billId: PAYMENT_BILL_ID });
    setOwner(seeded, OWNER);

    const session = await seeded.repository.readSession({
      sessionHash: (
        await import("./shared-bill-auth")
      ).hashSessionToken(seeded.sessionTokens[0] ?? ""),
      nowMs: PAYMENT_NOW,
    });
    expect(session.ok).toBe(true);
    if (!session.ok) return;

    /*
     * `StoredSharedBill` tipinde sahiplik alani YOKTUR; burada calisma
     * zamaninda da olculur, cunku sahte depo tam nesneyi tutuyor ve
     * yanlislikla oldugu gibi dondurebilirdi.
     */
    expect(Object.keys(session.bill)).not.toContain("createdByUserId");
    expect(JSON.stringify(session.bill)).not.toContain(OWNER);
  });
});

describe("geriye donuk uyum: sahipsiz hesaplar", () => {
  it("gecisten ONCE olusmus (sahibi null) hesapta borclu akisi aynen calisir", async () => {
    const seeded = await seedPaidBill({ billId: PAYMENT_BILL_ID });
    setOwner(seeded, null);

    const outputs = await runDebtorFlow(seeded);
    expect(outputs).toHaveLength(4);
    for (const output of outputs) {
      expect(output).not.toContain("null,null");
    }

    // Satir gercekten sahipsiz kaldi.
    expect(
      seeded.repository.bills.get(PAYMENT_BILL_ID.toLowerCase())
        ?.createdByUserId,
    ).toBeNull();
  });
});

describe("liste ust siniri", () => {
  it("51 hesapta EN YENI 50 doner, sessizce fazlasi gelmez", async () => {
    const { createFakeSharedBillRepository } = await import(
      "./shared-bill-repository.fixture"
    );
    const { listSharedBillsCreatedBy, MAX_LISTED_BILLS } = await import(
      "./shared-bill-listing-service"
    );
    const { createSharedBill, buildSharedBillTypedData } = await import(
      "@/lib/arc/shared-bill"
    );
    const { generatePrivateKey, privateKeyToAccount } = await import(
      "viem/accounts"
    );

    const repository = createFakeSharedBillRepository();
    const account = privateKeyToAccount(generatePrivateKey());
    const total = MAX_LISTED_BILLS + 1;

    for (let index = 0; index < total; index += 1) {
      const billId = `0x${index.toString(16).padStart(64, "0")}`;
      const created = createSharedBill({
        recipient: account.address,
        recipientLabel: "Poyraz",
        debts: [
          {
            debtor: "0x0000000000000000000000000000000000000aBc",
            debtorLabel: "Ada",
            debtKey: "a->p",
            tryMinor: "100",
          },
        ],
        nowMs: PAYMENT_NOW,
        billId,
      });
      if (!created.ok) throw new Error(created.problem);
      const typed = buildSharedBillTypedData(created.manifest);
      const signature = await account.signTypedData({
        domain: typed.domain,
        types: typed.types,
        primaryType: typed.primaryType,
        message: typed.message,
      });
      await repository.createSharedBill(
        { manifest: created.manifest, debts: created.debts, signature },
        { createdByUserId: OWNER },
      );
    }

    const listed = await listSharedBillsCreatedBy({
      createdByUserId: OWNER,
      repository,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    expect(listed.bills).toHaveLength(MAX_LISTED_BILLS);
    // KIRPMA SESSIZ DEGIL: fazlasi oldugu acikca bildirilir.
    expect(listed.hasMore).toBe(true);
    // En YENI olan (son yazilan) listede, en eski disarida.
    const ids = listed.bills.map((bill) => bill.billId);
    expect(ids[0]).toBe(`0x${(total - 1).toString(16).padStart(64, "0")}`);
    expect(ids).not.toContain(`0x${(0).toString(16).padStart(64, "0")}`);
  });

  it("sinirin altinda kirpma bildirilmez", async () => {
    const { createFakeSharedBillRepository } = await import(
      "./shared-bill-repository.fixture"
    );
    const { listSharedBillsCreatedBy } = await import(
      "./shared-bill-listing-service"
    );
    const repository = createFakeSharedBillRepository();
    const seeded = await seedPaidBill({ billId: PAYMENT_BILL_ID });
    setOwner(seeded, OWNER);

    const listed = await listSharedBillsCreatedBy({
      createdByUserId: OWNER,
      repository: seeded.repository,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.bills).toHaveLength(1);
    expect(listed.hasMore).toBe(false);
    // Kullanilmayan degisken uyarisi olmasin diye depo da olculur.
    expect(repository.calls).toBe(0);
  });
});
