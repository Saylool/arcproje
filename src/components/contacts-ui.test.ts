import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { pickSuggestions } from "@/components/ContactSuggestions";
import type { Contact } from "@/lib/arc/contacts-client";
import { translate, type TranslationKey } from "@/lib/i18n/dictionary";

/**
 * ADRES ONERILERININ SOZLESMESI.
 *
 * Siralama saf bir fonksiyondur ve dogrudan olculur. Geri kalan davranis —
 * "asla kendiliginden doldurmaz" — kaynak duzeyinde sabitlenir, cunku depoda
 * bilesen testi altyapisi yok.
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

const panel = readFileSync("src/components/ContactSuggestions.tsx", "utf8");
const creator = readFileSync("src/components/SharedBillCreator.tsx", "utf8");
const participants = readFileSync(
  "src/components/ParticipantAssignment.tsx",
  "utf8",
);
const flow = readFileSync("src/components/ReceiptFlow.tsx", "utf8");

const code = panel
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

function contact(label: string, tail: string, lastUsedAt: number): Contact {
  return Object.freeze({
    address: `0x${tail.repeat(40).slice(0, 40)}`,
    label,
    lastUsedAt,
  });
}

const ADA = contact("Ada", "a", 300);
const BORA = contact("Bora", "b", 200);
const CAGLA = contact("Çağla", "c", 100);
const ALL = [CAGLA, BORA, ADA];

describe("oneri siralamasi", () => {
  it("katilimci adiyla eslesen ONCE gelir, digerleri yeniden eskiye", () => {
    const picked = pickSuggestions(ALL, "Bora", "");
    expect(picked.map((c) => c.label)).toEqual(["Bora", "Ada", "Çağla"]);
  });

  it("ad eslesmesi yoksa yalnizca en son kullanilanlar", () => {
    const picked = pickSuggestions(ALL, "Deniz", "");
    expect(picked.map((c) => c.label)).toEqual(["Ada", "Bora", "Çağla"]);
  });

  it("yazilan adres onekine gore suzer", () => {
    const picked = pickSuggestions(ALL, "", "0xbb");
    expect(picked.map((c) => c.label)).toEqual(["Bora"]);
  });

  it("etikette aranir: buyuk/kucuk harf ve AKSAN onemsiz", () => {
    expect(pickSuggestions(ALL, "", "ada").map((c) => c.label)).toEqual(["Ada"]);
    // Turkce adlar cogu zaman aksansiz yazilir; ikisi de eslesmeli.
    for (const typed of ["çağ", "cag", "ÇAĞ", "CAG", "Çağla", "cagla"]) {
      expect(pickSuggestions(ALL, "", typed).map((c) => c.label), typed).toEqual([
        "Çağla",
      ]);
    }
  });

  it("noktasiz i ile yazilan ad da eslesir", () => {
    const isik = contact("Işık", "d", 400);
    for (const typed of ["isik", "ısık", "IŞIK", "Işık"]) {
      expect(
        pickSuggestions([isik, ...ALL], "", typed).map((c) => c.label),
        typed,
      ).toEqual(["Işık"]);
    }
  });

  it("hicbir sey eslesmezse bos doner", () => {
    expect(pickSuggestions(ALL, "", "0xzzz")).toEqual([]);
    expect(pickSuggestions([], "Ada", "")).toEqual([]);
  });

  it("en fazla uc oneri gosterilir", () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      contact(`Kisi${index}`, String(index % 10), index + 1),
    );
    expect(pickSuggestions(many, "", "").length).toBeLessThanOrEqual(3);
  });
});

describe("cipte YAS gosterilir", () => {
  it("yas ekranda durur, yalnizca ipucunda degil", () => {
    /*
     * Dokunmatik ekranda hover yoktur; `title` gorunmez. "Bu adres ne kadar
     * eski" sorusu tam da tiklamadan once sorulmasi gerekendir.
     */
    expect(code).toContain("formatRelativeAge(contact.lastUsedAt, asOfMs, locale)");
  });

  it("yas RENDER sirasinda degil, okuma anina gore hesaplanir", () => {
    // `Date.now()` render icinde okunsaydi ayni veri farkli cikti uretirdi.
    expect(code).toContain("asOfMs");
    expect(code).not.toMatch(/formatRelativeAge\([^)]*Date\.now\(\)/);
    // Okuma ani YALNIZCA veri geldiginde damgalanir.
    expect(code).toContain("loadedAtMs: Date.now()");
  });
});

describe("oneri ASLA kendiliginden doldurmaz", () => {
  it("onPick yalnizca kullanicinin tikladigi dugmeden cagrilir", () => {
    expect(code).toContain("onClick={() => onPick(contact.address)}");
    // Efekt ya da render sirasinda dolduran bir yol YOKTUR.
    expect(code).not.toMatch(/useEffect\([^)]*onPick/);
    expect(code.match(/onPick\(/g) ?? []).toHaveLength(1);
  });

  it("secilen deger TAM adrestir, kisaltma degil", () => {
    /*
     * Kisaltma yalnizca ekranda yer kaplamamak icindir. `onPick`e giden deger
     * dogrulanmis TAM adres olmalidir.
     */
    expect(code).toContain("onPick(contact.address)");
    expect(code).not.toMatch(/onPick\(shortenWalletAddress/);
  });

  it("tam adres ipucu olarak da verilir", () => {
    expect(code).toContain("title={`${contact.address}");
  });
});

describe("eslestirme KISI adiminda yapilir", () => {
  it("oneriler kisi adimindadir, odeme adiminda DEGIL", () => {
    /*
     * Insanlari isimle taniriz, adresle degil. Eslestirme isim alaninda
     * yapilir; odeme adiminda kullanici buyuk ihtimalle YENI bir adres girer.
     */
    expect(participants).toContain("<ContactSuggestions");
    expect(participants).toContain("useRecentContacts");
    expect(creator).not.toContain("<ContactSuggestions");
    expect(creator).not.toContain("useRecentContacts");
  });

  it("oneri yalnizca isim YAZILMISSA cikar", () => {
    // Bos isimde butun rehberi dokmek gurultu olurdu.
    expect(participants).toContain('participant.name.trim() !== ""');
  });

  it("secilen bag odeme adimina TASINIR", () => {
    expect(participants).toContain("onLinkAddress(participant.id, address)");
    expect(flow).toContain("initialAddresses={linkedAddresses}");
    expect(creator).toContain("useState<Record<string, string>>(\n    () => ({ ...initialAddresses }),\n  )");
  });

  it("bag ASLA kendiliginden kurulmaz", () => {
    // `onPick` yalnizca kullanicinin tikladigi dugmeden gelir.
    expect(participants).not.toMatch(/useEffect\([^)]*onLinkAddress/);
    expect(participants).toContain("onUnlinkAddress(participant.id)");
  });

  it("odeme adiminda dogrulama uyarisi KALIR", () => {
    /*
     * Oneri kaldirildi ama adres ister elle yazilmis ister bagli gelmis
     * olsun, gonderilmeden once dogrulanmalidir.
     */
    expectShows(creator, "contacts.verifyNotice", "geri alınamaz");
  });

  it("dogrulama ATLANMAZ: taslak denetimi yerinde kalir", () => {
    expect(creator).toContain("validateSharedBillDraft");
    expect(creator).not.toMatch(/skipValidation|trustedAddress|bypass/i);
  });

  it("gecerli adres TAM haliyle, sarmalanarak basilir", () => {
    expect(creator).toContain("normalizeWalletAddress(row.address) !== null");
    expect(creator).toContain("break-all font-mono");
    expectShows(creator, "contacts.fullAddress", "Tam adres");
    expect(creator).not.toMatch(/shortenWalletAddress\(row\.address\)/);
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
