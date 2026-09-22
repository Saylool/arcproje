import { NextResponse, type NextRequest } from "next/server";

import { translate } from "../i18n/dictionary";
import { readLocaleCookie, resolveLocale, type Locale } from "../i18n/locale";

/**
 * COĞRAFİ KAPI.
 *
 * Uygulama yalnızca hukuken çalışabildiği ülkelerde açılır. Liste
 * `ALLOWED_COUNTRIES` ortam değişkeninden gelir (ISO 3166-1 alpha-2, virgülle:
 * `US,DE`). Değişken TANIMSIZ ya da BOŞ ise kapı yoktur ve herkes girer —
 * bugünkü testnet dağıtımı böyle çalışır, hiçbir şey değişmez.
 *
 * Ülke, önümüzdeki vekilin (proxy) bastığı başlıktan okunur: Cloudflare
 * `cf-ipcountry`, Vercel `x-vercel-ip-country`. Bu başlıklara ancak istek
 * gerçekten vekilden geçtiyse güvenilebilir; bu yüzden sunucunun 80/443
 * portları yalnızca vekilin IP aralıklarına açık olmalıdır (README). Başlık
 * yoksa ülke BİLİNMİYOR sayılır ve kapı açıkken bilinmeyen İÇERİ ALINMAZ
 * (fail-closed): vekili atlayan bir istek kapıyı da atlayamaz.
 *
 * Yanlış yazılmış bir liste (`USA`, `D3`) SESSİZCE AÇMAZ: ilk istekte fırlatır
 * ve dağıtım hemen görünür şekilde düşer. Kapıyı sessizce açık bırakan bir
 * yazım hatası, hiç kapı olmamasından kötüdür.
 *
 * Kapının hukuki değeri sınırlıdır ve bu gizlenmez: hizmeti sunan kişinin
 * kendi ülkesindeki yükümlülüğünü kullanıcıyı engellemek kaldırmaz. Kapı
 * niyeti kanıtlar ve mağaza politikalarının istediği ülke sınırını uygular.
 */

export const ALLOWED_COUNTRIES_ENV = "ALLOWED_COUNTRIES";

/** Sırayla denenir; ilk bulunan kazanır. */
export const COUNTRY_HEADERS = ["cf-ipcountry", "x-vercel-ip-country"] as const;

/**
 * Cloudflare bilinmeyen ülke için `XX`, Tor için `T1` basar. `T1` desene
 * uymaz ve bilinmiyor sayılır; `XX` uyar ama hiçbir listede olmayacağı için
 * yine engellenir.
 */
const COUNTRY_CODE = /^[A-Z]{2}$/;

/** `null` = kapı yok, herkes girer. */
export type AllowedCountries = ReadonlySet<string> | null;

export function parseAllowedCountries(raw: string | undefined): AllowedCountries {
  if (raw === undefined || raw.trim() === "") {
    return null;
  }
  const codes = raw
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part !== "");
  if (codes.length === 0) {
    return null;
  }
  for (const code of codes) {
    if (!COUNTRY_CODE.test(code)) {
      throw new Error(
        `${ALLOWED_COUNTRIES_ENV}: "${code}" iki harfli ISO 3166-1 ülke kodu değil`,
      );
    }
  }
  return new Set(codes);
}

export function countryOf(headers: Headers): string | null {
  for (const name of COUNTRY_HEADERS) {
    const value = headers.get(name);
    if (value === null) {
      continue;
    }
    const code = value.trim().toUpperCase();
    return COUNTRY_CODE.test(code) ? code : null;
  }
  return null;
}

export type GeoDecision =
  | { kind: "open" }
  | { kind: "allowed"; country: string }
  | { kind: "blocked"; country: string | null };

export function decideGeo(
  allowed: AllowedCountries,
  headers: Headers,
): GeoDecision {
  if (allowed === null) {
    return { kind: "open" };
  }
  const country = countryOf(headers);
  if (country !== null && allowed.has(country)) {
    return { kind: "allowed", country };
  }
  return { kind: "blocked", country };
}

/** Metin bizim sözlüğümüzden gelir; yine de HTML'e kaçırılmadan basılmaz. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function localeOf(request: NextRequest): Locale {
  return resolveLocale({
    cookie: readLocaleCookie(request.headers.get("cookie")),
    acceptLanguage: request.headers.get("accept-language"),
  });
}

/**
 * 451 "Unavailable For Legal Reasons" — bu durum için var olan tek doğru kod.
 *
 * Sayfa BETİKSİZDİR: CSP nonce'una ihtiyaç duymaz ve kapıdaki bir sayfanın
 * hiçbir şey çalıştırmaması gerekir. Satır içi stil `style-src`'de zaten
 * serbesttir. Ülke kodu gövdeye YAZILMAZ; kullanıcının nerede olduğunu ona
 * söylemek kapının işi değil.
 */
export function blockedResponse(
  request: NextRequest,
  decision: Extract<GeoDecision, { kind: "blocked" }>,
): NextResponse {
  const locale = localeOf(request);
  const title = escapeHtml(translate(locale, "geo.blockedTitle"));
  const heading = escapeHtml(translate(locale, "geo.blockedHeading"));
  const body = escapeHtml(
    translate(
      locale,
      decision.country === null ? "geo.blockedUnknown" : "geo.blockedBody",
    ),
  );
  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#ffffff;color:#0b1120;padding:16px}
@media(prefers-color-scheme:dark){body{background:#0b1120;color:#ffffff}}
main{max-width:32rem}h1{font-size:1.5rem;margin:0 0 .75rem}p{margin:0;line-height:1.5}
</style>
</head>
<body><main><h1>${heading}</h1><p>${body}</p></main></body>
</html>`;
  return new NextResponse(html, {
    status: 451,
    headers: {
      "content-type": "text/html; charset=utf-8",
      /* Ülke isteğe göre değişir; hiçbir ara katman bu yanıtı saklamamalı. */
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
