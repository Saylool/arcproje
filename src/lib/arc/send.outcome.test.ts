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
