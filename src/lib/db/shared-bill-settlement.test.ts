import { describe, expect, it } from "vitest";

import { ERC20_TRANSFER_TOPIC, type ArcRpcClient } from "@/lib/arc/arc-receipt";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";

import { claimSharedBillPayment } from "./shared-bill-claim-service";
import {
  PAYMENT_BILL_ID,
  PAYMENT_NOW,
  fakeMint,
  seedPaidBill,
  type SeededBill,
} from "./shared-bill-payment.fixture";
import { prepareSharedBillPaymentOffer } from "./shared-bill-payment-service";
import {
  finalizeSharedBillPayment,
  readSharedBillPaymentStatus,
  reportClientOutcome,
} from "./shared-bill-settlement-service";

/**
 * SUNUCU TARAFI MUTABAKAT.
 *
 * Arc RPC ENJEKTE EDİLİR: hiçbir testte ağa çıkılmaz. Hiçbir gerçek işlem
 * hash'i, adres ya da makbuz kullanılmaz.
 */

const OFFER_ID = `0x${"a1".repeat(32)}`;
const ATTEMPT_ID = `0x${"b2".repeat(32)}`;
const TX_HASH = `0x${"ab".repeat(32)}`;
const OTHER_HASH = `0x${"cd".repeat(32)}`;
const TOKEN = ACTIVE_NETWORK_PROFILE.tokenErc20Address;

function topicOf(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

type Claimed = {
  seeded: SeededBill;
  attemptId: string;
  debtor: string;
  recipient: string;
  microUsdc: string;
};

/** Teklif bas → rezerve et. Cüzdan HİÇ çağrılmaz. */
async function claimed(): Promise<Claimed> {
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

  const result = await claimSharedBillPayment({
    bodyText: JSON.stringify({ offerId: OFFER_ID }),
    sessionToken: seeded.sessionTokens[0],
    pathBillId: PAYMENT_BILL_ID,
    repository: seeded.repository,
    nowMs: PAYMENT_NOW,
    attemptId: ATTEMPT_ID,
  });
  if (!result.ok) throw new Error(`rezerve edilemedi: ${result.code}`);

  return {
    seeded,
    attemptId: result.claim.attemptId,
    debtor: result.claim.snapshot.debtorAddress,
    recipient: result.claim.snapshot.recipientAddress,
    microUsdc: result.claim.snapshot.microUsdc,
  };
}

/** İstenen tutarı taşıyan başarılı bir makbuz döndüren sahte RPC. */
function successClient(input: {
  debtor: string;
  recipient: string;
  value: string;
  txHash?: string;
}): ArcRpcClient {
  return Object.freeze({
    async getChainId() {
      return ACTIVE_NETWORK_PROFILE.chainId;
    },
    async getTransactionReceipt() {
      return {
        transactionHash: input.txHash ?? TX_HASH,
        status: "success",
        blockNumber: BigInt(100),
        logs: [
          {
            address: TOKEN,
            topics: [
              ERC20_TRANSFER_TOPIC,
              topicOf(input.debtor),
              topicOf(input.recipient),
            ],
            data: `0x${BigInt(input.value).toString(16).padStart(64, "0")}`,
          },
        ],
      };
    },
    async getBlockNumber() {
      return BigInt(100);
    },
  });
}

function pendingClient(): ArcRpcClient {
  return Object.freeze({
    async getChainId() {
      return ACTIVE_NETWORK_PROFILE.chainId;
    },
    async getTransactionReceipt() {
      return null;
    },
    async getBlockNumber() {
      return BigInt(100);
    },
  });
}

function revertedClient(): ArcRpcClient {
  return Object.freeze({
    async getChainId() {
      return ACTIVE_NETWORK_PROFILE.chainId;
    },
    async getTransactionReceipt() {
      return {
        transactionHash: TX_HASH,
        status: "reverted",
        blockNumber: BigInt(100),
        logs: [],
      };
    },
    async getBlockNumber() {
      return BigInt(100);
    },
  });
}

function finalize(
  context: Claimed,
  client: ArcRpcClient,
  overrides: { txHash?: string; sessionToken?: string; attemptId?: string } = {},
) {
  return finalizeSharedBillPayment({
    bodyText: JSON.stringify({
      attemptId: overrides.attemptId ?? context.attemptId,
      txHash: overrides.txHash ?? TX_HASH,
    }),
    sessionToken: overrides.sessionToken ?? context.seeded.sessionTokens[0],
    pathBillId: PAYMENT_BILL_ID,
    repository: context.seeded.repository,
    nowMs: PAYMENT_NOW,
    client,
  });
}

function debtOf(context: Claimed) {
  const bill = context.seeded.repository.bills.get(
    PAYMENT_BILL_ID.toLowerCase(),
  );
  return bill?.debts.find(
    (row) => row.debtor.toLowerCase() === context.debtor.toLowerCase(),
  );
}

describe("borç YALNIZCA doğrulanmış makbuzla ödenmiş olur", () => {
  it("tam eşleşen makbuz borcu paid yapar", async () => {
    const context = await claimed();
    const result = await finalize(
      context,
      successClient({
        debtor: context.debtor,
        recipient: context.recipient,
        value: context.microUsdc,
      }),
    );
    if (!result.ok) throw new Error(`kesinlestirilemedi: ${result.code}`);
    expect(result.report.state).toBe("confirmed");
    expect(result.report.debtStatus).toBe("paid");
    expect(debtOf(context)?.paymentStatus).toBe("paid");
    expect(debtOf(context)?.paidTxHash).toBe(TX_HASH);
  });

  it("İSTEMCİNİN 'başarılı' iddiası TEK BAŞINA ödendi yapmaz", async () => {
    const context = await claimed();
    /*
     * İstemci elinden gelenin en iyisini yapar: bir hash bildirir. Sunucu
     * makbuzu HENÜZ görmediği için borç ÖDENMİŞ SAYILMAZ.
     */
    const reported = await reportClientOutcome({
      bodyText: JSON.stringify({
        attemptId: context.attemptId,
        outcome: "submitted",
        txHash: TX_HASH,
      }),
      sessionToken: context.seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
    });
    if (!reported.ok) throw new Error("bildirim reddedildi");
    expect(reported.report.attemptStatus).toBe("submitted");
    expect(reported.report.reconcile).toBe(true);
    expect(debtOf(context)?.paymentStatus).toBe("reserved");

    // Makbuz hâlâ yokken kesinleştirme de ödendi demez.
    const result = await finalize(context, pendingClient());
    if (!result.ok) throw new Error("kesinlestirme reddedildi");
    expect(result.report.state).toBe("pending");
    expect(debtOf(context)?.paymentStatus).toBe("reserved");
  });

  it("istemci 'success' sonucunu BİLDİREMEZ", async () => {
    const context = await claimed();
    const reported = await reportClientOutcome({
      bodyText: JSON.stringify({
        attemptId: context.attemptId,
        outcome: "success",
        txHash: TX_HASH,
      }),
      sessionToken: context.seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
    });
    if (reported.ok) throw new Error("'success' kabul edildi");
    expect(reported.code).toBe("INVALID_OUTCOME");
  });

  it("YANLIŞ TUTARLI makbuz ödendi yapmaz, inceleme gerektirir", async () => {
    const context = await claimed();
    const result = await finalize(
      context,
      successClient({
        debtor: context.debtor,
        recipient: context.recipient,
        value: (BigInt(context.microUsdc) - BigInt(1)).toString(),
      }),
    );
    if (!result.ok) throw new Error("kesinlestirme reddedildi");
    expect(result.report.state).toBe("review_required");
    expect(debtOf(context)?.paymentStatus).toBe("review_required");
    // Hash ArcScan mutabakatı için KORUNUR.
    expect(result.report.txHash).toBe(TX_HASH);
    expect(result.report.explorerUrl).toContain(TX_HASH);
  });

  it("REVERT eden makbuz borcu ödenmemiş bırakır ama hash'i korur", async () => {
    const context = await claimed();
    const result = await finalize(context, revertedClient());
    if (!result.ok) throw new Error("kesinlestirme reddedildi");
    expect(result.report.state).toBe("reverted");
    expect(debtOf(context)?.paymentStatus).toBe("unpaid");
    expect(result.report.txHash).toBe(TX_HASH);
    expect(
      context.seeded.repository.attempts.get(ATTEMPT_ID)?.status,
    ).toBe("reverted");
  });
});

describe("mutabakat IDEMPOTENT ve YARIŞA DAYANIKLIDIR", () => {
  it("onaylanmış durum tekrar çağrılınca değişmez", async () => {
    const context = await claimed();
    const client = successClient({
      debtor: context.debtor,
      recipient: context.recipient,
      value: context.microUsdc,
    });
    const first = await finalize(context, client);
    const second = await finalize(context, client);
    if (!first.ok || !second.ok) throw new Error("kesinlestirilemedi");
    expect(first.report.state).toBe("confirmed");
    expect(second.report.state).toBe("confirmed");
    expect(debtOf(context)?.paymentStatus).toBe("paid");
  });

  it("EŞZAMANLI iki kesinleştirme tutarlı tek sonuç üretir", async () => {
    const context = await claimed();
    const client = successClient({
      debtor: context.debtor,
      recipient: context.recipient,
      value: context.microUsdc,
    });
    const [first, second] = await Promise.all([
      finalize(context, client),
      finalize(context, client),
    ]);
    expect(first.ok && second.ok).toBe(true);
    expect(debtOf(context)?.paymentStatus).toBe("paid");
    expect(context.seeded.repository.attempts.get(ATTEMPT_ID)?.status).toBe(
      "confirmed",
    );
  });

  it("ÖDENMİŞ borç ASLA ödenmemişe dönmez", async () => {
    const context = await claimed();
    await finalize(
      context,
      successClient({
        debtor: context.debtor,
        recipient: context.recipient,
        value: context.microUsdc,
      }),
    );
    expect(debtOf(context)?.paymentStatus).toBe("paid");

    // Sonradan gelen "reddedildi" bildirimi hiçbir şeyi geri almaz.
    const reported = await reportClientOutcome({
      bodyText: JSON.stringify({
        attemptId: context.attemptId,
        outcome: "rejected",
        txHash: null,
      }),
      sessionToken: context.seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
    });
    if (!reported.ok) throw new Error("bildirim reddedildi");
    expect(reported.report.attemptStatus).toBe("confirmed");
    expect(debtOf(context)?.paymentStatus).toBe("paid");
  });

  it("onaylanmış deneme BAŞKA bir hash'e bağlanamaz", async () => {
    const context = await claimed();
    await finalize(
      context,
      successClient({
        debtor: context.debtor,
        recipient: context.recipient,
        value: context.microUsdc,
      }),
    );
    const again = await finalize(
      context,
      successClient({
        debtor: context.debtor,
        recipient: context.recipient,
        value: context.microUsdc,
        txHash: OTHER_HASH,
      }),
      { txHash: OTHER_HASH },
    );
    if (again.ok) throw new Error("ikinci hash kabul edildi");
    expect(again.code).toBe("TX_HASH_IN_USE");
  });
});

describe("işlem hash'i KÜRESEL olarak benzersizdir", () => {
  it("aynı hash ikinci bir denemeye bağlanamaz", async () => {
    const context = await claimed();
    // İlk denemeyi hash ile submitted yap.
    await reportClientOutcome({
      bodyText: JSON.stringify({
        attemptId: context.attemptId,
        outcome: "submitted",
        txHash: TX_HASH,
      }),
      sessionToken: context.seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
    });

    // İkinci borçlu için ayrı bir deneme aç.
    const prepared = await prepareSharedBillPaymentOffer({
      sessionToken: context.seeded.sessionTokens[1],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
      mintQuote: fakeMint(),
      offerId: `0x${"a2".repeat(32)}`,
    });
    if (!prepared.ok) throw new Error("ikinci teklif basilamadi");
    const secondClaim = await claimSharedBillPayment({
      bodyText: JSON.stringify({ offerId: `0x${"a2".repeat(32)}` }),
      sessionToken: context.seeded.sessionTokens[1],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
      attemptId: `0x${"b3".repeat(32)}`,
    });
    if (!secondClaim.ok) throw new Error("ikinci rezervasyon yapilamadi");

    // AYNI hash'i ikinci denemeye bağlamaya çalış.
    const reused = await reportClientOutcome({
      bodyText: JSON.stringify({
        attemptId: secondClaim.claim.attemptId,
        outcome: "submitted",
        txHash: TX_HASH,
      }),
      sessionToken: context.seeded.sessionTokens[1],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
    });
    if (reused.ok) throw new Error("hash yeniden kullanildi");
    expect(reused.code).toBe("TX_HASH_IN_USE");
  });
});

describe("belirsiz sonuç KİLİDİ AÇMAZ", () => {
  it("ambiguous bildirimi borcu review_required yapar", async () => {
    const context = await claimed();
    const reported = await reportClientOutcome({
      bodyText: JSON.stringify({
        attemptId: context.attemptId,
        outcome: "ambiguous",
        txHash: null,
      }),
      sessionToken: context.seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
    });
    if (!reported.ok) throw new Error("bildirim reddedildi");
    expect(reported.report.attemptStatus).toBe("unknown");
    expect(debtOf(context)?.paymentStatus).toBe("review_required");
  });

  it("belirsiz denemeden sonra OTOMATİK TEKRAR yoktur", async () => {
    const context = await claimed();
    await reportClientOutcome({
      bodyText: JSON.stringify({
        attemptId: context.attemptId,
        outcome: "ambiguous",
        txHash: null,
      }),
      sessionToken: context.seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
    });

    // Yeni bir teklif bile basılamaz.
    const retry = await prepareSharedBillPaymentOffer({
      sessionToken: context.seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
      mintQuote: fakeMint(),
      offerId: `0x${"a9".repeat(32)}`,
    });
    if (retry.ok) throw new Error("belirsiz denemeden sonra tekrar acildi");
    expect(retry.code).toBe("DEBT_NOT_CLAIMABLE");
  });

  it("YAYIN ÖNCESİ olduğu bildirilen sonuç HASH TAŞIYAMAZ", async () => {
    const context = await claimed();
    for (const outcome of [
      "rejected",
      "insufficientFunds",
      "preflightFailed",
    ]) {
      const reported = await reportClientOutcome({
        bodyText: JSON.stringify({
          attemptId: context.attemptId,
          outcome,
          txHash: TX_HASH,
        }),
        sessionToken: context.seeded.sessionTokens[0],
        pathBillId: PAYMENT_BILL_ID,
        repository: context.seeded.repository,
        nowMs: PAYMENT_NOW,
      });
      if (reported.ok) throw new Error(`${outcome} hash ile kabul edildi`);
      expect(reported.code).toBe("OUTCOME_HASH_CONFLICT");
    }
  });

  it("gönderildikten SONRA serbest bırakma İMKÂNSIZDIR", async () => {
    const context = await claimed();
    await reportClientOutcome({
      bodyText: JSON.stringify({
        attemptId: context.attemptId,
        outcome: "submitted",
        txHash: TX_HASH,
      }),
      sessionToken: context.seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
    });

    const released = await reportClientOutcome({
      bodyText: JSON.stringify({
        attemptId: context.attemptId,
        outcome: "rejected",
        txHash: null,
      }),
      sessionToken: context.seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
    });
    if (released.ok) throw new Error("gonderim sonrasi serbest birakildi");
    expect(released.code).toBe("INVALID_TRANSITION");
    expect(debtOf(context)?.paymentStatus).toBe("reserved");
  });
});

describe("KANITLI yayın öncesi hata rezervasyonu serbest bırakır", () => {
  it("kullanıcı reddi borcu tekrar ödenebilir yapar", async () => {
    const context = await claimed();
    const reported = await reportClientOutcome({
      bodyText: JSON.stringify({
        attemptId: context.attemptId,
        outcome: "rejected",
        txHash: null,
      }),
      sessionToken: context.seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
    });
    if (!reported.ok) throw new Error("bildirim reddedildi");
    expect(reported.report.attemptStatus).toBe("released");
    expect(debtOf(context)?.paymentStatus).toBe("unpaid");
    expect(reported.report.txHash).toBeNull();
  });
});

describe("SAHİPLİK ve GİZLİLİK", () => {
  it("BAŞKA bir borçlunun denemesi kesinleştirilemez", async () => {
    const context = await claimed();
    const result = await finalize(
      context,
      successClient({
        debtor: context.debtor,
        recipient: context.recipient,
        value: context.microUsdc,
      }),
      { sessionToken: context.seeded.sessionTokens[1] },
    );
    if (result.ok) throw new Error("baskasinin denemesi kesinlestirildi");
    expect(result.code).toBe("ATTEMPT_NOT_FOUND");
  });

  it("durum yanıtı yalnızca KENDİ verisini taşır", async () => {
    const context = await claimed();
    const status = await readSharedBillPaymentStatus({
      sessionToken: context.seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
    });
    if (!status.ok) throw new Error("durum okunamadi");

    const serialized = JSON.stringify(status.status);
    for (const other of context.seeded.debts) {
      if (other.debtor.toLowerCase() === context.debtor.toLowerCase()) continue;
      expect(serialized).not.toContain(other.debtor);
      expect(serialized).not.toContain(other.debtKey);
    }
    expect(serialized).not.toContain(context.seeded.sessionTokens[0]);
    expect(status.status.debtStatus).toBe("reserved");
  });

  it("oturumsuz durum sorgusu hiçbir şey dönmez", async () => {
    const context = await claimed();
    const status = await readSharedBillPaymentStatus({
      sessionToken: null,
      pathBillId: PAYMENT_BILL_ID,
      repository: context.seeded.repository,
      nowMs: PAYMENT_NOW,
    });
    if (status.ok) throw new Error("oturumsuz durum donduruldu");
    expect(status.status).toBe(401);
  });
});

describe("hesap TÜM borçlar onaylandığında kapanır", () => {
  it("tek borç onaylandığında hesap AÇIK kalır", async () => {
    const context = await claimed();
    const result = await finalize(
      context,
      successClient({
        debtor: context.debtor,
        recipient: context.recipient,
        value: context.microUsdc,
      }),
    );
    if (!result.ok) throw new Error("kesinlestirilemedi");
    expect(result.report.billClosed).toBe(false);
    expect(
      context.seeded.repository.bills.get(PAYMENT_BILL_ID.toLowerCase())?.status,
    ).toBe("open");
  });
});
