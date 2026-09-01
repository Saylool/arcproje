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

/** YORUMSUZ diyalog kaynagi: aciklamada gecen bir sinif adi kanit sayilmaz. */
const dialogCode = dialog
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

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

  it("ekleme dugmesi BASILABILIR: eksik adreste sebep soylenir", () => {
    /*
     * Dugme tam gecerli adres beklerse, eksik karakter yazan kullanici
     * basamaz ve NEDEN basamadigini ogrenemez — sessizce sikisir. Bos
     * alanlarda hala pasiftir; soylenecek bir sey yoktur.
     */
    expect(code).toContain('draft.label.trim() !== "" && draft.address.trim() !== ""');
    expect(code).toContain("disabled={busy || !draftReady}");
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
    /*
     * Panel artik akisa SLOT olarak gecer, ama oturum kapisi hala sayfada:
     * oturumsuz ziyaretcide bilesen hic olusturulmaz, gereksiz istek atilmaz.
     */
    expect(home).toContain("SavedContactsPanel");
    expect(home).toContain(
      'authState.status === "authenticated" ? <SavedContactsPanel /> : null',
    );
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
    expect(dialog).toContain("<SavedContactsPanel");
  });

  it("diyalog SECIM kipindedir: yonetim yapilmaz", () => {
    /*
     * Akisin ortasinda yanlislikla silmek, aramaya geldigi kisiyi kaybetmek
     * demektir. Diyalogda ekleme, duzenleme, silme ve gecmis YOKTUR.
     */
    expect(dialog).toContain("onPick={(contact) => {");
    expect(code).toContain("const picking = onPick !== undefined;");
    expect(code).toContain("!picking &&");
  });

  it("secim TEK adimda kisiyi ekler ve cuzdanini baglar", () => {
    expect(participants).toContain("addParticipant(state, contact.label)");
    expect(participants).toContain("onLinkAddress(created.id, contact.address)");
    // Ayni ad zaten varsa yeni kisi eklenmez, VAR OLANA baglanir.
    expect(participants).toContain("onLinkAddress(existing.id, contact.address)");
  });

  it("diyalog ORTALANIR", () => {
    // `m-auto` olmadan yerli <dialog> sola yaslanir. Aciklama degil, SINIF.
    expect(dialogCode).toContain("m-auto");
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

describe("panel YALNIZCA ilk ekranda", () => {
  const flow = readFileSync("src/components/ReceiptFlow.tsx", "utf8");

  it("kisi ve odeme adimlarinda kutu TEKRAR basilmaz", () => {
    /*
     * Ayni kutuyu her adimda gostermek, o adimin isini bolmekten baska bir
     * sey yapmaz. Akisin icinde rehbere kisi adimindaki DUGMEDEN ulasilir.
     */
    expect(flow).toContain('{screen === "receipt" && contactsPanel}');
    expect(home).toContain("contactsPanel={");
    // Sayfa artik paneli dogrudan basmaz.
    expect(home).not.toMatch(/authenticated" && <SavedContactsPanel/);
  });
});

describe("adres uzunlugu KULLANICIYA anlatilir", () => {
  it("eksik ve fazla karakter ayri ayri soylenir", () => {
    expectShows(panel, "contacts.errorAddressShort", "karakter daha gerekiyor");
    expectShows(panel, "contacts.errorAddressLong", "karakter fazla");
    expect(code).toContain("describeAddressShape");
  });

  it("kaydetmeden ONCE olculur, sunucuya gidilmez", () => {
    expect(code).toContain("if (!checkAddress(draft.address))");
    expect(code).toContain("if (!checkAddress(editDraft.address))");
  });
});
