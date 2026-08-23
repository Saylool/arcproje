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

/**
 * Preflight sırasında saati ilerletebilmek için ayarlanabilir gecikme.
 * Testin kontrol ettiği saat `NOW + clockOffsetMs` olarak okunur.
 */
let chainCallDelayMs = 0;
let clockOffsetMs = 0;

const provider = {
  request: ({ method }: { method: string }) => {
    if (method === "eth_accounts") return Promise.resolve([DEBTOR]);
    if (method === "eth_chainId") {
      clockOffsetMs += chainCallDelayMs;
      return Promise.resolve("0x4cef52");
    }
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

const {
  sendArcUsdc,
  SEND_MIN_REMAINING_SECONDS,
  keepsSubmissionLocked,
  classifySendResult,
  classifySendException,
} = await import("./send");

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
  chainCallDelayMs = 0;
  clockOffsetMs = 0;
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

  it("yapısal user_rejected kategorisi de rejected sayılır", async () => {
    sendMock.mockRejectedValue(
      Object.assign(new Error("cancelled"), { errorCategory: "user_rejected" }),
    );
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "rejected" });
  });

  it("SDK error+user_rejected sonucu da yeniden denenebilir", async () => {
    sendMock.mockResolvedValue({
      state: "error",
      errorCategory: "user_rejected",
      errorMessage: "User rejected the request",
    });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "rejected" });
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
    sendMock.mockResolvedValue({ state: "success", txHash: "0xdeadbeef" });
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
    sendMock.mockResolvedValue({ state: "success", txHash: TX_HASH });
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

describe("App Kit sonuç durumları (BridgeStep)", () => {
  it("BAŞARI için hem success durumu hem geçerli hash gerekir", () => {
    expect(classifySendResult({ state: "success", txHash: TX_HASH })).toEqual({
      kind: "success",
      txHash: TX_HASH,
    });
    // Geçerli hash tek başına yetmez.
    expect(classifySendResult({ txHash: TX_HASH })).toEqual({ kind: "unknown" });
    // Başarı durumu ama bozuk hash: doğrulanamaz.
    expect(classifySendResult({ state: "success", txHash: "0xdead" })).toEqual({
      kind: "unknown",
    });
    expect(classifySendResult({ state: "success" })).toEqual({ kind: "unknown" });
  });

  it("pending ve noop belirsizdir", () => {
    expect(classifySendResult({ state: "pending", txHash: TX_HASH })).toEqual({
      kind: "unknown",
    });
    expect(classifySendResult({ state: "noop" })).toEqual({ kind: "unknown" });
  });

  it("zincir revert kategorileri revert sayılır ve hash korunur", () => {
    for (const category of ["chain_revert", "reverted_onchain", "partial_reverted"]) {
      expect(
        classifySendResult({ state: "error", errorCategory: category, txHash: TX_HASH }),
        category,
      ).toEqual({ kind: "reverted", txHash: TX_HASH });
    }
  });

  it("sınıflandırılamayan error durumu belirsizdir", () => {
    expect(
      classifySendResult({ state: "error", errorCategory: "unknown" }),
    ).toEqual({ kind: "unknown" });
  });

  it("nesne olmayan sonuç belirsizdir", () => {
    for (const bad of [null, undefined, "ok", 42]) {
      expect(classifySendResult(bad), String(bad)).toEqual({ kind: "unknown" });
    }
  });
});

describe("revert ASLA ödendi sayılmaz", () => {
  it("revert eden işlem terminal reverted döner ve hash'i korur", async () => {
    sendMock.mockResolvedValue({
      state: "error",
      errorCategory: "chain_revert",
      errorMessage: "reverted",
      txHash: TX_HASH,
    });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("reverted");
    expect(result.txHash).toBe(TX_HASH);
    expect(result.explorerUrl).toBe(`https://testnet.arcscan.app/tx/${TX_HASH}`);
    expect(keepsSubmissionLocked("reverted")).toBe(true);
  });

  it("revert mesajı ödeme yapılmadığını söyler", async () => {
    const { describeArcSendError } = await import("./send");
    const mesaj = describeArcSendError("reverted");
    expect(mesaj).toMatch(/revert/i);
    expect(mesaj).toMatch(/ArcScan/);
    expect(mesaj).toMatch(/Ödeme yapılmadı/);
  });
});

describe("kit.send sonrası metin eşleştirmesi yapılmaz", () => {
  it('"insufficient confirmations" YENİDEN DENENEBİLİR sayılmaz', async () => {
    sendMock.mockRejectedValue(new Error("insufficient confirmations"));
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "submissionUnknown" });
  });

  it('"insufficient funds" metni de kanıt sayılmaz', async () => {
    sendMock.mockRejectedValue(new Error("insufficient funds for gas"));
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "submissionUnknown" });
  });

  it("yalnızca 4001 ve user_rejected yayın öncesi sayılır", () => {
    expect(classifySendException({ code: 4001 })).toBe("rejected");
    expect(classifySendException({ errorCategory: "user_rejected" })).toBe(
      "rejected",
    );
    for (const other of [
      new Error("insufficient confirmations"),
      new Error("network error"),
      { code: 4900 },
      { errorCategory: "polling_timeout" },
      null,
    ]) {
      expect(classifySendException(other), JSON.stringify(other)).toBe(
        "submissionUnknown",
      );
    }
  });
});

describe("son güvenlik payı kit.send'den HEMEN ÖNCE ölçülür", () => {
  it("kurulum payı tükettiyse cüzdan akışı açılmaz", async () => {
    /*
     * Girişte 65 sn kalmış: giriş kontrolü geçer. Preflight'ın eth_chainId
     * çağrısı saati 10 sn ilerletince kalan süre 55 sn'ye düşer ve kit.send
     * ARTIK ÇAĞRILMAZ.
     */
    sendMock.mockResolvedValue({ state: "success", txHash: TX_HASH });
    chainCallDelayMs = 10_000;
    const snapshot = snapshotOf({
      expiresAt: NOW_SECONDS + SEND_MIN_REMAINING_SECONDS + 5,
      quoteExpiresAt: NOW_SECONDS + SEND_MIN_REMAINING_SECONDS + 5,
    });
    const result = await sendArcUsdc("w", snapshot, () => NOW + clockOffsetMs);
    expect(result).toEqual({ ok: false, code: "insufficientTimeRemaining" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("pay yeterli kalırsa kit.send çağrılır", async () => {
    sendMock.mockResolvedValue({ state: "success", txHash: TX_HASH });
    chainCallDelayMs = 1000;
    const result = await sendArcUsdc("w", snapshotOf(), () => NOW + clockOffsetMs);
    expect(result.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
