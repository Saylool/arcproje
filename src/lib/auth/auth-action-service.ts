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
  };
}
