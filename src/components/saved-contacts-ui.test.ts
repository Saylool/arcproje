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
const dialog = readFileSync("src/components/SavedContactsDialog.tsx", "utf8");
const participants = readFileSync(
  "src/components/ParticipantAssignment.tsx",
  "utf8",
);

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
  it("kayitlilari YONETIR, gecmisi EKLEMEYE HAZIR gosterir", () => {
    /*
     * Asil kolaylik bu: daha once odeme yaptigin birini tek dokunusla
     * deftere alirsin. Gecmis satirinda duzenle/sil YOKTUR — kimligi yoktur.
     */
    expect(code).toContain('row.source === "saved"');
    expect(code).toContain('row.source === "history"');
    expectShows(panel, "contacts.historyHeading", "Daha önce ödeme");
    expect(code).toContain("saveContactOnServer({");
  });

  it("gecmis satirinda da TAM adres gosterilir", () => {
    // Kaydetmeden once ne kaydettigini gormelidir.
    const historyBlock = code.slice(code.indexOf("history.map"));
    expect(historyBlock).toContain("{contact.address}");
    expect(historyBlock).toContain("break-all font-mono");
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

describe("akis icinden acilan rehber", () => {
  it("diyalog ANA SAYFADAKI panelin aynisini gosterir", () => {
    // Tek bilesen, iki giris noktasi: ikisi birbirinden ayrisamaz.
    expect(dialog).toContain("<SavedContactsPanel />");
  });

  it("yerli <dialog> kullanilir: Escape ve odak tuzagi bedavaya gelir", () => {
    expect(dialog).toContain("showModal()");
    // Elle yazilmis bir modal bu ucunu de kolayca eksik birakir.
    expect(dialog).not.toMatch(/role="dialog"/);
  });

  it("close olayi DOGRUDAN dinlenir, React prop'u ile DEGIL", () => {
    /*
     * `close` KABARMAZ; React'in `onClose` prop'u onu yakalamaz. Yakalanmazsa
     * Escape'ten sonra React hala "acik" sanir, dugmeye basmak durumu
     * degistirmez ve diyalog BIR DAHA ACILMAZ. Tarayicida gozlendi.
     */
    expect(dialog).toContain('addEventListener("close", handleClose)');
    expect(dialog).toContain('removeEventListener("close", handleClose)');
    expect(dialog).not.toMatch(/onClose=\{onClose\}/);
  });

  it("dugme KISILER blogunda, isimlerin yaninda durur", () => {
    const button = participants.indexOf('t("contacts.openBook")');
    const payer = participants.indexOf('t("participants.payerLegend")');
    expect(button).toBeGreaterThan(-1);
    // "Fisi kim odedi?" bolumunden ONCE gelir.
    expect(button).toBeLessThan(payer);
  });

  it("acilma, close olayina BAGLI DEGILDIR", () => {
    /*
     * Tarayicida olculdu: bu ortamda programatik `close()` cagrisi `close`
     * olayini HIC tetiklemiyor. Boolean bir `open` bayragi kullanilsaydi
     * React "acik" sanip kalir, dugme olur ve diyalog bir daha acilmazdi.
     * Sayac her tiklamada yeni bir deger uretir; efekt her seferinde calisir.
     */
    expect(dialog).toContain("openToken");
    expect(dialog).toContain("openToken === 0");
    expect(dialog).not.toMatch(/open:\s*boolean/);
    expect(participants).toContain("setBookToken((token) => token + 1)");
  });

  it("kapanis YAKALANABILIRSE oneriler yenilenir", () => {
    const start = participants.indexOf("<SavedContactsDialog");
    expect(start).toBeGreaterThan(-1);
    const element = participants.slice(start, participants.indexOf("/>", start));
    expect(element).toContain("onClosed={() => recentContacts.reload()}");
  });
});
