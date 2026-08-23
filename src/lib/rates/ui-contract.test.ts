import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Arayüz sözleşmesi.
 *
 * Depoda bileşen testi altyapısı yok; bu yüzden UI'ın kaldırılması/eklenmesi
 * gereken davranışları kaynak düzeyinde doğrulanır. DOM davranışı ayrıca
 * tarayıcı doğrulamasıyla kontrol edilir.
 */

const creator = readFileSync("src/components/PaymentRequestCreator.tsx", "utf8");
const payer = readFileSync("src/components/PaymentRequestPayer.tsx", "utf8");

describe("oluşturucu ekranı", () => {
  it("elle kur girişi kalmadı", () => {
    expect(creator).not.toContain("setRateInput");
    expect(creator).not.toContain("parseRate(");
    expect(creator).not.toContain("describeRateFailure");
    expect(creator).not.toContain("1 USDC kaç TRY?");
    expect(creator).not.toContain("elle girilir");
    expect(creator).not.toContain("elle girdiğin demo");
  });

  it("kuru sunucudan otomatik alır", () => {
    expect(creator).toContain("fetchQuoteFromServer");
    expect(creator).toContain('status: "loading"');
    expect(creator).toContain('status: "ready"');
    expect(creator).toContain('status: "error"');
    expect(creator).toContain("Kuru yenile");
    expect(creator).toContain("Kuru yeniden dene");
  });

  it("CoinGecko atfı görünür ve bağlantılıdır", () => {
    expect(creator).toContain("https://www.coingecko.com/en/api");
    expect(creator).toContain("Data provided by CoinGecko");
  });

  it("geçerli teklif olmadan talep oluşturulamaz", () => {
    expect(creator).toContain("signedQuote !== null");
    expect(creator).toContain("!quoteExpired");
    // Teklif ve etiket doğrudan sunucu teklifinden gelir.
    expect(creator).toContain("quote: signedQuote.quote");
    expect(creator).toContain("quoteTag: signedQuote.tag");
  });

  it("süresi dolan teklifte uyarı gösterir", () => {
    expect(creator).toContain("Kur teklifinin süresi doldu");
  });
});

describe("ödeyen ekranı", () => {
  it("teklifi sunucuya doğrulatır", () => {
    expect(payer).toContain("verifyQuoteWithServer");
    expect(payer).toContain("extractQuoteFromPayload");
  });

  it("tahmin ve gönderim öncesi yeniden doğrular", () => {
    const occurrences = payer.split("verifyQuoteWithServer").length - 1;
    // import + ilk doğrulama + tahmin öncesi + gönderim öncesi
    expect(occurrences).toBeGreaterThanOrEqual(4);
    expect(payer).toContain("quoteBeforeEstimate");
    expect(payer).toContain("quoteBeforeSend");
  });

  it("cüzdan imzasının piyasa kurunu kanıtlamadığını söyler", () => {
    expect(payer).toContain(
      "Cüzdan imzası tek başına kurun piyasa değeri olduğunu kanıtlamaz",
    );
  });

  it("kur kaynağını ve zamanlarını gösterir", () => {
    expect(payer).toContain("Kur kaynağı");
    expect(payer).toContain("Kur gözlem zamanı");
    expect(payer).toContain("Kur geçerliliği");
  });
});
