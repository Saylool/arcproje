import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createAuthConfig } from "./auth-config";
import { createFakeAppUserRepository } from "./app-user-repository.fixture";
import { resolveGoogleIdentity } from "./app-user-service";
import type { AuthenticationConfiguration } from "./auth-runtime-config";

const AUTHENTICATION: AuthenticationConfiguration = {
  origin: "https://app.example.test",
  secret: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  googleClientId: "google-client-id.example.test",
  googleClientSecret: "google-client-secret-test-value",
  secureCookies: false,
};

const VERIFIED = {
  provider: "google",
  emailVerified: true,
  displayName: "Ada",
  avatarUrl: "https://example.test/avatar.png",
} as const;

describe("uygulama kullanici kimligi", () => {
  it("kimligi e-postaya degil Google provider hesap kimligine baglar", async () => {
    const repository = createFakeAppUserRepository();
    const first = await resolveGoogleIdentity(
      {
        ...VERIFIED,
        providerAccountId: "google-account-a",
        email: "same@example.test",
      },
      repository,
      () => "00000000-0000-4000-8000-000000000001",
    );
    const second = await resolveGoogleIdentity(
      {
        ...VERIFIED,
        providerAccountId: "google-account-b",
        email: "same@example.test",
      },
      repository,
      () => "00000000-0000-4000-8000-000000000002",
    );

    expect(first.ok && first.user.id).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(second.ok && second.user.id).toBe(
      "00000000-0000-4000-8000-000000000002",
    );
    expect(repository.users.size).toBe(2);
  });

  it("ayni Google hesabi e-posta degisse de ayni opak kullaniciya cozulur", async () => {
    const repository = createFakeAppUserRepository();
    const first = await resolveGoogleIdentity(
      {
        ...VERIFIED,
        providerAccountId: "stable-google-account",
        email: "old@example.test",
      },
      repository,
      () => "00000000-0000-4000-8000-000000000010",
    );
    const second = await resolveGoogleIdentity(
      {
        ...VERIFIED,
        providerAccountId: "stable-google-account",
        email: "new@example.test",
      },
      repository,
      () => "00000000-0000-4000-8000-000000000099",
    );

    expect(first.ok && first.user.id).toBe(
      second.ok ? second.user.id : "second failed",
    );
    expect(repository.users.size).toBe(1);
    expect(second.ok && second.user.normalizedEmail).toBe("new@example.test");
  });

  it("iki eszamanli ilk giris tek kullanici kaydinda birlesir", async () => {
    const repository = createFakeAppUserRepository();
    const identity = {
      ...VERIFIED,
      providerAccountId: "concurrent-google-account",
      email: "ada@example.test",
    };
    let next = 1;
    const createId = () =>
      `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;

    const [first, second] = await Promise.all([
      resolveGoogleIdentity(identity, repository, createId),
      resolveGoogleIdentity(identity, repository, createId),
    ]);
    expect(first.ok && second.ok && first.user.id).toBe(
      first.ok && second.ok ? second.user.id : "failed",
    );
    expect(repository.users.size).toBe(1);
  });

  it("dogrulanmamis Google e-postasini depoya dokunmadan reddeder", async () => {
    const repository = createFakeAppUserRepository();
    const result = await resolveGoogleIdentity(
      {
        ...VERIFIED,
        providerAccountId: "google-account",
        email: "ada@example.test",
        emailVerified: false,
      },
      repository,
    );
    expect(result).toEqual({ ok: false, reason: "unverified" });
    expect(repository.calls).toBe(0);
  });

  it("veritabani kullanilamiyorsa bellege dusmeden genel hata verir", async () => {
    const repository = createFakeAppUserRepository();
    repository.failWithUnavailable = true;
    const result = await resolveGoogleIdentity(
      {
        ...VERIFIED,
        providerAccountId: "google-account",
        email: "ada@example.test",
      },
      repository,
    );
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(repository.users.size).toBe(0);
  });
});

describe("OAuth token ve oturum siniri", () => {
  it("yalnizca Google, temel scope ve dogrulanmis e-posta kabul eder", async () => {
    const config = createAuthConfig(
      AUTHENTICATION,
      async () => createFakeAppUserRepository(),
    );
    const provider = config.providers[0] as unknown as {
      id: string;
      options: {
        authorization: { params: { scope: string } };
        checks: string[];
      };
    };
    expect(config.providers).toHaveLength(1);
    expect(provider.id).toBe("google");
    expect(provider.options.authorization.params.scope).toBe(
      "openid email profile",
    );
    expect(provider.options.checks).toEqual(["pkce", "state", "nonce"]);
    expect(config).not.toHaveProperty("adapter");
    expect(readFileSync("src/lib/auth/auth-config.ts", "utf8")).not.toContain(
      "@gmail.com",
    );

    const signIn = config.callbacks?.signIn as unknown as (input: {
      account: { provider: string };
      profile: Record<string, unknown>;
    }) => Promise<boolean> | boolean;
    expect(
      await signIn({
        account: { provider: "google" },
        profile: { sub: "stable", email_verified: true },
      }),
    ).toBe(true);
    expect(
      await signIn({
        account: { provider: "google" },
        profile: { sub: "stable", email_verified: false },
      }),
    ).toBe(false);
    expect(
      await signIn({
        account: { provider: "other" },
        profile: { sub: "stable", email_verified: true },
      }),
    ).toBe(false);
  });

  it("JWT callback access, refresh ve ID tokenlarini atar", async () => {
    const config = createAuthConfig(
      AUTHENTICATION,
      async () => createFakeAppUserRepository(),
    );
    const jwt = config.callbacks?.jwt as unknown as (input: {
      token: Record<string, unknown>;
      user: Record<string, unknown>;
      account: Record<string, unknown>;
    }) => Promise<Record<string, unknown>> | Record<string, unknown>;
    const token = await jwt({
      token: {
        sub: "old",
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        id_token: "id-secret",
      },
      user: {
        appUserId: "00000000-0000-4000-8000-000000000001",
        name: "Ada",
        image: null,
      },
      account: {
        provider: "google",
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        id_token: "id-secret",
      },
    });
    expect(token).toEqual({
      sub: "00000000-0000-4000-8000-000000000001",
      name: "Ada",
      picture: null,
    });
    expect(JSON.stringify(token)).not.toMatch(/access-secret|refresh-secret|id-secret/);
  });

  it("Auth.js profil siniri dogrulanmamis e-postada depo yaratmaz", async () => {
    const createRepository = vi.fn(async () => createFakeAppUserRepository());
    const config = createAuthConfig(AUTHENTICATION, createRepository);
    const provider = config.providers[0] as unknown as {
      options: {
        profile: (profile: Record<string, unknown>) => Promise<unknown>;
      };
    };
    await expect(
      provider.options.profile({
        sub: "stable-google-account",
        email: "ada@example.test",
        email_verified: false,
      }),
    ).rejects.toThrow("Authentication unavailable");
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("auth loglayicisi hassas argumanlari yazmaz", () => {
    const config = createAuthConfig(
      AUTHENTICATION,
      async () => createFakeAppUserRepository(),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    config.logger?.error?.({ type: "secret", access_token: "token-value" } as never);
    config.logger?.debug?.("secret", { email: "ada@example.test" });
    expect(error).toHaveBeenCalledWith("[auth] Kimlik doğrulama başarısız.");
    expect(JSON.stringify(error.mock.calls)).not.toContain("token-value");
    expect(debug).not.toHaveBeenCalled();
    error.mockRestore();
    debug.mockRestore();
  });

  it("oturum sunucu cookie'sidir ve tarayici depolamasi kullanilmaz", () => {
    const config = createAuthConfig(
      AUTHENTICATION,
      async () => createFakeAppUserRepository(),
    );
    const cookie = config.cookies?.sessionToken;
    expect(config.session?.strategy).toBe("jwt");
    expect(cookie).toBeDefined();
    if (cookie?.options === undefined) throw new Error("session cookie missing");
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options.path).toBe("/");
    expect(cookie.options.secure).toBe(process.env.NODE_ENV === "production");

    const configSource = readFileSync("src/lib/auth/auth-config.ts", "utf8");
    const uiSource = readFileSync("src/components/AuthControl.tsx", "utf8");
    expect(`${configSource}\n${uiSource}`).not.toMatch(
      /localStorage|sessionStorage/,
    );
  });

  it("uretim oturum cookie'si Secure ve __Secure- oneklidir", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const config = createAuthConfig(
        { ...AUTHENTICATION, secureCookies: true },
        async () => createFakeAppUserRepository(),
      );
      expect(config.cookies?.sessionToken?.name).toBe(
        "__Secure-authjs.session-token",
      );
      expect(config.cookies?.sessionToken?.options?.secure).toBe(true);
      expect(config.cookies?.sessionToken?.options?.httpOnly).toBe(true);
      expect(config.cookies?.sessionToken?.options?.sameSite).toBe("lax");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("0002 app_users gecisi", () => {
  it("transaction, provider kimligi benzersizligi ve token saklamama sozlesmesini korur", () => {
    const sql = readFileSync("migrations/0002_app_users.sql", "utf8");
    expect(sql).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS app_users");
    expect(sql).toContain("UNIQUE (provider, provider_account_id)");
    expect(sql).not.toMatch(/UNIQUE \(normalized_email\)/);
    expect(sql).not.toMatch(/access_token\s+(text|varchar)|refresh_token\s+(text|varchar)|id_token\s+(text|varchar)/i);
  });
});
