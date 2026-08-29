import type { NextAuthConfig } from "next-auth";
import Google, { type GoogleProfile } from "next-auth/providers/google";

import { resolveGoogleIdentity } from "./app-user-service";
import type { AuthenticationConfiguration } from "./auth-runtime-config";
import { createNeonAppUserRepository } from "./neon-app-user-repository";
import { safeAuthRedirect } from "./trusted-origin";

type RepositoryFactory = typeof createNeonAppUserRepository;

/**
 * Auth.js yapılandırması bir adapter kullanmaz. OAuth tokenları yalnızca
 * protokol alışverişi sırasında Auth.js belleğinde bulunur; veritabanına ve
 * JWT oturumuna yazılmaz.
 */
export function createAuthConfig(
  authentication: AuthenticationConfiguration,
  createRepository: RepositoryFactory = createNeonAppUserRepository,
): NextAuthConfig {
  const secureCookies = authentication.secureCookies;
  return {
    secret: authentication.secret,
    providers: [
      Google({
        clientId: authentication.googleClientId,
        clientSecret: authentication.googleClientSecret,
        authorization: { params: { scope: "openid email profile" } },
        checks: ["pkce", "state", "nonce"],
        account() {
          // İleride yanlışlıkla adapter eklense bile OAuth token alanlarını at.
          return {};
        },
        async profile(profile: GoogleProfile) {
          if (
            profile.email_verified !== true ||
            typeof profile.sub !== "string" ||
            profile.sub.length === 0
          ) {
            throw new Error("Authentication unavailable");
          }
          const repository = await createRepository();
          if (repository === null) {
            throw new Error("Authentication unavailable");
          }
          const result = await resolveGoogleIdentity(
            {
              provider: "google",
              providerAccountId: profile.sub,
              email: profile.email,
              emailVerified: profile.email_verified,
              displayName: profile.name,
              avatarUrl: profile.picture,
            },
            repository,
          );
          if (!result.ok) {
            throw new Error("Authentication failed");
          }

          return {
            /* Auth.js bunu yalnızca geçici `account.providerAccountId` yapar. */
            id: profile.sub,
            /* Auth.js kendi geçici user.id değerini üretse de bu alan korunur. */
            appUserId: result.user.id,
            name: result.user.displayName,
            email: null,
            image: result.user.avatarUrl,
          };
        },
      }),
    ],
    session: {
      strategy: "jwt",
      maxAge: 30 * 24 * 60 * 60,
    },
    callbacks: {
      async signIn({ account, profile }) {
        return (
          account?.provider === "google" &&
          profile?.email_verified === true &&
          typeof profile.sub === "string" &&
          profile.sub.length > 0
        );
      },
      jwt({ token, user }) {
        /*
         * Beyaz liste: `account`taki access_token, refresh_token ve id_token
         * bu şifreli JWT-cookie'ye hiçbir zaman kopyalanmaz.
         */
        return {
          sub:
            typeof user?.appUserId === "string" ? user.appUserId : token.sub,
          name: user?.name ?? token.name ?? null,
          picture: user?.image ?? token.picture ?? null,
        };
      },
      session({ session, token }) {
        if (session.user && typeof token.sub === "string") {
          session.user.id = token.sub;
        }
        return session;
      },
      redirect({ url }) {
        return safeAuthRedirect(url, authentication.origin);
      },
    },
    pages: {
      error: "/auth/error",
    },
    /* Origin, yukarıda doğrulanmış APP_ORIGIN ile zorla değiştirilmiştir. */
    trustHost: true,
    useSecureCookies: secureCookies,
    cookies: {
      sessionToken: {
        name: `${secureCookies ? "__Secure-" : ""}authjs.session-token`,
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: secureCookies,
        },
      },
    },
    logger: {
      error() {
        console.error("[auth] Kimlik doğrulama başarısız.");
      },
      warn() {
        console.warn("[auth] Kimlik doğrulama uyarısı.");
      },
      debug() {
        // Sağlayıcı profili, URL'leri veya tokenları debug loguna yazma.
      },
    },
  };
}
