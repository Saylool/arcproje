import { describe, expect, it } from "vitest";

import { MAX_RATE_VALUE } from "./conversion";
import { ARC_TESTNET_CHAIN_ID } from "./network";
import {
  amountToMicroUsdc,
  describeArcSendError,
  reviewStateAfterSendFailure,
  validatePaymentSnapshot,
  type ArcPaymentSnapshot,
  type ArcSendErrorCode,
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


describe("snapshot sınırı tutarı kurdan yeniden türetir", () => {
  // Taban snapshot: 20000 kuruş, 1 USDC = 40 TRY -> tam 5.000.000 mikro USDC.
  it("tutarsız tutarı reddeder", () => {
    expect(
      validatePaymentSnapshot(
        snapshotOf({ microUsdc: "500000000", amount: "500.00" }),
        NOW,
      ),
    ).toBe("inconsistentAmount");
  });

  it("tek mikro USDC'lik sapmayı bile yakalar", () => {
    expect(
      validatePaymentSnapshot(
        snapshotOf({ microUsdc: "5000001", amount: "5.000001" }),
        NOW,
      ),
    ).toBe("inconsistentAmount");
    expect(
      validatePaymentSnapshot(
        snapshotOf({ microUsdc: "4999999", amount: "4.999999" }),
        NOW,
      ),
    ).toBe("inconsistentAmount");
  });

  it("kanonik olmayan kur paydasını reddeder", () => {
    for (const rateDenominator of ["3", "20", "10000000", "0"]) {
      expect(
        validatePaymentSnapshot(snapshotOf({ rateDenominator }), NOW),
        rateDenominator,
      ).toBe("invalidRate");
    }
  });

  it("üst sınırın üstündeki kuru reddeder", () => {
    expect(
      validatePaymentSnapshot(
        snapshotOf({ rateNumerator: (MAX_RATE_VALUE + BigInt(1)).toString() }),
        NOW,
      ),
    ).toBe("invalidRate");
  });

  it("sıfır veya bozuk kur alanını reddeder", () => {
    expect(validatePaymentSnapshot(snapshotOf({ rateNumerator: "0" }), NOW)).toBe(
      "invalidRate",
    );
    expect(
      validatePaymentSnapshot(snapshotOf({ rateNumerator: "abc" }), NOW),
    ).toBe("invalidRate");
  });

  it("yarım yukarı yuvarlama sınırını üretimle aynı uygular", () => {
    // 1 kuruş, 1 USDC = 32 TRY -> 312,5 mikro USDC -> yarım yukarı -> 313.
    const halfUp = {
      tryMinor: 1,
      rateNumerator: "32",
      rateDenominator: "1",
    } as const;
    expect(
      validatePaymentSnapshot(
        snapshotOf({ ...halfUp, microUsdc: "313", amount: "0.000313" }),
        NOW,
      ),
    ).toBeNull();
    expect(
      validatePaymentSnapshot(
        snapshotOf({ ...halfUp, microUsdc: "312", amount: "0.000312" }),
        NOW,
      ),
    ).toBe("inconsistentAmount");
  });

  it("kanonik paydalı geçerli kuru kabul eder", () => {
    // 1 USDC = 400,0 TRY -> 4000/10; 20000 kuruş -> 500.000 mikro USDC.
    expect(
      validatePaymentSnapshot(
        snapshotOf({
          rateNumerator: "4000",
          rateDenominator: "10",
          microUsdc: "500000",
          amount: "0.50",
        }),
        NOW,
      ),
    ).toBeNull();
  });
});


describe("gönderim hatasından sonra inceleme ekranının durumu", () => {
  /*
   * Bu tablo Record<ArcSendErrorCode, ...> olarak yazılır: yeni bir hata kodu
   * eklendiğinde burada karşılığı verilmezse TypeScript derlemeyi durdurur.
   * Böylece "karar verilmemiş" bir hata kodu sessizce eklenemez.
   */
  const BEKLENEN: Record<ArcSendErrorCode, "leaveReview" | "keepReview"> = {
    // Talebin geçerlilik penceresi kapandı: aynı talep bir daha gönderilemez.
    expiredRequest: "leaveReview",
    invalidRequestTime: "leaveReview",
    // Kullanıcının düzeltip tekrar deneyebileceği durumlar.
    noProvider: "keepReview",
    rejected: "keepReview",
    noAccount: "keepReview",
    accountChanged: "keepReview",
    networkChanged: "keepReview",
    invalidRecipient: "keepReview",
    invalidSender: "keepReview",
    selfTransfer: "keepReview",
    invalidAmount: "keepReview",
    invalidRate: "keepReview",
    inconsistentAmount: "keepReview",
    invalidRequestId: "keepReview",
    insufficientFunds: "keepReview",
    estimateFailed: "keepReview",
    sendFailed: "keepReview",
  };

  it("süresi dolmuş talepte inceleme bırakılır", () => {
    expect(reviewStateAfterSendFailure("expiredRequest")).toBe("leaveReview");
  });

  it("geçersiz zaman bilgisinde de inceleme bırakılır", () => {
    expect(reviewStateAfterSendFailure("invalidRequestTime")).toBe("leaveReview");
  });

  it("sıradan gönderim hatasında inceleme korunur (tekrar denenebilir)", () => {
    for (const code of ["sendFailed", "rejected", "insufficientFunds"] as const) {
      expect(reviewStateAfterSendFailure(code), code).toBe("keepReview");
    }
  });

  it("her hata kodu için karar tablodakiyle aynıdır", () => {
    for (const [code, beklenen] of Object.entries(BEKLENEN)) {
      expect(
        reviewStateAfterSendFailure(code as ArcSendErrorCode),
        code,
      ).toBe(beklenen);
    }
  });

  it("yalnızca zaman penceresi hataları incelemeyi düşürür", () => {
    const dusurenler = Object.entries(BEKLENEN)
      .filter(([, karar]) => karar === "leaveReview")
      .map(([code]) => code)
      .sort();
    expect(dusurenler).toEqual(["expiredRequest", "invalidRequestTime"]);
  });

  it("incelemeyi düşüren hatalar yeni bağlantı istemeyi açıkça söyler", () => {
    for (const code of ["expiredRequest", "invalidRequestTime"] as const) {
      const mesaj = describeArcSendError(code);
      expect(mesaj, code).toMatch(/gönderim yapılmadı/);
      expect(mesaj, code).toMatch(/yeni bir bağlantı iste/);
    }
  });

  it("tekrar denenebilir hatalar yeni bağlantı istemeyi söylemez", () => {
    for (const code of ["accountChanged", "networkChanged", "insufficientFunds"] as const) {
      expect(describeArcSendError(code), code).not.toMatch(/yeni bir bağlantı iste/);
    }
  });
});
