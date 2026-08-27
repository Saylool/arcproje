import { describe, expect, it, vi } from "vitest";

import { createAuthenticationActions } from "./auth-action-service";
import {
  createAuthenticationRuntimeResolver,
  type OperationalAuthenticationRuntime,
} from "./auth-runtime";
import { readAuthenticationConfiguration } from "./auth-runtime-config";
import { createAuthenticateRequest } from "./session";

const VALID_CONFIGURATION = {
  ok: true as const,
  configuration: {
    origin: "https://app.example.test",
    secret:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    googleClientId: "google-client-id.example.test",
    googleClientSecret: "google-client-secret-test-value",
    secureCookies: true,
  },
};

function fakeRuntime(
  session: Awaited<ReturnType<OperationalAuthenticationRuntime["readSession"]>> = null,
): OperationalAuthenticationRuntime {
  return {
    handle: vi.fn(async () => new Response(null, { status: 204 })),
    readSession: vi.fn(async () => session),
    beginGoogleSignIn: vi.fn(async () => undefined),
    endSession: vi.fn(async () => undefined),
  };
}

describe("lazy ve fail-closed Auth.js baslatma siniri", () => {
  it("gecersiz yapilandirmada operasyonel runtime baslatmaz", () => {
    const initialize = vi.fn(() => fakeRuntime());
    const resolve = createAuthenticationRuntimeResolver({
      readConfiguration: () => ({ ok: false }),
      initialize,
    });

    expect(resolve()).toEqual({ status: "unavailable" });
    expect(initialize).not.toHaveBeenCalled();
  });

  it("gecerli yapilandirmayi ilk kullanimda bir kez baslatip onbellekler", () => {
    const runtime = fakeRuntime();
    const initialize = vi.fn(() => runtime);
    const resolve = createAuthenticationRuntimeResolver({
      readConfiguration: () => VALID_CONFIGURATION,
      initialize,
    });

    expect(resolve()).toEqual({ status: "ready", runtime });
    expect(resolve()).toEqual({ status: "ready", runtime });
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith(VALID_CONFIGURATION.configuration);
  });

  it("beklenmedik runtime baslatma hatasini import veya sayfa hatasina tasimaz", () => {
    const resolve = createAuthenticationRuntimeResolver({
      readConfiguration: () => VALID_CONFIGURATION,
      initialize: () => {
        throw new Error("unexpected initializer failure");
      },
    });

    expect(resolve()).toEqual({ status: "unavailable" });
  });

  it("zayif sirla uydurulmus oturumu okumaz ve kimlik dogrulamaz", async () => {
    const runtime = fakeRuntime({
      user: { id: "forged-arbitrary-sub", name: "Forged", image: null },
    });
    const initialize = vi.fn(() => runtime);
    const resolve = createAuthenticationRuntimeResolver({
      readConfiguration: () =>
        readAuthenticationConfiguration(
          {
            APP_ORIGIN: "https://app.example.test",
            AUTH_SECRET: "changeme",
            AUTH_GOOGLE_ID: "google-client-id.example.test",
            AUTH_GOOGLE_SECRET: "google-client-secret-test-value",
          },
          "production",
        ),
      initialize,
    });

    const authenticate = createAuthenticateRequest(resolve);
    await expect(authenticate()).resolves.toEqual({ status: "unavailable" });
    expect(initialize).not.toHaveBeenCalled();
    expect(runtime.readSession).not.toHaveBeenCalled();
  });
});

describe("oturum durumlari", () => {
  it("gecerli yapilandirma ve oturum yoklugunu signedOut olarak ayirir", async () => {
    const runtime = fakeRuntime(null);
    const authenticate = createAuthenticateRequest(() => ({
      status: "ready",
      runtime,
    }));
    await expect(authenticate()).resolves.toEqual({ status: "signedOut" });
  });

  it("gecerli uygulama kullanicisini yalniz guvenli alanlarla dondurur", async () => {
    const runtime = fakeRuntime({
      user: { id: "app-user", name: "Ada", image: "https://example.test/a.png" },
    });
    const authenticate = createAuthenticateRequest(() => ({
      status: "ready",
      runtime,
    }));
    await expect(authenticate()).resolves.toEqual({
      status: "authenticated",
      user: {
        id: "app-user",
        name: "Ada",
        image: "https://example.test/a.png",
      },
    });
  });

  it("oturum okuma hatasini sahte signedOut yerine unavailable yapar", async () => {
    const runtime = fakeRuntime();
    vi.mocked(runtime.readSession).mockRejectedValueOnce(new Error("internal"));
    const authenticate = createAuthenticateRequest(() => ({
      status: "ready",
      runtime,
    }));
    await expect(authenticate()).resolves.toEqual({ status: "unavailable" });
  });
});

describe("auth server action siniri", () => {
  it("gecersiz yapilandirmada Google sign-in baslatmaz", async () => {
    const runtime = fakeRuntime();
    const actions = createAuthenticationActions(() => ({
      status: "unavailable",
    }));
    await actions.beginGoogleSignIn();
    expect(runtime.beginGoogleSignIn).not.toHaveBeenCalled();
  });
});
