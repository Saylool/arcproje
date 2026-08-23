import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";

import { ACTIVE_NETWORK_PROFILE } from "./profile";
import {
  MAX_DEBT_KEY_LENGTH,
  MAX_LABEL_LENGTH,
  PAYMENT_REQUEST_SCHEMA_VERSION,
  REQUEST_MAX_LIFETIME_MS,
  buildTypedData,
  createPaymentRequestPayload,
  createRequestId,
  describePaymentRequestProblem,
  isValidSignatureFormat,
  validatePaymentRequestPayload,
  type PaymentRequestPayload,
} from "./payment-request";

import { buildTestQuote } from "@/lib/rates/quote-fixture";

const RECIPIENT = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const DEBTOR = "0x0000000000000000000000000000000000000aBc";
const NOW = 1_700_000_000_000;
const REQUEST_ID = `0x${"11".repeat(32)}`;

/** Sunucu kimliklendirmeli teklifler; kur artık elle verilmiyor. */
const RATE_40 = buildTestQuote({ nowMs: NOW, wholeRate: 40 });
const RATE_1 = buildTestQuote({ nowMs: NOW, wholeRate: 1 });

/** 20000 kuruş, 1 USDC = 40 TRY -> tam olarak 5.000.000 mikro USDC. */
const baseInput = {
  recipient: RECIPIENT,
  debtor: DEBTOR,
  debtKey: "b->a",
  tryMinor: 20000,
  quote: RATE_40.quote,
  quoteTag: RATE_40.tag,
  microUsdc: BigInt(5_000_000),
  recipientLabel: "Sen",
  debtorLabel: "Ayşe",
  nowMs: NOW,
  requestId: REQUEST_ID,
};

function payloadOf(over: Partial<PaymentRequestPayload> = {}): PaymentRequestPayload {
  const created = createPaymentRequestPayload(baseInput);
  if (!created.ok) {
    throw new Error(`payload üretilemedi: ${created.problem}`);
  }
  return { ...created.payload, ...over };
}

describe("createPaymentRequestPayload", () => {
  it("adresleri normalize eder ve zinciri profilden alır", () => {
    const payload = payloadOf();
    expect(payload.recipient).toBe(RECIPIENT);
    expect(payload.debtor).toBe("0x0000000000000000000000000000000000000aBc");
    expect(payload.chainId).toBe(ACTIVE_NETWORK_PROFILE.chainId);
    expect(payload.schemaVersion).toBe(PAYMENT_REQUEST_SCHEMA_VERSION);
  });

  it("tam sayıları ondalık metin olarak taşır", () => {
    const payload = payloadOf();
    expect(payload.tryMinor).toBe("20000");
    expect(payload.microUsdc).toBe("5000000");
    // Kur kanonik altı ondalıktır: 40.000000 -> 40000000 / 1000000
    expect(payload.rateNumerator).toBe("40000000");
    expect(payload.rateDenominator).toBe("1000000");
    // JSON'a BigInt yazılmadığı kanıtlanır.
    expect(() => JSON.stringify(payload)).not.toThrow();
  });

  it("varsayılan olarak 7 günlük geçerlilik verir", () => {
    const payload = payloadOf();
    // Talep, dayandığı teklifin ömrünü aşamaz: 5 dakika.
    expect(payload.expiresAt - payload.issuedAt).toBe(5 * 60);
  });

  it("kendine transferi reddeder", () => {
    const result = createPaymentRequestPayload({
      recipient: RECIPIENT,
      debtor: RECIPIENT.toLowerCase(),
      debtKey: "b->a",
      tryMinor: 1,
      quote: RATE_1.quote,
      quoteTag: RATE_1.tag,
      microUsdc: BigInt(1),
      recipientLabel: "Sen",
      debtorLabel: "Ayşe",
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, problem: "selfTransfer" });
  });

  it("geçersiz adres, tutar ve kuru reddeder", () => {
    const base = {
      recipient: RECIPIENT,
      debtor: DEBTOR,
      debtKey: "b->a",
      tryMinor: 100,
      quote: RATE_1.quote,
      quoteTag: RATE_1.tag,
      microUsdc: BigInt(1),
      recipientLabel: "Sen",
      debtorLabel: "Ayşe",
      nowMs: NOW,
    };
    expect(createPaymentRequestPayload({ ...base, recipient: "0x1" }).ok).toBe(false);
    expect(createPaymentRequestPayload({ ...base, debtor: "yok" }).ok).toBe(false);
    expect(createPaymentRequestPayload({ ...base, tryMinor: 0 }).ok).toBe(false);
    expect(createPaymentRequestPayload({ ...base, microUsdc: BigInt(0) }).ok).toBe(false);
    // Kur artık girdi değil; kurcalanmış bir teklif reddedilmeli.
    expect(
      createPaymentRequestPayload({
        ...base,
        quote: { ...RATE_1.quote, rateNumerator: "0" },
      }).ok,
    ).toBe(false);
  });

  it("çok uzun etiket ve borç kimliğini reddeder", () => {
    const base = {
      recipient: RECIPIENT,
      debtor: DEBTOR,
      debtKey: "b->a",
      tryMinor: 100,
      quote: RATE_1.quote,
      quoteTag: RATE_1.tag,
      microUsdc: BigInt(1),
      recipientLabel: "Sen",
      debtorLabel: "Ayşe",
      nowMs: NOW,
    };
    expect(
      createPaymentRequestPayload({
        ...base,
        recipientLabel: "a".repeat(MAX_LABEL_LENGTH + 1),
      }),
    ).toEqual({ ok: false, problem: "invalidLabel" });
    expect(
      createPaymentRequestPayload({
        ...base,
        debtKey: "a".repeat(MAX_DEBT_KEY_LENGTH + 1),
      }),
    ).toEqual({ ok: false, problem: "invalidDebtKey" });
  });

  it("kontrol karakteri içeren etiketi reddeder", () => {
    const result = createPaymentRequestPayload({
      recipient: RECIPIENT,
      debtor: DEBTOR,
      debtKey: "b->a",
      tryMinor: 100,
      quote: RATE_1.quote,
      quoteTag: RATE_1.tag,
      microUsdc: BigInt(1),
      recipientLabel: `Sen${String.fromCharCode(0)}`,
      debtorLabel: "Ayşe",
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, problem: "invalidLabel" });
  });

  it("izin verilenden uzun ömrü reddeder", () => {
    const result = createPaymentRequestPayload({
      recipient: RECIPIENT,
      debtor: DEBTOR,
      debtKey: "b->a",
      tryMinor: 100,
      quote: RATE_1.quote,
      quoteTag: RATE_1.tag,
      microUsdc: BigInt(1),
      recipientLabel: "Sen",
      debtorLabel: "Ayşe",
      nowMs: NOW,
      lifetimeMs: REQUEST_MAX_LIFETIME_MS + 1000,
    });
    expect(result).toEqual({ ok: false, problem: "lifetimeTooLong" });
  });
});

describe("createRequestId", () => {
  it("0x + 64 hex üretir ve tekrarlamaz", () => {
    const ids = new Set(Array.from({ length: 200 }, () => createRequestId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});

describe("buildTypedData", () => {
  it("aynı gövde için deterministik hash üretir", () => {
    const payload = payloadOf();
    const first = hashTypedData(buildTypedData(payload));
    const second = hashTypedData(buildTypedData({ ...payload }));
    expect(first).toBe(second);
  });

  it("alan sırasından değil değerlerden etkilenir", () => {
    const payload = payloadOf();
    // Anahtar sırası farklı ama değerler aynı: hash aynı kalmalı.
    const reordered = Object.fromEntries(
      Object.entries(payload).reverse(),
    ) as unknown as PaymentRequestPayload;
    expect(hashTypedData(buildTypedData(reordered))).toBe(
      hashTypedData(buildTypedData(payload)),
    );
  });

  it("her alan değişikliği hash'i değiştirir", () => {
    const payload = payloadOf();
    const base = hashTypedData(buildTypedData(payload));
    const variants: PaymentRequestPayload[] = [
      { ...payload, recipient: DEBTOR },
      { ...payload, debtor: RECIPIENT },
      { ...payload, tryMinor: "20001" },
      { ...payload, microUsdc: "5000001" },
      { ...payload, rateNumerator: "41" },
      { ...payload, rateDenominator: "2" },
      { ...payload, expiresAt: payload.expiresAt + 1 },
      { ...payload, issuedAt: payload.issuedAt + 1 },
      { ...payload, debtKey: "c->a" },
      { ...payload, recipientLabel: "Başka" },
      { ...payload, debtorLabel: "Başka" },
      { ...payload, requestId: `0x${"22".repeat(32)}` },
    ];
    for (const variant of variants) {
      expect(hashTypedData(buildTypedData(variant))).not.toBe(base);
    }
  });

  it("alan adları ve türleri sabittir", () => {
    const typedData = buildTypedData(payloadOf());
    expect(typedData.primaryType).toBe("PaymentRequest");
    expect(typedData.domain.chainId).toBe(ACTIVE_NETWORK_PROFILE.chainId);
    expect(typedData.types.PaymentRequest.map((f) => f.name)).toEqual([
      "schemaVersion",
      "requestId",
      "chainId",
      "recipient",
      "debtor",
      "debtKey",
      "tryMinor",
      "rateNumerator",
      "rateDenominator",
      "microUsdc",
      "issuedAt",
      "expiresAt",
      "recipientLabel",
      "debtorLabel",
      "quoteVersion",
      "quoteId",
      "quoteBaseCurrency",
      "quoteCurrency",
      "quoteSource",
      "quoteObservedAt",
      "quoteIssuedAt",
      "quoteExpiresAt",
      "quoteTag",
    ]);
  });
});

describe("validatePaymentRequestPayload", () => {
  it("geçerli gövdeyi kabul eder", () => {
    const result = validatePaymentRequestPayload(payloadOf(), NOW);
    expect(result.ok).toBe(true);
  });

  it("nesne olmayan ve dizi gövdeyi reddeder", () => {
    expect(validatePaymentRequestPayload(null, NOW)).toEqual({
      ok: false,
      problem: "notAnObject",
    });
    expect(validatePaymentRequestPayload([payloadOf()], NOW)).toEqual({
      ok: false,
      problem: "notAnObject",
    });
    expect(validatePaymentRequestPayload("metin", NOW)).toEqual({
      ok: false,
      problem: "notAnObject",
    });
  });

  it("fazladan ve eksik alanı reddeder", () => {
    expect(
      validatePaymentRequestPayload({ ...payloadOf(), fazladan: 1 }, NOW),
    ).toEqual({ ok: false, problem: "unexpectedField" });

    const eksik: Record<string, unknown> = { ...payloadOf() };
    delete eksik.microUsdc;
    expect(validatePaymentRequestPayload(eksik, NOW)).toEqual({
      ok: false,
      problem: "missingField",
    });
  });

  it("bilinmeyen şema sürümünü reddeder", () => {
    expect(
      validatePaymentRequestPayload({ ...payloadOf(), schemaVersion: 3 }, NOW),
    ).toEqual({ ok: false, problem: "unsupportedSchemaVersion" });
  });

  it("elle girilen kurlu şema 1 bağlantısını ayrı mesajla reddeder", () => {
    const result = validatePaymentRequestPayload(
      { ...payloadOf(), schemaVersion: 1 },
      NOW,
    );
    expect(result).toEqual({ ok: false, problem: "outdatedSchemaVersion" });
    expect(describePaymentRequestProblem("outdatedSchemaVersion")).toMatch(
      /yeni bir bağlantı iste/,
    );
  });

  it("yanlış zinciri reddeder", () => {
    expect(
      validatePaymentRequestPayload({ ...payloadOf(), chainId: 1 }, NOW),
    ).toEqual({ ok: false, problem: "invalidChainId" });
  });

  it("geçersiz talep kimliğini reddeder", () => {
    for (const bad of ["0x", "0xzz", `0x${"11".repeat(31)}`, 42, null]) {
      expect(
        validatePaymentRequestPayload({ ...payloadOf(), requestId: bad }, NOW).ok,
      ).toBe(false);
    }
  });

  it("geçersiz adresleri ve kendine transferi reddeder", () => {
    expect(
      validatePaymentRequestPayload({ ...payloadOf(), recipient: "0x1" }, NOW),
    ).toEqual({ ok: false, problem: "invalidRecipient" });
    expect(
      validatePaymentRequestPayload({ ...payloadOf(), debtor: "yok" }, NOW),
    ).toEqual({ ok: false, problem: "invalidDebtor" });
    expect(
      validatePaymentRequestPayload(
        { ...payloadOf(), debtor: RECIPIENT.toLowerCase() },
        NOW,
      ),
    ).toEqual({ ok: false, problem: "selfTransfer" });
  });

  it("sayı olarak gelen veya bozuk tutarı reddeder", () => {
    for (const bad of [20000, "020000", "-1", "1e5", "", "1.5", null]) {
      expect(
        validatePaymentRequestPayload({ ...payloadOf(), tryMinor: bad }, NOW).ok,
      ).toBe(false);
    }
    expect(
      validatePaymentRequestPayload({ ...payloadOf(), microUsdc: "0" }, NOW),
    ).toEqual({ ok: false, problem: "invalidAmount" });
  });

  it("bozuk kuru reddeder", () => {
    expect(
      validatePaymentRequestPayload({ ...payloadOf(), rateDenominator: "0" }, NOW),
    ).toEqual({ ok: false, problem: "invalidRate" });
    expect(
      validatePaymentRequestPayload({ ...payloadOf(), rateNumerator: "abc" }, NOW),
    ).toEqual({ ok: false, problem: "invalidRate" });
  });

  it("bozuk zaman damgalarını reddeder", () => {
    const payload = payloadOf();
    expect(
      validatePaymentRequestPayload({ ...payload, expiresAt: payload.issuedAt }, NOW),
    ).toEqual({ ok: false, problem: "invalidTimestamps" });
    expect(
      validatePaymentRequestPayload({ ...payload, issuedAt: 0 }, NOW),
    ).toEqual({ ok: false, problem: "invalidTimestamps" });
    expect(
      validatePaymentRequestPayload({ ...payload, issuedAt: "1700" }, NOW),
    ).toEqual({ ok: false, problem: "invalidTimestamps" });
  });

  it("süresi dolmuş talebi reddeder", () => {
    const payload = payloadOf();
    const sonra = (payload.expiresAt + 1) * 1000;
    expect(validatePaymentRequestPayload(payload, sonra)).toEqual({
      ok: false,
      problem: "expired",
    });
  });

  it("gelecekte başlayan talebi reddeder", () => {
    const payload = payloadOf();
    const cokOnce = (payload.issuedAt - 3600) * 1000;
    expect(validatePaymentRequestPayload(payload, cokOnce)).toEqual({
      ok: false,
      problem: "notYetValid",
    });
  });

  it("küçük saat kaymasını tolere eder", () => {
    const payload = payloadOf();
    const azOnce = (payload.issuedAt - 60) * 1000;
    expect(validatePaymentRequestPayload(payload, azOnce).ok).toBe(true);
  });

  it("aşırı uzun ömrü reddeder", () => {
    const payload = payloadOf();
    const uzun = {
      ...payload,
      expiresAt: payload.issuedAt + Math.floor(REQUEST_MAX_LIFETIME_MS / 1000) + 10,
    };
    expect(validatePaymentRequestPayload(uzun, NOW)).toEqual({
      ok: false,
      problem: "lifetimeTooLong",
    });
  });

  it("her sorun için Türkçe mesaj üretir", () => {
    for (const problem of [
      "notAnObject",
      "unexpectedField",
      "expired",
      "selfTransfer",
      "invalidChainId",
      "invalidSignatureFormat",
    ] as const) {
      expect(describePaymentRequestProblem(problem).length).toBeGreaterThan(0);
    }
  });
});

describe("isValidSignatureFormat", () => {
  it("65 baytlık imzayı kabul eder", () => {
    expect(isValidSignatureFormat(`0x${"ab".repeat(65)}`)).toBe(true);
  });

  it("hatalı uzunluk ve türleri reddeder", () => {
    expect(isValidSignatureFormat(`0x${"ab".repeat(64)}`)).toBe(false);
    expect(isValidSignatureFormat("0x")).toBe(false);
    expect(isValidSignatureFormat(null)).toBe(false);
    expect(isValidSignatureFormat(123)).toBe(false);
  });
});


describe("debtKey de kontrol/biçim karakterlerine karşı korunur", () => {
  const at = (codePoint: number) => String.fromCodePoint(codePoint);

  it("üretilen borç kimliklerini olduğu gibi kabul eder", () => {
    // debtIdentityKey biçimi: "<fromParticipantId>-><toParticipantId>"
    for (const debtKey of [
      "b->a",
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301->9f8b7c6d-1e2f-4a3b-8c9d-0e1f2a3b4c5d",
      "p_lz4k9x_ab12cd34->p_lz4k9y_ef56gh78",
    ]) {
      const created = createPaymentRequestPayload({ ...baseInput, debtKey });
      expect(created.ok, debtKey).toBe(true);
      if (!created.ok) return;
      expect(created.payload.debtKey).toBe(debtKey);
    }
  });

  it("kontrol, biçim ve boşluk hatalarını reddeder", () => {
    for (const debtKey of [
      `b->${at(0x200b)}a`,
      `b->${at(0x202e)}a`,
      `b->a${at(0x0000)}`,
      `b->a${at(0x007f)}`,
      " b->a",
      "b->a ",
      "",
      "   ",
    ]) {
      expect(
        createPaymentRequestPayload({ ...baseInput, debtKey }),
        JSON.stringify(debtKey),
      ).toEqual({ ok: false, problem: "invalidDebtKey" });
    }
  });

  it("sınırı aşan borç kimliğini reddeder", () => {
    expect(
      createPaymentRequestPayload({
        ...baseInput,
        debtKey: "a".repeat(MAX_DEBT_KEY_LENGTH + 1),
      }),
    ).toEqual({ ok: false, problem: "invalidDebtKey" });
  });
});
