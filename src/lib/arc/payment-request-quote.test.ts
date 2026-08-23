import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { convertTryMinorBigIntToMicroUsdc } from "./conversion";
import {
  PAYMENT_REQUEST_SCHEMA_VERSION,
  PAYMENT_REQUEST_TYPES,
  buildTypedData,
  createPaymentRequestPayload,
  extractQuoteFromPayload,
  validatePaymentRequestPayload,
  type PaymentRequestPayload,
} from "./payment-request";
import { decodeSignedRequest, encodeSignedRequest } from "./request-codec";
import { QUOTE_LIFETIME_MS, parseQuoteRate } from "@/lib/rates/quote";
import { verifyRateQuote } from "@/lib/rates/quote-auth";
import { buildTestQuote, TEST_QUOTE_SECRET } from "@/lib/rates/quote-fixture";

/**
 * Kurun uydurulamayacağının kanıtı.
 *
 * Talebi oluşturan kişi kendi cüzdanıyla İSTEDİĞİ alanı imzalayabilir; bu
 * yüzden imza tek başına kurun piyasadan geldiğini göstermez. Kuru sunucunun
 * HMAC etiketi korur ve o etiket kurun kendisini de kapsar.
 */

const NOW = 1_700_000_000_000;
const attacker = privateKeyToAccount(generatePrivateKey());
const debtor = privateKeyToAccount(generatePrivateKey());

/** 1 USDC = 42.123456 TRY */
const QUOTE = buildTestQuote({
  nowMs: NOW,
  rateNumerator: BigInt(42_123_456),
});

function microFor(tryMinor: number, numerator: string, denominator: string): bigint {
  const rate = parseQuoteRate(numerator, denominator);
  if (!rate.ok) throw new Error("kur ayrıştırılamadı");
  const converted = convertTryMinorBigIntToMicroUsdc(BigInt(tryMinor), rate.rate);
  if (!converted.ok) throw new Error("dönüşüm başarısız");
  return converted.microUsdc;
}

function honestPayload(): PaymentRequestPayload {
  const tryMinor = 48750;
  const created = createPaymentRequestPayload({
    recipient: attacker.address,
    debtor: debtor.address,
    debtKey: "b->a",
    tryMinor,
    quote: QUOTE.quote,
    quoteTag: QUOTE.tag,
    microUsdc: microFor(tryMinor, QUOTE.quote.rateNumerator, QUOTE.quote.rateDenominator),
    recipientLabel: "Test Alıcı",
    debtorLabel: "Test Borçlu",
    nowMs: NOW,
    requestId: `0x${"33".repeat(32)}`,
  });
  if (!created.ok) {
    throw new Error(`dürüst talep üretilemedi: ${created.problem}`);
  }
  return created.payload;
}

describe("şema sürümü", () => {
  it("şema 2'dir ve teklif alanlarını taşır", () => {
    const payload = honestPayload();
    expect(payload.schemaVersion).toBe(PAYMENT_REQUEST_SCHEMA_VERSION);
    expect(PAYMENT_REQUEST_SCHEMA_VERSION).toBe(2);
    expect(payload.quoteSource).toBe("coingecko");
    expect(payload.quoteBaseCurrency).toBe("USDC");
    expect(payload.quoteCurrency).toBe("TRY");
    expect(payload.quoteTag).toBe(QUOTE.tag);
  });

  it("tüm teklif alanları EIP-712 tip tanımındadır", () => {
    const names = PAYMENT_REQUEST_TYPES.PaymentRequest.map((f) => f.name);
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
      expect(names, field).toContain(field);
    }
  });

  it("teklif alanları imzalanan mesaja girer", () => {
    const message = buildTypedData(honestPayload()).message as Record<string, unknown>;
    expect(message.quoteTag).toBe(QUOTE.tag);
    expect(message.quoteId).toBe(QUOTE.quote.quoteId);
    expect(message.quoteExpiresAt).toBe(BigInt(QUOTE.quote.expiresAt));
  });
});

describe("kur uydurma engellenir", () => {
  it("kuru değiştirip tutarı yeniden hesaplamak sunucu doğrulamasında düşer", async () => {
    /*
     * Saldırı senaryosu: oluşturucu kuru 42.123456 yerine 10.000000 yazıyor ve
     * microUsdc'yi buna göre YENİDEN HESAPLIYOR; böylece ekonomik tutarlılık
     * kontrolünü geçiyor. Sonra gövdeyi kendi cüzdanıyla kusursuzca imzalıyor.
     */
    const base = honestPayload();
    const fakeNumerator = "10000000";
    const tampered: PaymentRequestPayload = {
      ...base,
      rateNumerator: fakeNumerator,
      microUsdc: microFor(
        Number(base.tryMinor),
        fakeNumerator,
        base.rateDenominator,
      ).toString(),
    };

    // 1) Şema ve ekonomik tutarlılık GEÇER: tutar kurla uyumlu.
    const structural = validatePaymentRequestPayload(tampered, NOW);
    expect(structural.ok).toBe(true);

    // 2) EIP-712 imzası da GEÇERLİ: saldırgan kendi alanlarını imzalıyor.
    const typedData = buildTypedData(tampered);
    const signature = await attacker.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/i);

    // 3) Ama sunucu teklifi doğrulaması DÜŞER: HMAC kurun kendisini kapsıyor.
    const quote = extractQuoteFromPayload(tampered);
    expect(verifyRateQuote(quote, tampered.quoteTag, TEST_QUOTE_SECRET, NOW)).toEqual({
      ok: false,
      problem: "invalidTag",
    });

    // Dürüst talepte aynı doğrulama geçer.
    expect(
      verifyRateQuote(
        extractQuoteFromPayload(base),
        base.quoteTag,
        TEST_QUOTE_SECRET,
        NOW,
      ).ok,
    ).toBe(true);
  });

  it("yalnızca microUsdc'yi değiştirmek ekonomik tutarlılıkta düşer", () => {
    const base = honestPayload();
    const tampered = { ...base, microUsdc: "999999999" };
    expect(validatePaymentRequestPayload(tampered, NOW)).toEqual({
      ok: false,
      problem: "inconsistentAmount",
    });
  });

  it("teklif meta verisinin her alanını kurcalamak sunucu doğrulamasında düşer", () => {
    const base = honestPayload();
    const tamperings: Array<Partial<PaymentRequestPayload>> = [
      { quoteId: `0x${"99".repeat(32)}` },
      { quoteObservedAt: base.quoteObservedAt - 1 },
      { quoteIssuedAt: base.quoteIssuedAt - 1 },
      { quoteExpiresAt: base.quoteExpiresAt - 1 },
      { quoteTag: `0x${"ab".repeat(32)}` },
    ];
    for (const patch of tamperings) {
      const quote = extractQuoteFromPayload({ ...base, ...patch });
      const tag = (patch.quoteTag as string | undefined) ?? base.quoteTag;
      expect(
        verifyRateQuote(quote, tag, TEST_QUOTE_SECRET, NOW).ok,
        JSON.stringify(patch),
      ).toBe(false);
    }
  });
});

describe("talep teklifinden uzun yaşayamaz", () => {
  it("uzun ömür istense bile bitiş teklifin bitişine kırpılır", () => {
    const payload = honestPayload();
    expect(payload.expiresAt).toBeLessThanOrEqual(payload.quoteExpiresAt);
    expect(payload.expiresAt - payload.issuedAt).toBe(QUOTE_LIFETIME_MS / 1000);
  });

  it("teklifin bitişini aşan talep reddedilir", () => {
    /*
     * Talep, teklifden 2 dk sonra üretilmiş gibi kurgulanır ve 4 dk ömür
     * verilir: ömür sınırı (5 dk) aşılmaz ama bitiş teklifin bitişini geçer.
     */
    const base = honestPayload();
    const issuedAt = base.quoteIssuedAt + 120;
    const tampered = {
      ...base,
      issuedAt,
      expiresAt: issuedAt + 240,
    };
    expect(tampered.expiresAt).toBeGreaterThan(base.quoteExpiresAt);
    expect(validatePaymentRequestPayload(tampered, (issuedAt + 1) * 1000)).toEqual({
      ok: false,
      problem: "requestOutlivesQuote",
    });
  });

  it("ömür sınırını aşan bitiş ayrı kodla reddedilir", () => {
    const base = honestPayload();
    const tampered = { ...base, expiresAt: base.quoteExpiresAt + 60 };
    expect(validatePaymentRequestPayload(tampered, NOW)).toEqual({
      ok: false,
      problem: "lifetimeTooLong",
    });
  });

  it("teklif ömrü sınırı aşılamaz", () => {
    const base = honestPayload();
    const tampered = {
      ...base,
      quoteExpiresAt: base.quoteIssuedAt + QUOTE_LIFETIME_MS / 1000 + 60,
    };
    expect(validatePaymentRequestPayload(tampered, NOW)).toEqual({
      ok: false,
      problem: "invalidQuote",
    });
  });
});

describe("altı ondalıklı kur ve yarım yukarı dönüşüm", () => {
  it("altı ondalıklı kur tam kalır", () => {
    const payload = honestPayload();
    expect(payload.rateNumerator).toBe("42123456");
    expect(payload.rateDenominator).toBe("1000000");
    // 48750 kuruş / 42.123456 -> tam BigInt yarım yukarı
    const expected = microFor(48750, "42123456", "1000000");
    expect(payload.microUsdc).toBe(expected.toString());
  });

  it("bir mikro USDC sapma reddedilir", () => {
    const base = honestPayload();
    for (const delta of [BigInt(1), BigInt(-1)]) {
      const tampered = {
        ...base,
        microUsdc: (BigInt(base.microUsdc) + delta).toString(),
      };
      expect(validatePaymentRequestPayload(tampered, NOW)).toEqual({
        ok: false,
        problem: "inconsistentAmount",
      });
    }
  });
});

describe("kodlama ve yinelenen anahtar", () => {
  it("teklif alanlı zarf çözülmeye devam eder", () => {
    const request = { payload: honestPayload(), signature: `0x${"ab".repeat(65)}` };
    const decoded = decodeSignedRequest(encodeSignedRequest(request), NOW);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.request.payload.quoteTag).toBe(QUOTE.tag);
  });

  it("yinelenen teklif alanı reddedilir", () => {
    const payload = honestPayload();
    const payloadJson = JSON.stringify(payload);
    const duplicated = `{"quoteTag":"0x${"11".repeat(32)}",${payloadJson.slice(1)}`;
    const json = `{"payload":${duplicated},"signature":"0x${"ab".repeat(65)}"}`;
    const encoded = Buffer.from(json, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeSignedRequest(encoded, NOW)).toEqual({
      ok: false,
      problem: "duplicateKey",
    });
  });
});
