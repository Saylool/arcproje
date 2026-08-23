import { beforeEach, describe, expect, it, vi } from "vitest";

import { ARC_TESTNET_CHAIN_ID } from "./network";
import type { ArcPaymentSnapshot } from "./send";

/**
 * `kit.send` çağrıldıktan SONRAKİ belirsizlik.
 *
 * Yalnızca kesin olarak yayın ÖNCESİ olduğunu bildiğimiz hatalar yeniden
 * denenebilir. Diğer her şeyde işlem zincire düşmüş OLABİLİR; kullanıcıya
 * "gönderilemedi" denmez.
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

const provider = {
  request: ({ method }: { method: string }) => {
    if (method === "eth_accounts") return Promise.resolve([DEBTOR]);
    if (method === "eth_chainId") return Promise.resolve("0x4cef52");
    return Promise.reject(new Error("desteklenmeyen"));
  },
};
vi.mock("./wallet", () => ({
  withProvider: async (_uuid: string, run: (p: typeof provider) => Promise<unknown>) => {
    try {
      return { ok: true, value: await run(provider) };
    } catch {
      return { ok: false, code: "requestFailed" };
    }
  },
}));

const { sendArcUsdc, SEND_MIN_REMAINING_SECONDS, keepsSubmissionLocked } =
  await import("./send");

const DEBTOR = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const RECIPIENT = "0x0000000000000000000000000000000000000aBc";
const TX_HASH = `0x${"ab".repeat(32)}`;
const NOW = 1_700_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);
const at = (ms: number) => () => ms;

function snapshotOf(over: Partial<ArcPaymentSnapshot> = {}): ArcPaymentSnapshot {
  const expiresAt = over.expiresAt ?? NOW_SECONDS + 300;
  return Object.freeze({
    debtKey: "b->a",
    debtorParticipantId: "b",
    recipientParticipantId: "a",
    debtorAddress: DEBTOR,
    recipientAddress: RECIPIENT,
    tryMinor: 20000,
    rateNumerator: "40000000",
    rateDenominator: "1000000",
    microUsdc: "5000000",
    amount: "5.00",
    displayAmount: "5,00",
    chainId: ARC_TESTNET_CHAIN_ID,
    requestId: `0x${"11".repeat(32)}`,
    issuedAt: NOW_SECONDS,
    expiresAt,
    quoteId: `0x${"5a".repeat(32)}`,
    quoteExpiresAt: expiresAt,
    ...over,
  });
}

beforeEach(() => {
  sendMock.mockReset();
  adapterMock.mockReset();
});

describe("yayın öncesi bilinen hatalar yeniden denenebilir", () => {
  it("cüzdan reddi (4001) rejected döner", async () => {
    sendMock.mockRejectedValue(
      Object.assign(new Error("user rejected"), { code: 4001 }),
    );
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "rejected" });
    expect(keepsSubmissionLocked("rejected")).toBe(false);
  });

  it("yetersiz bakiye insufficientFunds döner", async () => {
    sendMock.mockRejectedValue(new Error("insufficient funds for gas"));
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "insufficientFunds" });
    expect(keepsSubmissionLocked("insufficientFunds")).toBe(false);
  });
});

describe("belirsiz sonuç kalıcıdır", () => {
  it("tanınmayan istisna submissionUnknown döner", async () => {
    sendMock.mockRejectedValue(new Error("bağlantı koptu"));
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "submissionUnknown" });
    expect(keepsSubmissionLocked("submissionUnknown")).toBe(true);
  });

  it("geçersiz hash submissionUnknown döner", async () => {
    sendMock.mockResolvedValue({ txHash: "0xdeadbeef" });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "submissionUnknown" });
  });

  it("hash hiç dönmezse submissionUnknown döner", async () => {
    sendMock.mockResolvedValue({ state: "PENDING" });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "submissionUnknown" });
  });

  it("belirsizlik mesajı kullanıcıyı cüzdan ve ArcScan'e yönlendirir", async () => {
    const { describeArcSendError } = await import("./send");
    const mesaj = describeArcSendError("submissionUnknown");
    expect(mesaj).toMatch(/MetaMask/);
    expect(mesaj).toMatch(/ArcScan/);
    expect(mesaj).toMatch(/iki kez/);
  });
});

describe("gönderim öncesi süre payı", () => {
  it("kalan süre paydan azsa App Kit HİÇ çağrılmaz", async () => {
    const snapshot = snapshotOf({
      expiresAt: NOW_SECONDS + SEND_MIN_REMAINING_SECONDS - 1,
      quoteExpiresAt: NOW_SECONDS + SEND_MIN_REMAINING_SECONDS - 1,
    });
    const result = await sendArcUsdc("w", snapshot, at(NOW));
    expect(result).toEqual({ ok: false, code: "insufficientTimeRemaining" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(adapterMock).not.toHaveBeenCalled();
  });

  it("en yakın bitiş ufku pay için kullanılır", async () => {
    // Talep teklifden uzun yaşayamadığı için bağlayıcı ufuk talebin bitişidir.
    const snapshot = snapshotOf({
      expiresAt: NOW_SECONDS + 30,
      quoteExpiresAt: NOW_SECONDS + 300,
    });
    const result = await sendArcUsdc("w", snapshot, at(NOW));
    expect(result).toEqual({ ok: false, code: "insufficientTimeRemaining" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("pay yeterliyse gönderim normal ilerler", async () => {
    sendMock.mockResolvedValue({ txHash: TX_HASH, state: "COMPLETE" });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.txHash).toBe(TX_HASH);
  });

  it("süresi zaten dolmuş talepte kesin kod korunur", async () => {
    // "az kaldı" değil, "süresi doldu" denmeli.
    const snapshot = snapshotOf({
      issuedAt: NOW_SECONDS - 300,
      expiresAt: NOW_SECONDS - 1,
      quoteExpiresAt: NOW_SECONDS - 1,
    });
    const result = await sendArcUsdc("w", snapshot, at(NOW));
    expect(result).toEqual({ ok: false, code: "expiredRequest" });
  });
});
