/**
 * ÇEVİRİ MOTORU — küçük, tipli ve saf.
 *
 * Dışarıdan bir i18n kütüphanesi KULLANILMAZ: ihtiyaç duyulan davranış
 * (anahtar arama, güvenli değişken yerleştirme, çoğul seçimi) birkaç düzine
 * satırdır ve burada tamamı test edilebilir.
 *
 * GÜVENLİK: bu motor HTML ÜRETMEZ. `interpolate` yalnızca metin parçalarını
 * birleştirir; sonuç React'e METİN olarak verilir ve React kaçışları kendisi
 * yapar. Sözlükteki hiçbir metin `dangerouslySetInnerHTML` ile basılmaz, bu
 * yüzden bir çeviri (veya çeviriye konan bir kullanıcı adı) işaretleme
 * enjekte edemez.
 */

import { DEFAULT_LOCALE, toIntlLocale, type Locale } from "./locale";
import { en } from "./en";
import { tr, type Dictionary } from "./tr";

const DICTIONARIES: Record<Locale, Dictionary> = { tr, en };

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

/** Sayıya bağlı metinlerin biçimi. */
export type PluralForms = Dictionary["plurals"][keyof Dictionary["plurals"]];

/** `plurals` dışındaki her şey düz metin anahtarıdır. */
type Messages = Omit<Dictionary, "plurals">;

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

/**
 * Geçerli çeviri anahtarlarının BİRLEŞİMİ.
 *
 * Anahtar `string` değil bu birleşim olduğu için var olmayan bir anahtar
 * DERLENMEZ; yazım hataları çalışma zamanına kalmaz.
 */
export type TranslationKey = Paths<Messages>;

export type PluralKey = keyof Dictionary["plurals"] & string;

/** Metne konabilecek değerler. Nesne veya JSX kabul edilmez. */
export type TranslationParams = Readonly<Record<string, string | number>>;

/** `{ad}` biçimindeki yer tutucular. Ad yalnızca harf, rakam ve alt çizgidir. */
const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Yer tutucuları TEK GEÇİŞTE değiştirir.
 *
 * `replace` bir fonksiyonla çağrıldığında dönen metin OLDUĞU GİBİ yerleştirilir:
 * `$&` gibi değiştirme dizileri yorumlanmaz ve yerine konan metin YENİDEN
 * TARANMAZ. Bu yüzden içinde `{...}` geçen bir kullanıcı adı ikinci bir
 * değişime yol açamaz.
 *
 * Karşılığı olmayan yer tutucu OLDUĞU GİBİ bırakılır: eksik bir değişken
 * sessizce boşluğa dönüşüp cümleyi bozmaz, görünür kalır.
 */
export function interpolate(
  template: string,
  params?: TranslationParams,
): string {
  if (params === undefined) {
    return template;
  }
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Noktalı yolu izler. Yol bir metne çıkmıyorsa `null` döner. */
function lookup(dictionary: Dictionary, key: string): string | null {
  let node: unknown = dictionary;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return null;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : null;
}

/**
 * Bir anahtarı çevirir.
 *
 * BİLİNMEYEN ANAHTAR: önce Türkçe sözlüğe düşülür (yeni bir metin henüz
 * çevrilmemişse kullanıcı boş ekran değil Türkçe metin görür), o da yoksa
 * ANAHTARIN KENDİSİ döner. Hiçbir durumda istisna fırlatılmaz ve hiçbir
 * durumda sunucudan gelen ham metin gösterilmez.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const raw = lookup(dictionaryFor(locale), key) ?? lookup(tr, key);
  return raw === null ? key : interpolate(raw, params);
}

/**
 * Sayı kategorisi. `Intl.PluralRules` yoksa veya hata verirse İngilizce
 * kuralına eşdeğer güvenli bir ayrım kullanılır.
 */
function pluralCategory(locale: Locale, count: number): "one" | "other" {
  try {
    return new Intl.PluralRules(toIntlLocale(locale)).select(count) === "one"
      ? "one"
      : "other";
  } catch {
    return count === 1 ? "one" : "other";
  }
}

/**
 * Sayıya bağlı bir metni çevirir. `{count}` her zaman doldurulur.
 *
 * Türkçede sayıdan sonra ad tekil kalır ("2 ürün"), İngilizcede çoğullaşır
 * ("2 items"); bu fark sözlükte iki biçim tutularak çözülür, kodda değil.
 */
export function translatePlural(
  locale: Locale,
  key: PluralKey,
  count: number,
  params?: TranslationParams,
): string {
  const forms: PluralForms =
    dictionaryFor(locale).plurals[key] ?? tr.plurals[key];
  const category = pluralCategory(locale, count);
  const raw = forms[category] ?? forms.other;
  return interpolate(raw, { count, ...params });
}

/**
 * Bir sözlükteki bütün metin anahtarlarını noktalı yol olarak listeler.
 *
 * Yalnızca testlerde kullanılır: iki dilin anahtar kümesi karşılaştırılırken
 * derleme zamanı garantisinin yanına ÇALIŞMA ZAMANI kanıtı da konur.
 */
export function flattenKeys(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") {
    return [prefix];
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const keys: string[] = [];
  for (const [name, child] of Object.entries(value)) {
    keys.push(...flattenKeys(child, prefix === "" ? name : `${prefix}.${name}`));
  }
  return keys;
}

/** `splitTemplate` çıktısı: düz metin parçası veya doldurulacak bir yuva. */
export type TemplateSegment =
  | { kind: "text"; value: string }
  | { kind: "slot"; name: string };

/**
 * Bir şablonu metin parçalarına ve yuvalara böler.
 *
 * Cümlenin ORTASINA bir React düğümü (kalın yazılmış bir isim, bir bağlantı)
 * koymak gerektiğinde kullanılır. Sonuç düz veridir: metin parçaları React'e
 * METİN olarak verilir, yuvalara ise ÇAĞIRANIN verdiği düğümler konur.
 * Sözlükten gelen hiçbir şey işaretleme olarak yorumlanmaz — bu yüzden bir
 * çeviri metni HTML enjekte edemez ve `dangerouslySetInnerHTML` gerekmez.
 *
 * Karşılığı olmayan yuva, `{ad}` metniyle GÖRÜNÜR kalır.
 */
export function splitTemplate(template: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let lastIndex = 0;
  PLACEHOLDER.lastIndex = 0;
  let match = PLACEHOLDER.exec(template);
  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", value: template.slice(lastIndex, match.index) });
    }
    segments.push({ kind: "slot", name: match[1] });
    lastIndex = match.index + match[0].length;
    match = PLACEHOLDER.exec(template);
  }
  if (lastIndex < template.length) {
    segments.push({ kind: "text", value: template.slice(lastIndex) });
  }
  return segments;
}
