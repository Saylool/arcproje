import { describe, expect, it } from "vitest";

import { ARC_TESTNET_CHAIN_ID } from "./network";
import {
  amountToMicroUsdc,
  describeArcSendError,
  validatePaymentSnapshot,
  type ArcPaymentSnapshot,
} from "./send";

const DEBTOR = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const RECIPIENT = "0x0000000000000000000000000000000000000aBc";

/** Belirlenimci test zamanı; üretimde her zaman geçerli zaman kullanılır. */
const NOW = 1_700_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
const REQUEST_ID = `0x${"11".repeat(32)}`;

function snapshotOf(over: Partial<ArcPaymentSnapshot> = {}): ArcPaymentSnapshot {
  return Object.freeze({
    debtKey: "b->a",
    debtorParticipantId: "b",
    recipientParticipantId: "a",
    debtorAddress: DEBTOR,
    recipientAddress: RECIPIENT,
    tryMinor: 20000,
    rateNumerator: "40",
    rateDenominator: "1",
    microUsdc: "5000000",
    amount: "5.00",
    displayAmount: "5,00",
    chainId: ARC_TESTNET_CHAIN_ID,
    requestId: REQUEST_ID,
    issuedAt: NOW_SECONDS,
    expiresAt: NOW_SECONDS + SEVEN_DAYS_SECONDS,
    ...over,
  });
}

describe("amountToMicroUsdc", () => {
  it("sıradan ondalık gösterimi kabul eder", () => {
    expect(amountToMicroUsdc("5.00")).toBe(BigInt(5_000_000));
    expect(amountToMicroUsdc("0.000001")).toBe(BigInt(1));
    expect(amountToMicroUsdc("12")).toBe(BigInt(12_000_000));
    expect(amountToMicroUsdc("0.5")).toBe(BigInt(500_000));
  });

  it("üstel gösterim, işaret ve boşluğu reddeder", () => {
    for (const bad of [
      "1e6",
      "1E6",
      "+1.0",
      "-1.0",
      " 1.0",
      "1.0 ",
      "",
      "   ",
      "NaN",
      "Infinity",
      "1,5",
      "1.2.3",
      ".5",
      "1.",
      "01.5",
      "0x10",
    ]) {
      expect(amountToMicroUsdc(bad), `"${bad}" kabul edildi`).toBeNull();
    }
  });

  it("altı ondalıktan fazlasını reddeder", () => {
    expect(amountToMicroUsdc("1.1234567")).toBeNull();
    expect(amountToMicroUsdc("1.123456")).toBe(BigInt(1_123_456));
  });
});

describe("validatePaymentSnapshot", () => {
  it("geçerli snapshot'ı kabul eder", () => {
    expect(validatePaymentSnapshot(snapshotOf(), NOW)).toBeNull();
  });

  it("geçersiz alıcı adresini reddeder", () => {
    expect(validatePaymentSnapshot(snapshotOf({ recipientAddress: "0x123" }), NOW)).toBe(
      "invalidRecipient",
    );
    expect(validatePaymentSnapshot(snapshotOf({ recipientAddress: "" }), NOW)).toBe(
      "invalidRecipient",
    );
  });

  it("geçersiz gönderen adresini reddeder", () => {
    expect(validatePaymentSnapshot(snapshotOf({ debtorAddress: "yok" }), NOW)).toBe(
      "invalidSender",
    );
  });

  it("kendine transferi reddeder", () => {
    expect(
      validatePaymentSnapshot(
        snapshotOf({ debtorAddress: RECIPIENT, recipientAddress: RECIPIENT }),
        NOW,
      ),
    ).toBe("selfTransfer");
  });

  it("büyük/küçük harf farklı yazılmış aynı adresi de kendine transfer sayar", () => {
    expect(
      validatePaymentSnapshot(
        snapshotOf({
          debtorAddress: RECIPIENT.toLowerCase(),
          recipientAddress: RECIPIENT.toUpperCase().replace("0X", "0x"),
        }),
        NOW,
      ),
    ).toBe("selfTransfer");
  });

  it("farklı kişi ID'leri olsa bile aynı adresi reddeder", () => {
    expect(
      validatePaymentSnapshot(
        snapshotOf({
          debtorParticipantId: "b",
          recipientParticipantId: "a",
          debtorAddress: DEBTOR,
          recipientAddress: DEBTOR.toLowerCase(),
        }),
        NOW,
      ),
    ).toBe("selfTransfer");
  });

  it("Arc Testnet dışındaki zinciri reddeder", () => {
    expect(validatePaymentSnapshot(snapshotOf({ chainId: 1 }), NOW)).toBe(
      "networkChanged",
    );
  });

  it("sıfır ve geçersiz tutarı reddeder", () => {
    expect(
      validatePaymentSnapshot(snapshotOf({ amount: "0", microUsdc: "0" }), NOW),
    ).toBe("invalidAmount");
    expect(
      validatePaymentSnapshot(snapshotOf({ amount: "0.000000", microUsdc: "0" }), NOW),
    ).toBe("invalidAmount");
    expect(validatePaymentSnapshot(snapshotOf({ amount: "1e6" }), NOW)).toBe(
      "invalidAmount",
    );
  });

  it("tutar ile mikro birim uyuşmazsa reddeder", () => {
    expect(validatePaymentSnapshot(snapshotOf({ microUsdc: "4999999" }), NOW)).toBe(
      "invalidAmount",
    );
    expect(validatePaymentSnapshot(snapshotOf({ microUsdc: "abc" }), NOW)).toBe(
      "invalidAmount",
    );
  });

  it("geçersiz TRY borcunu reddeder", () => {
    expect(validatePaymentSnapshot(snapshotOf({ tryMinor: 0 }), NOW)).toBe(
      "invalidAmount",
    );
    expect(validatePaymentSnapshot(snapshotOf({ tryMinor: -5 }), NOW)).toBe(
      "invalidAmount",
    );
    expect(
      validatePaymentSnapshot(snapshotOf({ tryMinor: Number.MAX_SAFE_INTEGER + 2 }), NOW),
    ).toBe("invalidAmount");
  });

  it("her hata kodu için Türkçe mesaj üretir", () => {
    for (const code of [
      "invalidRecipient",
      "invalidSender",
      "selfTransfer",
      "invalidAmount",
      "accountChanged",
      "networkChanged",
      "noAccount",
    ] as const) {
      expect(describeArcSendError(code).length).toBeGreaterThan(0);
    }
  });
});

describe("snapshot değişmezliği", () => {
  it("snapshot dondurulmuştur", () => {
    const snapshot = snapshotOf();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("onaylanan snapshot sonradan değişen form değerlerinden etkilenmez", () => {
    const reviewed = snapshotOf({ amount: "5.00", microUsdc: "5000000" });
    // Kullanıcı formda kuru değiştirse bile onaylanan kayıt aynı kalır.
    const later = snapshotOf({ amount: "9.00", microUsdc: "9000000" });
    expect(reviewed.amount).toBe("5.00");
    expect(reviewed.microUsdc).toBe("5000000");
    expect(later.amount).not.toBe(reviewed.amount);
    expect(validatePaymentSnapshot(reviewed, NOW)).toBeNull();
  });
});
