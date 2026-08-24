import { describe, expect, it } from "vitest";

import { QUOTE_MIN_SEND_MARGIN_SECONDS } from "@/lib/rates/quote";

import {
  PAYMENT_BILL_ID,
  PAYMENT_NOW,
  expectedMicroUsdc,
  fakeMint,
  fakeQuote,
  failingMint,
  overrideStoredDebtAmount,
  seedPaidBill,
} from "./shared-bill-payment.fixture";
import { prepareSharedBillPaymentOffer } from "./shared-bill-payment-service";

/**
 * YETKİLİ ÖDEME TEKLİFİ.
 *
 * Hiçbir testte CoinGecko, Neon, Arc RPC ya da cüzdan ÇAĞRILMAZ: kur servisi
 * enjekte edilmiş belirlenimci bir sahtedir ve depo bellek içidir.
 */

const OFFER_ID = `0x${"a1".repeat(32)}`;

async function prepare(
  overrides: Partial<Parameters<typeof prepareSharedBillPaymentOffer>[0]> = {},
  amounts?: readonly string[],
) {
  const seeded = await seedPaidBill(amounts === undefined ? {} : { amounts });
  const result = await prepareSharedBillPaymentOffer({
    sessionToken: seeded.sessionTokens[0],
    pathBillId: PAYMENT_BILL_ID,
    repository: seeded.repository,
    nowMs: PAYMENT_NOW,
    mintQuote: fakeMint(),
    offerId: OFFER_ID,
    ...overrides,
  });
  return { seeded, result };
}

describe("teklif TAM SAYI aritmetiğiyle türetilir", () => {
  it("saklanan borçtan ve sunucu kurundan tutarı hesaplar", async () => {
    const { seeded, result } = await prepare();
    if (!result.ok) throw new Error(`teklif basilamadi: ${result.code}`);

    const debt = seeded.debts[0];
    expect(result.offer.tryMinor).toBe(debt.tryMinor);
    expect(result.offer.microUsdc).toBe(expectedMicroUsdc(debt.tryMinor));
    expect(result.offer.debtor.toLowerCase()).toBe(debt.debtor.toLowerCase());
    expect(result.offer.recipient.toLowerCase()).toBe(
      seeded.recipient.address.toLowerCase(),
    );
  });

  it("MAX_SAFE_INTEGER üstündeki borcu KAYIPSIZ taşır", async () => {
    /*
     * Manifest katmanı tutarları BİLEREK güvenli tam sayı aralığıyla
     * sınırlar ve o sınır bu görevde ZAYIFLATILMADI. Burada ölçülen şey
     * farklı: ÖDEME YOLUNUN KENDİSİ hiçbir aşamada `number`a indirgeme
     * yapmıyor mu? Satır depoya doğrudan yerleştirilir.
     */
    const huge = "9007199254740993";
    const seeded = await seedPaidBill();
    overrideStoredDebtAmount(seeded, seeded.debts[0].debtor, huge);

    const result = await prepareSharedBillPaymentOffer({
      sessionToken: seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: seeded.repository,
      nowMs: PAYMENT_NOW,
      mintQuote: fakeMint(),
      offerId: OFFER_ID,
    });
    if (!result.ok) throw new Error(`teklif basilamadi: ${result.code}`);

    // `number`a indirgeyen bir uygulamada tutar 9007199254740992 olurdu.
    expect(result.offer.tryMinor).toBe(huge);
    expect(result.offer.microUsdc).toBe(expectedMicroUsdc(huge));
    expect(result.offer.microUsdc).not.toBe(
      expectedMicroUsdc("9007199254740992"),
    );
  });

  it("teklif kurdan ve hesaptan UZUN yaşamaz", async () => {
    const { result } = await prepare();
    if (!result.ok) throw new Error("teklif basilamadi");
    const quote = fakeQuote();
    expect(result.offer.expiresAt).toBeLessThanOrEqual(quote.expiresAt);
    expect(result.offer.expiresAt).toBeLessThanOrEqual(
      result.offer.billExpiresAt,
    );
  });

  it("teklif hazırlamak borcu REZERVE ETMEZ", async () => {
    const { seeded, result } = await prepare();
    expect(result.ok).toBe(true);
    const bill = seeded.repository.bills.get(PAYMENT_BILL_ID.toLowerCase());
    expect(bill?.debts[0].paymentStatus).toBe("unpaid");
    expect(seeded.repository.attempts.size).toBe(0);
  });
});

describe("YAVAŞ kur sağlayıcısı teklifi bozmaz", () => {
  /*
   * GERÇEK ARIZA (yerel entegrasyon testinde yakalandı): CoinGecko çağrısı
   * ~0,5-1 sn sürer. Teklifin `issuedAt`i isteğin GİRİŞ anına, kurun
   * `expiresAt`i ise sağlayıcı yanıtının DÖNDÜĞÜ ana çıpalanıyordu. Çağrı bir
   * saniye sınırını geçtiğinde
   *
   *     expires_at = quote.issuedAt + 300 > issued_at + 300
   *
   * olur ve `shared_bill_payment_offers_lifetime_max_5_min` CHECK kısıtı
   * satırı REDDEDER. Sonuç: aralıklı HTTP 500 ("AMOUNT_UNAVAILABLE"), üstelik
   * gerçek nedeni gizleyen yanlış bir mesajla.
   *
   * Teklifin veriliş anı, içindeki kurdan ÖNCE olamaz.
   */
  it("kur istekten SONRA basılmış olsa bile teklif yazılabilir", async () => {
    const seeded = await seedPaidBill();
    const routeNowMs = PAYMENT_NOW;
    // Sağlayıcı 1200 ms sürdü: kur, isteğin girişinden SONRA basıldı.
    const slowQuoteNowMs = PAYMENT_NOW + 1200;

    const result = await prepareSharedBillPaymentOffer({
      sessionToken: seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: seeded.repository,
      nowMs: routeNowMs,
      mintQuote: fakeMint({}, slowQuoteNowMs),
      offerId: OFFER_ID,
    });
    if (!result.ok) {
      throw new Error(`yavas saglayici teklifi bozdu: ${result.code}`);
    }

    // Depodaki satır, veritabanı kısıtlarının HEPSİNİ sağlamalı.
    const stored = seeded.repository.offers.get(OFFER_ID);
    if (stored === undefined) throw new Error("teklif depoda yok");
    expect(stored.expiresAt).toBeGreaterThan(stored.issuedAt);
    expect(stored.expiresAt).toBeLessThanOrEqual(stored.issuedAt + 5 * 60);
    expect(stored.expiresAt).toBeLessThanOrEqual(stored.quoteExpiresAt);
  });
});

describe("teklif FAIL-CLOSED reddedilir", () => {
  it("oturum yoksa hiçbir şey dönmez", async () => {
    const { result } = await prepare({ sessionToken: null });
    if (result.ok) throw new Error("oturumsuz teklif basildi");
    expect(result.status).toBe(401);
  });

  it("oturum başka bir hesaba aitse reddedilir", async () => {
    const { result } = await prepare({ pathBillId: `0x${"11".repeat(32)}` });
    if (result.ok) throw new Error("baska hesabin teklifi basildi");
    expect(result.status).toBe(401);
  });

  it("kur servisi çalışmıyorsa ELLE GİRİLEN KURA DÜŞÜLMEZ", async () => {
    const { seeded, result } = await prepare({ mintQuote: failingMint() });
    if (result.ok) throw new Error("kursuz teklif basildi");
    expect(result.code).toBe("RATE_UNAVAILABLE");
    expect(seeded.repository.offers.size).toBe(0);
  });

  it("süresi dolmuş kur teklifi kabul edilmez", async () => {
    const { result } = await prepare({
      mintQuote: fakeMint({
        issuedAt: Math.floor(PAYMENT_NOW / 1000) - 3600,
        expiresAt: Math.floor(PAYMENT_NOW / 1000) - 3300,
        observedAt: Math.floor(PAYMENT_NOW / 1000) - 3605,
      }),
    });
    if (result.ok) throw new Error("bayat kurla teklif basildi");
    expect(result.code).toBe("RATE_UNAVAILABLE");
  });

  it("gönderim payından kısa ömürlü teklif BASILMAZ", async () => {
    const nowSeconds = Math.floor(PAYMENT_NOW / 1000);
    const { result } = await prepare({
      mintQuote: fakeMint({
        issuedAt: nowSeconds,
        // Paydan bir saniye eksik: cüzdan onayı sırasında süresi dolabilirdi.
        expiresAt: nowSeconds + QUOTE_MIN_SEND_MARGIN_SECONDS - 1,
        observedAt: nowSeconds - 5,
      }),
    });
    if (result.ok) throw new Error("kisa omurlu teklif basildi");
    expect(result.code).toBe("INSUFFICIENT_TIME");
  });

  it("veritabanı erişilemezse kontrollü hata döner", async () => {
    const seeded = await seedPaidBill();
    seeded.repository.controls.failWithUnavailable = true;
    const result = await prepareSharedBillPaymentOffer({
      sessionToken: seeded.sessionTokens[0],
      pathBillId: PAYMENT_BILL_ID,
      repository: seeded.repository,
      nowMs: PAYMENT_NOW,
      mintQuote: fakeMint(),
      offerId: OFFER_ID,
    });
    if (result.ok) throw new Error("veritabanisiz teklif basildi");
    expect(result.status).toBe(503);
  });

  it("ödenmiş, rezerve ya da inceleme bekleyen borç için teklif basılmaz", async () => {
    for (const status of ["paid", "reserved", "review_required"] as const) {
      const seeded = await seedPaidBill();
      const bill = seeded.repository.bills.get(PAYMENT_BILL_ID.toLowerCase());
      if (bill === undefined) throw new Error("hesap yok");
      bill.debts[0] = Object.freeze({
        ...bill.debts[0],
        paymentStatus: status,
        paidTxHash: status === "paid" ? `0x${"cc".repeat(32)}` : null,
        paidAt: status === "paid" ? Math.floor(PAYMENT_NOW / 1000) : null,
      });

      const result = await prepareSharedBillPaymentOffer({
        sessionToken: seeded.sessionTokens[0],
        pathBillId: PAYMENT_BILL_ID,
        repository: seeded.repository,
        nowMs: PAYMENT_NOW,
        mintQuote: fakeMint(),
        offerId: OFFER_ID,
      });
      if (result.ok) throw new Error(`${status} borc icin teklif basildi`);
      expect(result.code).toBe("DEBT_NOT_CLAIMABLE");
    }
  });
});

describe("teklif GİZLİLİĞİ", () => {
  it("yanıt yalnızca KENDİ borcunu taşır", async () => {
    /*
     * Tutarlar BİLEREK ayırt edici seçilir: kısa bir tutar ("1") başka bir
     * sayının içinde alt dize olarak geçebilir ve testi anlamsızlaştırırdı.
     */
    const { seeded, result } = await prepare({}, [
      "7770001",
      "8880002",
      "9990003",
    ]);
    if (!result.ok) throw new Error("teklif basilamadi");

    const serialized = JSON.stringify(result.offer);
    const mine = result.offer.debtor.toLowerCase();
    for (const other of seeded.debts) {
      if (other.debtor.toLowerCase() === mine) continue;
      expect(serialized).not.toContain(other.debtor);
      expect(serialized).not.toContain(other.debtKey);
      expect(serialized).not.toContain(other.tryMinor);
    }
    // Ham oturum jetonu ve HMAC etiketi ASLA dönmez.
    expect(serialized).not.toContain(seeded.sessionTokens[0]);
    expect(serialized).not.toContain("ab".repeat(32));
  });
});
