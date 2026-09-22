import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  ALLOWED_COUNTRIES_ENV,
  blockedResponse,
  countryOf,
  decideGeo,
  parseAllowedCountries,
} from "./geo-gate";

/**
 * COGRAFI KAPI.
 *
 * Kapinin iki tehlikeli hatasi vardir: yanlis yapilandirmada SESSIZCE ACIK
 * kalmak, ve vekili atlayan istegi ICERI ALMAK. Testler ikisini de zorlar.
 */

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

function request(init: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://splitstable.test/pay", { headers: init });
}

describe("liste: ortam degiskeninden", () => {
  it("tanimsiz ya da bos liste = kapi YOK, herkes girer", () => {
    for (const raw of [undefined, "", "   ", ",", " , "]) {
      expect(parseAllowedCountries(raw)).toBeNull();
    }
  });

  it("virgulle ayrilir, bosluk ve kucuk harf hos gorulur", () => {
    expect([...(parseAllowedCountries(" us, de ,AR") ?? [])]).toEqual([
      "US",
      "DE",
      "AR",
    ]);
  });

  it("yanlis yazilmis kod SESSIZCE ACMAZ, firlatir", () => {
    for (const raw of ["USA", "U1", "US,D", "DE;US", "TÜR"]) {
      expect(() => parseAllowedCountries(raw), raw).toThrow(ALLOWED_COUNTRIES_ENV);
    }
  });
});

describe("ulke: vekilin basligindan", () => {
  it("Cloudflare once, Vercel sonra", () => {
    expect(countryOf(headers({ "cf-ipcountry": "DE" }))).toBe("DE");
    expect(countryOf(headers({ "x-vercel-ip-country": "US" }))).toBe("US");
    expect(
      countryOf(headers({ "cf-ipcountry": "DE", "x-vercel-ip-country": "US" })),
    ).toBe("DE");
  });

  it("kucuk harf normalize edilir; bicimsiz deger BILINMIYOR sayilir", () => {
    expect(countryOf(headers({ "cf-ipcountry": "de" }))).toBe("DE");
    /* Cloudflare Tor icin T1 basar: ulke degil. */
    expect(countryOf(headers({ "cf-ipcountry": "T1" }))).toBeNull();
    expect(countryOf(headers({ "cf-ipcountry": "" }))).toBeNull();
    expect(countryOf(headers({ "cf-ipcountry": "<script>" }))).toBeNull();
    expect(countryOf(headers())).toBeNull();
  });
});

describe("karar", () => {
  const allowed = parseAllowedCountries("US,DE");

  it("kapi yokken ulke ne olursa olsun ACIK", () => {
    expect(decideGeo(null, headers({ "cf-ipcountry": "TR" }))).toEqual({ kind: "open" });
    expect(decideGeo(null, headers())).toEqual({ kind: "open" });
  });

  it("listedeki ulke gecer", () => {
    expect(decideGeo(allowed, headers({ "cf-ipcountry": "DE" }))).toEqual({
      kind: "allowed",
      country: "DE",
    });
  });

  it("listede olmayan ulke ENGELLENIR", () => {
    expect(decideGeo(allowed, headers({ "cf-ipcountry": "TR" }))).toEqual({
      kind: "blocked",
      country: "TR",
    });
    /* Cloudflare'in "bilinmiyor" kodu da listede degildir. */
    expect(decideGeo(allowed, headers({ "cf-ipcountry": "XX" }))).toEqual({
      kind: "blocked",
      country: "XX",
    });
  });

  it("baslik YOKSA engellenir: vekili atlayan istek kapiyi atlayamaz", () => {
    expect(decideGeo(allowed, headers())).toEqual({ kind: "blocked", country: null });
    expect(decideGeo(allowed, headers({ "cf-ipcountry": "T1" }))).toEqual({
      kind: "blocked",
      country: null,
    });
  });
});

describe("451 sayfasi", () => {
  it("dogru kod, HTML, onbelleksiz, aramaya kapali", async () => {
    const response = blockedResponse(request(), { kind: "blocked", country: "TR" });
    expect(response.status).toBe(451);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const html = await response.text();
    expect(html).toContain("<h1>");
    /* Kapidaki sayfa hicbir sey CALISTIRMAZ. */
    expect(html).not.toContain("<script");
    /* Ulke kodu gövdeye yazilmaz. */
    expect(html).not.toMatch(/>\s*TR\s*</);
  });

  it("dil cerezden, yoksa tarayicidan; metin sozlukten", async () => {
    const trPage = await blockedResponse(
      request({ cookie: "hb_locale=tr" }),
      { kind: "blocked", country: "US" },
    ).text();
    expect(trPage).toContain('<html lang="tr">');
    expect(trPage).toContain("bu bölgede sunulmuyor");

    const enPage = await blockedResponse(
      request({ "accept-language": "en-US,en;q=0.9" }),
      { kind: "blocked", country: "US" },
    ).text();
    expect(enPage).toContain('<html lang="en">');
    expect(enPage).toContain("not offered in this region");
  });

  it("ulke bilinmiyorsa bunu soyler", async () => {
    const html = await blockedResponse(request({ cookie: "hb_locale=en" }), {
      kind: "blocked",
      country: null,
    }).text();
    expect(html).toContain("could not be determined");
  });
});

describe("proxy: kapi + CSP birlikte", () => {
  const previous = process.env[ALLOWED_COUNTRIES_ENV];
  afterEach(() => {
    if (previous === undefined) {
      delete process.env[ALLOWED_COUNTRIES_ENV];
    } else {
      process.env[ALLOWED_COUNTRIES_ENV] = previous;
    }
  });

  it("degisken yokken hicbir sey degismez: sayfa gecer, CSP basilir", async () => {
    delete process.env[ALLOWED_COUNTRIES_ENV];
    const { proxy } = await import("../../proxy");
    const response = proxy(request({ "cf-ipcountry": "TR" }));
    expect(response.status).not.toBe(451);
    expect(response.headers.get("content-security-policy")).toContain("'nonce-");
  });

  it("listede olmayan ulke 451 alir ve o sayfa da CSP tasir", async () => {
    process.env[ALLOWED_COUNTRIES_ENV] = "US,DE";
    const { proxy } = await import("../../proxy");
    const blocked = proxy(request({ "cf-ipcountry": "TR" }));
    expect(blocked.status).toBe(451);
    expect(blocked.headers.get("content-security-policy")).toContain("'nonce-");
    expect(blocked.headers.get("content-security-policy-report-only")).toContain("'nonce-");

    const allowed = proxy(request({ "cf-ipcountry": "DE" }));
    expect(allowed.status).not.toBe(451);
    expect(allowed.headers.get("content-security-policy")).toContain("'nonce-");
  });

  it("bozuk liste ilk istekte FIRLATIR, sessizce acmaz", async () => {
    process.env[ALLOWED_COUNTRIES_ENV] = "USA";
    const { proxy } = await import("../../proxy");
    expect(() => proxy(request({ "cf-ipcountry": "US" }))).toThrow();
  });
});
