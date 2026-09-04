import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DISCLOSED_HOSTS } from "@/lib/legal/privacy";

import {
  BROWSER_CONNECT_HOSTS,
  CONTENT_SECURITY_POLICY_REPORT_ONLY,
  SECURITY_HEADERS,
} from "./headers";

/** Tek politika var ve simdilik yalnizca RAPORLANIYOR. */
const POLICY = CONTENT_SECURITY_POLICY_REPORT_ONLY;

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
    const connect = directive(POLICY, "connect-src");
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
    const connect = directive(POLICY, "connect-src");
    expect(connect).not.toContain("api.openai.com");
    expect(connect).not.toContain("neon.tech");
  });
});

describe("CSP simdilik RAPORLAR, uygulanmaz", () => {
  it("uygulanan bir CSP basligi GONDERILMEZ", () => {
    /*
     * Sebep olculmus bir bilinmezlik: `@circle-fin/app-kit` tarayicida
     * dinamik olarak yukleniyor ve transfer sirasinda nereye bagladigini
     * gercek bir transfer yapmadan sayamayiz. Eksik bir `connect-src`, tam da
     * uygulamanin asil isini -- parayi gondermeyi -- kirardi.
     */
    const keys = SECURITY_HEADERS.map((header) => header.key);
    expect(keys).toContain("Content-Security-Policy-Report-Only");
    expect(keys).not.toContain("Content-Security-Policy");
  });

  it("cerceveleme korumasi CSP'yi BEKLEMEZ", () => {
    /*
     * Asil kazanc buydu ve AYRI bir baslikla bugun uygulaniyor; CSP'nin
     * raporda kalmasi onu geciktirmiyor.
     */
    const byKey = new Map(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey.get("X-Frame-Options")).toBe("DENY");
  });

  it("satir ici script RAPORDA da serbesttir", () => {
    /*
     * Amac satir ici script gurultusu degil; `connect-src` gibi GERCEKTEN
     * bilmedigimiz ihlalleri gorebilmek.
     */
    expect(directive(POLICY, "script-src")).toContain("'unsafe-inline'");
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
});
