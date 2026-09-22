import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { applyContentSecurityPolicy } from "./csp-proxy";
import {
  CSP_NONCE_REQUEST_HEADER,
  buildContentSecurityPolicies,
  generateCspNonce,
  isValidCspNonce,
} from "./headers";

/**
 * CSP NONCE.
 *
 * Nonce tahmin edilebilir ya da disaridan secilebilir olsaydi CSP hic
 * yokmus gibi olurdu: saldirgan kendi satir ici betigini damgalardi.
 */

function nonceIn(policy: string): string {
  const match = /'nonce-([^']+)'/.exec(policy);
  expect(match, "politikada nonce yok").not.toBeNull();
  return match?.[1] ?? "";
}

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://splitstable.test/pay", { headers });
}

describe("nonce uretimi", () => {
  it("Next'in cozumleyicisinin kabul ettigi bicimdedir", () => {
    const nonce = generateCspNonce();
    expect(isValidCspNonce(nonce)).toBe(true);
    /* 16 bayt base64 = 24 karakter. */
    expect(nonce).toHaveLength(24);
  });

  it("her cagrida FARKLIDIR", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateCspNonce()));
    expect(seen.size).toBe(200);
  });

  it("kisa ya da bicimsiz bir nonce politikaya GIREMEZ", () => {
    for (const bad of ["", "abc", "kisa-nonce", "has space here 12345678", "quote'here12345678901234"]) {
      expect(isValidCspNonce(bad)).toBe(false);
      expect(() => buildContentSecurityPolicies(bad)).toThrow();
    }
  });
});

describe("proxy: her istege taze nonce", () => {
  it("yanitin IKI CSP basligi da ayni nonce'u tasir", () => {
    const response = applyContentSecurityPolicy(request());
    const enforced = response.headers.get("content-security-policy") ?? "";
    const measured =
      response.headers.get("content-security-policy-report-only") ?? "";
    expect(nonceIn(enforced)).toBe(nonceIn(measured));
    expect(isValidCspNonce(nonceIn(enforced))).toBe(true);
  });

  it("nonce ISTEGE de yazilir: Next kendi betiklerini oradan damgalar", () => {
    const response = applyContentSecurityPolicy(request());
    const nonce = nonceIn(response.headers.get("content-security-policy") ?? "");
    /*
     * `NextResponse.next({ request })` ustune yazilan istek basliklarini
     * `x-middleware-request-*` olarak tasir; Next bunlari isteğe geri koyar.
     */
    expect(response.headers.get(`x-middleware-request-${CSP_NONCE_REQUEST_HEADER}`)).toBe(nonce);
    expect(
      response.headers.get("x-middleware-request-content-security-policy"),
    ).toContain(`'nonce-${nonce}'`);
  });

  it("istemciden gelen x-nonce UZERINE YAZILIR", () => {
    const response = applyContentSecurityPolicy(
      request({ [CSP_NONCE_REQUEST_HEADER]: "saldirganin-sectigi-deger-1234" }),
    );
    const nonce = nonceIn(response.headers.get("content-security-policy") ?? "");
    expect(nonce).not.toBe("saldirganin-sectigi-deger-1234");
    expect(response.headers.get(`x-middleware-request-${CSP_NONCE_REQUEST_HEADER}`)).toBe(nonce);
  });

  it("iki istek iki nonce", () => {
    const a = applyContentSecurityPolicy(request());
    const b = applyContentSecurityPolicy(request());
    expect(nonceIn(a.headers.get("content-security-policy") ?? "")).not.toBe(
      nonceIn(b.headers.get("content-security-policy") ?? ""),
    );
  });
});

describe("proxy dosyasi: Next 16 sozlesmesi", () => {
  it("`proxy` adinda bir fonksiyon disa aktarir ve CSP modulunu cagirir", async () => {
    const mod = await import("../../proxy");
    expect(typeof mod.proxy).toBe("function");
    const response = mod.proxy(request());
    expect(response.headers.get("content-security-policy")).toContain("'nonce-");
  });

  it("API ve degismez varliklar disinda HER yola uygulanir", async () => {
    const { config } = await import("../../proxy");
    const [rule] = config.matcher;
    const pattern = new RegExp(`^${rule.source}$`);
    for (const page of ["/", "/pay", "/pay/abc", "/privacy", "/account", "/auth/error"]) {
      expect(pattern.test(page), page).toBe(true);
    }
    for (const skipped of ["/api/csp-report", "/_next/static/chunks/x.js", "/_next/image", "/favicon.ico"]) {
      expect(pattern.test(skipped), skipped).toBe(false);
    }
  });
});
