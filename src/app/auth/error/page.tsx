import Link from "next/link";

import { AppHeader } from "@/components/AppHeader";
import { translate } from "@/lib/i18n/dictionary";
import { resolveRequestLocale } from "@/lib/i18n/server";

export default async function AuthenticationErrorPage() {
  const locale = await resolveRequestLocale();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16">
      <header>
        <AppHeader
          titleKey="metadata.authErrorTitle"
          authState={{ status: "signedOut" }}
        />
      </header>
      <section className="rounded-3xl border border-danger-line bg-danger-surface p-5 shadow-card">
        <h1 className="text-xl font-semibold text-danger-ink">
          {translate(locale, "auth.failureTitle")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-danger-ink">
          {translate(locale, "auth.failureMessage")}
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-h-11"
        >
          {translate(locale, "auth.backHome")}
        </Link>
      </section>
    </main>
  );
}
