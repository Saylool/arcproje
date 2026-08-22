import { describe, expect, it } from "vitest";

import {
  createPaymentRequestPayload,
  type PaymentRequestPayload,
  type SignedPaymentRequest,
} from "./payment-request";
import {
  MAX_ENCODED_REQUEST_LENGTH,
  PAY_ROUTE,
  buildShareUrl,
  decodeSignedRequest,
  describeCodecProblem,
  encodeSignedRequest,
} from "./request-codec";

const RECIPIENT = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const DEBTOR = "0x0000000000000000000000000000000000000aBc";
const NOW = 1_700_000_000_000;
const SIGNATURE = `0x${"ab".repeat(65)}`;

function payloadOf(over: Partial<PaymentRequestPayload> = {}): PaymentRequestPayload {
  const created = createPaymentRequestPayload({
    recipient: RECIPIENT,
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
    throw new Error("payload üretilemedi");
  }
  return { ...created.payload, ...over };
}

function signedOf(over: Partial<PaymentRequestPayload> = {}): SignedPaymentRequest {
  return { payload: payloadOf(over), signature: SIGNATURE };
}

describe("encode/decode turu", () => {
  it("kodlanan talep aynen geri çözülür", () => {
    const request = signedOf();
    const encoded = encodeSignedRequest(request);
    const decoded = decodeSignedRequest(encoded, NOW);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.request.payload).toEqual(request.payload);
    expect(decoded.request.signature).toBe(SIGNATURE);
  });

  it("base64url alfabesi kullanır (URL güvenli)", () => {
    const encoded = encodeSignedRequest(signedOf());
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain("=");
  });

  it("çözülen gövde değiştirilemez", () => {
    const decoded = decodeSignedRequest(encodeSignedRequest(signedOf()), NOW);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(Object.isFrozen(decoded.request)).toBe(true);
    expect(Object.isFrozen(decoded.request.payload)).toBe(true);
  });
});

describe("bozuk ve aşırı büyük girdi", () => {
  it("boş ve dize olmayan girdiyi reddeder", () => {
    expect(decodeSignedRequest("", NOW)).toEqual({
      ok: false,
      problem: "malformedEncoding",
    });
    expect(decodeSignedRequest(null as unknown as string, NOW).ok).toBe(false);
  });

  it("çözmeden önce uzunluğu sınırlar", () => {
    const long = "A".repeat(MAX_ENCODED_REQUEST_LENGTH + 1);
    expect(decodeSignedRequest(long, NOW)).toEqual({ ok: false, problem: "tooLong" });
  });

  it("base64url olmayan karakterleri reddeder", () => {
    expect(decodeSignedRequest("abc!def", NOW)).toEqual({
      ok: false,
      problem: "malformedEncoding",
    });
    expect(decodeSignedRequest("a+b/c=", NOW)).toEqual({
      ok: false,
      problem: "malformedEncoding",
    });
  });

  it("geçerli base64url ama JSON olmayan içeriği reddeder", () => {
    const encoded = Buffer.from("merhaba dunya")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeSignedRequest(encoded, NOW)).toEqual({
      ok: false,
      problem: "malformedJson",
    });
  });

  const encodeRaw = (value: string) =>
    Buffer.from(value, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  it("dizi veya yanlış zarf yapısını reddeder", () => {
    expect(decodeSignedRequest(encodeRaw("[1,2,3]"), NOW)).toEqual({
      ok: false,
      problem: "invalidEnvelope",
    });
    expect(decodeSignedRequest(encodeRaw('{"payload":{}}'), NOW)).toEqual({
      ok: false,
      problem: "invalidEnvelope",
    });
    expect(
      decodeSignedRequest(
        encodeRaw('{"payload":{},"signature":"0x","extra":1}'),
        NOW,
      ),
    ).toEqual({ ok: false, problem: "invalidEnvelope" });
  });

  it("yinelenen zarf anahtarını reddeder", () => {
    const raw = `{"payload":${JSON.stringify(payloadOf())},"signature":"${SIGNATURE}","signature":"${SIGNATURE}"}`;
    expect(decodeSignedRequest(encodeRaw(raw), NOW)).toEqual({
      ok: false,
      problem: "duplicateKey",
    });
  });

  it("bozuk imza biçimini reddeder", () => {
    const raw = `{"payload":${JSON.stringify(payloadOf())},"signature":"0xdeadbeef"}`;
    expect(decodeSignedRequest(encodeRaw(raw), NOW)).toEqual({
      ok: false,
      problem: "invalidSignatureFormat",
    });
  });
});

describe("kurcalanmış talepler şema düzeyinde reddedilir", () => {
  const cases: { ad: string; over: Partial<PaymentRequestPayload>; problem: string }[] =
    [
      { ad: "alıcı", over: { recipient: "0x1" }, problem: "invalidRecipient" },
      { ad: "borçlu", over: { debtor: "0x2" }, problem: "invalidDebtor" },
      { ad: "zincir", over: { chainId: 1 }, problem: "invalidChainId" },
      { ad: "şema sürümü", over: { schemaVersion: 99 }, problem: "unsupportedSchemaVersion" },
      { ad: "tutar", over: { microUsdc: "0" }, problem: "invalidAmount" },
      { ad: "kur", over: { rateDenominator: "0" }, problem: "invalidRate" },
    ];

  for (const { ad, over, problem } of cases) {
    it(`${ad} kurcalanmışsa reddeder`, () => {
      const encoded = encodeSignedRequest(signedOf(over));
      expect(decodeSignedRequest(encoded, NOW)).toEqual({ ok: false, problem });
    });
  }

  it("süresi dolmuş talebi reddeder", () => {
    const request = signedOf();
    const encoded = encodeSignedRequest(request);
    const sonra = (request.payload.expiresAt + 1) * 1000;
    expect(decodeSignedRequest(encoded, sonra)).toEqual({
      ok: false,
      problem: "expired",
    });
  });

  it("her sorun için Türkçe mesaj üretir", () => {
    for (const problem of [
      "tooLong",
      "malformedEncoding",
      "malformedJson",
      "duplicateKey",
      "invalidEnvelope",
      "expired",
    ] as const) {
      expect(describeCodecProblem(problem).length).toBeGreaterThan(0);
    }
  });
});

describe("buildShareUrl", () => {
  it("bağlantıyı /pay rotasıyla kurar", () => {
    const encoded = encodeSignedRequest(signedOf());
    const url = buildShareUrl("https://ornek.test", encoded);
    expect(url).toBe(`https://ornek.test${PAY_ROUTE}?request=${encoded}`);
  });

  it("sondaki eğik çizgiyi tekrarlamaz", () => {
    const url = buildShareUrl("https://ornek.test/", "abc");
    expect(url).toBe(`https://ornek.test${PAY_ROUTE}?request=abc`);
  });

  it("üretilen bağlantı tekrar çözülebilir", () => {
    const encoded = encodeSignedRequest(signedOf());
    const url = buildShareUrl("http://localhost:3000", encoded);
    const param = new URL(url).searchParams.get("request");
    expect(param).toBe(encoded);
    expect(decodeSignedRequest(param ?? "", NOW).ok).toBe(true);
  });
});
