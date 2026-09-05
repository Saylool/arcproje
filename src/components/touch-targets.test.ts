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
 *
 * İLK YAZIMDA BÜYÜK BİR KÖR NOKTA VARDI: tarama yalnızca `button`, `a` ve
 * `Link` etiketlerine bakıyordu. Oysa ödeyen seçimi, ürüne kişi atama, cüzdan
 * seçimi ve onay kutuları `<label>` içine sarılmış radio/checkbox
 * kontrolleridir — hiçbiri taranmıyordu. Tarayıcıda ölçüldüklerinde 16 ile
 * 36 piksel arasında çıktılar; yani test "hepsi geçti" derken sayfadaki EN
 * KÜÇÜK hedefler denetimin tamamen dışındaydı.
 *
 * Bu yüzden aşağıda iki koruma var: etiketler de taranır VE her
 * radio/checkbox girdisinin bir hedef etiketin içinde olduğu SAYILARAK
 * kanıtlanır. İkincisi olmadan tarama yine sessizce daralabilirdi.
 */

/**
 * Dosyanın YORUMSUZ kaynağı.
 *
 * Yorumlar atılır: `LanguageSelect` içindeki bir JSDoc satırı `<label>`
 * yazısını içeriyor ve tarama onu gerçek bir etiket sanıyordu. Sahte eşleşme
 * sayımları bozar, sayımlar da buradaki asıl korumadır.
 */
function sourceOf(file: string): string {
  return readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

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

/** Dosyadaki `const SABIT = "..."` tanimlari; `className={SABIT}` bunlardan cozulur. */
function classConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(
    /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*\n?\s*"([^"]*)"/g,
  )) {
    constants.set(match[1], match[2]);
  }
  return constants;
}

function interactiveControls(): { controls: Control[]; tags: number } {
  const controls: Control[] = [];
  let tags = 0;
  for (const file of FILES) {
    if (file.endsWith(".test.tsx")) continue;
    const source = sourceOf(file);
    const constants = classConstants(source);
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

/**
 * ETİKETE SARILMIŞ KONTROLLER.
 *
 * `<label>` içine konmuş bir radio ya da checkbox'ta dokunma hedefi görünen
 * hap DEĞİL, ETİKETİN KENDİSİDİR: etiketin her yeri girdiyi tetikler. Bu
 * yüzden yükseklik etikette aranır. Ölçü hapın kendisinde aransaydı, hedefi
 * hapın dışına taşıyarak büyütmek "küçük" görünürdü.
 */
type LabelKind = "screenReader" | "toggle" | "linked" | "field";

/**
 * `<label ...>` açılışından `</label>`a kadar olan kaynak. Etiketler iç içe
 * geçemez, bu yüzden BİR SONRAKİ kapanış doğru sınırdır.
 *
 * Kapanış yoksa `null` döner — dosyanın sonuna kadar okumak yerine. Sessizce
 * sona kadar okusaydı, ilerideki herhangi bir radio/checkbox bu etikete ait
 * sanılır ve sınıflandırma yanlış olurdu. `null` sayılır ve iddia edilir.
 */
function labelBody(source: string, from: number): string | null {
  const end = source.indexOf("</label>", from);
  return end === -1 ? null : source.slice(from, end);
}

const TOGGLE_INPUT = /type="(radio|checkbox)"/;

function classifyLabel(
  attrs: string,
  body: string | null,
  className: string | null,
): LabelKind {
  /* Ekran okuyucu etiketi GÖRÜNMEZ; ona 44 piksel dayatmak anlamsız olurdu. */
  if (className !== null && className.includes("sr-only")) return "screenReader";
  /* Sınırı bilinmeyen etiket TAHMİN EDİLMEZ; hedef sayılıp denetlenir. */
  if (body === null) return "linked";
  if (TOGGLE_INPUT.test(body)) return "toggle";
  /* `htmlFor` etiketi de tıklanabilir bir hedeftir (yükleme alanı böyledir). */
  if (/htmlFor=/.test(attrs)) return "linked";
  /*
   * Geriye metin alanını saran etiketler kalır. Hedef orada ETİKET değil
   * girdinin kendisidir; metin alanlarının ölçüsü bu testin kapsamı dışında
   * ve ayrıca ölçüldü.
   */
  return "field";
}

type LabelTarget = Control & { kind: LabelKind };

type LabelScan = {
  targets: LabelTarget[];
  open: number;
  close: number;
  named: number;
  toggles: number;
  toggleInputs: number;
  /** `</label>` bulunamayan açılış etiketi sayısı. */
  unterminated: number;
  /** Gövdesi BAŞKA bir `<label` içeren etiket sayısı; sınır kaymış demektir. */
  overlapping: number;
};

function labelControls(): LabelScan {
  const targets: LabelTarget[] = [];
  let open = 0;
  let close = 0;
  let named = 0;
  let toggles = 0;
  let toggleInputs = 0;
  let unterminated = 0;
  let overlapping = 0;
  for (const file of FILES) {
    if (file.endsWith(".test.tsx")) continue;
    const source = sourceOf(file);
    const constants = classConstants(source);
    open += [...source.matchAll(/<label\b/g)].length;
    close += [...source.matchAll(/<\/label>/g)].length;
    /*
     * BAĞIMSIZ SAYIM. Bu, `TOGGLE_INPUT`u KULLANMAZ ve kullanmamalı: iki
     * taraf aynı düzenli ifadeye dayansaydı, onu daraltan bir değişiklik iki
     * sayıyı BİRLİKTE değiştirir ve karşılaştırma totolojiye dönerdi.
     * Mutasyonla denendi: tam olarak öyle oluyordu.
     */
    toggleInputs += [...source.matchAll(/type="(radio|checkbox)"/g)].length;
    for (const match of source.matchAll(/<label\b/g)) {
      const attrs = source.slice(match.index, tagEnd(source, match.index));
      const body = labelBody(source, match.index);
      if (body === null) unterminated += 1;
      /*
       * Etiketler iç içe geçemez. Bir gövde başka bir `<label` içeriyorsa
       * sınır kaymıştır ve ilerideki kontroller bu etikete ait sanılır.
       */
      if (body !== null && /<label\b/.test(body.slice("<label".length))) {
        overlapping += 1;
      }
      const className = classNameOf(attrs, constants);
      if (className !== null) named += 1;
      const kind = classifyLabel(attrs, body, className);
      if (kind === "toggle") toggles += 1;
      if ((kind === "toggle" || kind === "linked") && className !== null) {
        targets.push({ file, tag: "label", className, kind });
      }
    }
  }
  return {
    targets,
    open,
    close,
    named,
    toggles,
    toggleInputs,
    unterminated,
    overlapping,
  };
}

describe("dokunmatik hedefler", () => {
  const { controls: tagControls, tags } = interactiveControls();
  const labels = labelControls();
  /* Yükseklik kuralları HER İKİ tarama için de AYNI. */
  const controls = [...tagControls, ...labels.targets];

  it("taranacak kontrol BULUNUR", () => {
    // Tarama bozulursa test sessizce "hepsi geçti" derdi.
    expect(tagControls.length).toBeGreaterThan(30);
  });

  it("ETIKETE sarilmis kontroller de BULUNUR", () => {
    /*
     * İlk yazımda buradaki sayı sıfırdı ve kimse fark etmedi: sayfanın en
     * küçük hedefleri tam olarak bunlardı.
     */
    expect(labels.targets.length).toBeGreaterThan(0);
    /*
     * İKİ AYRI hedef biçimi var ve ikisi de denetlenmeli: girdiyi SARAN
     * etiket (rozetler, onay kutuları) ve `htmlFor` ile girdiye BAĞLANAN
     * etiket (fiş yükleme alanı). Yalnızca sayıya bakan bir iddia, ikinci
     * biçim sessizce denetim dışına çıkarılsa bile geçerdi.
     */
    expect(new Set(labels.targets.map((target) => target.kind))).toEqual(
      new Set(["toggle", "linked"]),
    );
    /*
     * Ve gerçekten YÜKSEKLİK DENETİMİNE giriyorlar. Bu iddia olmadan
     * etiketleri denetlenen kümeden çıkarmak hiçbir testi kırmazdı: yükseklik
     * iddiaları yalnızca bir ihlal varken konuşur, hepsi düzeltilmişken
     * sessiz kalırdı. Sessizlik, kapsamın kanıtı değildir.
     */
    expect(controls.length).toBe(tagControls.length + labels.targets.length);
  });

  it("HER radio/checkbox bir HEDEF etiketin ICINDE", () => {
    /*
     * ASIL KORUMA BU. İki taraf AYRI hesaplardan gelir: sol taraf etiketleri
     * gezip sınıflandırır, sağ taraf dosyadaki girdileri kendi düzenli
     * ifadesiyle sayar. Ortak bir sabite dayansalardı — ilk yazımda öyleydi —
     * onu daraltan bir değişiklik ikisini birlikte kaydırır ve iddia hiçbir
     * şey ölçmezdi. Mutasyonla denendi: aynen öyle oluyordu.
     */
    expect(labels.toggles).toBe(labels.toggleInputs);
    expect(labels.toggleInputs).toBeGreaterThan(0);
  });

  it("etiket ayristirmasi TUTARLI", () => {
    /* Açılış ve kapanış eşit değilse `labelBody` yanlış aralığı okur. */
    expect(labels.open).toBe(labels.close);
    /*
     * Kapanışı bulunamayan bir etiket, gövdesi dosyanın SONUNA kadar uzamış
     * demektir; o zaman ilerideki herhangi bir radio/checkbox o etikete ait
     * sanılır. Bu depoda şu an sonucu değiştirmiyor, ama sessizce yanlış
     * sınıflandırmanın kapısı budur.
     */
    expect(labels.unterminated).toBe(0);
    /*
     * Sınır dosyanın sonuna kaydığında `unterminated` YAKALAMAZ — kapanış
     * yine bulunur, yalnızca yanlış yerde biter. Örtüşme sayısı bunu görür:
     * aynı dosyadaki ikinci bir etiket birincinin gövdesine düşerdi.
     */
    expect(labels.overlapping).toBe(0);
    // className okunamayan etiket, sınıflandırmadan sessizce düşerdi.
    expect(labels.named).toBe(labels.open);
  });

  it("HICBIR kontrol taramanin disinda kalmaz", () => {
    /*
     * Asıl koruma bu. İlk yazımda hem `className={SABIT}` hem de ok
     * fonksiyonu içeren etiketler sessizce atlanmıştı; test ölçmediği
     * dosyaları "geçti" sayıyordu. Kapsam artık sayılarak kanıtlanır.
     */
    expect(tagControls.length).toBe(tags);
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
