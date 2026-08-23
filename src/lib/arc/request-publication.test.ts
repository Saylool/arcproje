import { describe, expect, it, vi } from "vitest";

import { convertTryMinorBigIntToMicroUsdc } from "./conversion";
import { createPaymentRequestPayload } from "./payment-request";
import { ensureSignedRequestPublishable } from "./request-publication";
import { QUOTE_LIFETIME_MS, parseQuoteRate } from "@/lib/rates/quote";
import { buildTestQuote } from "@/lib/rates/quote-fixture";

/**
 * İmza sırasında teklifin süresi dolabilir. Bu kapı, bağlantı üretilmeden önce
 * hem gövdeyi hem teklifi güncel saatle yeniden doğrular.
 */

const NOW = 1_700_000_000_000;
const RECIPIENT = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const DEBTOR = "0x0000000000000000000000000000000000000aBc";
const QUOTE = buildTestQuote({ nowMs: NOW, wholeRate: 42 });

function signedRequest() {
  const rate = parseQuoteRate(QUOTE.quote.rateNumerator, QUOTE.quote.rateDenominator);
  if (!rate.ok) throw new Error("kur");
  const micro = convertTryMinorBigIntToMicroUsdc(BigInt(48750), rate.rate);
  if (!micro.ok) throw new Error("dönüşüm");
  const created = createPaymentRequestPayload({
    recipient: RECIPIENT,
    debtor: DEBTOR,
    debtKey: "b->a",
    tryMinor: 48750,
    quote: QUOTE.quote,
    quoteTag: QUOTE.tag,
    microUsdc: micro.microUsdc,
    recipientLabel: "Test Alıcı",
    debtorLabel: "Test Borçlu",
    nowMs: NOW,
  });
  if (!created.ok) throw new Error(created.problem);
  return { payload: created.payload, signature: `0x${"ab".repeat(65)}` };
}

const acceptQuote = vi.fn(async () => ({ ok: true }) as const);

describe("yayım kapısı", () => {
  it("imza anında geçerli olan talep yayımlanabilir", async () => {
    const result = await ensureSignedRequestPublishable(
      signedRequest(),
      acceptQuote,
      () => NOW,
    );
    expect(result).toEqual({ ok: true });
  });

  it("imza tamamlanırken süresi dolan talep YAYIMLANMAZ", async () => {
    /*
     * İmza NOW'da başlıyor, kullanıcı cüzdanda 6 dakika sonra onaylıyor.
     * Teklif ömrü 5 dakika olduğu için bağlantı üretilmemeli.
     */
    const request = signedRequest();
    const verify = vi.fn(async () => ({ ok: true }) as const);
    const afterExpiry = NOW + QUOTE_LIFETIME_MS + 60_000;

    const result = await ensureSignedRequestPublishable(
      request,
      verify,
      () => afterExpiry,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/Kuru yenileyip talebi yeniden imzala/);
    // Gövde zaten geçersiz: sunucuya gitmeye bile gerek yok.
    expect(verify).not.toHaveBeenCalled();
  });

  it("sunucu teklifi reddederse yayımlanmaz", async () => {
    const result = await ensureSignedRequestPublishable(
      signedRequest(),
      async () => ({ ok: false, message: "Kur teklifi doğrulanamadı." }),
      () => NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("Kur teklifi doğrulanamadı.");
    expect(result.message).toMatch(/Kuru yenileyip talebi yeniden imzala/);
  });

  it("tam bitiş saniyesinde de yayımlanmaz", async () => {
    const request = signedRequest();
    const atExpiry = request.payload.expiresAt * 1000;
    const result = await ensureSignedRequestPublishable(
      request,
      acceptQuote,
      () => atExpiry,
    );
    expect(result.ok).toBe(false);
  });
});

describe("doğrulama SIRASINDA süre dolması", () => {
  it("sunucu doğrulaması dönerken süre dolduysa yayımlanmaz", async () => {
    /*
     * Saat, doğrulamadan ÖNCE geçerli; sunucu yanıtı dönerken bitişi geçiyor.
     * "Doğrulama başladığında geçerliydi" yeterli değildir.
     */
    const request = signedRequest();
    let calls = 0;
    const clock = () => {
      calls += 1;
      // İlk okuma geçerli, ikinci okuma (yanıt sonrası) süre dolmuş.
      return calls === 1 ? NOW : (request.payload.expiresAt + 1) * 1000;
    };
    const verify = vi.fn(async () => ({ ok: true }) as const);

    const result = await ensureSignedRequestPublishable(request, verify, clock);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/Kuru yenileyip talebi yeniden imzala/);
    // Sunucuya gidildi ama bağlantı yine de üretilmedi.
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("tam bitiş saniyesinde ikinci kontrol de reddeder", async () => {
    const request = signedRequest();
    let calls = 0;
    const clock = () => {
      calls += 1;
      return calls === 1 ? NOW : request.payload.expiresAt * 1000;
    };
    const result = await ensureSignedRequestPublishable(
      request,
      async () => ({ ok: true }),
      clock,
    );
    expect(result.ok).toBe(false);
  });

  it("doğrulama boyunca geçerli kalırsa yayımlanır", async () => {
    const request = signedRequest();
    // İki okuma da geçerli aralıkta.
    const result = await ensureSignedRequestPublishable(
      request,
      async () => ({ ok: true }),
      () => NOW + 1000,
    );
    expect(result).toEqual({ ok: true });
  });
});
