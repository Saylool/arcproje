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
  MAX_ERROR_GRAPH_NODES,
  keepsSubmissionLocked,
  reviewStateAfterSendFailure,
  classifySendResult,
  classifySendException,
  analyzeSendException,
  readErrorTxHash,
} = await import("./send");

const DEBTOR = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const RECIPIENT = "0x0000000000000000000000000000000000000aBc";
const TX_HASH = `0x${"ab".repeat(32)}`;
const OTHER_TX_HASH = `0x${"cd".repeat(32)}`;
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
    tryMinor: "20000",
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
    // Geçerli hash tek başına yetmez; durum yoksa sonuç belirsizdir.
    expect(classifySendResult({ txHash: TX_HASH })).toEqual({
      kind: "unknown",
      txHash: TX_HASH,
    });
    // Başarı durumu ama bozuk hash: doğrulanamaz, korunacak hash de yok.
    expect(classifySendResult({ state: "success", txHash: "0xdead" })).toEqual({
      kind: "unknown",
      txHash: null,
    });
    expect(classifySendResult({ state: "success" })).toEqual({
      kind: "unknown",
      txHash: null,
    });
  });

  it("pending ve noop belirsizdir ama HASH KORUNUR", () => {
    expect(classifySendResult({ state: "pending", txHash: TX_HASH })).toEqual({
      kind: "unknown",
      txHash: TX_HASH,
    });
    expect(classifySendResult({ state: "noop", txHash: TX_HASH })).toEqual({
      kind: "unknown",
      txHash: TX_HASH,
    });
    expect(classifySendResult({ state: "noop" })).toEqual({
      kind: "unknown",
      txHash: null,
    });
  });

  it("zincir revert kategorileri revert sayılır ve hash korunur", () => {
    for (const category of ["chain_revert", "reverted_onchain", "partial_reverted"]) {
      expect(
        classifySendResult({ state: "error", errorCategory: category, txHash: TX_HASH }),
        category,
      ).toEqual({ kind: "reverted", txHash: TX_HASH });
    }
  });

  it("KURULU SDK: error + hash + kategori YOK => onaylanmış REVERT", () => {
    /*
     * @circle-fin/app-kit 1.12.1 aynı zincir `send` yolu makbuzu bekler ve
     *   state: receipt.status === 'success' ? 'success' : 'error'
     * döndürür; `errorCategory` HİÇ set edilmez. Bu, revert eden makbuzun
     * belgelenmiş şeklidir: belirsiz DEĞİL, revert. Ve asla "ödendi" değil.
     */
    expect(classifySendResult({ name: "send", state: "error", txHash: TX_HASH })).toEqual(
      { kind: "reverted", txHash: TX_HASH },
    );
    // Hash yoksa revert kanıtlanamaz: belirsiz kalır.
    expect(classifySendResult({ name: "send", state: "error" })).toEqual({
      kind: "unknown",
      txHash: null,
    });
    // Hash bozuksa da kanıt yoktur.
    expect(
      classifySendResult({ name: "send", state: "error", txHash: "0xdead" }),
    ).toEqual({ kind: "unknown", txHash: null });
  });

  it("user_rejected YALNIZCA hash yokken yeniden denenebilir", () => {
    expect(
      classifySendResult({ state: "error", errorCategory: "user_rejected" }),
    ).toEqual({ kind: "rejected" });
    // Hash varsa bir şey zincire gitmiştir: tekrar denemeye izin verilmez.
    expect(
      classifySendResult({
        state: "error",
        errorCategory: "user_rejected",
        txHash: TX_HASH,
      }),
    ).toEqual({ kind: "unknown", txHash: TX_HASH });
  });

  it("belgelenmiş HER kategori × hash birleşimi doğru sınıflanır", () => {
    // BridgeStepErrorCategory'nin kurulu sürümdeki tam listesi.
    const categories = [
      "user_rejected",
      "atomic_unsupported",
      "batch_too_large",
      "duplicate_batch_id",
      "unknown_bundle",
      "polling_timeout",
      "failed_offchain",
      "reverted_onchain",
      "partial_reverted",
      "chain_revert",
      "unknown",
    ] as const;
    const revertCategories = new Set([
      "reverted_onchain",
      "partial_reverted",
      "chain_revert",
    ]);

    for (const category of categories) {
      const withHash = classifySendResult({
        state: "error",
        errorCategory: category,
        txHash: TX_HASH,
      });
      const withoutHash = classifySendResult({
        state: "error",
        errorCategory: category,
      });

      if (revertCategories.has(category)) {
        expect(withHash, category).toEqual({ kind: "reverted", txHash: TX_HASH });
        expect(withoutHash, category).toEqual({ kind: "reverted", txHash: null });
        continue;
      }
      if (category === "user_rejected") {
        expect(withHash, category).toEqual({ kind: "unknown", txHash: TX_HASH });
        expect(withoutHash, category).toEqual({ kind: "rejected" });
        continue;
      }
      // Kanıtlanmamış diğer her kategori belirsizdir; hash varsa korunur.
      expect(withHash, category).toEqual({ kind: "unknown", txHash: TX_HASH });
      expect(withoutHash, category).toEqual({ kind: "unknown", txHash: null });
      // Hiçbiri ASLA başarı sayılmaz.
      expect(withHash.kind, category).not.toBe("success");
    }
  });

  it("tanınmayan durum adları belirsizdir, hash korunur", () => {
    for (const state of ["PENDING", "confirmed", "", 7, null]) {
      expect(classifySendResult({ state, txHash: TX_HASH }), String(state)).toEqual({
        kind: "unknown",
        txHash: TX_HASH,
      });
    }
  });

  it("nesne olmayan sonuç belirsizdir", () => {
    for (const bad of [null, undefined, "ok", 42]) {
      expect(classifySendResult(bad), String(bad)).toEqual({
        kind: "unknown",
        txHash: null,
      });
    }
  });
});

describe("belirsiz sonuçta hash MUTABAKAT için korunur", () => {
  it("pending sonucu hash'i ile birlikte submissionUnknown döner", async () => {
    sendMock.mockResolvedValue({ name: "send", state: "pending", txHash: TX_HASH });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("submissionUnknown");
    expect(result.txHash).toBe(TX_HASH);
    expect(result.explorerUrl).toBe(`https://testnet.arcscan.app/tx/${TX_HASH}`);
  });

  it("noop sonucu da hash'i korur", async () => {
    sendMock.mockResolvedValue({ name: "send", state: "noop", txHash: TX_HASH });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toMatchObject({
      ok: false,
      code: "submissionUnknown",
      txHash: TX_HASH,
    });
  });

  it("kategorisiz error + hash REVERT olur, ödendi olmaz", async () => {
    // Kurulu SDK'nın revert eden makbuz için döndürdüğü tam şekil.
    sendMock.mockResolvedValue({
      name: "send",
      state: "error",
      txHash: TX_HASH,
      explorerUrl: "https://sdk.example/tx",
    });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("reverted");
    expect(result.txHash).toBe(TX_HASH);
    // Bağlantı SDK'nın verdiğinden değil, doğrulanmış hash'ten kurulur.
    expect(result.explorerUrl).toBe(`https://testnet.arcscan.app/tx/${TX_HASH}`);
    expect(keepsSubmissionLocked("reverted")).toBe(true);
  });

  it("user_rejected + hash tekrar denenemez ve hash korunur", async () => {
    sendMock.mockResolvedValue({
      state: "error",
      errorCategory: "user_rejected",
      txHash: TX_HASH,
    });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toMatchObject({
      ok: false,
      code: "submissionUnknown",
      txHash: TX_HASH,
    });
    expect(keepsSubmissionLocked("submissionUnknown")).toBe(true);
  });

  it("istisna cause.trace.txHash taşıyorsa hash korunur", async () => {
    // SDK revert hatasını `cause.trace` altında taşır.
    sendMock.mockRejectedValue({
      name: "ONCHAIN_TRANSACTION_REVERTED",
      code: 8001,
      message: "Transaction reverted",
      cause: { trace: { txHash: TX_HASH, chain: "Arc_Testnet" } },
    });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toMatchObject({
      ok: false,
      code: "submissionUnknown",
      txHash: TX_HASH,
    });
  });

  it("hash okuyucu yalnızca GEÇERLİ hash döner", () => {
    expect(readErrorTxHash({ txHash: TX_HASH })).toBe(TX_HASH);
    expect(readErrorTxHash({ cause: { trace: { txHash: TX_HASH } } })).toBe(TX_HASH);
    expect(readErrorTxHash({ txHash: "0xdead" })).toBeNull();
    expect(readErrorTxHash({ cause: { trace: {} } })).toBeNull();
    expect(readErrorTxHash(new Error("boş"))).toBeNull();
    expect(readErrorTxHash(null)).toBeNull();
  });
});

describe("yapısal bakiye hataları YALNIZCA hash yokken denenebilir", () => {
  it("BALANCE_INSUFFICIENT_TOKEN yayın öncesi sayılır", async () => {
    // Kurulu SDK: prepareSend içindeki bakiye doğrulaması, execute'tan ÖNCE.
    sendMock.mockRejectedValue(
      Object.assign(new Error("Insufficient USDC balance"), {
        name: "BALANCE_INSUFFICIENT_TOKEN",
        code: 9001,
        type: "BALANCE",
      }),
    );
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "insufficientFunds" });
    expect(keepsSubmissionLocked("insufficientFunds")).toBe(false);
  });

  it("BALANCE_INSUFFICIENT_GAS de yayın öncesi sayılır", async () => {
    sendMock.mockRejectedValue(
      Object.assign(new Error("Insufficient gas"), {
        name: "BALANCE_INSUFFICIENT_GAS",
        code: 9002,
        type: "BALANCE",
      }),
    );
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "insufficientFunds" });
  });

  it("ad ile kod uyuşmazsa yapısal sayılmaz", () => {
    // Yalnızca belgelenmiş ad+kod ÇİFTİ kabul edilir; ad tek başına yetmez.
    expect(
      classifySendException({ name: "BALANCE_INSUFFICIENT_TOKEN", code: 1234 }),
    ).toBe("submissionUnknown");
    expect(classifySendException({ name: "BALANCE_INSUFFICIENT_TOKEN" })).toBe(
      "submissionUnknown",
    );
    // Kodsuz rastgele bir hata da eşleşmez.
    expect(classifySendException(new Error("herhangi"))).toBe("submissionUnknown");
  });

  it("hash taşıyan bakiye hatası ARTIK yayın öncesi sayılmaz", async () => {
    sendMock.mockRejectedValue(
      Object.assign(new Error("Insufficient USDC balance"), {
        name: "BALANCE_INSUFFICIENT_TOKEN",
        code: 9001,
        txHash: TX_HASH,
      }),
    );
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toMatchObject({
      ok: false,
      code: "submissionUnknown",
      txHash: TX_HASH,
    });
  });

  it("hash taşıyan 4001 de yeniden denenebilir sayılmaz", () => {
    expect(classifySendException({ code: 4001, txHash: TX_HASH })).toBe(
      "submissionUnknown",
    );
    expect(
      classifySendException({ errorCategory: "user_rejected", txHash: TX_HASH }),
    ).toBe("submissionUnknown");
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

  it("yalnızca yapısal 4001/user_rejected/bakiye kodları tanınır", () => {
    expect(classifySendException({ code: 4001 })).toBe("rejected");
    expect(classifySendException({ errorCategory: "user_rejected" })).toBe(
      "rejected",
    );
    expect(
      classifySendException({ name: "BALANCE_INSUFFICIENT_TOKEN", code: 9001 }),
    ).toBe("insufficientFunds");
    for (const other of [
      new Error("insufficient confirmations"),
      new Error("network error"),
      new Error("user rejected the request"),
      new Error("user denied transaction signature"),
      { code: 4900 },
      { errorCategory: "polling_timeout" },
      { errorCategory: "chain_revert" },
      null,
    ]) {
      expect(classifySendException(other), JSON.stringify(other)).toBe(
        "submissionUnknown",
      );
    }
  });

  it('metinde "user rejected" geçmesi tek başına ret KANITI değildir', async () => {
    // Yapısal kod yok: kit.send çağrıldıktan sonra işlem gitmiş olabilir.
    sendMock.mockRejectedValue(new Error("user rejected the request"));
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "submissionUnknown" });
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

describe("viem onay zaman aşımında hash KURTARILIR", () => {
  /**
   * Kurulu viem 2.55.19 bu hatayı hash'i yalnızca cümlede taşıyarak kurar ve
   * `@circle-fin/adapter-viem-v2` onu sarmalamaz. Aşağıdaki gövde kurulu
   * sürümün ürettiğinin birebir aynısıdır.
   */
  function viemTimeoutError(hash: string) {
    const shortMessage = `Timed out while waiting for transaction with hash "${hash}" to be confirmed.`;
    return Object.assign(new Error(`${shortMessage}\n\nVersion: viem@2.55.19`), {
      name: "WaitForTransactionReceiptTimeoutError",
      shortMessage,
      details: undefined,
      version: "viem@2.55.19",
    });
  }

  it("bilinen zaman aşımı hatasından hash okunur", () => {
    expect(readErrorTxHash(viemTimeoutError(TX_HASH))).toBe(TX_HASH);
  });

  it("sonuç yine de submissionUnknown kalır ve hash korunur", async () => {
    // Onay alınamadı: işlem zincire düşmüş de olabilir, düşmemiş de.
    sendMock.mockRejectedValue(viemTimeoutError(TX_HASH));
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("submissionUnknown");
    expect(result.txHash).toBe(TX_HASH);
    expect(result.explorerUrl).toBe(`https://testnet.arcscan.app/tx/${TX_HASH}`);
    expect(keepsSubmissionLocked("submissionUnknown")).toBe(true);
  });

  it("BOZUK hash içeren zaman aşımı mesajından hash çıkarılmaz", () => {
    for (const bad of ["0xdead", `0x${"ab".repeat(31)}`, "not-a-hash", ""]) {
      expect(readErrorTxHash(viemTimeoutError(bad)), bad).toBeNull();
    }
  });

  it("bozuk hash'te sonuç yine submissionUnknown, hash YOK", async () => {
    sendMock.mockRejectedValue(viemTimeoutError("0xdead"));
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "submissionUnknown" });
  });

  it("ALAKASIZ hata mesajındaki hash ASLA çıkarılmaz", () => {
    // Genel metin taraması yapılsaydı bunlardan hash okunurdu.
    for (const other of [
      new Error(`transaction ${TX_HASH} failed somewhere`),
      Object.assign(new Error(`hash "${TX_HASH}"`), { name: "RpcRequestError" }),
      Object.assign(
        new Error(
          `Timed out while waiting for transaction with hash "${TX_HASH}" to be confirmed.`,
        ),
        { name: "SomeOtherTimeoutError" },
      ),
      { message: `with hash "${TX_HASH}" to be confirmed.` },
    ]) {
      expect(readErrorTxHash(other), String(other)).toBeNull();
    }
  });

  it("mesajın ortasına gömülü kalıp kabul edilmez", () => {
    // Kalıp cümlenin TAMAMINA çapalıdır; öneki olan satır eşleşmez.
    const shortMessage = `Wrapped: Timed out while waiting for transaction with hash "${TX_HASH}" to be confirmed.`;
    expect(
      readErrorTxHash(
        Object.assign(new Error(shortMessage), {
          name: "WaitForTransactionReceiptTimeoutError",
          shortMessage,
        }),
      ),
    ).toBeNull();
  });

  it("SARMALANMIŞ (nested cause) zaman aşımı hatasından da okunur", () => {
    const inner = viemTimeoutError(TX_HASH);
    const wrapped = Object.assign(new Error("Send failed"), {
      name: "ONCHAIN_TRANSACTION_FAILED",
      code: 8002,
      cause: inner,
    });
    expect(readErrorTxHash(wrapped)).toBe(TX_HASH);

    // İki kat sarmalama da çözülür.
    const outer = Object.assign(new Error("Kit failure"), { cause: wrapped });
    expect(readErrorTxHash(outer)).toBe(TX_HASH);
  });

  it("sarmalanmış zaman aşımı uçtan uca hash'i korur", async () => {
    sendMock.mockRejectedValue(
      Object.assign(new Error("Send failed"), {
        name: "ONCHAIN_TRANSACTION_FAILED",
        code: 8002,
        cause: viemTimeoutError(TX_HASH),
      }),
    );
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toMatchObject({
      ok: false,
      code: "submissionUnknown",
      txHash: TX_HASH,
    });
  });

  it("tipli alan varsa metinden ÖNCE o kullanılır", () => {
    // İleride viem hash'i tipli alanda verirse metin ayrıştırmasına düşülmez.
    const shortMessage = `Timed out while waiting for transaction with hash "${TX_HASH}" to be confirmed.`;
    expect(
      readErrorTxHash(
        Object.assign(new Error(shortMessage), {
          name: "WaitForTransactionReceiptTimeoutError",
          shortMessage,
          hash: OTHER_TX_HASH,
        }),
      ),
    ).toBe(OTHER_TX_HASH);
  });

  it("döngüsel cause zinciri sonsuz dönmez", () => {
    const a: Record<string, unknown> = { name: "A" };
    const b: Record<string, unknown> = { name: "B", cause: a };
    a.cause = b;
    expect(readErrorTxHash(a)).toBeNull();
  });
});

describe("iç içe cüzdan reddi güvenli sınıflanır", () => {
  /** Ham EIP-1193 reddi: MetaMask'ın sağlayıcıdan fırlattığı şekil. */
  const rawRejection = () =>
    Object.assign(new Error("User rejected the request."), { code: 4001 });

  /** viem `UserRejectedRequestError` (`_esm/errors/rpc.js`). */
  const viemUserRejected = () =>
    Object.assign(new Error("User rejected the request."), {
      name: "UserRejectedRequestError",
      code: 4001,
      shortMessage: "User rejected the request.",
      details: "MetaMask Tx Signature: User denied transaction signature.",
    });

  /** viem `TransactionExecutionError`, reddi `cause` altında sarar. */
  const viemExecutionWrapper = (cause: unknown) =>
    Object.assign(new Error("User rejected the request."), {
      name: "TransactionExecutionError",
      shortMessage: "User rejected the request.",
      cause,
    });

  /** App Kit `KitError`: bağlamı `cause.trace`, özgün hatayı `rawError`. */
  const kitError = (
    fields: Record<string, unknown>,
    trace: Record<string, unknown> = {},
  ) =>
    Object.assign(new Error("Kit failure"), {
      recoverability: "RETRYABLE",
      ...fields,
      cause: { trace },
    });

  it("DOĞRUDAN ham EIP-1193 reddi yeniden denenebilir", async () => {
    expect(classifySendException(rawRejection())).toBe("rejected");
    sendMock.mockRejectedValue(rawRejection());
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "rejected" });
    // Rezervasyon serbest bırakılır ve inceleme ekranda kalır.
    expect(keepsSubmissionLocked("rejected")).toBe(false);
    expect(reviewStateAfterSendFailure("rejected")).toBe("keepReview");
  });

  it("viem TransactionExecutionError içindeki ret çözülür", async () => {
    const wrapped = viemExecutionWrapper(viemUserRejected());
    expect(classifySendException(wrapped)).toBe("rejected");
    sendMock.mockRejectedValue(wrapped);
    expect(await sendArcUsdc("w", snapshotOf(), at(NOW))).toEqual({
      ok: false,
      code: "rejected",
    });
  });

  it("App Kit cause.trace.rawError.rawError sarmalaması çözülür", async () => {
    /*
     * Gerçek grafik: KitError -> cause.trace -> rawError (viem sarmalayıcısı)
     * -> rawError (UserRejectedRequestError). Yalnızca `cause` izlenseydi
     * gerçek ret GÖRÜLMEZDİ.
     */
    const graph = kitError(
      { name: "ONCHAIN_TRANSACTION_FAILED", code: 7001, type: "ONCHAIN" },
      {
        chain: "Arc_Testnet",
        rawError: {
          name: "TransactionExecutionError",
          rawError: viemUserRejected(),
        },
      },
    );
    expect(classifySendException(graph)).toBe("rejected");
    sendMock.mockRejectedValue(graph);
    expect(await sendArcUsdc("w", snapshotOf(), at(NOW))).toEqual({
      ok: false,
      code: "rejected",
    });
  });

  it("cause -> trace -> rawError -> cause karışık yolu da çözülür", () => {
    const graph = kitError(
      { name: "RPC_ENDPOINT_ERROR", code: 4001, type: "RPC" },
      { rawError: viemExecutionWrapper(viemUserRejected()) },
    );
    expect(classifySendException(graph)).toBe("rejected");
  });

  it("RPC_ENDPOINT_ERROR (code 4001) ret SAYILMAZ", async () => {
    /*
     * Kurulu App Kit'te RpcError.ENDPOINT_ERROR de code 4001 kullanır. Bu bir
     * uç nokta arızasıdır; kit.send sonrası işlem zincire gitmiş OLABİLİR.
     */
    const rpcFailure = kitError({
      name: "RPC_ENDPOINT_ERROR",
      code: 4001,
      type: "RPC",
    });
    expect(classifySendException(rpcFailure)).toBe("submissionUnknown");
    sendMock.mockRejectedValue(rpcFailure);
    expect(await sendArcUsdc("w", snapshotOf(), at(NOW))).toEqual({
      ok: false,
      code: "submissionUnknown",
    });
    // Rezervasyon KİLİTLİ kalır: körlemesine tekrar denenmez.
    expect(keepsSubmissionLocked("submissionUnknown")).toBe(true);
    expect(reviewStateAfterSendFailure("submissionUnknown")).toBe("leaveReview");
  });

  it("type RPC + code 4001 (adı farklı olsa da) ret SAYILMAZ", () => {
    expect(
      classifySendException(
        Object.assign(new Error("endpoint down"), {
          name: "SomeWrapper",
          type: "RPC",
          code: 4001,
        }),
      ),
    ).toBe("submissionUnknown");
  });

  it("ağ KitError sarmalayıcısı 4001 ile ret SAYILMAZ", () => {
    for (const fields of [
      { name: "NETWORK_CONNECTION_FAILED", code: 4001, type: "NETWORK" },
      { name: "RPC_ENDPOINT_ERROR", code: 4001 },
      { name: "SOME_KIT_ERROR", code: 4001 },
    ]) {
      expect(classifySendException(kitError(fields)), fields.name).toBe(
        "submissionUnknown",
      );
    }
  });

  it("grafikte HEM ret HEM geçerli hash varsa ret sayılmaz", async () => {
    // Hash her şeyin önündedir: bir şey zincire gitmiş olabilir.
    const graph = kitError(
      { name: "ONCHAIN_TRANSACTION_FAILED", code: 7001, type: "ONCHAIN" },
      { txHash: TX_HASH, rawError: viemUserRejected() },
    );
    expect(readErrorTxHash(graph)).toBe(TX_HASH);
    expect(classifySendException(graph)).toBe("submissionUnknown");

    sendMock.mockRejectedValue(graph);
    expect(await sendArcUsdc("w", snapshotOf(), at(NOW))).toMatchObject({
      ok: false,
      code: "submissionUnknown",
      txHash: TX_HASH,
    });
  });

  it("hash derinde, ret yüzeyde olsa bile ret sayılmaz", () => {
    const graph = Object.assign(new Error("User rejected the request."), {
      code: 4001,
      cause: { trace: { rawError: { txHash: TX_HASH } } },
    });
    expect(classifySendException(graph)).toBe("submissionUnknown");
  });

  it("DÖNGÜSEL grafik sonsuza gitmez", () => {
    const a: Record<string, unknown> = { name: "A", type: "RPC", code: 4001 };
    const b: Record<string, unknown> = { name: "B", cause: a };
    a.cause = b;
    a.rawError = b;
    expect(classifySendException(a)).toBe("submissionUnknown");
    expect(readErrorTxHash(a)).toBeNull();

    // Döngünün içine gerçek bir ret konursa yine de bulunur.
    b.trace = { rawError: { name: "UserRejectedRequestError" } };
    expect(classifySendException(a)).toBe("rejected");
  });

  it("AŞIRI DERİN grafik sınırda durur ve belirsiz kalır", () => {
    // Düğüm sınırının çok ötesine gömülü bir ret aranmaya devam edilmez.
    let deep: Record<string, unknown> = { name: "UserRejectedRequestError" };
    for (let i = 0; i < 60; i += 1) {
      deep = { name: `KATMAN_${i}`, cause: deep };
    }
    expect(classifySendException(deep)).toBe("submissionUnknown");
    expect(readErrorTxHash(deep)).toBeNull();
  });

  it("sınır İÇİNDEKİ derin ret hâlâ bulunur", () => {
    let deep: Record<string, unknown> = { name: "UserRejectedRequestError" };
    for (let i = 0; i < 6; i += 1) {
      deep = { name: `KATMAN_${i}`, cause: deep };
    }
    expect(classifySendException(deep)).toBe("rejected");
  });

  it("ALAKASIZ alandaki code 4001 ret SAYILMAZ", () => {
    /*
     * Yalnızca cause/trace/rawError izlenir. Rastgele bir yükün içindeki
     * 4001 değeri kullanıcı reddi kanıtı değildir.
     */
    for (const unrelated of [
      { name: "RpcRequestError", details: { code: 4001 } },
      { name: "HttpRequestError", body: { error: { code: 4001 } } },
      { name: "Bilinmeyen", response: { code: 4001 } },
      { name: "Bilinmeyen", data: { originalError: { code: 4001 } } },
      { code: "4001" },
      { code: 4901 },
    ]) {
      expect(classifySendException(unrelated), JSON.stringify(unrelated)).toBe(
        "submissionUnknown",
      );
    }
  });

  it("nesne olmayan girdi belirsizdir", () => {
    for (const bad of [null, undefined, "4001", 4001]) {
      expect(classifySendException(bad), String(bad)).toBe("submissionUnknown");
    }
  });

  it("bakiye hatası YALNIZCA en üst düğümde kabul edilir", () => {
    // Üstte: yayın öncesi kesin.
    expect(
      classifySendException(
        Object.assign(new Error("Insufficient USDC balance"), {
          name: "BALANCE_INSUFFICIENT_TOKEN",
          code: 9001,
          type: "BALANCE",
        }),
      ),
    ).toBe("insufficientFunds");

    // Derinde: sarmalayan RPC arızasının yayın öncesi olduğunu kanıtlamaz.
    expect(
      classifySendException(
        kitError(
          { name: "RPC_ENDPOINT_ERROR", code: 4001, type: "RPC" },
          {
            rawError: {
              name: "BALANCE_INSUFFICIENT_TOKEN",
              code: 9001,
              type: "BALANCE",
            },
          },
        ),
      ),
    ).toBe("submissionUnknown");
  });
});

describe("hata incelemesi TOTAL ve fırlatmaz", () => {
  /** Belirtilen alan okunduğunda fırlatan nesne. */
  function withThrowingGetter(
    key: string,
    base: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const target: Record<string, unknown> = { ...base };
    Object.defineProperty(target, key, {
      get() {
        throw new TypeError(`${key} okunamaz`);
      },
      enumerable: true,
      configurable: true,
    });
    return target;
  }

  /** Her okumada SIRADAKİ değeri veren durumlu erişimci. */
  function withStatefulGetter(
    key: string,
    values: readonly unknown[],
    base: Record<string, unknown> = {},
  ): Record<string, unknown> {
    let reads = 0;
    const target: Record<string, unknown> = { ...base };
    Object.defineProperty(target, key, {
      get() {
        const value = values[Math.min(reads, values.length - 1)];
        reads += 1;
        return value;
      },
      enumerable: true,
      configurable: true,
    });
    return target;
  }

  function revokedProxy(): object {
    const { proxy, revoke } = Proxy.revocable({ code: 4001 }, {});
    revoke();
    return proxy;
  }

  /** `length` adet sarmalayıcı + kuyruk = length + 1 düğüm. */
  function causeChain(
    length: number,
    tail: Record<string, unknown>,
  ): Record<string, unknown> {
    let node: Record<string, unknown> = tail;
    for (let index = 0; index < length; index += 1) {
      node = { name: `KATMAN_${index}`, cause: node };
    }
    return node;
  }

  const INSPECTED = [
    "cause",
    "trace",
    "rawError",
    "name",
    "code",
    "message",
    "txHash",
  ] as const;

  it("İNCELENEN her alanın fırlatan getter'ı yutulur", () => {
    for (const key of INSPECTED) {
      const hostile = withThrowingGetter(key);
      expect(() => classifySendException(hostile), key).not.toThrow();
      expect(classifySendException(hostile), key).toBe("submissionUnknown");
      expect(() => readErrorTxHash(hostile), key).not.toThrow();
      expect(readErrorTxHash(hostile), key).toBeNull();
      expect(analyzeSendException(hostile).complete, key).toBe(false);
    }
  });

  it("code 4001 taşısa da okunamayan alan varsa ret SAYILMAZ", () => {
    // İnceleme eksikse görülmeyen yerde hash olabilir: kanıt yok.
    const hostile = withThrowingGetter("name", { code: 4001 });
    expect(classifySendException(hostile)).toBe("submissionUnknown");
    expect(analyzeSendException(hostile).complete).toBe(false);

    // Aynı nesnenin sağlam hâli gerçekten ret verir: fark yalnızca getter'dır.
    expect(classifySendException({ code: 4001 })).toBe("rejected");
  });

  it("fırlatan bağlantı getter'ı dolaşımı EKSİK işaretler", () => {
    for (const link of ["cause", "trace", "rawError"] as const) {
      const hostile = withThrowingGetter(link, {
        name: "UserRejectedRequestError",
      });
      // Ret kimliği görünse bile grafiğin kalanı incelenemedi.
      expect(analyzeSendException(hostile).complete, link).toBe(false);
      expect(classifySendException(hostile), link).toBe("submissionUnknown");
    }
  });

  it("İPTAL EDİLMİŞ proxy fırlatmaz ve fail-closed olur", () => {
    const revoked = revokedProxy();
    expect(() => classifySendException(revoked)).not.toThrow();
    expect(classifySendException(revoked)).toBe("submissionUnknown");
    expect(readErrorTxHash(revoked)).toBeNull();
    expect(analyzeSendException(revoked).complete).toBe(false);
  });

  it("grafiğin İÇİNDEKİ iptal edilmiş proxy de fail-closed olur", () => {
    const wrapper = {
      name: "ONCHAIN_TRANSACTION_FAILED",
      type: "ONCHAIN",
      cause: { trace: { rawError: revokedProxy() } },
    };
    expect(() => classifySendException(wrapper)).not.toThrow();
    expect(analyzeSendException(wrapper).complete).toBe(false);
    expect(classifySendException(wrapper)).toBe("submissionUnknown");
  });

  it("DURUMLU getter tek analiz içinde tek kez okunur", () => {
    // İlk okuma 4001; ikinci okuma farklı olsaydı sınıf değişemez.
    const stateful = withStatefulGetter("code", [4001, 9999, 9999]);
    const analysis = analyzeSendException(stateful);
    expect(analysis.classification).toBe("rejected");
    expect(analysis.complete).toBe(true);
    // Hash ve ret aynı görüntüden okunduğu için tutarlıdır.
    expect(analysis.txHash).toBeNull();
  });

  it("durumlu txHash getter'ı hash ile sınıfı ÇELİŞTİREMEZ", () => {
    // Hash ilk okumada var: sonuç belirsiz olmalı ve hash korunmalı.
    const stateful = withStatefulGetter("txHash", [TX_HASH, undefined], {
      code: 4001,
    });
    const analysis = analyzeSendException(stateful);
    expect(analysis.txHash).toBe(TX_HASH);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("DÖNGÜSEL grafik fırlatmaz ve tamamlanmış sayılır", () => {
    const a: Record<string, unknown> = { name: "A" };
    const b: Record<string, unknown> = { name: "B", cause: a };
    a.cause = b;
    a.rawError = b;
    const analysis = analyzeSendException(a);
    expect(analysis.complete).toBe(true);
    expect(analysis.classification).toBe("submissionUnknown");

    // Döngü içindeki gerçek ret yine bulunur.
    b.trace = { name: "UserRejectedRequestError" };
    expect(classifySendException(a)).toBe("rejected");
  });

  it("TAM sınırdaki grafik EKSİKSİZ sayılır ve ret bulunur", () => {
    // MAX_ERROR_GRAPH_NODES - 1 sarmalayıcı + 1 kuyruk = tam sınır.
    const atLimit = causeChain(MAX_ERROR_GRAPH_NODES - 1, {
      name: "UserRejectedRequestError",
    });
    const analysis = analyzeSendException(atLimit);
    expect(analysis.complete).toBe(true);
    expect(analysis.classification).toBe("rejected");
  });

  it("sınırı AŞAN derin grafik EKSİK sayılır", () => {
    const overLimit = causeChain(MAX_ERROR_GRAPH_NODES, {
      name: "UserRejectedRequestError",
    });
    const analysis = analyzeSendException(overLimit);
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("sınırı AŞAN geniş grafik de EKSİK sayılır", () => {
    // Her düğüm üç bağlantıya dallanır: bütçe hızla dolar.
    const branch = (depth: number): Record<string, unknown> =>
      depth === 0
        ? { name: "YAPRAK" }
        : {
            name: `DAL_${depth}`,
            cause: branch(depth - 1),
            trace: branch(depth - 1),
            rawError: branch(depth - 1),
          };
    const analysis = analyzeSendException(branch(4));
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("ERKEN ret + sınırın hemen ÖTESİNDE hash: ret SAYILMAZ", () => {
    /*
     * Ret kimliği en üstte; geçerli hash ise bütçenin bir düğüm ötesinde.
     * Bütünlük izlenmeseydi "yeniden denenebilir ret" denir ve zincire
     * gitmiş olabilecek ödeme ikinci kez gönderilebilirdi.
     */
    const beyond = causeChain(MAX_ERROR_GRAPH_NODES - 1, { txHash: TX_HASH });
    const graph: Record<string, unknown> = {
      name: "UserRejectedRequestError",
      code: 4001,
      cause: beyond,
    };
    const analysis = analyzeSendException(graph);
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("sınır İÇİNDEKİ hash ret kimliğini yine bastırır", () => {
    const within = causeChain(3, { txHash: TX_HASH });
    const analysis = analyzeSendException({
      name: "UserRejectedRequestError",
      code: 4001,
      cause: within,
    });
    expect(analysis.complete).toBe(true);
    expect(analysis.txHash).toBe(TX_HASH);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("EKSİK dolaşımda bakiye hatası yeniden denenebilir SAYILMAZ", () => {
    const balanceWithHostileGraph = {
      name: "BALANCE_INSUFFICIENT_TOKEN",
      code: 9001,
      type: "BALANCE",
      cause: { trace: { rawError: withThrowingGetter("code") } },
    };
    const analysis = analyzeSendException(balanceWithHostileGraph);
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");

    // Grafiği sağlam olan aynı bakiye hatası hâlâ yeniden denenebilir.
    expect(
      classifySendException({
        name: "BALANCE_INSUFFICIENT_TOKEN",
        code: 9001,
        type: "BALANCE",
      }),
    ).toBe("insufficientFunds");
  });

  it("inceleme başarısızlığından ÖNCE bulunan hash KORUNUR", () => {
    const graph = {
      txHash: TX_HASH,
      cause: withThrowingGetter("rawError"),
    };
    const analysis = analyzeSendException(graph);
    expect(analysis.txHash).toBe(TX_HASH);
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("BridgeStep alanı okunamıyorsa sonuç kanıtlanamaz", () => {
    // Başarı da revert de iddia edilmez; varsa hash korunur.
    expect(
      classifySendResult(withThrowingGetter("state", { txHash: TX_HASH })),
    ).toEqual({ kind: "unknown", txHash: TX_HASH });
    expect(
      classifySendResult(withThrowingGetter("errorCategory", { state: "error" })),
    ).toEqual({ kind: "unknown", txHash: null });
    expect(
      classifySendResult(withThrowingGetter("txHash", { state: "success" })),
    ).toEqual({ kind: "unknown", txHash: null });
    expect(() => classifySendResult(revokedProxy())).not.toThrow();
  });
});

describe("kit.send belirsizliği ASLA sendFailed olmaz", () => {
  function withThrowingGetter(
    key: string,
    base: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const target: Record<string, unknown> = { ...base };
    Object.defineProperty(target, key, {
      get() {
        throw new TypeError(`${key} okunamaz`);
      },
      enumerable: true,
      configurable: true,
    });
    return target;
  }

  /** Yeniden denemeye izin veren TÜM kodlar. */
  const RETRYABLE = ["sendFailed", "rejected", "insufficientFunds"] as const;

  it("fırlatan getter'lı hata uçtan uca submissionUnknown döner", async () => {
    for (const key of ["cause", "trace", "rawError", "name", "code", "message"]) {
      sendMock.mockReset();
      sendMock.mockRejectedValue(withThrowingGetter(key, { code: 4001 }));
      const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
      expect(result.ok, key).toBe(false);
      if (result.ok) continue;
      expect(result.code, key).toBe("submissionUnknown");
      expect(RETRYABLE, key).not.toContain(result.code);
      expect(keepsSubmissionLocked(result.code), key).toBe(true);
    }
  });

  it("iptal edilmiş proxy uçtan uca submissionUnknown döner", async () => {
    const { proxy, revoke } = Proxy.revocable({ code: 4001 }, {});
    revoke();
    sendMock.mockRejectedValue(proxy);
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "submissionUnknown" });
  });

  it("DURUMLU hata sınıflandırıcıyı çeliştirse bile sendFailed olmaz", async () => {
    /*
     * `code` ilk okumada 4001 (ret gibi görünür), sonraki okumada başka bir
     * değer. İki analiz çelişir ve klasik yol `sendFailed`e düşerdi; emniyet
     * ağı bunu `submissionUnknown`a çeker.
     */
    let reads = 0;
    const stateful: Record<string, unknown> = { message: "belirsiz" };
    Object.defineProperty(stateful, "code", {
      get() {
        reads += 1;
        return reads === 1 ? 4001 : 5000;
      },
      enumerable: true,
      configurable: true,
    });

    sendMock.mockRejectedValue(stateful);
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(RETRYABLE).not.toContain(result.code);
    expect(result.code).toBe("submissionUnknown");
    expect(keepsSubmissionLocked(result.code)).toBe(true);
    expect(reviewStateAfterSendFailure(result.code)).toBe("leaveReview");
  });

  it("düşmanca hatada bile kurtarılan hash korunur", async () => {
    sendMock.mockRejectedValue(
      withThrowingGetter("name", { txHash: TX_HASH, code: 4001 }),
    );
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toMatchObject({
      ok: false,
      code: "submissionUnknown",
      txHash: TX_HASH,
      explorerUrl: `https://testnet.arcscan.app/tx/${TX_HASH}`,
    });
  });

  it("kit.send ÇAĞRILMADAN önceki hata sendFailed kalabilir", async () => {
    // Emniyet ağı yalnızca kit.send'e girildikten SONRA devreye girer.
    adapterMock.mockImplementationOnce(() => {
      throw new Error("adaptör kurulamadı");
    });
    sendMock.mockResolvedValue({ state: "success", txHash: TX_HASH });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "sendFailed" });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("dizi/kap bağlantılar FAIL-CLOSED", () => {
  const REJECTION = { name: "UserRejectedRequestError", code: 4001 } as const;

  /** Gerçek dizi, ama indeks erişimi fırlatıyor. */
  function arrayWithThrowingIndex(): unknown[] {
    const array: unknown[] = [{ txHash: TX_HASH }];
    Object.defineProperty(array, "0", {
      get() {
        throw new TypeError("eleman okunamaz");
      },
      configurable: true,
    });
    return array;
  }

  /** `length` okuması fırlatan dizi proxy'si. */
  function arrayWithThrowingLength(): unknown {
    return new Proxy([{ txHash: TX_HASH }], {
      get(target, key, receiver) {
        if (key === "length") {
          throw new TypeError("length okunamaz");
        }
        return Reflect.get(target, key, receiver);
      },
    });
  }

  function revokedArray(): unknown {
    const { proxy, revoke } = Proxy.revocable([{ txHash: TX_HASH }], {});
    revoke();
    return proxy;
  }

  it("cause DİZİSİ içindeki hash bulunur ve sonuç belirsiz kalır", () => {
    const analysis = analyzeSendException({ cause: [{ txHash: TX_HASH }] });
    expect(analysis.complete).toBe(false);
    expect(analysis.txHash).toBe(TX_HASH);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("trace ve rawError dizileri de EKSİK işaretlenir", () => {
    for (const link of ["trace", "rawError"] as const) {
      const analysis = analyzeSendException({ [link]: [{ txHash: TX_HASH }] });
      expect(analysis.complete, link).toBe(false);
      expect(analysis.txHash, link).toBe(TX_HASH);
      expect(analysis.classification, link).toBe("submissionUnknown");
    }
  });

  it("ERKEN ret + dizide saklı hash ASLA yeniden denenebilir olmaz", () => {
    /*
     * Bildirilen açık: ret kimliği en üstte, hash bir dizinin içinde.
     * Diziler sessizce atlanıp `complete` true kalsaydı sonuç "rejected"
     * olur ve zincire gitmiş olabilecek ödeme ikinci kez gönderilebilirdi.
     */
    const analysis = analyzeSendException({
      ...REJECTION,
      cause: [{ txHash: TX_HASH }],
    });
    expect(analysis.complete).toBe(false);
    expect(analysis.txHash).toBe(TX_HASH);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("dizide hash OLMASA bile ret yeniden denenebilir olmaz", () => {
    const analysis = analyzeSendException({
      ...REJECTION,
      cause: [{ name: "BOŞ" }],
    });
    expect(analysis.complete).toBe(false);
    expect(analysis.txHash).toBeNull();
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("AggregateError.errors hesaba katılır", () => {
    const aggregate = new AggregateError(
      [{ txHash: TX_HASH }, REJECTION],
      "hepsi başarısız",
    );
    const analysis = analyzeSendException(aggregate);
    expect(analysis.complete).toBe(false);
    expect(analysis.txHash).toBe(TX_HASH);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("AggregateError yalnızca ret içerse de yeniden denenebilir olmaz", () => {
    const aggregate = new AggregateError([REJECTION], "iptal");
    const analysis = analyzeSendException(aggregate);
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("sarmalanmış AggregateError de bulunur", () => {
    const analysis = analyzeSendException({
      name: "ONCHAIN_TRANSACTION_FAILED",
      type: "ONCHAIN",
      cause: { trace: { rawError: new AggregateError([{ txHash: TX_HASH }], "x") } },
    });
    expect(analysis.complete).toBe(false);
    expect(analysis.txHash).toBe(TX_HASH);
  });

  it("BOŞ dizi de desteklenmeyen kap sayılır", () => {
    const analysis = analyzeSendException({ ...REJECTION, cause: [] });
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("AŞIRI BÜYÜK dizi fırlatmaz ve eksik kalır", () => {
    const huge = Array.from({ length: 5000 }, (_, index) => ({
      name: `ALT_${index}`,
    }));
    const analysis = analyzeSendException({ ...REJECTION, cause: huge });
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("iç içe diziler sonsuz işe yol açmaz", () => {
    let nested: unknown = [{ name: "DERİN" }];
    for (let index = 0; index < 40; index += 1) {
      nested = [nested, [{ name: `KAT_${index}` }]];
    }
    const analysis = analyzeSendException({ cause: nested });
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("KENDİNİ içeren dizi döngüye girmez", () => {
    const cyclic: unknown[] = [{ name: "A" }];
    cyclic.push(cyclic);
    expect(() => analyzeSendException({ cause: cyclic })).not.toThrow();
    expect(analyzeSendException({ cause: cyclic }).complete).toBe(false);
  });

  it("FIRLATAN dizi erişimi fırlatmaz ve eksik kalır", () => {
    for (const container of [
      arrayWithThrowingIndex(),
      arrayWithThrowingLength(),
      revokedArray(),
    ]) {
      const analysis = analyzeSendException({ ...REJECTION, cause: container });
      expect(analysis.complete).toBe(false);
      expect(analysis.classification).toBe("submissionUnknown");
    }
  });

  it("en üstteki dizi de eksik sayılır", () => {
    const analysis = analyzeSendException([REJECTION]);
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("EKSİK dolaşımda bakiye hatası yeniden denenebilir SAYILMAZ", () => {
    const analysis = analyzeSendException({
      name: "BALANCE_INSUFFICIENT_TOKEN",
      code: 9001,
      type: "BALANCE",
      cause: [{ name: "ALT" }],
    });
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("HİÇBİR kap biçimi rejected/insufficientFunds üretmez", () => {
    const containers: unknown[] = [
      [{ txHash: TX_HASH }],
      [],
      [REJECTION],
      new AggregateError([REJECTION], "x").errors,
      arrayWithThrowingIndex(),
      arrayWithThrowingLength(),
      revokedArray(),
      Array.from({ length: 100 }, () => REJECTION),
    ];
    for (const [index, container] of containers.entries()) {
      for (const link of ["cause", "trace", "rawError", "errors"] as const) {
        const analysis = analyzeSendException({
          ...REJECTION,
          name: "BALANCE_INSUFFICIENT_TOKEN",
          code: 9001,
          type: "BALANCE",
          [link]: container,
        });
        const label = `${link}#${index}`;
        expect(analysis.complete, label).toBe(false);
        expect(analysis.classification, label).not.toBe("rejected");
        expect(analysis.classification, label).not.toBe("insufficientFunds");
        expect(analysis.classification, label).toBe("submissionUnknown");
      }
    }
  });

  it("NORMAL nesne bağlantıları eskisi gibi çalışır", () => {
    // Regresyon koruması: dizi olmayan bağlantılarda davranış değişmedi.
    expect(analyzeSendException(REJECTION)).toEqual({
      classification: "rejected",
      txHash: null,
      complete: true,
    });
    expect(
      analyzeSendException({ cause: { trace: { rawError: REJECTION } } }),
    ).toEqual({ classification: "rejected", txHash: null, complete: true });
    expect(
      analyzeSendException({
        name: "BALANCE_INSUFFICIENT_TOKEN",
        code: 9001,
        type: "BALANCE",
      }).classification,
    ).toBe("insufficientFunds");
  });
});

describe("kap içeren hatalar uçtan uca KİLİTLİ kalır", () => {
  const REJECTION = { name: "UserRejectedRequestError", code: 4001 } as const;
  const RETRYABLE = ["sendFailed", "rejected", "insufficientFunds"] as const;

  it("dizide saklı hash uçtan uca korunur ve kilit açılmaz", async () => {
    sendMock.mockRejectedValue({ ...REJECTION, cause: [{ txHash: TX_HASH }] });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(RETRYABLE).not.toContain(result.code);
    expect(result.code).toBe("submissionUnknown");
    expect(result.txHash).toBe(TX_HASH);
    expect(result.explorerUrl).toBe(`https://testnet.arcscan.app/tx/${TX_HASH}`);
    expect(keepsSubmissionLocked(result.code)).toBe(true);
    expect(reviewStateAfterSendFailure(result.code)).toBe("leaveReview");
  });

  it("AggregateError uçtan uca submissionUnknown döner", async () => {
    sendMock.mockRejectedValue(new AggregateError([REJECTION], "iptal"));
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toEqual({ ok: false, code: "submissionUnknown" });
    expect(keepsSubmissionLocked("submissionUnknown")).toBe(true);
  });

  it("her kap biçimi uçtan uca kilitli kalır", async () => {
    for (const container of [
      [{ txHash: TX_HASH }],
      [],
      [REJECTION],
      Array.from({ length: 100 }, () => REJECTION),
    ]) {
      sendMock.mockReset();
      sendMock.mockRejectedValue({ ...REJECTION, cause: container });
      const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(RETRYABLE).not.toContain(result.code);
      expect(keepsSubmissionLocked(result.code)).toBe(true);
    }
  });
});

describe("desteklenmeyen kaplar FAIL-CLOSED", () => {
  const REJECTION = { name: "UserRejectedRequestError", code: 4001 } as const;
  const HIDDEN = { txHash: TX_HASH };
  const RETRYABLE = ["sendFailed", "rejected", "insufficientFunds"] as const;

  /** `Symbol.iterator` okunduğunda fırlatan nesne. */
  function throwingIterator(): object {
    const target = { txHash: TX_HASH };
    Object.defineProperty(target, Symbol.iterator, {
      get() {
        throw new TypeError("iterator okunamaz");
      },
      configurable: true,
    });
    return target;
  }

  /** `getPrototypeOf` tuzağı fırlatan proxy. */
  function throwingPrototype(): object {
    return new Proxy(
      { txHash: TX_HASH },
      {
        getPrototypeOf() {
          throw new TypeError("prototip okunamaz");
        },
      },
    );
  }

  /** Düz prototipli ama özel yinelenebilir kap. */
  function customIterable(): object {
    return {
      hidden: HIDDEN,
      [Symbol.iterator]() {
        return [HIDDEN][Symbol.iterator]();
      },
    };
  }

  class CustomContainer {
    readonly hidden = HIDDEN;
  }

  /** Adı ve içeriğiyle birlikte desteklenmeyen her kap. */
  const UNSUPPORTED: readonly (readonly [string, unknown])[] = [
    ["Set", new Set([HIDDEN])],
    ["Map", new Map([["k", HIDDEN]])],
    ["WeakSet", new WeakSet([HIDDEN])],
    ["WeakMap", new WeakMap([[HIDDEN, 1]])],
    ["Uint8Array", new Uint8Array([1, 2, 3])],
    ["DataView", new DataView(new ArrayBuffer(8))],
    ["ArrayBuffer", new ArrayBuffer(8)],
    ["dizi-benzeri", { 0: HIDDEN, length: 1 }],
    ["özel yinelenebilir", customIterable()],
    ["özel sınıf", new CustomContainer()],
    ["promise", Promise.resolve(HIDDEN)],
    ["thenable", { then: () => undefined, hidden: HIDDEN }],
    ["fırlatan iterator", throwingIterator()],
    ["fırlatan prototip", throwingPrototype()],
  ];

  it("Set ve Map içindeki hash görünmez ve dolaşım EKSİK kalır", () => {
    for (const container of [new Set([HIDDEN]), new Map([["k", HIDDEN]])]) {
      const analysis = analyzeSendException({ cause: container });
      expect(analysis.complete).toBe(false);
      expect(analysis.classification).toBe("submissionUnknown");
      // İçine GİRİLMEZ: kap gezinme uygulaması eklenmedi.
      expect(analysis.txHash).toBeNull();
    }
  });

  it("WeakSet ve WeakMap de desteklenmez", () => {
    for (const container of [new WeakSet([HIDDEN]), new WeakMap([[HIDDEN, 1]])]) {
      const analysis = analyzeSendException({ cause: container });
      expect(analysis.complete).toBe(false);
      expect(analysis.classification).toBe("submissionUnknown");
    }
  });

  it("tipli diziler ve dizi benzeri nesneler desteklenmez", () => {
    for (const container of [
      new Uint8Array([1, 2, 3]),
      new Float64Array(2),
      new DataView(new ArrayBuffer(8)),
      new ArrayBuffer(8),
      { 0: HIDDEN, length: 1 },
    ]) {
      const analysis = analyzeSendException({ cause: container });
      expect(analysis.complete).toBe(false);
      expect(analysis.classification).toBe("submissionUnknown");
    }
  });

  it("özel yinelenebilir ve özel kap sınıfı desteklenmez", () => {
    for (const container of [customIterable(), new CustomContainer()]) {
      const analysis = analyzeSendException({ cause: container });
      expect(analysis.complete).toBe(false);
      expect(analysis.classification).toBe("submissionUnknown");
    }
  });

  it("DİZİ OLMAYAN errors değeri dolaşımı eksik bırakır", () => {
    for (const value of [
      new Set([HIDDEN]),
      { 0: HIDDEN, length: 1 },
      HIDDEN,
      customIterable(),
    ]) {
      const analysis = analyzeSendException(
        Object.assign(new Error("toplu"), { errors: value }),
      );
      expect(analysis.complete).toBe(false);
      expect(analysis.classification).toBe("submissionUnknown");
      // Desteklenmeyen şekil içine GİRİLMEZ.
      expect(analysis.txHash).toBeNull();
    }
  });

  it("gerçek AggregateError dizisi hâlâ hash kurtarır", () => {
    const analysis = analyzeSendException(new AggregateError([HIDDEN], "x"));
    expect(analysis.complete).toBe(false);
    expect(analysis.txHash).toBe(TX_HASH);
  });

  it("FIRLATAN Symbol.iterator ve prototip erişimi fırlatmaz", () => {
    for (const container of [throwingIterator(), throwingPrototype()]) {
      expect(() => analyzeSendException({ cause: container })).not.toThrow();
      const analysis = analyzeSendException({ cause: container });
      expect(analysis.complete).toBe(false);
      expect(analysis.classification).toBe("submissionUnknown");
    }
  });

  it("fonksiyon değerli bağlantı desteklenmez", () => {
    const analysis = analyzeSendException({
      ...REJECTION,
      cause: function hidden() {
        return HIDDEN;
      },
    });
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("en üstteki desteklenmeyen kap da eksik sayılır", () => {
    for (const [label, container] of UNSUPPORTED) {
      const analysis = analyzeSendException(container);
      expect(analysis.complete, label).toBe(false);
      expect(analysis.classification, label).toBe("submissionUnknown");
    }
  });

  it("ERKEN ret + HER desteklenmeyen kap: asla yeniden denenebilir olmaz", () => {
    for (const [label, container] of UNSUPPORTED) {
      for (const link of ["cause", "trace", "rawError", "errors"] as const) {
        const analysis = analyzeSendException({
          ...REJECTION,
          [link]: container,
        });
        const tag = `${label}/${link}`;
        expect(analysis.complete, tag).toBe(false);
        expect(analysis.classification, tag).toBe("submissionUnknown");
      }
    }
  });

  it("bakiye hatası + desteklenmeyen kap da yeniden denenebilir olmaz", () => {
    for (const [label, container] of UNSUPPORTED) {
      const analysis = analyzeSendException({
        name: "BALANCE_INSUFFICIENT_TOKEN",
        code: 9001,
        type: "BALANCE",
        cause: container,
      });
      expect(analysis.classification, label).not.toBe("insufficientFunds");
      expect(analysis.classification, label).toBe("submissionUnknown");
    }
  });

  it("İNCELEME ÖNCESİ bulunan hash desteklenmeyen kapla birlikte korunur", () => {
    const analysis = analyzeSendException({
      txHash: TX_HASH,
      cause: new Set([{ name: "GİZLİ" }]),
    });
    expect(analysis.txHash).toBe(TX_HASH);
    expect(analysis.complete).toBe(false);
    expect(analysis.classification).toBe("submissionUnknown");
  });

  it("NORMAL nesne ve Error bağlantıları desteklenmeye devam eder", () => {
    // Düz nesne zinciri.
    expect(
      analyzeSendException({ cause: { trace: { rawError: REJECTION } } }),
    ).toEqual({ classification: "rejected", txHash: null, complete: true });

    // Gerçek Error örneği ve Error türevi sınıf.
    class KitLike extends Error {
      readonly type = "ONCHAIN";
    }
    const kitLike = new KitLike("zincir hatası");
    expect(
      analyzeSendException({
        cause: Object.assign(kitLike, { rawError: REJECTION }),
      }),
    ).toEqual({ classification: "rejected", txHash: null, complete: true });

    // Prototipsiz kayıt.
    const bare = Object.create(null) as Record<string, unknown>;
    bare.name = "UserRejectedRequestError";
    expect(analyzeSendException({ cause: bare })).toEqual({
      classification: "rejected",
      txHash: null,
      complete: true,
    });

    // İlkel değerli ve boş bağlantılar bütünlüğü bozmaz.
    expect(
      analyzeSendException({ ...REJECTION, cause: "metin", trace: null }),
    ).toEqual({ classification: "rejected", txHash: null, complete: true });
  });

  it("normal viem/AppKit şekilleri hâlâ hash ve ret verir", () => {
    const viemTimeout = Object.assign(new Error("t"), {
      name: "WaitForTransactionReceiptTimeoutError",
      shortMessage: `Timed out while waiting for transaction with hash "${TX_HASH}" to be confirmed.`,
    });
    expect(analyzeSendException(viemTimeout).txHash).toBe(TX_HASH);

    const kitError = Object.assign(new Error("Kit failure"), {
      name: "ONCHAIN_TRANSACTION_FAILED",
      code: 7001,
      type: "ONCHAIN",
      cause: { trace: { txHash: TX_HASH } },
    });
    expect(analyzeSendException(kitError).txHash).toBe(TX_HASH);
  });

  it("HİÇBİR desteklenmeyen şekil uçtan uca kilidi açmaz", async () => {
    for (const [label, container] of UNSUPPORTED) {
      sendMock.mockReset();
      sendMock.mockRejectedValue({ ...REJECTION, cause: container });
      const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
      expect(result.ok, label).toBe(false);
      if (result.ok) continue;
      expect(RETRYABLE, label).not.toContain(result.code);
      expect(result.code, label).toBe("submissionUnknown");
      expect(keepsSubmissionLocked(result.code), label).toBe(true);
      expect(reviewStateAfterSendFailure(result.code), label).toBe("leaveReview");
    }
  });

  it("kap yanında kurtarılan hash uçtan uca korunur", async () => {
    sendMock.mockRejectedValue({
      ...REJECTION,
      txHash: TX_HASH,
      cause: new Map([["k", { name: "GİZLİ" }]]),
    });
    const result = await sendArcUsdc("w", snapshotOf(), at(NOW));
    expect(result).toMatchObject({
      ok: false,
      code: "submissionUnknown",
      txHash: TX_HASH,
      explorerUrl: `https://testnet.arcscan.app/tx/${TX_HASH}`,
    });
  });
});
