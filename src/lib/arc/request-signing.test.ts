import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTypedData,
  createPaymentRequestPayload,
  type PaymentRequestPayload,
} from "./payment-request";

/**
 * İmza turu gerçek kriptografiyle test edilir. Kullanılan anahtar test
 * çalışırken bellekte üretilir; hiçbir yere yazılmaz, loglanmaz ve depoya
 * girmez. Gerçek bir cüzdan veya kullanıcı anahtarı kullanılmaz.
 */

type RequestArgs = { method: string; params?: unknown[] | object };

let accountsResponse: unknown = [];
let chainResponse: unknown = "0x4cef52";
let signResponse: unknown = null;
let signShouldReject = false;

const provider = {
  request: async ({ method }: RequestArgs) => {
    if (method === "eth_accounts") return accountsResponse;
    if (method === "eth_chainId") return chainResponse;
    if (method === "eth_signTypedData_v4") {
      if (signShouldReject) {
        throw Object.assign(new Error("user rejected"), { code: 4001 });
      }
      return signResponse;
    }
    throw new Error("desteklenmeyen metot");
  },
};

vi.mock("./wallet", () => ({
  withProvider: async (
    _uuid: string,
    run: (p: typeof provider) => Promise<unknown>,
  ) => {
    try {
      return { ok: true, value: await run(provider) };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error &&
        (error as { code: unknown }).code === 4001
          ? "rejected"
          : "requestFailed";
      return { ok: false, code };
    }
  },
}));

const { signPaymentRequest, verifyPaymentRequestSignature } = await import(
  "./request-signing"
);

const DEBTOR = "0x0000000000000000000000000000000000000aBc";
const NOW = 1_700_000_000_000;

/** Test süresince bellekte kalan geçici imzalayan. */
const signerAccount = privateKeyToAccount(generatePrivateKey());
const otherAccount = privateKeyToAccount(generatePrivateKey());

function payloadFor(
  recipient: string,
  over: Partial<PaymentRequestPayload> = {},
): PaymentRequestPayload {
  const created = createPaymentRequestPayload({
    recipient,
    debtor: DEBTOR,
    debtKey: "b->a",
    tryMinor: 20000,
    rateNumerator: BigInt(40),
    rateDenominator: BigInt(1),
    microUsdc: BigInt(5_000_000),
    recipientLabel: "Sen",
    debtorLabel: "Ayşe",
    nowMs: NOW,
    requestId: `0x${"11".repeat(32)}`,
  });
  if (!created.ok) {
    throw new Error(`payload üretilemedi: ${created.problem}`);
  }
  return { ...created.payload, ...over };
}

async function signWith(
  account: typeof signerAccount,
  payload: PaymentRequestPayload,
): Promise<string> {
  const typedData = buildTypedData(payload);
  return account.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
}

beforeEach(() => {
  accountsResponse = [signerAccount.address];
  chainResponse = "0x4cef52";
  signShouldReject = false;
  signResponse = null;
});

describe("verifyPaymentRequestSignature", () => {
  it("alıcının kendi imzasını doğrular", async () => {
    const payload = payloadFor(signerAccount.address);
    const signature = await signWith(signerAccount, payload);
    const result = await verifyPaymentRequestSignature({ payload, signature });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.signer.toLowerCase()).toBe(
        signerAccount.address.toLowerCase(),
      );
    }
  });

  it("imzalayan alıcı değilse reddeder", async () => {
    const payload = payloadFor(signerAccount.address);
    const signature = await signWith(otherAccount, payload);
    expect(await verifyPaymentRequestSignature({ payload, signature })).toEqual({
      ok: false,
      reason: "signerMismatch",
    });
  });

  it("bozuk imza biçimini reddeder", async () => {
    const payload = payloadFor(signerAccount.address);
    expect(
      await verifyPaymentRequestSignature({ payload, signature: "0xdeadbeef" }),
    ).toEqual({ ok: false, reason: "format" });
  });

  const tamperCases: { ad: string; over: Partial<PaymentRequestPayload> }[] = [
    { ad: "alıcı", over: { recipient: otherAccount.address } },
    { ad: "borçlu", over: { debtor: "0x1111111111111111111111111111111111111111" } },
    { ad: "TRY tutarı", over: { tryMinor: "20001" } },
    { ad: "USDC tutarı", over: { microUsdc: "5000001" } },
    { ad: "kur payı", over: { rateNumerator: "41" } },
    { ad: "kur paydası", over: { rateDenominator: "2" } },
    { ad: "zincir", over: { chainId: 1 } },
    { ad: "son kullanma", over: { expiresAt: 2_000_000_000 } },
    { ad: "borç kimliği", over: { debtKey: "c->a" } },
    { ad: "talep kimliği", over: { requestId: `0x${"22".repeat(32)}` } },
    { ad: "alıcı etiketi", over: { recipientLabel: "Başkası" } },
  ];

  for (const { ad, over } of tamperCases) {
    it(`${ad} kurcalanmışsa imza tutmaz`, async () => {
      const original = payloadFor(signerAccount.address);
      const signature = await signWith(signerAccount, original);
      const tampered = { ...original, ...over };
      const result = await verifyPaymentRequestSignature({
        payload: tampered,
        signature,
      });
      expect(result.ok).toBe(false);
    });
  }
});

describe("signPaymentRequest — imza öncesi preflight", () => {
  it("hesap alıcıyla eşleşmiyorsa imzalamaz", async () => {
    accountsResponse = [otherAccount.address];
    const result = await signPaymentRequest(
      "w",
      payloadFor(signerAccount.address),
    );
    expect(result).toEqual({ ok: false, code: "accountChanged" });
  });

  it("hesap yoksa imzalamaz", async () => {
    accountsResponse = [];
    const result = await signPaymentRequest(
      "w",
      payloadFor(signerAccount.address),
    );
    expect(result).toEqual({ ok: false, code: "noAccount" });
  });

  it("ağ Arc Testnet değilse imzalamaz", async () => {
    chainResponse = "0x1";
    const result = await signPaymentRequest(
      "w",
      payloadFor(signerAccount.address),
    );
    expect(result).toEqual({ ok: false, code: "networkChanged" });
  });

  it("bozuk zincir cevabını yanlış ağ sayar", async () => {
    chainResponse = "0x4cef52junk";
    const result = await signPaymentRequest(
      "w",
      payloadFor(signerAccount.address),
    );
    expect(result).toEqual({ ok: false, code: "networkChanged" });
  });

  it("geçersiz alıcı adresini imzalamaz", async () => {
    const payload = payloadFor(signerAccount.address, { recipient: "0x1" });
    const result = await signPaymentRequest("w", payload);
    expect(result).toEqual({ ok: false, code: "invalidRecipient" });
  });

  it("kullanıcı reddederse hata döner", async () => {
    signShouldReject = true;
    const result = await signPaymentRequest(
      "w",
      payloadFor(signerAccount.address),
    );
    expect(result).toEqual({ ok: false, code: "rejected" });
  });

  it("cüzdan bozuk imza döndürürse talep üretilmez", async () => {
    signResponse = "0xdeadbeef";
    const result = await signPaymentRequest(
      "w",
      payloadFor(signerAccount.address),
    );
    expect(result).toEqual({ ok: false, code: "signatureFormat" });
  });

  it("imza başka bir hesaptan geldiyse talep üretilmez", async () => {
    const payload = payloadFor(signerAccount.address);
    signResponse = await signWith(otherAccount, payload);
    const result = await signPaymentRequest("w", payload);
    expect(result).toEqual({ ok: false, code: "signerMismatch" });
  });

  it("geçerli akışta imzalı talep üretir", async () => {
    const payload = payloadFor(signerAccount.address);
    signResponse = await signWith(signerAccount, payload);
    const result = await signPaymentRequest("w", payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.payload).toBe(payload);
    expect(result.request.signature).toBe(signResponse);
    expect(Object.isFrozen(result.request)).toBe(true);
    // Üretilen talep bağımsız olarak da doğrulanabilir.
    expect((await verifyPaymentRequestSignature(result.request)).ok).toBe(true);
  });
});
