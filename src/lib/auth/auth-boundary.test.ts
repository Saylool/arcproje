import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const WALLET_ONLY_FILES = [
  "src/app/pay/page.tsx",
  "src/app/pay/[billId]/page.tsx",
  "src/app/api/shared-bills/[billId]/challenge/route.ts",
  "src/app/api/shared-bills/[billId]/resolve/route.ts",
  "src/app/api/shared-bills/[billId]/me/route.ts",
  "src/app/api/shared-bills/[billId]/payment/claim/route.ts",
  "src/app/api/shared-bills/[billId]/payment/finalize/route.ts",
  "src/app/api/shared-bills/[billId]/payment/outcome/route.ts",
  "src/app/api/shared-bills/[billId]/payment/prepare/route.ts",
  "src/app/api/shared-bills/[billId]/payment/status/route.ts",
  "src/app/api/rates/usdc-try/route.ts",
  "src/app/api/rates/verify/route.ts",
] as const;

describe("Google auth route siniri", () => {
  it("yalnizca iki pahali creator POST route'u Google oturumu ister", () => {
    for (const file of [
      "src/app/api/receipts/analyze/route.ts",
      "src/app/api/shared-bills/route.ts",
    ]) {
      expect(readFileSync(file, "utf8"), file).toContain("authenticateRequest");
      expect(readFileSync(file, "utf8"), file).toContain("AUTH_REQUIRED");
    }
  });

  it("pay sayfalari, borclu API'leri ve kur API'leri Google auth import etmez", () => {
    for (const file of WALLET_ONLY_FILES) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/@\/auth|@\/lib\/auth/);
    }
  });

  it("pay/[billId] oturumsuz sunucu sayfasi olarak kalir", () => {
    const source = readFileSync("src/app/pay/[billId]/page.tsx", "utf8");
    expect(source).toContain("export default async function SharedBillPage");
    expect(source).not.toMatch(/redirect\(|signIn\(|authenticateRequest/);
  });

  it("Google oturumu cüzdan sahiplik kanitinin yerini alamaz", () => {
    const resolve = readFileSync(
      "src/app/api/shared-bills/[billId]/resolve/route.ts",
      "utf8",
    );
    const me = readFileSync(
      "src/app/api/shared-bills/[billId]/me/route.ts",
      "utf8",
    );
    expect(resolve).toMatch(/signature|resolveSharedBillAccess/);
    expect(me).toMatch(/readSharedBillSession|session/i);
    expect(`${resolve}\n${me}`).not.toMatch(/Google|authenticateRequest/);
  });

  it("genis eslesen auth middleware veya proxy yoktur", () => {
    expect(existsSync("src/middleware.ts")).toBe(false);
    expect(existsSync("middleware.ts")).toBe(false);
    expect(existsSync("src/proxy.ts")).toBe(false);
    expect(existsSync("proxy.ts")).toBe(false);
  });

  it("OAuth origin'i istek Host/Origin/forwarded basliklarindan turetilmez", () => {
    const source = readFileSync("src/lib/auth/trusted-origin.ts", "utf8");
    expect(source).toContain("readAppOrigin(process.env");
    expect(source).toContain("process.env.AUTH_URL = trustedAuthOrigin");
    expect(source).not.toMatch(/headers\(|x-forwarded-host|referer/i);
  });

  it("auth kontrolu semantik tema tokenlarini kullanir", () => {
    const source = readFileSync("src/components/AuthControl.tsx", "utf8");
    expect(source).toMatch(/bg-card/);
    expect(source).toMatch(/text-ink/);
    expect(source).not.toMatch(/bg-white|text-black|dark:/);
  });
});
