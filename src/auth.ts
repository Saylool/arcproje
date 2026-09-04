import NextAuth from "next-auth";

import { createAuthConfig } from "@/lib/auth/auth-config";
import { createAuthenticationRuntimeResolver } from "@/lib/auth/auth-runtime";
import { readAuthenticationConfiguration } from "@/lib/auth/auth-runtime-config";

const resolveRuntime = createAuthenticationRuntimeResolver({
  readConfiguration: () =>
    readAuthenticationConfiguration(process.env, process.env.NODE_ENV),
  initialize(configuration) {
    /*
     * Auth.js v5 URL üretiminde AUTH_URL okur. Yalnızca bütün auth girdileri
     * doğrulandıktan sonra, doğrulanmış APP_ORIGIN ile sabitlenir.
     */
    process.env.AUTH_URL = configuration.origin;
    const instance = NextAuth(createAuthConfig(configuration));
    return {
      handle: (method, request) => instance.handlers[method](request as never),
      readSession: () => instance.auth(),
      beginGoogleSignIn: () => instance.signIn("google", { redirectTo: "/" }),
      endSession: () => instance.signOut({ redirectTo: "/" }),
      endSessionWithoutRedirect: () => instance.signOut({ redirect: false }),
    };
  },
});

/** Modül yüklenirken Auth.js başlatılmaz; ilk kullanımda güvenli biçimde çözülür. */
export function resolveAuthenticationRuntime() {
  return resolveRuntime();
}
