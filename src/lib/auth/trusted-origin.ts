/**
 * OAuth sonrası hedef yalnızca daha önce doğrulanmış APP_ORIGIN olabilir.
 * Bu saf yardımcı ortamı okumaz veya değiştirmez.
 */
export function safeAuthRedirect(url: string, trustedOrigin: string): string {
  try {
    const destination = new URL(url, trustedOrigin);
    return destination.origin === trustedOrigin
      ? destination.toString()
      : trustedOrigin;
  } catch {
    return trustedOrigin;
  }
}
