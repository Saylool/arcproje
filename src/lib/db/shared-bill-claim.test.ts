import { describe, expect, it } from "vitest";

import { validatePaymentSnapshot } from "@/lib/arc/send";

import { claimSharedBillPayment } from "./shared-bill-claim-service";
import {
  PAYMENT_BILL_ID,
  PAYMENT_NOW,
  expectedMicroUsdc,
  fakeMint,
  seedPaidBill,
  type SeededBill,
} from "./shared-bill-payment.fixture";
import { prepareSharedBillPaymentOffer } from "./shared-bill-payment-service";

/**
 * ATOMİK REZERVASYON.
 *
 * Hiçbir testte cüzdan, App Kit, Neon, CoinGecko ya da Arc RPC ÇAĞRILMAZ.
 * Rezervasyon bir veritabanı işlemidir; hiçbir işlem gönderilmez.
 */

const OFFER_ID = `0x${"a1".repeat(32)}`;
const ATTEMPT_ID = `0x${"b2".repeat(32)}`;

async function withOffer(amounts?: readonly string[]) {
  const seeded = await seedPaidBill(amounts === undefined ? {} : { amounts });
  const prepared = await prepareSharedBillPaymentOffer({
    sessionToken: seeded.sessionTokens[0],
    pathBillId: PAYMENT_BILL_ID,
    repository: seeded.repository,
    nowMs: PAYMENT_NOW,
    mintQuote: fakeMint(),
    offerId: OFFER_ID,
  });
  if (!prepared.ok) throw new Error(`teklif basilamadi: ${prepared.code}`);
  return { seeded, offer: prepared.offer };
}

function claim(
  seeded: SeededBill,
  overrides: Partial<Parameters<typeof claimSharedBillPayment>[0]> = {},
) {
  return claimSharedBillPayment({
    bodyText: JSON.stringify({ offerId: OFFER_ID }),
    sessionToken: seeded.sessionTokens[0],
    pathBillId: PAYMENT_BILL_ID,
    repository: seeded.repository,
    nowMs: PAYMENT_NOW,
    attemptId: ATTEMPT_ID,
    ...overrides,
  });
}

describe("rezervasyon YETKİLİ snapshot üretir", () => {
  it("snapshot gönderim sınırının TAM doğrulamasından geçer", async () => {
    const { seeded, offer } = await withOffer();
    const result = await claim(seeded);
    if (!result.ok) throw new Error(`rezervasyon yapilamadi: ${result.code}`);

    const snapshot = result.claim.snapshot;
    expect(validatePaymentSnapshot(snapshot, PAYMENT_NOW)).toBeNull();
    expect(snapshot.tryMinor).toBe(offer.tryMinor);
    expect(snapshot.microUsdc).toBe(offer.microUsdc);
    expect(snapshot.microUsdc).toBe(expectedMicroUsdc(offer.tryMinor));
    expect(snapshot.recipientAddress.toLowerCase()).toBe(
      seeded.recipient.address.toLowerCase(),
    );
    expect(snapshot.debtorAddress.toLowerCase()).toBe(
      offer.debtor.toLowerCase(),
    );
    // Deneme kimliği, gönderim sınırının KATI biçim kuralını sağlamalı.
    expect(snapshot.requestId).toBe(result.claim.attemptId);
    expect(snapshot.requestId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("borcu REZERVE eder ve teklifi TÜKETİR", async () => {
    const { seeded } = await withOffer();
    const result = await claim(seeded);
    if (!result.ok) throw new Error("rezervasyon yapilamadi");

    const bill = seeded.repository.bills.get(PAYMENT_BILL_ID.toLowerCase());
    const debt = bill?.debts.find(
      (row) =>
        row.debtor.toLowerCase() ===
        result.claim.snapshot.debtorAddress.toLowerCase(),
    );
    expect(debt?.paymentStatus).toBe("reserved");
    expect(seeded.repository.offers.get(OFFER_ID)?.consumedAt).not.toBeNull();
    expect(seeded.repository.attempts.get(ATTEMPT_ID)?.status).toBe("reserved");
  });
});

describe("EŞZAMANLI rezervasyon EN FAZLA BİR deneme üretir", () => {
  it("iki eşzamanlı claim'den yalnızca biri kazanır", async () => {
    const { seeded } = await withOffer();
    const [first, second] = await Promise.all([
      claim(seeded, { attemptId: `0x${"c1".repeat(32)}` }),
      claim(seeded, { attemptId: `0x${"c2".repeat(32)}` }),
    ]);

    const succeeded = [first, second].filter((result) => result.ok);
    expect(succeeded).toHaveLength(1);
    // Depoda TEK aktif deneme kalır.
    expect(seeded.repository.attempts.size).toBe(1);
  });

  it("farklı OTURUMDAN gelen ikinci claim de reddedilir", async () => {
    const { seeded } = await withOffer();
    const first = await claim(seeded, { attemptId: `0x${"c1".repeat(32)}` });
    expect(first.ok).toBe(true);

    /*
     * Aynı borçlunun İKİNCİ bir cihazdan açtığı oturum. Kilit borç
     * satırındadır; oturum başına DEĞİLDİR.
     */
    const second = await claim(seeded, { attemptId: `0x${"c2".repeat(32)}` });
    if (second.ok) throw new Error("ikinci cihaz da rezerve etti");
    expect(second.code).toBe("DEBT_NOT_CLAIMABLE");
    expect(seeded.repository.attempts.size).toBe(1);
  });
});

describe("rezervasyon FAIL-CLOSED reddedilir", () => {
  it("ödenmiş / rezerve / inceleme bekleyen borç rezerve edilemez", async () => {
    for (const status of ["paid", "reserved", "review_required"] as const) {
      const { seeded } = await withOffer();
      const bill = seeded.repository.bills.get(PAYMENT_BILL_ID.toLowerCase());
      if (bill === undefined) throw new Error("hesap yok");
      const index = bill.debts.findIndex(
        (row) => row.paymentStatus === "unpaid",
      );
      bill.debts[index] = Object.freeze({
        ...bill.debts[index],
        paymentStatus: status,
        paidTxHash: status === "paid" ? `0x${"cc".repeat(32)}` : null,
        paidAt: status === "paid" ? Math.floor(PAYMENT_NOW / 1000) : null,
      });

      const result = await claim(seeded);
      if (result.ok) throw new Error(`${status} borc rezerve edildi`);
      expect(result.code).toBe("DEBT_NOT_CLAIMABLE");
      expect(seeded.repository.attempts.size).toBe(0);
    }
  });

  it("istemci TUTAR, KUR veya ALICI bildiremez", async () => {
    const { seeded } = await withOffer();
    for (const extra of [
      { microUsdc: "1" },
      { tryMinor: "1" },
      { rateNumerator: "1" },
      { recipient: `0x${"11".repeat(20)}` },
    ]) {
      const result = await claim(seeded, {
        bodyText: JSON.stringify({ offerId: OFFER_ID, ...extra }),
      });
      if (result.ok) throw new Error("fazladan alan kabul edildi");
      expect(result.code).toBe("UNEXPECTED_FIELD");
    }
    expect(seeded.repository.attempts.size).toBe(0);
  });

  it("BAŞKA bir borçlunun teklifi kullanılamaz", async () => {
    const { seeded } = await withOffer();
    const result = await claim(seeded, {
      // İkinci borçlunun oturumu, birinci borçlunun teklifi.
      sessionToken: seeded.sessionTokens[1],
    });
    if (result.ok) throw new Error("baskasinin teklifi kullanildi");
    expect(result.code).toBe("OFFER_UNUSABLE");
  });

  it("teklifin tutarı depodakiyle uyuşmuyorsa GÖNDERİM YAPILMAZ", async () => {
    const { seeded, offer } = await withOffer();
    const bill = seeded.repository.bills.get(PAYMENT_BILL_ID.toLowerCase());
    if (bill === undefined) throw new Error("hesap yok");
    const index = bill.debts.findIndex(
      (row) => row.debtor.toLowerCase() === offer.debtor.toLowerCase(),
    );
    // Borç, teklif basıldıktan SONRA değişti.
    bill.debts[index] = Object.freeze({
      ...bill.debts[index],
      tryMinor: "999999",
    });

    const result = await claim(seeded);
    if (result.ok) throw new Error("tutarsiz teklif rezerve edildi");
    expect(result.code).toBe("INCONSISTENT_OFFER");
    expect(seeded.repository.attempts.size).toBe(0);
  });

  it("teklifin kuru bozulmuşsa tutar YENİDEN TÜRETİLİP reddedilir", async () => {
    const { seeded } = await withOffer();
    const offers = seeded.repository.offers as Map<
      string,
      NonNullable<ReturnType<typeof seeded.repository.offers.get>>
    >;
    const stored = offers.get(OFFER_ID);
    if (stored === undefined) throw new Error("teklif yok");
    // Kur değişti ama mikro USDC eski kaldı: ekonomik tutarsızlık.
    offers.set(OFFER_ID, { ...stored, rateNumerator: "50000000" });

    const result = await claim(seeded);
    if (result.ok) throw new Error("tutarsiz kur rezerve edildi");
    expect(result.code).toBe("INCONSISTENT_OFFER");
  });

  it("süresi dolmuş teklif rezerve edilemez", async () => {
    const { seeded, offer } = await withOffer();
    const result = await claim(seeded, {
      nowMs: (offer.expiresAt + 1) * 1000,
    });
    if (result.ok) throw new Error("suresi dolmus teklif rezerve edildi");
    expect(result.code).toBe("OFFER_UNUSABLE");
  });

  it("gönderim payı kalmamışsa cüzdan HİÇ açılmaz", async () => {
    const { seeded, offer } = await withOffer();
    // Bitişe 10 saniye kaldı: pay (60 sn) tükenmiş.
    const result = await claim(seeded, { nowMs: (offer.expiresAt - 10) * 1000 });
    if (result.ok) throw new Error("pay tukenmisken rezerve edildi");
    expect(result.code).toBe("INSUFFICIENT_TIME");
    expect(seeded.repository.attempts.size).toBe(0);
  });

  it("teklif İKİNCİ kez kullanılamaz", async () => {
    const { seeded } = await withOffer();
    const first = await claim(seeded, { attemptId: `0x${"c1".repeat(32)}` });
    expect(first.ok).toBe(true);

    // Borcu elle serbest bırak; teklif yine de tüketilmiş olmalı.
    const bill = seeded.repository.bills.get(PAYMENT_BILL_ID.toLowerCase());
    if (bill === undefined) throw new Error("hesap yok");
    const index = bill.debts.findIndex(
      (row) => row.paymentStatus === "reserved",
    );
    bill.debts[index] = Object.freeze({
      ...bill.debts[index],
      paymentStatus: "unpaid",
    });

    const second = await claim(seeded, { attemptId: `0x${"c2".repeat(32)}` });
    if (second.ok) throw new Error("teklif ikinci kez kullanildi");
    expect(second.code).toBe("OFFER_UNUSABLE");
  });

  it("veritabanı erişilemezse rezervasyon yapılmaz", async () => {
    const { seeded } = await withOffer();
    seeded.repository.controls.failWithUnavailable = true;
    const result = await claim(seeded);
    if (result.ok) throw new Error("veritabanisiz rezerve edildi");
    expect(result.status).toBe(503);
  });
});
