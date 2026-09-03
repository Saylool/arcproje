import type { Metadata } from "next";

import { AccountDeletionPanel } from "@/components/AccountDeletionPanel";
import { AppHeader } from "@/components/AppHeader";
import { GoogleSignInButton } from "@/components/AuthControl";
import { readSafeAuthState } from "@/lib/auth/safe-auth-state";
import { translate } from "@/lib/i18n/dictionary";
import { resolveRequestLocale } from "@/lib/i18n/server";

/**
 * HESAP SAYFASI — `/account`.
 *
 * Google Play, hesap açtıran uygulamalardan İKİ şey ister: uygulama içinde
 * hesabı silme yolu ve silme talebi için herkesin açabileceği bir web adresi.
 * Bu sayfa ikisini de karşılar; mağaza girişine verilecek adres budur.
 *
 * `/privacy` gibi burada da dil yol ön eki YOKTUR, metin isteğin diline göre
 * seçilir; adres tek ve kalıcıdır.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale();
  return {
    title: translate(locale, "metadata.accountTitle"),
    description: translate(locale, "metadata.accountDescription"),
  };
}

export default async function AccountPage() {
  const locale = await resolveRequestLocale();
  const authState = await readSafeAuthState();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16">
      <header>
        <AppHeader titleKey="metadata.accountTitle" authState={authState} />
      </header>

      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {translate(locale, "account.heading")}
        </h1>

        {authState.status === "authenticated" ? (
          <AccountDeletionPanel />
        ) : (
          /*
           * Oturum yoksa silinecek bir kayıt da yoktur. Sayfa yine de AÇILIR:
           * mağaza girişindeki adres herkese açık olmalı ve silmenin nasıl
           * istendiğini oturum açmadan da anlatmalıdır.
           */
          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4">
            <h2 className="text-base font-semibold text-ink">
              {translate(locale, "account.signedOutTitle")}
            </h2>
            <p className="text-sm leading-relaxed text-ink-soft">
              {translate(locale, "account.signedOutBody")}
            </p>
            <div>
              <GoogleSignInButton
                disabled={authState.status === "unavailable"}
              />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
