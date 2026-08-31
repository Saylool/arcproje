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

describe("olusturucuya baglanma", () => {
  it("oneri secilince yalnizca ADRES ALANI degisir", () => {
    expect(creator).toContain("<ContactSuggestions");
    expect(creator).toContain("[row.participantId]: address,");
  });

  it("dogrulama ATLANMAZ: taslak denetimi yerinde kalir", () => {
    // Oneri, taslak dogrulamasini devre disi birakan bir yol ACMAZ.
    expect(creator).toContain("validateSharedBillDraft");
    expect(creator).not.toMatch(/skipValidation|trustedAddress|bypass/i);
  });

  it("gecerli adres TAM haliyle, sarmalanarak ayrica basilir", () => {
    /*
     * Girdi kutusu dar ekranda adresin sonunu keser. Kullanici bir oneriyi
     * ETIKETINE guvenerek sectigi icin, dogrulayabilecegi tek yerin kirpik
     * olmasi kabul edilemez.
     */
    expect(creator).toContain("normalizeWalletAddress(row.address) !== null");
    expect(creator).toContain("break-all font-mono");
    expectShows(creator, "contacts.fullAddress", "Tam adres");
    expect(translate("en", "contacts.fullAddress")).toBe("Full address");
    // Kisaltilmis hali DEGIL, tam hali basilir.
    expect(creator).not.toMatch(/shortenWalletAddress\(row\.address\)/);
  });

  it("KULLANICIYA tam adresi dogrulamasi soylenir", () => {
    expectShows(creator, "contacts.verifyNotice", "geri alınamaz");
    expect(translate("en", "contacts.verifyNotice")).toContain("cannot be undone");
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
