import { describe, expect, it } from "vitest";

import {
  QUOTE_FIELD_ORDER,
  QUOTE_LIFETIME_MS,
  serializeQuoteForAuth,
  validateRateQuote,
  type RateQuote,
} from "./quote";
import { buildTestQuote, TEST_QUOTE_SECRET } from "./quote-fixture";
import {
  createQuoteId,
  readQuoteSecret,
  signRateQuote,
  verifyRateQuote,
} from "./quote-auth";

const NOW = 1_700_000_000_000;
const SIGNED = buildTestQuote({ nowMs: NOW, wholeRate: 42 });

describe("kanonik serileştirme", () => {
  it("belirlenimcidir ve alan sırasına bağlıdır", () => {
    const once = serializeQuoteForAuth(SIGNED.quote);
    const again = serializeQuoteForAuth({ ...SIGNED.quote });
    expect(once).toBe(again);
    // Anahtar sırası farklı yazılmış bir nesne aynı metni üretir:
    // serileştirme nesne sırasına DEĞİL, sabit listeye bağlıdır.
    const reordered = Object.fromEntries(
      [...QUOTE_FIELD_ORDER].reverse().map((k) => [k, SIGNED.quote[k]]),
    ) as unknown as RateQuote;
    expect(serializeQuoteForAuth(reordered)).toBe(once);
  });

  it("tüm alanları içerir", () => {
    const text = serializeQuoteForAuth(SIGNED.quote);
    for (const field of QUOTE_FIELD_ORDER) {
      expect(text, field).toContain(String(SIGNED.quote[field]));
    }
  });
});

describe("HMAC üretimi ve doğrulaması", () => {
  it("geçerli etiket doğrulanır", () => {
    const result = verifyRateQuote(SIGNED.quote, SIGNED.tag, TEST_QUOTE_SECRET, NOW);
    expect(result.ok).toBe(true);
  });

  it("etiket 0x + 64 küçük hex biçimindedir", () => {
    expect(SIGNED.tag).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("yanlış sır doğrulamayı düşürür", () => {
    expect(
      verifyRateQuote(SIGNED.quote, SIGNED.tag, "baska-bir-sir-0000000000000000000", NOW),
    ).toEqual({ ok: false, problem: "invalidTag" });
  });

  it("etiketin tek karakteri değişse doğrulama düşer", () => {
    const flipped = SIGNED.tag.endsWith("a")
      ? `${SIGNED.tag.slice(0, -1)}b`
      : `${SIGNED.tag.slice(0, -1)}a`;
    expect(verifyRateQuote(SIGNED.quote, flipped, TEST_QUOTE_SECRET, NOW)).toEqual({
      ok: false,
      problem: "invalidTag",
    });
  });

  it("HER alanın tek tek kurcalanması doğrulamayı düşürür", () => {
    const tampered: Record<string, unknown> = {
      quoteVersion: 2,
      quoteId: `0x${"11".repeat(32)}`,
      baseCurrency: "USDT",
      quoteCurrency: "EUR",
      source: "başka-kaynak",
      rateNumerator: "43000000",
      rateDenominator: "100000",
      observedAt: SIGNED.quote.observedAt - 1,
      issuedAt: SIGNED.quote.issuedAt - 1,
      expiresAt: SIGNED.quote.expiresAt - 1,
    };
    for (const field of QUOTE_FIELD_ORDER) {
      const result = verifyRateQuote(
        { ...SIGNED.quote, [field]: tampered[field] },
        SIGNED.tag,
        TEST_QUOTE_SECRET,
        NOW,
      );
      expect(result.ok, field).toBe(false);
    }
  });

  it("bozuk etiket kodlaması reddedilir", () => {
    for (const bad of [
      "0x",
      SIGNED.tag.slice(0, -1),
      `${SIGNED.tag}00`,
      SIGNED.tag.slice(2),
      SIGNED.tag.toUpperCase(),
      "0xZZ" + "0".repeat(62),
      123,
      null,
    ]) {
      expect(
        verifyRateQuote(SIGNED.quote, bad, TEST_QUOTE_SECRET, NOW).ok,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});

describe("teklif geçerlilik penceresi", () => {
  it("süresi dolmuş teklif reddedilir", () => {
    const after = (SIGNED.quote.expiresAt + 1) * 1000;
    expect(verifyRateQuote(SIGNED.quote, SIGNED.tag, TEST_QUOTE_SECRET, after)).toEqual({
      ok: false,
      problem: "expired",
    });
  });

  it("henüz geçerli olmayan teklif reddedilir", () => {
    const future = buildTestQuote({ nowMs: NOW + 10 * 60 * 1000, wholeRate: 42 });
    const result = verifyRateQuote(future.quote, future.tag, TEST_QUOTE_SECRET, NOW);
    expect(result.ok).toBe(false);
  });

  it("bayat gözlem sessizce kabul edilmez", () => {
    const stale = buildTestQuote({
      nowMs: NOW,
      wholeRate: 42,
      observedAt: Math.floor(NOW / 1000) - 3600,
    });
    expect(verifyRateQuote(stale.quote, stale.tag, TEST_QUOTE_SECRET, NOW)).toEqual({
      ok: false,
      problem: "observationTooOld",
    });
  });

  it("izin verilenden uzun ömür reddedilir", () => {
    const long = buildTestQuote({
      nowMs: NOW,
      wholeRate: 42,
      lifetimeMs: QUOTE_LIFETIME_MS + 60_000,
    });
    expect(verifyRateQuote(long.quote, long.tag, TEST_QUOTE_SECRET, NOW)).toEqual({
      ok: false,
      problem: "lifetimeTooLong",
    });
  });
});

describe("katı şema", () => {
  it("bilinmeyen alan reddedilir", () => {
    expect(
      validateRateQuote({ ...SIGNED.quote, fazladan: 1 }, NOW),
    ).toEqual({ ok: false, problem: "unexpectedField" });
  });

  it("eksik alan reddedilir", () => {
    for (const field of QUOTE_FIELD_ORDER) {
      const partial: Record<string, unknown> = { ...SIGNED.quote };
      delete partial[field];
      expect(validateRateQuote(partial, NOW), field).toEqual({
        ok: false,
        problem: "missingField",
      });
    }
  });

  it("nesne olmayan gövde reddedilir", () => {
    for (const bad of [null, [], "quote", 42]) {
      expect(validateRateQuote(bad, NOW).ok).toBe(false);
    }
  });
});

describe("sır ve kimlik üretimi", () => {
  it("eksik veya kısa sır yapılandırılmamış sayılır", () => {
    expect(readQuoteSecret({})).toEqual({
      ok: false,
      problem: "missing",
    });
    expect(
      readQuoteSecret({ RATE_QUOTE_SECRET: "kisa" }),
    ).toEqual({ ok: false, problem: "tooShort" });
    expect(
      readQuoteSecret({ RATE_QUOTE_SECRET: TEST_QUOTE_SECRET }).ok,
    ).toBe(true);
  });

  it("quoteId kriptografik rastgele ve biçimlidir", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createQuoteId()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("imza sırra bağlıdır", () => {
    const a = signRateQuote(SIGNED.quote, TEST_QUOTE_SECRET);
    const b = signRateQuote(SIGNED.quote, `${TEST_QUOTE_SECRET}x`);
    expect(a).not.toBe(b);
  });
});
