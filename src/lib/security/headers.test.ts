import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DISCLOSED_HOSTS } from "@/lib/legal/privacy";

import {
  BROWSER_CONNECT_HOSTS,
  SECURITY_HEADERS,
  buildContentSecurityPolicies,
} from "./headers";

/** Sabit bir nonce; gercekte her istek kendininkini `src/proxy.ts`'ten alir. */
const NONCE = "dGVzdC1ub25jZS0xMjM0NTY3OA==";
const POLICIES = buildContentSecurityPolicies(NONCE);
/** UYGULANAN politika: connect-src disindaki her sey burada zorlayicidir. */
const POLICY = POLICIES.enforced;
/** OLCEN politika: yalnizca connect-src burada katidir. */
const MEASURED = POLICIES.reportOnly;

/**
 * GUVENLIK BASLIKLARI.
 *
 * Uretimde olculdu: yalnizca `strict-transport-security` vardi. Cerceveleme
 * korumasi, MIME koklama korumasi, yonlendiren politikasi ve CSP YOKTU.
 *
 * En somut acik cerceveleme idi: odeme sayfasi baskasinin sitesinde iframe'e
 * alinabiliyordu.
 */

function directive(policy: string, name: string): string {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  expect(found, `${name} yonergesi yok`).toBeDefined();
  return found ?? "";
}

describe("yonergeler: acilan yuzeyler kapatilir", () => {
  it("sayfa CERCEVELENEMEZ", () => {
    /* Tiklama hirsizligi: odeme sayfasi bir iframe'e alinamamali. */
    expect(directive(POLICY, "frame-ancestors")).toBe(
      "frame-ancestors 'none'",
    );
  });

  it("CSP'yi anlamayan tarayicilar icin de karsiligi vardir", () => {
    const legacy = SECURITY_HEADERS.find(
      (header) => header.key === "X-Frame-Options",
    );
    expect(legacy?.value).toBe("DENY");
  });

  it("taban etiketi ve eklentiler kapali", () => {
    expect(directive(POLICY, "base-uri")).toBe(
      "base-uri 'none'",
    );
    expect(directive(POLICY, "object-src")).toBe(
      "object-src 'none'",
    );
  });

  it("form yalnizca KENDI adresimize gonderilebilir", () => {
    /* Aksi halde bir enjeksiyon, gonderimi baska bir sunucuya yollayabilirdi. */
    expect(directive(POLICY, "form-action")).toBe(
      "form-action 'self'",
    );
  });

  it("varsayilan KISITLAYICIDIR", () => {
    expect(directive(POLICY, "default-src")).toBe(
      "default-src 'self'",
    );
  });

  it("MIME koklama kapali, yonlendiren YOL tasimaz", () => {
    const byKey = new Map(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
    /*
     * Ortak hesap adresleri `billId` tasiyor; tam adresin dis sitelere
     * gitmesi baglantiyi sizdirmak olurdu.
     */
    expect(byKey.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("kullanilmayan guclu yetenekler kapali", () => {
    const value =
      SECURITY_HEADERS.find((h) => h.key === "Permissions-Policy")?.value ?? "";
    for (const capability of ["camera", "microphone", "geolocation", "payment"]) {
      expect(value).toContain(`${capability}=()`);
    }
  });
});

describe("baglantilar: yalnizca BILDIRILEN adresler", () => {
  it("cuzdan ve zincir icin gerekenler acik", () => {
    const connect = directive(MEASURED, "connect-src");
    expect(connect).toContain("'self'");
    expect(connect).toContain("https://rpc.testnet.arc.io");
    /* WalletConnect rolesi WEBSOCKET kullanir; wss ayrica gerekir. */
    expect(connect).toContain("wss://relay.walletconnect.org");
  });

  it("tarayicinin bagladigi HER adres politikada BILDIRILMIS olmalidir", () => {
    /*
     * Yeni bir dis baglanti eklendiginde gizlilik politikasinin da
     * guncellenmesini zorlar. Iki liste ayrisirsa politika eksik kalir.
     */
    const disclosed = new Set(DISCLOSED_HOSTS);
    for (const url of BROWSER_CONNECT_HOSTS) {
      const host = url.replace(/^[a-z]+:\/\//, "");
      expect(disclosed.has(host), `${host} politikada bildirilmemis`).toBe(true);
    }
  });

  it("sunucu tarafi adresleri tarayiciya ACILMAZ", () => {
    /*
     * OpenAI ve veritabanina SUNUCU baglanir. Bunlari connect-src'ye koymak,
     * gereksiz yere tarayiciya izin vermek olurdu.
     */
    const connect = directive(MEASURED, "connect-src");
    expect(connect).not.toContain("api.openai.com");
    expect(connect).not.toContain("neon.tech");
  });
});

describe("uygulanan ve olcen politikalar birlikte gonderilir", () => {
  it("CSP statik listede DEGILDIR: nonce tasir, proxy basar", () => {
    /*
     * Iki yerden basilsaydi tarayici ikisini birden uygulardi ve statik
     * olan nonce'suz oldugu icin her betigi engellerdi.
     */
    const keys = SECURITY_HEADERS.map((header) => header.key);
    expect(keys).not.toContain("Content-Security-Policy");
    expect(keys).not.toContain("Content-Security-Policy-Report-Only");
  });

  it("connect-src YALNIZCA olcen politikada katidir", () => {
    /*
     * Uretimde olculen tek ihlal sinifi buydu ve olcum yalnizca
     * masaustu/eklenti borclu akisini kapsiyor. Mobil WalletConnect ve
     * hesabi OLUSTURAN akis henuz calistirilmadi; eksik bir liste parayi
     * gondermeyi kirardi.
     */
    expect(directive(POLICY, "connect-src")).toContain("*");
    expect(directive(MEASURED, "connect-src")).toContain("'self'");
    expect(directive(MEASURED, "connect-src")).not.toContain("*");
  });

  it("connect-src DISINDA iki politika AYNIDIR", () => {
    /*
     * Ayrisirlarsa olcum, uygulananla ilgisiz bir seyi olcmeye baslar.
     */
    const strip = (policy: string) =>
      policy
        .split(";")
        .map((part) => part.trim())
        .filter((part) => !part.startsWith("connect-src"));
    expect(strip(POLICY)).toEqual(strip(MEASURED));
  });

  it("satir ici script YALNIZCA nonce ile calisir", () => {
    /*
     * Saklamasiz cuzdan uygulamasinda XSS = cuzdan bosaltici. Sayfaya sizan
     * bir betik ancak o istegin nonce'unu tasiyorsa calisir; onu da yalnizca
     * sunucu bilir.
     */
    for (const policy of [POLICY, MEASURED]) {
      const script = directive(policy, "script-src");
      expect(script).toContain(`'nonce-${NONCE}'`);
      expect(script).toContain("'strict-dynamic'");
      expect(script).not.toContain("'unsafe-inline'");
    }
  });

  it("satir ici STIL hala serbesttir ve bu bilincli", () => {
    /*
     * Tailwind ve Next satir ici stil uretir; stil enjeksiyonu betik gibi
     * cuzdana ulasamaz. Kapatmak icin bir neden olcunce kapatilir.
     */
    expect(directive(POLICY, "style-src")).toContain("'unsafe-inline'");
  });
});

describe("baglanma: baslıklar GERCEKTEN gonderiliyor", () => {
  const config = readFileSync("next.config.ts", "utf8");

  it("her yola uygulanir", () => {
    expect(config).toContain("SECURITY_HEADERS");
    expect(config).toContain('source: "/:path*"');
  });

  it("degerler config'de TEKRARLANMAZ", () => {
    /* Tek kaynak: testlerin okudugu dosya ile sunulan deger ayni olmali. */
    expect(config).not.toContain("frame-ancestors");
    expect(config).not.toContain("nosniff");
  });

  it("CSP proxy'den gelir ve duzen tema betigini nonce ile damgalar", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain("applyContentSecurityPolicy");
    /* Damgasiz kalsa tema betigi engellenir ve sayfa yanlis temada acilir. */
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain("nonce={nonce}");
    expect(layout).toContain("CSP_NONCE_REQUEST_HEADER");
  });
});
