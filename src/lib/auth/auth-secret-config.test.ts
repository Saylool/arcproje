import { describe, expect, it } from "vitest";

import { createAuthConfig } from "./auth-config";
import { createFakeAppUserRepository } from "./app-user-repository.fixture";
import { readAuthenticationConfiguration } from "./auth-runtime-config";
import { readAuthenticationSecret } from "./auth-secret-config";

const VALID_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const VALID_ENV = Object.freeze({
  APP_ORIGIN: "https://app.example.test",
  AUTH_SECRET: VALID_SECRET,
  AUTH_GOOGLE_ID: "google-client-id.example.test",
  AUTH_GOOGLE_SECRET: "google-client-secret-test-value",
});

describe("AUTH_SECRET kati bicim sozlesmesi", () => {
  it.each([
    ["eksik", undefined],
    ["bos", ""],
    ["bilinen zayif deger", "changeme"],
    ["63 kucuk hex", "a".repeat(63)],
    ["65 kucuk hex", "a".repeat(65)],
    ["buyuk hex", VALID_SECRET.toUpperCase()],
    ["hex olmayan karakter", `${VALID_SECRET.slice(0, 63)}g`],
    ["basta bosluk", ` ${VALID_SECRET}`],
    ["sonda bosluk", `${VALID_SECRET} `],
  ])("%s reddedilir", (_label, value) => {
    expect(readAuthenticationSecret({ AUTH_SECRET: value })).toEqual({
      ok: false,
    });
  });

  it("tam 64 kucuk hex karakteri degistirmeden kabul eder", () => {
    expect(readAuthenticationSecret({ AUTH_SECRET: VALID_SECRET })).toEqual({
      ok: true,
      secret: VALID_SECRET,
    });
  });
});

describe("butunlesik authentication yapilandirmasi", () => {
  it.each(["APP_ORIGIN", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] as const)(
    "%s eksikken auth yapilandirmasini gecersiz sayar",
    (name) => {
      expect(
        readAuthenticationConfiguration(
          { ...VALID_ENV, [name]: undefined },
          "test",
        ),
      ).toEqual({ ok: false });
    },
  );

  it("secret ve Google saglayici degerlerini Auth.js'e acikca aktarir", () => {
    const resolved = readAuthenticationConfiguration(VALID_ENV, "test");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error("test configuration missing");

    const config = createAuthConfig(
      resolved.configuration,
      async () => createFakeAppUserRepository(),
    );
    const provider = config.providers[0] as unknown as {
      options: { clientId: string; clientSecret: string };
    };

    expect(config.secret).toBe(VALID_SECRET);
    expect(provider.options.clientId).toBe(VALID_ENV.AUTH_GOOGLE_ID);
    expect(provider.options.clientSecret).toBe(VALID_ENV.AUTH_GOOGLE_SECRET);
  });

  it("yonlendirmeleri dogrulanmis origin disina cikarmadan tutar", async () => {
    const resolved = readAuthenticationConfiguration(VALID_ENV, "test");
    if (!resolved.ok) throw new Error("test configuration missing");
    const config = createAuthConfig(
      resolved.configuration,
      async () => createFakeAppUserRepository(),
    );
    const redirect = config.callbacks?.redirect;
    if (redirect === undefined) throw new Error("redirect callback missing");

    expect(
      await redirect({
        url: "https://attacker.example/path",
        baseUrl: VALID_ENV.APP_ORIGIN,
      }),
    ).toBe(VALID_ENV.APP_ORIGIN);
  });

  it("yapilandirma sonucuna sir veya saglayici degeriyle hata yazmaz", () => {
    const result = readAuthenticationConfiguration(
      { ...VALID_ENV, AUTH_SECRET: "changeme" },
      "test",
    );
    expect(JSON.stringify(result)).toBe('{"ok":false}');
    expect(JSON.stringify(result)).not.toMatch(/changeme|google-client/);
  });
});
