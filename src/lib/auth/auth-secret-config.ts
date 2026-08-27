/** Auth.js oturum sırrının uygulama tarafından zorunlu tutulan biçimi. */
const AUTH_SECRET_PATTERN = /^[0-9a-f]{64}$/;

export type AuthenticationSecretResult =
  | { ok: true; secret: string }
  | { ok: false };

/**
 * Tam 32 baytı temsil eden 64 küçük hex karakteri kabul eder.
 * Değer bilerek trim edilmez: çevresindeki boşluklar yapılandırma hatasıdır.
 */
export function readAuthenticationSecret(
  env: Readonly<Record<string, string | undefined>>,
): AuthenticationSecretResult {
  const secret = env.AUTH_SECRET;
  return typeof secret === "string" && AUTH_SECRET_PATTERN.test(secret)
    ? { ok: true, secret }
    : { ok: false };
}
