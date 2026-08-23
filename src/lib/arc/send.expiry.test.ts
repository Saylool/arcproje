import { beforeEach, describe, expect, it, vi } from "vitest";

import { ARC_TESTNET_CHAIN_ID } from "./network";
import type { ArcPaymentSnapshot } from "./send";

/**
 * Talebin geçerlilik süresinin gönderim sınırında, React'ten bağımsız olarak
 * uygulandığını kanıtlar. App Kit ve cüzdan katmanı taklit edilir; gerçek bir
 * zincir işlemi yapılmaz.
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

const providerRequest = vi.fn(async ({ method }: { method: string }) => {
  if (method === "eth_accounts") return [DEBTOR];
  if (method === "eth_chainId") {
    // Sağlayıcıyla konuşurken zaman ilerleyebilir; testler bunu buradan sürer.
    clock += chainCallDelayMs;
    return "0x4cef52";
  }
  throw new Error("desteklenmeyen metot");
});

const withProviderMock = vi.fn(
  async (_uuid: string, run: (p: unknown) => Promise<unknown>) => {
    try {
      return { ok: true, value: await run({ request: providerRequest }) };
    } catch {
      return { ok: false, code: "requestFailed" };
    }
  },
);

vi.mock("./wallet", () => ({ withProvider: withProviderMock }));

const { estimateArcSend, sendArcUsdc } = await import("./send");

const DEBTOR = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const RECIPIENT = "0x0000000000000000000000000000000000000aBc";
const TX_HASH = `0x${"ef".repeat(32)}`;

const NOW = 1_700_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);
const LIFETIME_SECONDS = 5 * 60;
const QUOTE_ID = `0x${"5a".repeat(32)}`;
const EXPIRES_AT = NOW_SECONDS + LIFETIME_SECONDS;

/** Testlerin sürdüğü saat. Üretimde her zaman Date.now kullanılır. */
let clock = NOW;
let chainCallDelayMs = 0;
const clockNow = () => clock;

function snapshotOf(over: Partial<ArcPaymentSnapshot> = {}): ArcPaymentSnapshot {
  const merged = buildSnapshot(over);
  return Object.freeze({
    ...merged,
    quoteExpiresAt: over.quoteExpiresAt ?? merged.expiresAt,
  });
}

function buildSnapshot(over: Partial<ArcPaymentSnapshot>): ArcPaymentSnapshot {
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
    requestId: `0x${"11".repeat(32)}`,
    issuedAt: NOW_SECONDS,
    expiresAt: EXPIRES_AT,
    quoteId: QUOTE_ID,
    quoteExpiresAt: EXPIRES_AT,
    ...over,
  });
}

function expectChainUntouched() {
  expect(sendMock).not.toHaveBeenCalled();
  expect(estimateMock).not.toHaveBeenCalled();
  expect(adapterMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  sendMock.mockReset();
  estimateMock.mockReset();
  adapterMock.mockReset();
  providerRequest.mockClear();
  withProviderMock.mockClear();
  clock = NOW;
  chainCallDelayMs = 0;
});

describe("tahminden sonra, gönderimden önce süresi dolan talep", () => {
  it("tahmin sırasında geçerli, gönderimde reddedilir", async () => {
    estimateMock.mockResolvedValue({ totalFee: "0.01" });
    const snapshot = snapshotOf();

    // Talep geçerliyken tahmin başarılı olur.
    const estimated = await estimateArcSend("w", snapshot, clockNow);
    expect(estimated.ok).toBe(true);
    expect(estimateMock).toHaveBeenCalledTimes(1);

    // İnceleme sırasında geçerlilik süresi dolar.
    clock = (EXPIRES_AT + 1) * 1000;
    withProviderMock.mockClear();
    providerRequest.mockClear();
    adapterMock.mockClear();

    const result = await sendArcUsdc("w", snapshot, clockNow);
    expect(result).toEqual({ ok: false, code: "expiredRequest" });

    // Sağlayıcı, adaptör ve App Kit'e hiç dokunulmaz.
    expect(withProviderMock).not.toHaveBeenCalled();
    expect(providerRequest).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(adapterMock).not.toHaveBeenCalled();
  });

  it("tam bitiş saniyesinde de gönderilmez", async () => {
    clock = EXPIRES_AT * 1000;
    const result = await sendArcUsdc("w", snapshotOf(), clockNow);
    expect(result).toEqual({ ok: false, code: "expiredRequest" });
    expectChainUntouched();
  });

  it("preflight sırasında süresi dolarsa App Kit yüklenmez", async () => {
    /*
     * Girişte 120 sn kalmış: 60 sn'lik güvenlik payı geçilir. Sağlayıcı
     * sorgusu sırasında saat 130 sn ilerler ve talep sona erer.
     */
    clock = (EXPIRES_AT - 120) * 1000;
    chainCallDelayMs = 130_000;

    const result = await sendArcUsdc("w", snapshotOf(), clockNow);
    expect(result).toEqual({ ok: false, code: "expiredRequest" });

    // Sağlayıcıya gidildi ama adaptör ve App Kit hiç kurulmadı.
    expect(withProviderMock).toHaveBeenCalledTimes(1);
    expect(adapterMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("tahmin sınırı da aynı süreyi uygular", async () => {
    clock = (EXPIRES_AT + 1) * 1000;
    const result = await estimateArcSend("w", snapshotOf(), clockNow);
    expect(result).toEqual({ ok: false, code: "expiredRequest" });
    expectChainUntouched();
  });
});

describe("geçersiz zaman bilgisi", () => {
  it("henüz geçerli olmayan talebi reddeder", async () => {
    const future = NOW_SECONDS + 3600;
    const result = await sendArcUsdc(
      "w",
      snapshotOf({ issuedAt: future, expiresAt: future + LIFETIME_SECONDS }),
      clockNow,
    );
    expect(result).toEqual({ ok: false, code: "invalidRequestTime" });
    expectChainUntouched();
  });

  it("saat kayması toleransı içindeki talebi kabul eder", async () => {
    estimateMock.mockResolvedValue({ totalFee: "0.01" });
    // 4 dakika ilerideki bir talep, 5 dakikalık tolerans içinde kalır.
    const slightlyAhead = NOW_SECONDS + 4 * 60;
    const result = await estimateArcSend(
      "w",
      snapshotOf({
        issuedAt: slightlyAhead,
        expiresAt: slightlyAhead + LIFETIME_SECONDS,
      }),
      clockNow,
    );
    expect(result.ok).toBe(true);
  });

  it("bitişi başlangıcından önce olan talebi reddeder", async () => {
    const result = await sendArcUsdc(
      "w",
      snapshotOf({ expiresAt: NOW_SECONDS - 1 }),
      clockNow,
    );
    expect(result).toEqual({ ok: false, code: "invalidRequestTime" });
    expectChainUntouched();
  });

  it("izin verilen ömrü aşan talebi reddeder", async () => {
    const result = await sendArcUsdc(
      "w",
      snapshotOf({ expiresAt: NOW_SECONDS + 31 * 24 * 60 * 60 }),
      clockNow,
    );
    expect(result).toEqual({ ok: false, code: "invalidRequestTime" });
    expectChainUntouched();
  });

  it("geçersiz talep kimliğini reddeder", async () => {
    const result = await sendArcUsdc(
      "w",
      snapshotOf({ requestId: "0xdeadbeef" }),
      clockNow,
    );
    expect(result).toEqual({ ok: false, code: "invalidRequestId" });
    expectChainUntouched();
  });
});

describe("sonuç imzalı talebe bağlanır", () => {
  it("başarılı işlem talep kimliğini birebir korur", async () => {
    sendMock.mockResolvedValue({ txHash: TX_HASH, state: "COMPLETE" });
    const snapshot = snapshotOf();

    const result = await sendArcUsdc("w", snapshot, clockNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.snapshot.requestId).toBe(snapshot.requestId);
    expect(result.value.snapshot.issuedAt).toBe(snapshot.issuedAt);
    expect(result.value.snapshot.expiresAt).toBe(snapshot.expiresAt);
    expect(result.value.snapshot).toBe(snapshot);
  });

  it("aynı borç ve tutar için iki ayrı talep birbirinden ayırt edilebilir", async () => {
    sendMock.mockResolvedValue({ txHash: TX_HASH, state: "COMPLETE" });

    const first = snapshotOf({ requestId: `0x${"aa".repeat(32)}` });
    const second = snapshotOf({ requestId: `0x${"bb".repeat(32)}` });

    // Borç kimliği, tutar ve taraflar aynı; ayıran tek şey talep kimliği.
    expect(second.debtKey).toBe(first.debtKey);
    expect(second.microUsdc).toBe(first.microUsdc);
    expect(second.requestId).not.toBe(first.requestId);

    const firstResult = await sendArcUsdc("w", first, clockNow);
    const secondResult = await sendArcUsdc("w", second, clockNow);
    expect(firstResult.ok && secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) return;

    expect(firstResult.value.snapshot.requestId).toBe(first.requestId);
    expect(secondResult.value.snapshot.requestId).toBe(second.requestId);
    expect(firstResult.value.snapshot.requestId).not.toBe(
      secondResult.value.snapshot.requestId,
    );
  });
});
