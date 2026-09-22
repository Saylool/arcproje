import { beforeEach, describe, expect, it, vi } from "vitest";

import { ARC_TESTNET_CHAIN_ID } from "./network";
import type { ArcPaymentSnapshot } from "./send";

/**
 * viem seam'i ve cüzdan katmanı taklit edilir; gerçek bir zincir işlemi
 * yapılmaz. Amaç, güvenlik sınırının zincire ne zaman uzandığını ve ne zaman
 * HİÇ uzanmadığını kanıtlamaktır.
 */

const simulateMock = vi.fn();
const submitMock = vi.fn();
const receiptMock = vi.fn();
const estimateMock = vi.fn();
const clientMock = vi.fn();

vi.mock("./transfer-client", () => ({
  createArcTransferClient: (...args: unknown[]) => {
    clientMock(...args);
    return Promise.resolve({
      estimateFee: estimateMock,
      simulate: simulateMock,
      submit: submitMock,
      waitForReceipt: receiptMock,
    });
  },
}));

type RequestArgs = { method: string; params?: unknown[] | object };
let accountsResponse: unknown = [];
let chainResponse: unknown = "0x4cef52";

const provider = {
  request: ({ method }: RequestArgs) => {
    if (method === "eth_accounts") return Promise.resolve(accountsResponse);
    if (method === "eth_chainId") return Promise.resolve(chainResponse);
    return Promise.reject(new Error("desteklenmeyen metot"));
  },
};

vi.mock("./wallet", () => ({
  withProvider: async (
    _uuid: string,
    run: (p: typeof provider) => Promise<unknown>,
  ) => {
    try {
      return { ok: true, value: await run(provider) };
    } catch {
      return { ok: false, code: "requestFailed" };
    }
  },
}));

const { estimateArcSend, sendArcUsdc } = await import("./send");

const DEBTOR = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const RECIPIENT = "0x0000000000000000000000000000000000000aBc";
const TX_HASH = `0x${"ab".repeat(32)}`;

/** Belirlenimci test zamanı; üretimde her zaman geçerli zaman kullanılır. */
const NOW = 1_700_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);
const LIFETIME_SECONDS = 5 * 60;
const QUOTE_ID = `0x${"5a".repeat(32)}`;
const REQUEST_ID = `0x${"11".repeat(32)}`;
const at = (nowMs: number) => () => nowMs;

function snapshotOf(over: Partial<ArcPaymentSnapshot> = {}): ArcPaymentSnapshot {
  return Object.freeze({
    debtKey: "b->a",
    debtorParticipantId: "b",
    recipientParticipantId: "a",
    debtorAddress: DEBTOR,
    recipientAddress: RECIPIENT,
    tryMinor: "20000",
    rateNumerator: "40",
    rateDenominator: "1",
    microUsdc: "5000000",
    amount: "5.00",
    displayAmount: "5,00",
    chainId: ARC_TESTNET_CHAIN_ID,
    requestId: REQUEST_ID,
    issuedAt: NOW_SECONDS,
    expiresAt: NOW_SECONDS + LIFETIME_SECONDS,
    quoteId: QUOTE_ID,
    quoteExpiresAt: NOW_SECONDS + LIFETIME_SECONDS,
    ...over,
  });
}

beforeEach(() => {
  simulateMock.mockReset();
  submitMock.mockReset();
  receiptMock.mockReset();
  estimateMock.mockReset();
  clientMock.mockReset();
  /* Varsayılan mutlu yol: simülasyon geçer, gönderim hash döner, makbuz başarılı. */
  simulateMock.mockResolvedValue(undefined);
  submitMock.mockResolvedValue(TX_HASH);
  receiptMock.mockResolvedValue({ kind: "success", txHash: TX_HASH });
  accountsResponse = [DEBTOR];
  chainResponse = "0x4cef52";
});

describe("App Kit hiç çağrılmayan durumlar", () => {
  it("kendine transferde App Kit çağrılmaz", async () => {
    const result = await sendArcUsdc(
      "w",
      snapshotOf({ recipientAddress: DEBTOR.toLowerCase() }),
      at(NOW),
    );
    expect(result).toEqual({ ok: false, code: "selfTransfer" });
    expect(submitMock).not.toHaveBeenCalled();
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("geçersiz alıcıda App Kit çağrılmaz", async () => {
    const result = await sendArcUsdc("w", snapshotOf({ recipientAddress: "0x1" }), at(NOW));
    expect(result).toEqual({ ok: false, code: "invalidRecipient" });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("geçersiz tutarda App Kit çağrılmaz", async () => {
    const result = await sendArcUsdc(
      "w",
      snapshotOf({ amount: "1e6", microUsdc: "1000000000000" }),
      at(NOW),
    );
    expect(result).toEqual({ ok: false, code: "invalidAmount" });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("tutar borç ve kurla uyuşmuyorsa App Kit çağrılmaz", async () => {
    // İmza doğrulaması bu sınırın dışındadır; sınır tutarı kendisi türetir.
    const result = await sendArcUsdc(
      "w",
      snapshotOf({ microUsdc: "500000000", amount: "500.00" }),
      at(NOW),
    );
    expect(result).toEqual({ ok: false, code: "inconsistentAmount" });
    expect(submitMock).not.toHaveBeenCalled();
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("kur alanı bozuksa App Kit çağrılmaz", async () => {
    const result = await sendArcUsdc(
      "w",
      snapshotOf({ rateDenominator: "3" }),
      at(NOW),
    );
    expect(result).toEqual({ ok: false, code: "invalidRate" });
    expect(submitMock).not.toHaveBeenCalled();
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("hesap değiştiyse App Kit çağrılmaz", async () => {
    accountsResponse = ["0x1111111111111111111111111111111111111111"];
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "accountChanged" });
    expect(submitMock).not.toHaveBeenCalled();
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("hesap kalmadıysa App Kit çağrılmaz", async () => {
    accountsResponse = [];
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "noAccount" });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("ağ değiştiyse App Kit çağrılmaz", async () => {
    chainResponse = "0x1";
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "networkChanged" });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("bozuk zincir cevabı ağ değişmiş sayılır", async () => {
    chainResponse = "0x4cef52junk";
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "networkChanged" });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("preflight tahmin için de çalışır", async () => {
    chainResponse = "0x1";
    const result = await estimateArcSend("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "networkChanged" });
    expect(estimateMock).not.toHaveBeenCalled();
  });

  it("tahmin başarılı olsa bile gönderimden önce preflight tekrarlanır", async () => {
    estimateMock.mockResolvedValue("0.01 USDC");
    const snapshot = snapshotOf();
    expect((await estimateArcSend("w", snapshot, at(NOW))).ok).toBe(true);
    expect(estimateMock).toHaveBeenCalledTimes(1);

    // Tahminden sonra hesap değişir.
    accountsResponse = ["0x1111111111111111111111111111111111111111"];
    const result = await sendArcUsdc("w", snapshot, at(NOW));
    expect(result).toEqual({ ok: false, code: "accountChanged" });
    expect(submitMock).not.toHaveBeenCalled();
  });
});

describe("başarılı gönderim (taklit zincir)", () => {
  it("işlemi onaylanan snapshot'a bağlar ve bağlantıyı yerelde kurar", async () => {
    const snapshot = snapshotOf();
    const result = await sendArcUsdc("w", snapshot, at(NOW));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.txHash).toBe(TX_HASH);
    expect(result.value.explorerUrl).toBe(
      `https://testnet.arcscan.app/tx/${TX_HASH}`,
    );
    expect(result.value.snapshot).toBe(snapshot);
    expect(result.value.snapshot.microUsdc).toBe("5000000");
    expect(typeof result.value.completedAt).toBe("string");
  });

  it("zincire onaylanan snapshot'ın MİKRO tutarı ve alıcısı gider", async () => {
    await sendArcUsdc("w", snapshotOf(), at(NOW));
    /*
     * Tutar gösterilen ondalık metinden ("5.00") DEĞİL, doğrulanmış mikro
     * birimden alınır: zincire giden sayı, borç ve kurdan yeniden türetilip
     * eşitliği kanıtlanmış olan tam sayıdır.
     */
    expect(clientMock).toHaveBeenCalledTimes(1);
    expect(clientMock.mock.calls[0][1]).toEqual({
      debtorAddress: DEBTOR,
      recipientAddress: RECIPIENT,
      microUsdc: "5000000",
    });
  });

  it("makbuz beklenmeden ÖNCE simülasyon çalışır", async () => {
    /* Sıra güvenliğin kendisidir: cüzdan istemi ancak simülasyon geçerse açılır. */
    await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(simulateMock).toHaveBeenCalledTimes(1);
    expect(simulateMock.mock.invocationCallOrder[0]).toBeLessThan(
      submitMock.mock.invocationCallOrder[0],
    );
    expect(submitMock.mock.invocationCallOrder[0]).toBeLessThan(
      receiptMock.mock.invocationCallOrder[0],
    );
  });

  it("simülasyon düşerse cüzdan HİÇ açılmaz", async () => {
    simulateMock.mockRejectedValue(
      Object.assign(new Error("transfer reverted"), {
        name: "ContractFunctionExecutionError",
      }),
    );
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "insufficientFunds" });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("geçersiz bir hash döndüğünde sonuç BELİRSİZ sayılır", async () => {
    /*
     * `submit` çağrıldı; hash okunamadı diye "gönderilemedi" denemez —
     * işlem zincire düşmüş olabilir.
     */
    submitMock.mockResolvedValue("0xdeadbeef");
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "submissionUnknown" });
    expect(receiptMock).not.toHaveBeenCalled();
  });

  it("makbuz REVERT derse ödendi sayılmaz, hash korunur", async () => {
    receiptMock.mockResolvedValue({ kind: "reverted", txHash: TX_HASH });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({
      ok: false,
      code: "reverted",
      txHash: TX_HASH,
      explorerUrl: `https://testnet.arcscan.app/tx/${TX_HASH}`,
    });
  });

  it("makbuz beklemesi fırlarsa sonuç belirsizdir ama hash ELİMİZDEDİR", async () => {
    receiptMock.mockRejectedValue(new Error("timeout"));
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({
      ok: false,
      code: "submissionUnknown",
      txHash: TX_HASH,
      explorerUrl: `https://testnet.arcscan.app/tx/${TX_HASH}`,
    });
  });

  it("cüzdan reddi kullanıcıya uygun kodla döner", async () => {
    submitMock.mockRejectedValue(
      Object.assign(new Error("user rejected"), { code: 4001 }),
    );
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "rejected" });
  });
});
