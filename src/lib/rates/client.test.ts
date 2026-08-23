import { describe, expect, it, vi } from "vitest";

import { fetchQuoteFromServer, verifyQuoteWithServer } from "./client";
import { buildTestQuote } from "./quote-fixture";

const NOW = 1_700_000_000_000;
const SIGNED = buildTestQuote({ nowMs: NOW, wholeRate: 42 });

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchQuoteFromServer", () => {
  it("geçerli teklifi alır", async () => {
    const result = await fetchQuoteFromServer(
      NOW,
      (async () => jsonResponse({ quote: SIGNED.quote, tag: SIGNED.tag })) as never,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signed.tag).toBe(SIGNED.tag);
  });

  it("sunucudan gelse bile teklifi YERELDE doğrular", async () => {
    // Sunucu bozuk/geçersiz bir teklif dönerse istemci körü körüne kabul etmez.
    const result = await fetchQuoteFromServer(
      NOW,
      (async () =>
        jsonResponse({
          quote: { ...SIGNED.quote, source: "baska-kaynak" },
          tag: SIGNED.tag,
        })) as never,
    );
    expect(result.ok).toBe(false);
  });

  it("süresi dolmuş teklifi kabul etmez", async () => {
    const later = (SIGNED.quote.expiresAt + 1) * 1000;
    const result = await fetchQuoteFromServer(
      later,
      (async () => jsonResponse({ quote: SIGNED.quote, tag: SIGNED.tag })) as never,
    );
    expect(result.ok).toBe(false);
  });

  it("hata durumunda sunucu mesajını taşır", async () => {
    const result = await fetchQuoteFromServer(
      NOW,
      (async () =>
        jsonResponse({ error: { code: "timeout", message: "Kur zaman aşımı." } }, 504)) as never,
    );
    expect(result).toEqual({ ok: false, message: "Kur zaman aşımı." });
  });

  it("ağ hatasında sessizce başarılı olmaz", async () => {
    const result = await fetchQuoteFromServer(
      NOW,
      (async () => {
        throw new Error("ağ yok");
      }) as never,
    );
    expect(result.ok).toBe(false);
  });

  it("bozuk etiket biçimini reddeder", async () => {
    const result = await fetchQuoteFromServer(
      NOW,
      (async () => jsonResponse({ quote: SIGNED.quote, tag: "0x123" })) as never,
    );
    expect(result.ok).toBe(false);
  });
});

describe("verifyQuoteWithServer", () => {
  it("sunucu geçerli derse başarılıdır", async () => {
    const result = await verifyQuoteWithServer(
      SIGNED.quote,
      SIGNED.tag,
      (async () => jsonResponse({ valid: true })) as never,
    );
    expect(result).toEqual({ ok: true });
  });

  it("valid:false yanıtı başarısızdır", async () => {
    const result = await verifyQuoteWithServer(
      SIGNED.quote,
      SIGNED.tag,
      (async () =>
        jsonResponse({ valid: false, error: { code: "expired", message: "Süre doldu." } })) as never,
    );
    expect(result).toEqual({ ok: false, message: "Süre doldu." });
  });

  it("hatalı HTTP durumunda başarısızdır", async () => {
    const result = await verifyQuoteWithServer(
      SIGNED.quote,
      SIGNED.tag,
      (async () => jsonResponse({ error: { code: "invalidTag", message: "Etiket geçersiz." } }, 400)) as never,
    );
    expect(result).toEqual({ ok: false, message: "Etiket geçersiz." });
  });

  it("ağ hatasında başarısızdır", async () => {
    const result = await verifyQuoteWithServer(
      SIGNED.quote,
      SIGNED.tag,
      (async () => {
        throw new Error("ağ yok");
      }) as never,
    );
    expect(result.ok).toBe(false);
  });

  it("teklifi ve etiketi gövdede gönderir", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ valid: true }));
    await verifyQuoteWithServer(SIGNED.quote, SIGNED.tag, fetchImpl as never);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      quote: SIGNED.quote,
      tag: SIGNED.tag,
    });
  });
});
