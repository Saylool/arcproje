import type { AuthenticationRuntimeResolution } from "./auth-runtime";

export function createAuthenticationActions(
  resolveRuntime: () => AuthenticationRuntimeResolution,
) {
  return {
    async beginGoogleSignIn() {
      const resolved = resolveRuntime();
      if (resolved.status === "unavailable") return;
      await resolved.runtime.beginGoogleSignIn();
    },
    async endSession() {
      const resolved = resolveRuntime();
      if (resolved.status === "unavailable") return;
      await resolved.runtime.endSession();
    },
    /**
     * Hesap silindikten SONRA çağrılır: çerez o anda ölür, kullanıcı ana
     * sayfaya fırlatılmaz ve sonucu görebilir.
     *
     * Bu YALNIZCA isteği gönderen tarayıcıyı etkiler. Başka bir cihazdaki
     * oturum JWT'siyle çalışmaya devam eder; onu kapatan şey, analiz ucundaki
     * "kullanıcı hâlâ var mı" kontrolüdür.
     */
    async endSessionWithoutRedirect() {
      const resolved = resolveRuntime();
      if (resolved.status === "unavailable") return;
      await resolved.runtime.endSessionWithoutRedirect();
    },
  };
}
