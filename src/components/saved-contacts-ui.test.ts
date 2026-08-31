import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { translate, type TranslationKey } from "@/lib/i18n/dictionary";

/**
 * KAYITLI KISILER PANELININ SOZLESMESI.
 *
 * Bu tablo uygulamanin actigi tek kalici "kisi -> cuzdan" kaydidir. Bu yuzden
 * iki sey KANITLANIR: kullanici silebilir ve adresi TAM gorebilir.
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

const panel = readFileSync("src/components/SavedContactsPanel.tsx", "utf8");
const home = readFileSync("src/app/page.tsx", "utf8");

const code = panel
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("silme hakki", () => {
  it("tek tek VE toptan silme sunulur", () => {
    expectShows(panel, "contacts.remove", "Sil");
    expectShows(panel, "contacts.removeAll", "Tümünü sil");
    expect(code).toContain("deleteContactOnServer");
    expect(code).toContain("deleteAllContactsOnServer");
  });

  it("toptan silme ONAY ister", () => {
    // Geri alinamaz bir islem tek tiklamayla olmaz.
    expect(code).toContain("window.confirm");
    expectShows(panel, "contacts.confirmRemoveAll", "geri alınamaz");
  });

  it("gizlilik ve silme hakki KULLANICIYA soylenir", () => {
    expectShows(panel, "contacts.privacyNotice", "istediğin an tümünü");
    expect(translate("en", "contacts.privacyNotice")).toContain("delete all");
  });
});

describe("adres gozden gecirilebilir", () => {
  it("kayitli adres TAM ve sarmalanarak gosterilir", () => {
    /*
     * Kisaltma, kullanicinin kayitli bir adresi denetlemesini imkansiz
     * kilardi; yanlis adrese giden transfer geri alinamaz.
     */
    expect(code).toContain("{contact.address}");
    expect(code).toContain("break-all font-mono");
    expect(code).not.toMatch(/shortenWalletAddress/);
  });

  it("ekleme, adres GECERLI olana kadar kapalidir", () => {
    expect(code).toContain("normalizeWalletAddress(draft.address) !== null");
    expect(code).toContain("disabled={busy || !draftValid}");
  });
});

describe("panel kapsami", () => {
  it("YALNIZCA kayitli kisileri yonetir", () => {
    // Gecmisten turetilen oneriler burada duzenlenemez; kimlikleri yoktur.
    expect(code).toContain('row.source === "saved"');
  });

  it("yalnizca oturum acikken olusturulur", () => {
    expect(home).toContain("SavedContactsPanel");
    const guard = home.indexOf('authState.status === "authenticated" && <SavedContactsPanel');
    expect(guard).toBeGreaterThan(-1);
  });

  it("sunucu KODU tasinir, sunucunun METNI degil", () => {
    // Gosterilecek cumleyi arayuz kendi sozlugunden secer.
    expect(code).toContain("CONTACT_LABEL_EXISTS");
    expect(code).toContain("CONTACT_ADDRESS_EXISTS");
    expect(code).toContain("errorKeyFor");
  });
});

describe("tema ve metin", () => {
  it("yalnizca semantik tokenlar kullanilir", () => {
    expect(panel).toMatch(/bg-card/);
    expect(panel).toMatch(/text-ink/);
    expect(panel).not.toMatch(/bg-white|text-black|dark:/);
  });

  it("hicbir kullanici metni kaynakta gomulu degildir", () => {
    expect(code).not.toMatch(/"[^"]*[çğıöşüÇĞİÖŞÜ][^"]*"/);
  });
});
