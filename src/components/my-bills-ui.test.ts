import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { translate, type TranslationKey } from "@/lib/i18n/dictionary";

/**
 * OLUSTURULAN HESAPLAR PANELININ SOZLESMESI.
 *
 * Depoda bilesen testi altyapisi yok; bu yuzden davranis kaynak duzeyinde
 * dogrulanir. Metin bilesende degil sozluktedir, bu yuzden her cumle IKI
 * parcada olculur: bilesen dogru ANAHTARI kullaniyor mu ve sozluk o anahtar
 * altinda beklenen TURKCE metni tasiyor mu.
 */
function expectShows(
  source: string,
  key: TranslationKey,
  expectedTurkish: string,
): void {
  expect(source, key).toContain(key);
  expect(translate("tr", key), key).toContain(expectedTurkish);
  expect(translate("en", key), key).not.toBe("");
}

const panel = readFileSync("src/components/MyBillsPanel.tsx", "utf8");
const homePage = readFileSync("src/app/page.tsx", "utf8");

/** YORUMSUZ kaynak: olculmek istenen gercek kullanimdir, aciklama degil. */
const code = panel
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("panel yalnizca oturum acikken vardir", () => {
  it("ana sayfa paneli yalnizca kimligi dogrulanmis durumda olusturur", () => {
    expect(homePage).toContain("MyBillsPanel");
    expect(homePage).toContain('authState.status === "authenticated"');
  });

  it("oturumsuz ziyaretcide istek atilmaz", () => {
    /*
     * Panel hic render edilmediginde efekti de calismaz. Kosul bilesenin
     * ICINDE olsaydi, oturumsuz herkes bosuna bir 401 istegi uretirdi.
     */
    const rendered = homePage.indexOf("<MyBillsPanel />");
    const guard = homePage.indexOf('authState.status === "authenticated"');
    expect(guard).toBeGreaterThan(-1);
    expect(rendered).toBeGreaterThan(guard);
  });
});

describe("panel metinleri", () => {
  it("baslik, aciklama ve bos durum sozlukten gelir", () => {
    expectShows(panel, "myBills.title", "Oluşturduğun hesaplar");
    expectShows(panel, "myBills.subtitle", "Google hesabıyla");
    expectShows(panel, "myBills.empty", "henüz");
    expectShows(panel, "myBills.failed", "okunamıyor");
    expectShows(panel, "myBills.loading", "yükleniyor");
  });

  it("durum rozetleri uc hali de ayirt eder", () => {
    expectShows(panel, "myBills.statusOpen", "Açık");
    expectShows(panel, "myBills.statusClosed", "Kapalı");
    expectShows(panel, "myBills.statusExpired", "Süresi doldu");
  });

  it("YETKI SINIRI kullaniciya acikca soylenir", () => {
    /*
     * Sahipligin bir odeme yetkisi olmadigi yalnizca kodda degil, EKRANDA da
     * yazar. Bu cumle silinirse test duser.
     */
    expectShows(
      panel,
      "myBills.authorityNotice",
      "hiçbir ödeme yetkisi VERMEZ",
    );
    expect(translate("en", "myBills.authorityNotice")).toContain(
      "NO payment authority",
    );
  });

  it("hicbir kullanici metni kaynakta gomulu degildir", () => {
    // Turkce harf iceren duz dize kalmadigini kabaca tarar.
    expect(code).not.toMatch(/"[^"]*[çğıöşüÇĞİÖŞÜ][^"]*"/);
  });
});

describe("para ve tarih SUNUM katmanindadir", () => {
  it("tutarlar formatTryMinor ile basilir", () => {
    expect(code).toContain("formatTryMinor(bill.totalTryMinor, locale)");
    expect(code).toContain("formatTryMinor(bill.paidTryMinor, locale)");
  });

  it("panelde kayan nokta aritmetigi YOKTUR", () => {
    expect(code).not.toMatch(/parseFloat|Number\(bill\.|\/\s*100\b|\*\s*100\b/);
  });

  it("tarihler Intl uzerinden bicimlenir", () => {
    expect(code).toContain("formatDateTime(bill.issuedAt, locale)");
    expect(code).toContain("formatDateTime(bill.expiresAt, locale)");
  });

  it("sure dolumu render sirasinda DEGIL, okuma aninda olculur", () => {
    /*
     * Render sirasinda `Date.now()` okunsaydi ayni veri farkli ciktilar
     * uretirdi. Zaman, listenin okundugu an olarak asagi tasinir.
     */
    expect(code).toContain("asOfMs");
    expect(code).not.toMatch(/expiresAt \* 1000 <= Date\.now\(\)/);
  });
});

describe("panel YALNIZCA okur", () => {
  it("transfer, imza veya yazma istegi baslatmaz", () => {
    expect(code).not.toMatch(
      /kit\.send|sendTransaction|signTypedData|writeContract/,
    );
    expect(code).not.toMatch(/method: "(POST|PUT|PATCH|DELETE)"/);
  });

  it("borclu adresi veya etiketi gostermez", () => {
    expect(code).not.toMatch(/\bdebtor\b|debtorLabel|recipientLabel/);
  });
});

describe("tema", () => {
  it("yalnizca semantik tokenlar kullanilir", () => {
    expect(panel).toMatch(/bg-card/);
    expect(panel).toMatch(/text-ink/);
    expect(panel).not.toMatch(/bg-white|text-black|dark:/);
  });
});
