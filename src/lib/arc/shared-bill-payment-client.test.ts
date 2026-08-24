import { describe, expect, it } from "vitest";

import { convertTryMinorBigIntToMicroUsdc } from "./conversion";
import { ACTIVE_NETWORK_PROFILE } from "./profile";
import type { ArcPaymentSnapshot, ArcSendErrorCode } from "./send";
import {
  outcomeForSendFailure,
  verifyClaimedSnapshot,
  verifyPaymentOffer,
  type VerifiedOffer,
} from "./shared-bill-payment-client";
import { parseQuoteRate } from "@/lib/rates/quote";

/**
 * İSTEMCİ TARAFI BAĞIMSIZ DOĞRULAMA.
 *
 * Hiçbir testte ağ, cüzdan, App Kit ya da sunucu ÇAĞRILMAZ. Adresler
 * uydurmadır.
 */

const CHAIN = ACTIVE_NETWORK_PROFILE.chainId;
const NOW = 1_700_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);
const BILL_ID = `0x${"5c".repeat(32)}`;
const DEBTOR = `0x${"11".repeat(20)}`;
const RECIPIENT = `0x${"22".repeat(20)}`;
const STRANGER = `0x${"33".repeat(20)}`;
const OFFER_ID = `0x${"a1".repeat(32)}`;
const QUOTE_ID = `0x${"91".repeat(32)}`;
const ATTEMPT_ID = `0x${"b2".repeat(32)}`;

const RATE_NUMERATOR = "40000000";
const RATE_DENOMINATOR = "1000000";
const TRY_MINOR = "12345";

function microFor(tryMinor: string): bigint {
  const rate = parseQuoteRate(RATE_NUMERATOR, RATE_DENOMINATOR);
  if (!rate.ok) throw new Error("kur");
  const converted = convertTryMinorBigIntToMicroUsdc(BigInt(tryMinor), rate.rate);
  if (!converted.ok) throw new Error("donusum");
  return converted.microUsdc;
}

function offerPayload(overrides: Record<string, unknown> = {}) {
  const micro = microFor(TRY_MINOR);
  const whole = micro / BigInt(1_000_000);
  const fraction = (micro % BigInt(1_000_000)).toString().padStart(6, "0");
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0");
  return {
    offer: {
      offerId: OFFER_ID,
      billId: BILL_ID,
      debtor: DEBTOR,
      recipient: RECIPIENT,
      recipientLabel: "Poyraz",
      debtKey: "a->p",
      tryMinor: TRY_MINOR,
      microUsdc: micro.toString(),
      amount: `${whole}.${trimmed}`,
      displayAmount: `${whole},${trimmed}`,
      rateNumerator: RATE_NUMERATOR,
      rateDenominator: RATE_DENOMINATOR,
      rateDisplay: "40.000000",
      rateSource: "coingecko",
      quoteId: QUOTE_ID,
      quoteIssuedAt: NOW_SECONDS,
      quoteExpiresAt: NOW_SECONDS + 300,
      issuedAt: NOW_SECONDS,
      expiresAt: NOW_SECONDS + 300,
      chainId: CHAIN,
      billExpiresAt: NOW_SECONDS + 86400,
      ...overrides,
    },
  };
}

function verify(overrides: Record<string, unknown> = {}, extra: Partial<Parameters<typeof verifyPaymentOffer>[0]> = {}) {
  return verifyPaymentOffer({
    payload: offerPayload(overrides),
    connectedAddress: DEBTOR,
    connectedChainId: CHAIN,
    billId: BILL_ID,
    verifiedRecipient: RECIPIENT,
    verifiedTryMinor: TRY_MINOR,
    nowMs: NOW,
    ...extra,
  });
}

describe("teklif İSTEMCİDE bağımsız doğrulanır", () => {
  it("tutarlı teklifi kabul eder", () => {
    const result = verify();
    if (!result.ok) throw new Error(`teklif reddedildi: ${result.problem}`);
    expect(result.offer.tryMinor).toBe(TRY_MINOR);
    expect(result.offer.microUsdc).toBe(microFor(TRY_MINOR).toString());
  });

  it("BAŞKA bir cüzdanın teklifini göstermez", () => {
    const result = verify({ debtor: STRANGER });
    expect(result).toEqual({ ok: false, problem: "walletMismatch" });
  });

  it("ALICI imzalı manifesttekinden farklıysa cüzdan AÇILMAZ", () => {
    const result = verify({ recipient: STRANGER });
    expect(result).toEqual({ ok: false, problem: "recipientMismatch" });
  });

  it("TRY tutarı doğrulanmış borçtan farklıysa reddeder", () => {
    const result = verify({ tryMinor: "99999" });
    expect(result).toEqual({ ok: false, problem: "amountMismatch" });
  });

  it("mikro USDC borç ve kurdan YENİDEN türetilir", () => {
    const tampered = (microFor(TRY_MINOR) + BigInt(1)).toString();
    const result = verify({ microUsdc: tampered });
    expect(result).toEqual({ ok: false, problem: "inconsistentAmount" });
  });

  it("gösterilen tutar mikro USDC ile AYNI tam sayıdan türemelidir", () => {
    const result = verify({ amount: "999.999999" });
    expect(result).toEqual({ ok: false, problem: "inconsistentAmount" });
  });

  it("Arc Testnet dışındaki zinciri reddeder", () => {
    expect(verify({}, { connectedChainId: 11155111 })).toEqual({
      ok: false,
      problem: "wrongChain",
    });
    expect(verify({ chainId: 11155111 })).toEqual({
      ok: false,
      problem: "wrongChain",
    });
  });

  it("teklif kurdan ya da hesaptan uzun yaşayamaz", () => {
    expect(verify({ expiresAt: NOW_SECONDS + 400 }).ok).toBe(false);
    expect(
      verify({ billExpiresAt: NOW_SECONDS + 10, expiresAt: NOW_SECONDS + 300 }).ok,
    ).toBe(false);
  });

  it("süresi dolmuş ya da payı tükenmiş teklifi reddeder", () => {
    expect(verify({}, { nowMs: (NOW_SECONDS + 301) * 1000 })).toEqual({
      ok: false,
      problem: "expired",
    });
    expect(verify({}, { nowMs: (NOW_SECONDS + 290) * 1000 })).toEqual({
      ok: false,
      problem: "insufficientTime",
    });
  });

  it("bozuk yanıtı reddeder", () => {
    for (const payload of [null, {}, { offer: null }, { offer: 42 }]) {
      const result = verifyPaymentOffer({
        payload,
        connectedAddress: DEBTOR,
        connectedChainId: CHAIN,
        billId: BILL_ID,
        verifiedRecipient: RECIPIENT,
        verifiedTryMinor: TRY_MINOR,
        nowMs: NOW,
      });
      expect(result).toEqual({ ok: false, problem: "malformedResponse" });
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * REZERVASYON KARŞILAŞTIRMASI
 * ---------------------------------------------------------------------------
 */

function reviewedOffer(): VerifiedOffer {
  const result = verify();
  if (!result.ok) throw new Error("teklif reddedildi");
  return result.offer;
}

function snapshotOf(overrides: Partial<ArcPaymentSnapshot> = {}): ArcPaymentSnapshot {
  const reviewed = reviewedOffer();
  return Object.freeze({
    debtKey: "a->p",
    debtorParticipantId: "Ada",
    recipientParticipantId: "Poyraz",
    debtorAddress: DEBTOR,
    recipientAddress: RECIPIENT,
    tryMinor: reviewed.tryMinor,
    rateNumerator: reviewed.rateNumerator,
    rateDenominator: reviewed.rateDenominator,
    microUsdc: reviewed.microUsdc,
    amount: reviewed.amount,
    displayAmount: reviewed.displayAmount,
    chainId: CHAIN,
    requestId: ATTEMPT_ID,
    issuedAt: NOW_SECONDS,
    expiresAt: NOW_SECONDS + 240,
    quoteId: QUOTE_ID,
    quoteExpiresAt: NOW_SECONDS + 240,
    ...overrides,
  });
}

function claimPayload(snapshot: ArcPaymentSnapshot = snapshotOf()) {
  return { attemptId: ATTEMPT_ID, offerId: OFFER_ID, snapshot };
}

function checkClaim(payload: unknown) {
  return verifyClaimedSnapshot({
    payload,
    reviewed: reviewedOffer(),
    connectedAddress: DEBTOR,
    connectedChainId: CHAIN,
    nowMs: NOW,
  });
}

describe("rezervasyon İNCELENENLE BİREBİR eşleşmelidir", () => {
  it("aynı ödemeyi kabul eder", () => {
    const result = checkClaim(claimPayload());
    if (!result.ok) throw new Error(`rezervasyon reddedildi: ${result.problem}`);
    expect(result.claim.attemptId).toBe(ATTEMPT_ID);
  });

  it("TUTAR değiştiyse GÖNDERİM YAPILMAZ", () => {
    const micro = (BigInt(reviewedOffer().microUsdc) + BigInt(1)).toString();
    const result = checkClaim(
      claimPayload(snapshotOf({ microUsdc: micro, amount: "999.999999" })),
    );
    // Gönderim sınırının kendi doğrulaması zaten tutarsızlığı yakalar.
    expect(result.ok).toBe(false);
  });

  it("ALICI değiştiyse GÖNDERİM YAPILMAZ", () => {
    const result = checkClaim(
      claimPayload(snapshotOf({ recipientAddress: STRANGER })),
    );
    expect(result).toEqual({ ok: false, problem: "changedFromReview" });
  });

  it("KUR değiştiyse GÖNDERİM YAPILMAZ", () => {
    const result = checkClaim(
      claimPayload(snapshotOf({ quoteId: `0x${"99".repeat(32)}` })),
    );
    expect(result).toEqual({ ok: false, problem: "changedFromReview" });
  });

  it("HESAP değiştiyse GÖNDERİM YAPILMAZ", () => {
    const result = verifyClaimedSnapshot({
      payload: claimPayload(),
      reviewed: reviewedOffer(),
      connectedAddress: STRANGER,
      connectedChainId: CHAIN,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, problem: "changedFromReview" });
  });

  it("AĞ değiştiyse GÖNDERİM YAPILMAZ", () => {
    const result = verifyClaimedSnapshot({
      payload: claimPayload(),
      reviewed: reviewedOffer(),
      connectedAddress: DEBTOR,
      connectedChainId: 11155111,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, problem: "changedFromReview" });
  });

  it("deneme kimliği snapshot'ın talep kimliğiyle eşleşmelidir", () => {
    const result = checkClaim(
      claimPayload(snapshotOf({ requestId: `0x${"ee".repeat(32)}` })),
    );
    expect(result).toEqual({ ok: false, problem: "malformedResponse" });
  });

  it("süresi dolmuş snapshot cüzdana GİTMEZ", () => {
    const result = verifyClaimedSnapshot({
      payload: claimPayload(),
      reviewed: reviewedOffer(),
      connectedAddress: DEBTOR,
      connectedChainId: CHAIN,
      nowMs: (NOW_SECONDS + 500) * 1000,
    });
    expect(result).toEqual({ ok: false, problem: "snapshotRejected" });
  });
});

/*
 * ---------------------------------------------------------------------------
 * SONUÇ EŞLEMESİ — sınıflandırıcı YENİDEN YAZILMAZ
 * ---------------------------------------------------------------------------
 */

describe("gönderim sonucu KATI sonuca çevrilir", () => {
  const HASH = `0x${"ab".repeat(32)}`;

  it("HASH varsa sonuç HER ZAMAN mutabakata gider", () => {
    for (const code of [
      "rejected",
      "insufficientFunds",
      "reverted",
      "submissionUnknown",
      "sendFailed",
    ] as ArcSendErrorCode[]) {
      expect(outcomeForSendFailure(code, HASH)).toEqual({
        outcome: "submitted",
        txHash: HASH,
      });
    }
  });

  it("KANITLI kullanıcı reddi ve bakiye hatası serbest bırakır", () => {
    expect(outcomeForSendFailure("rejected", null).outcome).toBe("rejected");
    expect(outcomeForSendFailure("insufficientFunds", null).outcome).toBe(
      "insufficientFunds",
    );
  });

  it("BELİRSİZ sonuç kilidi AÇMAZ", () => {
    expect(outcomeForSendFailure("submissionUnknown", null).outcome).toBe(
      "ambiguous",
    );
    expect(outcomeForSendFailure("reverted", null).outcome).toBe("ambiguous");
  });

  it("`kit.send` HİÇ çağrılmadıysa serbest bırakılır", () => {
    for (const code of [
      "noProvider",
      "noAccount",
      "accountChanged",
      "networkChanged",
      "invalidRecipient",
      "invalidSender",
      "selfTransfer",
      "invalidAmount",
      "invalidRate",
      "inconsistentAmount",
      "invalidRequestId",
      "invalidRequestTime",
      "expiredRequest",
      "invalidQuoteId",
      "expiredQuote",
      "insufficientTimeRemaining",
      "estimateFailed",
      "sendFailed",
    ] as ArcSendErrorCode[]) {
      expect(outcomeForSendFailure(code, null).outcome).toBe("preflightFailed");
    }
  });
});
