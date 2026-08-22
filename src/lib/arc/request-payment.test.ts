import { renderSVG } from "uqr";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatMicroUsdcAmount, formatMicroUsdcForDisplay } from "./conversion";
import {
  buildTypedData,
  createPaymentRequestPayload,
  type PaymentRequestPayload,
} from "./payment-request";
import { ACTIVE_NETWORK_PROFILE } from "./profile";
import {
  buildShareUrl,
  decodeSignedRequest,
  encodeSignedRequest,
} from "./request-codec";

/**
 * Borçlu tarafının uçtan uca davranışı: imzalı talep -> çözümleme ->
 * anlık görüntü -> App Kit sınırı. Gerçek zincir işlemi yapılmaz; App Kit ve
 * cüzdan katmanı taklit edilir.
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

type RequestArgs = { method: string };
let accountsResponse: unknown = [];
let chainResponse: unknown = "0x4cef52";

const provider = {
  request: ({ method }: RequestArgs) => {
    if (method === "eth_accounts") return Promise.resolve(accountsResponse);
    if (method === "eth_chainId") return Promise.resolve(chainResponse);
    return Promise.reject(new Error("desteklenmeyen"));
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

const { estimateArcSend, sendArcUsdc, validatePaymentSnapshot } = await import(
  "./send"
);

const NOW = 1_700_000_000_000;
const TX_HASH = `0x${"cd".repeat(32)}`;

/** Test süresince bellekte kalan geçici imzalayanlar. */
const payerAccount = privateKeyToAccount(generatePrivateKey());
const debtorAccount = privateKeyToAccount(generatePrivateKey());

function payloadOf(over: Partial<PaymentRequestPayload> = {}): PaymentRequestPayload {
  const created = createPaymentRequestPayload({
    recipient: payerAccount.address,
    debtor: debtorAccount.address,
    debtKey: "b->a",
    tryMinor: 20000,
    rateNumerator: BigInt(4000),
    rateDenominator: BigInt(1),
    microUsdc: BigInt(50_000),
    recipientLabel: "Sen",
    debtorLabel: "Ayşe",
    nowMs: NOW,
    requestId: `0x${"33".repeat(32)}`,
  });
  if (!created.ok) {
    throw new Error(`payload üretilemedi: ${created.problem}`);
  }
  return { ...created.payload, ...over };
}

async function signedLinkFor(payload: PaymentRequestPayload) {
  const typedData = buildTypedData(payload);
  const signature = await payerAccount.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
  const encoded = encodeSignedRequest({ payload, signature });
  return { encoded, url: buildShareUrl("https://ornek.test", encoded) };
}

/** PaymentRequestPayer bileşeniyle aynı kurulum. */
function snapshotFromPayload(payload: PaymentRequestPayload) {
  const micro = BigInt(payload.microUsdc);
  return Object.freeze({
    debtKey: payload.debtKey,
    debtorParticipantId: payload.debtorLabel,
    recipientParticipantId: payload.recipientLabel,
    debtorAddress: payload.debtor,
    recipientAddress: payload.recipient,
    tryMinor: Number(payload.tryMinor),
    rateNumerator: payload.rateNumerator,
    rateDenominator: payload.rateDenominator,
    microUsdc: payload.microUsdc,
    amount: formatMicroUsdcAmount(micro),
    displayAmount: formatMicroUsdcForDisplay(micro),
    chainId: payload.chainId,
    requestId: payload.requestId,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  });
}

/** Belirlenimci zaman kaynağı; üretimde her zaman geçerli zaman kullanılır. */
const at = (nowMs: number) => () => nowMs;

beforeEach(() => {
  sendMock.mockReset();
  estimateMock.mockReset();
  adapterMock.mockReset();
  accountsResponse = [debtorAccount.address];
  chainResponse = "0x4cef52";
});

describe("imzalı talepten anlık görüntü", () => {
  it("yalnızca imzalı gövdeden kurulur ve sınır doğrulamasını geçer", () => {
    const payload = payloadOf();
    const snapshot = snapshotFromPayload(payload);
    expect(validatePaymentSnapshot(snapshot, NOW)).toBeNull();
    expect(snapshot.recipientAddress).toBe(payload.recipient);
    expect(snapshot.debtorAddress).toBe(payload.debtor);
    expect(snapshot.microUsdc).toBe("50000");
    expect(snapshot.amount).toBe("0.05");
    expect(snapshot.chainId).toBe(ACTIVE_NETWORK_PROFILE.chainId);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("çözülen talep, imzalanan talebin aynısıdır", async () => {
    const payload = payloadOf();
    const { encoded } = await signedLinkFor(payload);
    const decoded = decodeSignedRequest(encoded, NOW);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(snapshotFromPayload(decoded.request.payload)).toEqual(
      snapshotFromPayload(payload),
    );
  });
});

describe("App Kit sınırı — borçlu tarafı", () => {
  it("bağlı hesap talepteki borçlu değilse App Kit çağrılmaz", async () => {
    accountsResponse = [payerAccount.address];
    const result = await sendArcUsdc("w", snapshotFromPayload(payloadOf()), at(NOW));
    expect(result).toEqual({ ok: false, code: "accountChanged" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(adapterMock).not.toHaveBeenCalled();
  });

  it("ağ Arc Testnet değilse App Kit çağrılmaz", async () => {
    chainResponse = "0x1";
    const result = await sendArcUsdc("w", snapshotFromPayload(payloadOf()), at(NOW));
    expect(result).toEqual({ ok: false, code: "networkChanged" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("kendine transferde App Kit çağrılmaz", async () => {
    const snapshot = {
      ...snapshotFromPayload(payloadOf()),
      recipientAddress: debtorAccount.address,
    };
    const result = await sendArcUsdc("w", snapshot, at(NOW));
    expect(result).toEqual({ ok: false, code: "selfTransfer" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("geçerli talepte tahmin başarılı olur", async () => {
    estimateMock.mockResolvedValue({ totalFee: "0.0001" });
    const result = await estimateArcSend("w", snapshotFromPayload(payloadOf()), at(NOW));
    expect(result.ok).toBe(true);
    expect(estimateMock).toHaveBeenCalledTimes(1);
  });

  it("başarılı gönderim tam olarak imzalı talebe bağlanır", async () => {
    sendMock.mockResolvedValue({ txHash: TX_HASH, state: "COMPLETE" });
    const payload = payloadOf();
    const snapshot = snapshotFromPayload(payload);
    const result = await sendArcUsdc("w", snapshot, at(NOW));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot).toBe(snapshot);
    expect(result.value.snapshot.microUsdc).toBe(payload.microUsdc);
    expect(result.value.snapshot.debtKey).toBe(payload.debtKey);
    expect(result.value.txHash).toBe(TX_HASH);
    expect(result.value.explorerUrl).toBe(
      `${ACTIVE_NETWORK_PROFILE.explorerUrl}/tx/${TX_HASH}`,
    );

    // App Kit'e giden değerler imzalı talepten gelir.
    const params = sendMock.mock.calls[0][0];
    expect(params.to).toBe(payload.recipient);
    expect(params.amount).toBe("0.05");
    expect(params.token).toBe("USDC");
    expect(params.from.chain).toBe(ACTIVE_NETWORK_PROFILE.appKitChain);
  });

  it("kurcalanmış tutar daha imza doğrulamasına gelmeden reddedilir", async () => {
    const payload = payloadOf();
    const { encoded } = await signedLinkFor(payload);
    const decoded = decodeSignedRequest(encoded, NOW);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    // Tutar borç ve kurla artık tutarsız; çözümleme bunu imzaya bakmadan görür.
    const tampered = { ...decoded.request.payload, microUsdc: "5000000" };
    const reencoded = encodeSignedRequest({
      payload: tampered,
      signature: decoded.request.signature,
    });
    expect(decodeSignedRequest(reencoded, NOW)).toEqual({
      ok: false,
      problem: "inconsistentAmount",
    });
  });

  it("ekonomik olarak tutarlı ama kurcalanmış alan imza doğrulamasında yakalanır", async () => {
    const payload = payloadOf();
    const { encoded } = await signedLinkFor(payload);
    const decoded = decodeSignedRequest(encoded, NOW);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    // Etiket değişimi tutarları bozmaz; bu katmanı yalnızca imza yakalayabilir.
    const tampered = { ...decoded.request.payload, recipientLabel: "Başkası" };
    const reencoded = encodeSignedRequest({
      payload: tampered,
      signature: decoded.request.signature,
    });
    const redecoded = decodeSignedRequest(reencoded, NOW);
    expect(redecoded.ok).toBe(true);
    if (!redecoded.ok) return;

    const { verifyPaymentRequestSignature } = await import("./request-signing");
    expect((await verifyPaymentRequestSignature(redecoded.request)).ok).toBe(false);
  });
});

describe("QR kodu", () => {
  it("tam olarak paylaşılan bağlantıyı kodlar", async () => {
    const { url } = await signedLinkFor(payloadOf());
    const svg = renderSVG(url);
    const other = renderSVG(`${url}x`);
    expect(svg.startsWith("<svg")).toBe(true);
    // Aynı girdi aynı QR'ı verir, farklı girdi farklı QR verir.
    expect(renderSVG(url)).toBe(svg);
    expect(other).not.toBe(svg);
  });
});
