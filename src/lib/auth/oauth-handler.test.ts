import { describe, expect, it, vi } from "vitest";

import type { OperationalAuthenticationRuntime } from "./auth-runtime";
import { createOAuthHandler } from "./oauth-handler";

describe("OAuth handler fail-closed siniri", () => {
  it.each(["GET", "POST"] as const)(
    "%s gecersiz yapilandirmada genel no-store 503 doner",
    async (method) => {
      const response = await createOAuthHandler(method, () => ({
        status: "unavailable",
      }))(
        new Request("https://attacker.example/api/auth/signin", { method }),
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe(
        "no-store, private, max-age=0",
      );
      expect(await response.json()).toEqual({
        error: {
          code: "SERVICE_NOT_CONFIGURED",
          message: "Kimlik doğrulama servisi şu anda kullanılamıyor.",
        },
      });
    },
  );

  it("gecerli yapilandirmada istegi operasyonel handler'a aktarir", async () => {
    const handle = vi.fn(async () => new Response("ok", { status: 200 }));
    const runtime = {
      handle,
      readSession: vi.fn(),
      beginGoogleSignIn: vi.fn(),
      endSession: vi.fn(),
    } as unknown as OperationalAuthenticationRuntime;
    const request = new Request("https://app.example.test/api/auth/session");
    const response = await createOAuthHandler("GET", () => ({
      status: "ready",
      runtime,
    }))(request);

    expect(response.status).toBe(200);
    expect(handle).toHaveBeenCalledWith("GET", request);
  });
});
