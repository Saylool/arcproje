import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * DOKUNMATİK HEDEF BOYUTU.
 *
 * İnceleme bazı kontrolleri 24–32 CSS pikseli yüksekliğinde ölçtü. Parmakla
 * bu boyuta isabet ettirmek zordur ve yanlış düğmeye basmak bir ödeme
 * akışında pahalıdır.
 *
 * Hedef 44 piksel (`min-h-11`): Apple'ın ve WCAG 2.2 AAA'nın alt sınırı.
 * Material 48 der; aradaki fark bu arayüzün yoğunluğunda gereksiz yer
 * kaplardı.
 *
 * Bu test KAYNAK düzeyinde çalışır, çünkü depoda bileşen testi altyapısı
 * yok. Gerçek yükseklikler tarayıcıda ayrıca ölçüldü; buradaki amaç yeni bir
 * kontrolün ölçüsüz eklenmesini engellemek.
 */

/** `globSync` bu @types/node sürümünde tipli değil; dizin okuması taşınabilir. */
function tsxFilesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => `${root}/${entry}`);
}

const FILES = [
  ...tsxFilesUnder("src/components"),
  ...tsxFilesUnder("src/app"),
];

/** Yüksekliği bildiren herhangi bir sınıf. */
const DECLARES_HEIGHT = /\b(min-h-\[?[0-9]|h-[0-9]|min-h-screen|h-full)/;

/** 44 pikselin altında kalan Tailwind ölçüleri (`h-10` = 40px). */
const TOO_SHORT = /\b(min-h|h)-([0-9]|10)\b/;

/**
 * Cümle içinde geçen bağlantı.
 *
 * Bunlara yükseklik dayatmak metin satırını bozar; erişilebilirlik kuralı da
 * satır içi bağlantıları hedef boyutu şartından ayrı tutar.
 */
function isInlineProseLink(tag: string, className: string): boolean {
  return (
    (tag === "a" || tag === "Link") &&
    className.includes("underline") &&
    !/rounded|flex|self-start/.test(className)
  );
}

/**
 * Bir açılış etiketinin sonunu bulur.
 *
 * Düz bir `[^>]*?>` YETMEZ: `onClick={() => ...}` içindeki `>` etiketi erken
 * bitirir ve o kontrol taramanın dışında kalır. İlk yazımda tam olarak bu
 * oldu — 93 etiketin yalnızca 71'i görülüyordu ve test bunu fark etmeden
 * "geçti" diyordu. Bu yüzden süslü parantez derinliği ve metin sınırları
 * sayılarak ilerlenir.
 */
function tagEnd(source: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return i;
  }
  return source.length;
}

/** `className="..."`, `className={SABIT}`, dizi ve şablon biçimleri. */
function classNameOf(
  attrs: string,
  constants: ReadonlyMap<string, string>,
): string | null {
  const literal = /className="([^"]*)"/.exec(attrs);
  if (literal) return literal[1];

  const named = /className=\{([A-Z_][A-Z0-9_]*)\}/.exec(attrs);
  if (named) return constants.get(named[1]) ?? null;

  if (/className=\{\s*\[/.test(attrs)) {
    /* Dizi biçimi: içindeki bütün metin parçaları birleştirilir. */
    return [...attrs.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join(" ");
  }

  const template = /className=\{`([^`]*)`\}/.exec(attrs);
  if (template) return template[1];

  return null;
}

type Control = { file: string; tag: string; className: string };

function interactiveControls(): { controls: Control[]; tags: number } {
  const controls: Control[] = [];
  let tags = 0;
  for (const file of FILES) {
    if (file.endsWith(".test.tsx")) continue;
    const source = readFileSync(file, "utf8");
    const constants = new Map<string, string>();
    for (const m of source.matchAll(
      /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*\n?\s*"([^"]*)"/g,
    )) {
      constants.set(m[1], m[2]);
    }
    for (const m of source.matchAll(/<(button|a|Link)\b/g)) {
      tags += 1;
      const attrs = source.slice(m.index, tagEnd(source, m.index));
      const className = classNameOf(attrs, constants);
      if (className !== null) {
        controls.push({ file, tag: m[1], className });
      }
    }
  }
  return { controls, tags };
}

describe("dokunmatik hedefler", () => {
  const { controls, tags } = interactiveControls();

  it("taranacak kontrol BULUNUR", () => {
    // Tarama bozulursa test sessizce "hepsi geçti" derdi.
    expect(controls.length).toBeGreaterThan(30);
  });

  it("HICBIR kontrol taramanin disinda kalmaz", () => {
    /*
     * Asıl koruma bu. İlk yazımda hem `className={SABIT}` hem de ok
     * fonksiyonu içeren etiketler sessizce atlanmıştı; test ölçmediği
     * dosyaları "geçti" sayıyordu. Kapsam artık sayılarak kanıtlanır.
     */
    expect(controls.length).toBe(tags);
  });

  it("her kontrol yuksekligini BILDIRIR", () => {
    const missing = controls
      .filter((c) => !isInlineProseLink(c.tag, c.className))
      .filter((c) => !DECLARES_HEIGHT.test(c.className))
      .map((c) => `${c.file} <${c.tag}>`);
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("hicbir kontrol 44 pikselin ALTINDA degil", () => {
    const short = controls
      .filter((c) => !isInlineProseLink(c.tag, c.className))
      .filter((c) => TOO_SHORT.test(c.className))
      .map((c) => `${c.file} <${c.tag}> ${c.className.match(TOO_SHORT)?.[0]}`);
    expect(short, short.join("\n")).toEqual([]);
  });

  it("satir ici baglantilar BILEREK disarida", () => {
    /*
     * Muafiyetin kendisi de sabitlenir: kural sessizce genişleyip her
     * bağlantıyı kapsamaya başlarsa metin düzeni bozulurdu.
     */
    expect(isInlineProseLink("a", "underline underline-offset-2")).toBe(true);
    expect(isInlineProseLink("a", "rounded-full underline")).toBe(false);
    expect(isInlineProseLink("button", "underline")).toBe(false);
    /*
     * ALTI ÇİZİLİ OLMAYAN bir bağlantı prose değildir; muafiyet ona
     * uzanmamalı. Bu iddia olmadan `underline` koşulu silinse bile test
     * geçiyordu.
     */
    expect(isInlineProseLink("a", "text-sm text-ink-soft")).toBe(false);
    expect(isInlineProseLink("Link", "text-xs")).toBe(false);
  });
});
