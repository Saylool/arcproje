import { beforeEach, describe, expect, it, vi } from "vitest";

import { ARC_TESTNET_CHAIN_ID } from "./network";
import type { ArcPaymentSnapshot } from "./send";

/**
 * App Kit ve cüzdan katmanı taklit edilir; gerçek bir zincir işlemi yapılmaz.
 * Amaç, güvenlik sınırının App Kit'i ne zaman çağırdığını ve ne zaman hiç
 * çağırmadığını kanıtlamaktır.
 */

const sendMock = vi.fn();
const estimateMock = vi.fn();
const adapterMock = vi.fn();

vi.mock("@circle-fin/app-kit", () => ({
  AppKit: class {
    send = sendMock;
    estimateSend = estimateMock;
  },
}));

vi.mock("@circle-fin/adapter-viem-v2", () => ({
  createViemAdapterFromProvider: (...args: unknown[]) => {
    adapterMock(...args);
    return Promise.resolve({});
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
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
const REQUEST_ID = `0x${"11".repeat(32)}`;
const at = (nowMs: number) => () => nowMs;

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

beforeEach(() => {
  sendMock.mockReset();
  estimateMock.mockReset();
  adapterMock.mockReset();
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
    expect(sendMock).not.toHaveBeenCalled();
    expect(adapterMock).not.toHaveBeenCalled();
  });

  it("geçersiz alıcıda App Kit çağrılmaz", async () => {
    const result = await sendArcUsdc("w", snapshotOf({ recipientAddress: "0x1" }), at(NOW));
    expect(result).toEqual({ ok: false, code: "invalidRecipient" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("geçersiz tutarda App Kit çağrılmaz", async () => {
    const result = await sendArcUsdc(
      "w",
      snapshotOf({ amount: "1e6", microUsdc: "1000000000000" }),
      at(NOW),
    );
    expect(result).toEqual({ ok: false, code: "invalidAmount" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("hesap değiştiyse App Kit çağrılmaz", async () => {
    accountsResponse = ["0x1111111111111111111111111111111111111111"];
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "accountChanged" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(adapterMock).not.toHaveBeenCalled();
  });

  it("hesap kalmadıysa App Kit çağrılmaz", async () => {
    accountsResponse = [];
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "noAccount" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("ağ değiştiyse App Kit çağrılmaz", async () => {
    chainResponse = "0x1";
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "networkChanged" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("bozuk zincir cevabı ağ değişmiş sayılır", async () => {
    chainResponse = "0x4cef52junk";
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "networkChanged" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("preflight tahmin için de çalışır", async () => {
    chainResponse = "0x1";
    const result = await estimateArcSend("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "networkChanged" });
    expect(estimateMock).not.toHaveBeenCalled();
  });

  it("tahmin başarılı olsa bile gönderimden önce preflight tekrarlanır", async () => {
    estimateMock.mockResolvedValue({ totalFee: "0.01" });
    const snapshot = snapshotOf();
    expect((await estimateArcSend("w", snapshot, at(NOW))).ok).toBe(true);
    expect(estimateMock).toHaveBeenCalledTimes(1);

    // Tahminden sonra hesap değişir.
    accountsResponse = ["0x1111111111111111111111111111111111111111"];
    const result = await sendArcUsdc("w", snapshot, at(NOW));
    expect(result).toEqual({ ok: false, code: "accountChanged" });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("başarılı gönderim (taklit App Kit)", () => {
  it("işlemi onaylanan snapshot'a bağlar ve bağlantıyı yerelde kurar", async () => {
    sendMock.mockResolvedValue({
      txHash: TX_HASH,
      state: "COMPLETE",
      // Bağımlılığın döndürdüğü kötü niyetli URL kullanılmamalı.
      explorerUrl: "https://evil.example.com/tx/0xdeadbeef",
    });

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

  it("App Kit'e onaylanan snapshot'ın tutarı ve alıcısı gönderilir", async () => {
    sendMock.mockResolvedValue({ txHash: TX_HASH });
    await sendArcUsdc("w", snapshotOf(), at(NOW));
    const params = sendMock.mock.calls[0][0];
    expect(params.to).toBe(RECIPIENT);
    expect(params.amount).toBe("5.00");
    expect(params.token).toBe("USDC");
    expect(params.from.chain).toBe("Arc_Testnet");
  });

  it("SDK geçersiz bir hash döndürürse başarı sayılmaz", async () => {
    sendMock.mockResolvedValue({ txHash: "0xdeadbeef" });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "sendFailed" });
  });

  it("cüzdan reddi kullanıcıya uygun kodla döner", async () => {
    sendMock.mockRejectedValue(Object.assign(new Error("user rejected"), { code: 4001 }));
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "rejected" });
  });
});
