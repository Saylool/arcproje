import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVE_ATTEMPT_STATUSES,
  debtStatusAfterSettlement,
  isActiveAttemptStatus,
  isAllowedSettlement,
  type AttemptSettlement,
  type PaymentAttemptStatus,
} from "./shared-bill-payment-repository";
import { claimSharedBillPayment } from "./shared-bill-claim-service";
import {
  PAYMENT_BILL_ID,
  PAYMENT_NOW,
  fakeMint,
  seedPaidBill,
} from "./shared-bill-payment.fixture";
import { prepareSharedBillPaymentOffer } from "./shared-bill-payment-service";

/**
 * ÖDEME DURUM MAKİNESİ.
 *
 * Her izin verilen ve her YASAK geçiş burada açıkça tanımlıdır.
 */

const ALL_STATUSES: readonly PaymentAttemptStatus[] = [
  "reserved",
  "submitted",
  "confirmed",
  "reverted",
  "unknown",
  "released",
];
const ALL_SETTLEMENTS: readonly AttemptSettlement[] = [
  "confirmed",
  "reverted",
  "unknown",
  "released",
];

const OFFER_ID = `0x${"a1".repeat(32)}`;
const ATTEMPT_ID = `0x${"b2".repeat(32)}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deneme geçişleri", () => {
  it("`reserved` her sonuca gidebilir", () => {
    for (const settlement of ALL_SETTLEMENTS) {
      expect(isAllowedSettlement("reserved", settlement)).toBe(true);
    }
  });

  it("`submitted` SERBEST BIRAKILAMAZ", () => {
    // `kit.send` çağrıldıktan sonra rezervasyon açılmaz.
    expect(isAllowedSettlement("submitted", "released")).toBe(false);
    for (const settlement of ["confirmed", "reverted", "unknown"] as const) {
      expect(isAllowedSettlement("submitted", settlement)).toBe(true);
    }
  });

  it("SON durumlardan çıkış YOKTUR", () => {
    for (const terminal of [
      "confirmed",
      "reverted",
      "unknown",
      "released",
    ] as const) {
      for (const settlement of ALL_SETTLEMENTS) {
        expect(
          isAllowedSettlement(terminal, settlement),
          `${terminal} -> ${settlement}`,
        ).toBe(false);
      }
    }
  });

  it("`unknown` deneme SONRADAN onaylanamaz: elle mutabakat şarttır", () => {
    /*
     * Belgelenen davranış budur ve BİLEREK katıdır: sonucu çözülemeyen bir
     * deneme, sonradan gelen bir makbuz doğrulamasıyla bile OTOMATİK olarak
     * `confirmed`e taşınmaz. `review_required` borç, insan tarafından
     * yürütülen açık bir mutabakat gerektirir.
     *
     * Bu sınır gevşetilirse, belirsiz bir denemenin hash'ine bağlanmış
     * herhangi bir makbuz kilidi tek başına açabilirdi.
     */
    for (const settlement of ALL_SETTLEMENTS) {
      expect(
        isAllowedSettlement("unknown", settlement),
        `unknown -> ${settlement}`,
      ).toBe(false);
    }
  });

  it("her durum için izin listesi TANIMLIDIR", () => {
    for (const status of ALL_STATUSES) {
      for (const settlement of ALL_SETTLEMENTS) {
        expect(typeof isAllowedSettlement(status, settlement)).toBe("boolean");
      }
    }
  });
});

describe("borç durumu yerleşimden TÜRETİLİR", () => {
  it("yalnızca onaylı makbuz `paid` üretir", () => {
    expect(debtStatusAfterSettlement("confirmed")).toBe("paid");
    for (const settlement of ["reverted", "unknown", "released"] as const) {
      expect(debtStatusAfterSettlement(settlement)).not.toBe("paid");
    }
  });

  it("belirsizlik `review_required` üretir, `unpaid` DEĞİL", () => {
    expect(debtStatusAfterSettlement("unknown")).toBe("review_required");
  });

  it("revert ve kanıtlı serbest bırakma borcu ödenmemişe döndürür", () => {
    expect(debtStatusAfterSettlement("reverted")).toBe("unpaid");
    expect(debtStatusAfterSettlement("released")).toBe("unpaid");
  });
});

describe("aktif deneme tanımı", () => {
  it("`unknown` de rezervasyonu TUTAR", () => {
    expect(isActiveAttemptStatus("unknown")).toBe(true);
    expect([...ACTIVE_ATTEMPT_STATUSES]).toEqual([
      "reserved",
      "submitted",
      "unknown",
    ]);
  });

  it("SONUÇLANMIŞ denemeler rezervasyonu tutmaz", () => {
    for (const status of ["confirmed", "reverted", "released"] as const) {
      expect(isActiveAttemptStatus(status)).toBe(false);
    }
  });
});

describe("BELİRSİZ deneme süre dolunca da SESSİZCE AÇILMAZ", () => {
  it("temizlik `unknown` denemeyi SİLMEZ", async () => {
    const seeded = await seedPaidBill();
    const prepared = await prepareSharedBillPaymentOffer({
      sessionToken: seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: seeded.repository,
      nowMs: PAYMENT_NOW,
      mintQuote: fakeMint(),
      offerId: OFFER_ID,
    });
    if (!prepared.ok) throw new Error("teklif basilamadi");
    const claim = await claimSharedBillPayment({
      bodyText: JSON.stringify({ offerId: OFFER_ID }),
      sessionToken: seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: seeded.repository,
      nowMs: PAYMENT_NOW,
      attemptId: ATTEMPT_ID,
    });
    if (!claim.ok) throw new Error("rezerve edilemedi");

    await seeded.repository.settleAttempt({
      attemptId: ATTEMPT_ID,
      billId: PAYMENT_BILL_ID,
      debtor: claim.claim.snapshot.debtorAddress,
      settlement: "unknown",
      txHash: null,
      nowMs: PAYMENT_NOW,
    });

    // Rezervasyonun süresi ÇOKTAN doldu.
    const later = PAYMENT_NOW + 30 * 24 * 60 * 60 * 1000;
    await seeded.repository.cleanupExpiredPaymentRecords({
      nowMs: later,
      limit: 50,
    });

    // Kanıt DURUYOR ve borç HÂLÂ inceleme bekliyor.
    expect(seeded.repository.attempts.get(ATTEMPT_ID)?.status).toBe("unknown");
    const bill = seeded.repository.bills.get(PAYMENT_BILL_ID.toLowerCase());
    const debt = bill?.debts.find(
      (row) =>
        row.debtor.toLowerCase() ===
        claim.claim.snapshot.debtorAddress.toLowerCase(),
    );
    expect(debt?.paymentStatus).toBe("review_required");

    // Süresi dolmuş olması bile yeni bir teklife izin vermez.
    const retry = await prepareSharedBillPaymentOffer({
      sessionToken: seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: seeded.repository,
      nowMs: later,
      mintQuote: fakeMint({}, later),
      offerId: `0x${"a9".repeat(32)}`,
    });
    expect(retry.ok).toBe(false);
  });

  it("temizlik yalnızca KULLANILMAMIŞ teklifi ve SERBEST denemeyi siler", async () => {
    const seeded = await seedPaidBill();
    const prepared = await prepareSharedBillPaymentOffer({
      sessionToken: seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: seeded.repository,
      nowMs: PAYMENT_NOW,
      mintQuote: fakeMint(),
      offerId: OFFER_ID,
    });
    if (!prepared.ok) throw new Error("teklif basilamadi");

    const later = PAYMENT_NOW + 30 * 24 * 60 * 60 * 1000;
    await seeded.repository.cleanupExpiredPaymentRecords({
      nowMs: later,
      limit: 50,
    });
    // Hiç kullanılmamış ve süresi dolmuş teklif silinir.
    expect(seeded.repository.offers.size).toBe(0);
  });
});

describe("testlerde CANLI SAĞLAYICI ÇAĞRILMAZ", () => {
  it("kur servisi yapılandırılmamışsa AĞA HİÇ ÇIKILMAZ", async () => {
    const seeded = await seedPaidBill();
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    // Sunucu sırrı YOK: teklif basımı ağa gitmeden fail-closed düşer.
    const withoutSecret = { ...process.env };
    delete withoutSecret.RATE_QUOTE_SECRET;
    delete withoutSecret.COINGECKO_DEMO_API_KEY;
    vi.stubGlobal("process", { ...process, env: withoutSecret });

    const result = await prepareSharedBillPaymentOffer({
      sessionToken: seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: seeded.repository,
      nowMs: PAYMENT_NOW,
      offerId: OFFER_ID,
    });

    if (result.ok) throw new Error("kur servisi olmadan teklif basildi");
    expect(result.code).toBe("RATE_UNAVAILABLE");
    // HİÇBİR ağ isteği yapılmadı.
    expect(networkCall).not.toHaveBeenCalled();
    expect(seeded.repository.offers.size).toBe(0);
  });
});
