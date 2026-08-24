import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SHARED_BILL_FLOW_ENABLED } from "@/lib/arc/shared-bill-feature";

/**
 * BORÇLU ÖDEME ARAYÜZÜNÜN SÖZLEŞMESİ.
 *
 * Bu testler kaynağı okur ve akışın SIRASINI zorunlu kılar. Hiçbir testte
 * cüzdan, App Kit, ağ ya da sunucu çağrılmaz: otomatik çalışma HİÇBİR koşulda
 * gerçek bir cüzdan istemine ilerlemez.
 */

const panel = readFileSync("src/components/SharedBillPaymentPanel.tsx", "utf8");

/**
 * YORUMSUZ kaynak.
 *
 * Yasaklı adlar açıklama metninde geçebilir ("`localStorage` KULLANILMAZ");
 * ölçülmek istenen GERÇEK KULLANIMDIR, bu yüzden yorumlar çıkarılır.
 */
const code = panel
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("ödeme YALNIZCA kullanıcının açık eylemiyle başlar", () => {
  it("gönderim, KULLANICININ tıkladığı düğmeye bağlıdır", () => {
    expect(panel).toContain("Arc Testnet ile öde");
    expect(panel).toContain("onClick={() => pay(phase.offer)}");
  });

  it("ödeme düğmesi YALNIZCA inceleme aşamasında görünür", () => {
    /*
     * `offered` aşamasında (tahmin YOK) düğme yerine "İşlemi tahmin et"
     * vardır; `pay` ancak `reviewed` dalında çağrılabilir.
     */
    const branch = panel.slice(panel.indexOf('phase.status === "offered" ?'));
    const estimateFirst = branch.indexOf("İşlemi tahmin et");
    const payAfter = branch.indexOf("Arc Testnet ile öde");
    expect(estimateFirst).toBeGreaterThanOrEqual(0);
    expect(payAfter).toBeGreaterThan(estimateFirst);
  });

  it("cüzdan çağrısından ÖNCE sunucu rezervasyonu yapılır", () => {
    const body = panel.slice(panel.indexOf("const pay = async"));
    const claimAt = body.indexOf("await claimPayment(");
    const verifyAt = body.indexOf("verifyClaimedSnapshot({");
    const sendAt = body.indexOf("await sendArcUsdc(");
    expect(claimAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeGreaterThan(claimAt);
    expect(sendAt).toBeGreaterThan(verifyAt);
  });

  it("rezervasyon başarısızsa cüzdan HİÇ çağrılmaz", () => {
    const body = panel.slice(panel.indexOf("const pay = async"));
    const guard = body.indexOf("if (!claimed.ok)");
    const sendAt = body.indexOf("await sendArcUsdc(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(sendAt);
    // Erken dönüş: gönderim satırına hiç ulaşılmaz.
    expect(body.slice(guard, sendAt)).toContain("return;");
  });

  it("ağ Arc Testnet değilse ödeme kontrolü açılmaz", () => {
    expect(panel).toContain("if (!onArc)");
    expect(panel).toContain("isArcTestnet");
  });
});

describe("ÖDENDİ etiketi yalnızca SUNUCU onayından sonra", () => {
  it("App Kit başarısı doğrudan 'ödendi' yapmaz", () => {
    const body = panel.slice(panel.indexOf("if (sent.ok)"));
    const confirming = body.indexOf('status: "confirming"');
    const reconcile = body.indexOf("await reconcile(");
    expect(confirming).toBeGreaterThan(-1);
    expect(reconcile).toBeGreaterThan(confirming);
    // `paid` bu dalda YAZILMAZ.
    expect(body.slice(0, reconcile)).not.toContain('status: "paid"');
  });

  it("'paid' YALNIZCA mutabakat 'confirmed' dediğinde yazılır", () => {
    const loop = panel.slice(panel.indexOf("const reconcile = useCallback"));
    const confirmed = loop.indexOf('report.state === "confirmed"');
    const paid = loop.indexOf('status: "paid"');
    expect(confirmed).toBeGreaterThan(-1);
    expect(paid).toBeGreaterThan(confirmed);
    /*
     * Kaynakta `paid` DURUMU başka hiçbir yerde YAZILMAZ. (Tip tanımındaki
     * `status: "paid";` bir atama değildir; virgüllü biçim yalnızca atamayı
     * yakalar.)
     */
    expect(code.split('status: "paid",').length - 1).toBe(1);
  });

  it("doğrulanırken kullanıcıya 'tamamlanmış sayılmaz' denir", () => {
    expect(panel).toContain("Doğrulanıyor.");
    expect(panel).toContain("tamamlanmış sayılmaz");
  });

  it("yoklama SINIRLIDIR", () => {
    expect(panel).toContain("RECONCILE_MAX_ATTEMPTS");
    expect(panel).toContain("RECONCILE_POLL_INTERVAL_MS");
  });
});

describe("belirsiz sonuç KİLİTLİ kalır", () => {
  it("sınıflandırıcı YENİDEN YAZILMAZ", () => {
    expect(panel).toContain("outcomeForSendFailure");
    // Serbest metin eşleştirmesi ya da kendi hata çözümlemesi YOKTUR.
    for (const forbidden of [
      "user rejected",
      "insufficient funds",
      "errorCategory",
      "error.code",
      "4001",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("belirsiz sonuçta 'blocked' gösterilir, tekrar açılmaz", () => {
    const body = panel.slice(panel.indexOf('decision.outcome === "ambiguous"'));
    expect(body).toContain('status: "blocked"');
  });

  it("hash taşıyan her sonuç mutabakata gider", () => {
    const body = panel.slice(panel.indexOf('decision.outcome === "submitted"'));
    expect(body).toContain("await reconcile(");
  });

  it("işlem bağlantısı DOĞRULANMIŞ hash'ten kurulur", () => {
    expect(panel).toContain("buildArcExplorerTxUrl");
    expect(panel).toContain("ArcScan");
  });
});

describe("uyarılar ve atıf GÖRÜNÜR kalır", () => {
  it("CoinGecko atfı vardır", () => {
    expect(panel).toContain("CoinGecko");
  });

  it("testnet uyarısı ve faucet bağlantısı vardır", () => {
    expect(panel).toContain("gerçek parasal değeri yoktur");
    expect(panel).toContain("ARC_TESTNET_FAUCET_URL");
  });

  it("alıcının TAM adresi gösterilir", () => {
    expect(panel).toContain("Alıcı cüzdan adresi (tam)");
    expect(panel).toContain("{phase.offer.recipient}");
  });

  it("kur, TRY borcu, USDC tutarı ve bitiş gösterilir", () => {
    for (const label of [
      "Borç (TRY)",
      "Kur (1 USDC)",
      "Gönderilecek",
      "Kur teklifi biter",
      "Tahmini ücret",
    ]) {
      expect(panel, label).toContain(label);
    }
  });
});

describe("tarayıcı deposu YETKİLİ durum DEĞİLDİR", () => {
  it("panel hiçbir tarayıcı deposu kullanmaz", () => {
    for (const forbidden of [
      "localStorage",
      "sessionStorage",
      "document.cookie",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe("özellik bayrağı", () => {
  it("ortak akış AÇIKTIR", () => {
    /*
     * Bağımsız inceleme ve tüm doğrulama kapıları geçildikten sonra açıldı.
     * Kapalıyken eski, borçlu başına ayrı bağlantı üreten akış çalışır; iki
     * yol da derlenir ve test edilir.
     */
    expect(SHARED_BILL_FLOW_ENABLED).toBe(true);
  });
});
