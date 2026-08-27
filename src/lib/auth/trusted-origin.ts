import { readAppOrigin } from "@/lib/db/shared-bill-auth";

const INVALID_AUTH_ORIGIN = "https://invalid.invalid";

/**
 * Auth.js v5, Next.js istek URL'sini normalde Host/forwarded-host'tan kurar.
 * Proje bunun yerine mevcut, açıkça yapılandırılan APP_ORIGIN modelini kullanır.
 * Eksik üretim yapılandırması gerçek bir origin'e sessizce düşmez.
 */
const resolved = readAppOrigin(process.env, process.env.NODE_ENV);

export const trustedAuthOrigin = resolved.ok
  ? resolved.origin
  : INVALID_AUTH_ORIGIN;
export const isTrustedAuthOriginConfigured = resolved.ok;

/*
 * next-auth'ın `reqWithEnvURL` sınırı AUTH_URL varsa her gelen istek origin'ini
 * onunla değiştirir. Değer istemci başlıklarından değil, doğrulanmış APP_ORIGIN
 * sonucundan gelir. Böylece Auth.js'nin zorunlu `trustHost` bayrağı açık olsa
 * bile OAuth callback/redirect origin'i Host başlığına dayanmaz.
 */
process.env.AUTH_URL = trustedAuthOrigin;

export function safeAuthRedirect(url: string): string {
  try {
    const destination = new URL(url, trustedAuthOrigin);
    return destination.origin === trustedAuthOrigin
      ? destination.toString()
      : trustedAuthOrigin;
  } catch {
    return trustedAuthOrigin;
  }
}
