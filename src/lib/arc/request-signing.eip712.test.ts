import { hashTypedData, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { convertTryMinorBigIntToMicroUsdc } from "./conversion";
import {
  PAYMENT_REQUEST_TYPES,
  buildTypedData,
  createPaymentRequestPayload,
  type PaymentRequestPayload,
} from "./payment-request";
import { parseQuoteRate } from "@/lib/rates/quote";
import { buildTestQuote } from "@/lib/rates/quote-fixture";

/**
 * Cüzdana GİDEN JSON'un eksiksizliği.
 *
 * `buildTypedData`'yı tek başına test etmek yetmez: cüzdana gönderilen mesaj
 * ayrı bir yoldan üretiliyorsa şema büyüdüğünde sessizce eksik kalabilir ve
 * cüzdanın imzaladığı özet, doğrulanan özetten ayrışır. Bu test, sağlayıcıya
 * geçilen İKİNCİ parametreyi yakalayıp çözümler.
 */

let capturedTypedDataJson: string | null = null;
let signResponse: unknown = null;

const providerRequest = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
  if (method === "eth_accounts") return [signer.address];
  if (method === "eth_chainId") return "0x4cef52";
  if (method === "eth_signTypedData_v4") {
    capturedTypedDataJson = (params?.[1] as string) ?? null;
    return signResponse;
  }
  throw new Error("desteklenmeyen metot");
});

vi.mock("./wallet", () => ({
  withProvider: async (_uuid: string, run: (p: unknown) => Promise<unknown>) => {
    try {
      return { ok: true, value: await run({ request: providerRequest }) };
    } catch {
      return { ok: false, code: "requestFailed" };
    }
  },
}));

const { signPaymentRequest } = await import("./request-signing");

const NOW = 1_700_000_000_000;
const at = (ms: number) => () => ms;
const signer = privateKeyToAccount(generatePrivateKey());
const debtor = privateKeyToAccount(generatePrivateKey());
const QUOTE = buildTestQuote({ nowMs: NOW, rateNumerator: BigInt(42_123_456) });

function payloadOf(): PaymentRequestPayload {
  const rate = parseQuoteRate(QUOTE.quote.rateNumerator, QUOTE.quote.rateDenominator);
  if (!rate.ok) throw new Error("kur");
  const micro = convertTryMinorBigIntToMicroUsdc(BigInt(48750), rate.rate);
  if (!micro.ok) throw new Error("dönüşüm");

  const created = createPaymentRequestPayload({
    recipient: signer.address,
    debtor: debtor.address,
    debtKey: "b->a",
    tryMinor: 48750,
    quote: QUOTE.quote,
    quoteTag: QUOTE.tag,
    microUsdc: micro.microUsdc,
    recipientLabel: "Test Alıcı",
    debtorLabel: "Test Borçlu",
    nowMs: NOW,
    requestId: `0x${"33".repeat(32)}`,
  });
  if (!created.ok) throw new Error(created.problem);
  return created.payload;
}

/** Yakalanan JSON mesajını EIP-712 tiplerine göre geri çevirir. */
function messageFromJson(message: Record<string, unknown>) {
  const restored: Record<string, unknown> = {};
  for (const field of PAYMENT_REQUEST_TYPES.PaymentRequest) {
    const value = message[field.name];
    restored[field.name] = field.type.startsWith("uint")
      ? BigInt(value as string | number)
      : value;
  }
  return restored;
}

beforeEach(() => {
  capturedTypedDataJson = null;
  providerRequest.mockClear();
});

describe("eth_signTypedData_v4'e giden JSON", () => {
  it("PaymentRequest alanlarının TAMAMINI içerir; eksik veya fazla alan yoktur", async () => {
    const payload = payloadOf();
    const typedData = buildTypedData(payload);
    signResponse = await signer.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    const result = await signPaymentRequest("w", payload, at(NOW));
    expect(result.ok).toBe(true);
    expect(capturedTypedDataJson).not.toBeNull();

    const sent = JSON.parse(capturedTypedDataJson as string) as {
      domain: Record<string, unknown>;
      types: Record<string, { name: string; type: string }[]>;
      primaryType: string;
      message: Record<string, unknown>;
    };

    const expected = PAYMENT_REQUEST_TYPES.PaymentRequest.map((f) => f.name).sort();
    const actual = Object.keys(sent.message).sort();
    expect(actual).toEqual(expected);

    // Şema 2'nin teklif alanları tek tek aranır.
    for (const field of [
      "quoteVersion",
      "quoteId",
      "quoteBaseCurrency",
      "quoteCurrency",
      "quoteSource",
      "quoteObservedAt",
      "quoteIssuedAt",
      "quoteExpiresAt",
      "quoteTag",
    ]) {
      expect(sent.message, field).toHaveProperty(field);
    }
  });

  it("EIP712Domain doğru serileştirilir ve tip tanımı buildTypedData ile aynıdır", async () => {
    const payload = payloadOf();
    const typedData = buildTypedData(payload);
    signResponse = await signer.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    await signPaymentRequest("w", payload, at(NOW));

    const sent = JSON.parse(capturedTypedDataJson as string);
    expect(sent.primaryType).toBe("PaymentRequest");
    expect(sent.types.EIP712Domain).toEqual([
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
    ]);
    expect(sent.types.PaymentRequest).toEqual(
      PAYMENT_REQUEST_TYPES.PaymentRequest.map((f) => ({
        name: f.name,
        type: f.type,
      })),
    );
    expect(sent.domain.name).toBe(typedData.domain.name);
    expect(sent.domain.version).toBe(typedData.domain.version);
    expect(String(sent.domain.chainId)).toBe(String(typedData.domain.chainId));
  });

  it("cüzdana giden mesajın ÖZETİ buildTypedData ile birebir aynıdır", async () => {
    const payload = payloadOf();
    const typedData = buildTypedData(payload);
    signResponse = await signer.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    await signPaymentRequest("w", payload, at(NOW));

    const sent = JSON.parse(capturedTypedDataJson as string);
    const rebuiltHash = hashTypedData({
      domain: typedData.domain,
      types: PAYMENT_REQUEST_TYPES,
      primaryType: "PaymentRequest",
      message: messageFromJson(sent.message) as never,
    });
    const referenceHash = hashTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    expect(rebuiltHash).toBe(referenceHash);
  });

  it("yakalanan mesajdan imzalayan geri kurtarılabilir", async () => {
    const payload = payloadOf();
    const typedData = buildTypedData(payload);
    const signature = await signer.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    signResponse = signature;
    await signPaymentRequest("w", payload, at(NOW));

    const sent = JSON.parse(capturedTypedDataJson as string);
    const recovered = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: PAYMENT_REQUEST_TYPES,
      primaryType: "PaymentRequest",
      message: messageFromJson(sent.message) as never,
      signature: signature as `0x${string}`,
    });
    expect(recovered.toLowerCase()).toBe(signer.address.toLowerCase());
  });

  it("BigInt alanlar ondalık metne çevrilir, metin ve bayt alanları bozulmaz", async () => {
    const payload = payloadOf();
    const typedData = buildTypedData(payload);
    signResponse = await signer.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    await signPaymentRequest("w", payload, at(NOW));

    const sent = JSON.parse(capturedTypedDataJson as string);
    expect(sent.message.tryMinor).toBe("48750");
    expect(sent.message.quoteExpiresAt).toBe(String(payload.quoteExpiresAt));
    expect(sent.message.recipient).toBe(payload.recipient);
    expect(sent.message.quoteTag).toBe(payload.quoteTag);
    expect(sent.message.recipientLabel).toBe("Test Alıcı");
    expect(sent.message.quoteSource).toBe("coingecko");
  });
});
