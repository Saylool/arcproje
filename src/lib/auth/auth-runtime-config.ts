import { readAppOrigin } from "@/lib/db/shared-bill-auth";

import { readAuthenticationSecret } from "./auth-secret-config";

export type AuthenticationConfiguration = Readonly<{
  origin: string;
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
  secureCookies: boolean;
}>;

export type AuthenticationConfigurationResult =
  | { ok: true; configuration: AuthenticationConfiguration }
  | { ok: false };

function readRequiredProviderValue(value: string | undefined): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    return null;
  }
  return value;
}

/** Bütün auth girdileri tek sınırda doğrulanır; hiçbir sır hata sonucuna girmez. */
export function readAuthenticationConfiguration(
  env: Readonly<Record<string, string | undefined>>,
  nodeEnv: string | undefined,
): AuthenticationConfigurationResult {
  /* Auth için geliştirmede dahi örtük localhost yedeği kullanılmaz. */
  if (readRequiredProviderValue(env.APP_ORIGIN) === null) {
    return { ok: false };
  }
  const origin = readAppOrigin(env, nodeEnv);
  const secret = readAuthenticationSecret(env);
  const googleClientId = readRequiredProviderValue(env.AUTH_GOOGLE_ID);
  const googleClientSecret = readRequiredProviderValue(env.AUTH_GOOGLE_SECRET);

  if (
    !origin.ok ||
    !secret.ok ||
    googleClientId === null ||
    googleClientSecret === null
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    configuration: Object.freeze({
      origin: origin.origin,
      secret: secret.secret,
      googleClientId,
      googleClientSecret,
      secureCookies: nodeEnv === "production",
    }),
  };
}
