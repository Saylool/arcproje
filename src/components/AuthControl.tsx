"use client";

import { useFormStatus } from "react-dom";

import { endGoogleSession, startGoogleSignIn } from "@/app/auth-actions";
import { useTranslator } from "@/lib/i18n/context";

export type SafeAuthUser = Readonly<{
  name: string | null;
  image: string | null;
}>;

function GoogleButtonContent() {
  const { pending } = useFormStatus();
  const { t } = useTranslator();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="inline-flex min-h-9 items-center justify-center rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? t("auth.loading") : t("auth.continueWithGoogle")}
    </button>
  );
}

export function GoogleSignInButton() {
  return (
    <form action={startGoogleSignIn}>
      <GoogleButtonContent />
    </form>
  );
}

function SignOutButton() {
  const { pending } = useFormStatus();
  const { t } = useTranslator();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="rounded-full px-2.5 py-1 text-xs font-semibold text-ink-faint transition-colors hover:bg-muted-strong hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? t("auth.loading") : t("auth.signOut")}
    </button>
  );
}

export function AuthControl({ user }: { user: SafeAuthUser | null }) {
  const { t } = useTranslator();

  if (user === null) return <GoogleSignInButton />;

  return (
    <div
      className="flex max-w-48 items-center gap-1.5 rounded-full border border-line bg-card p-1"
      aria-label={t("auth.signedInState")}
    >
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- doğrulanmış HTTPS profil URL'si; boyut küçük ve sağlayıcı değişkendir
        <img
          src={user.image}
          alt=""
          referrerPolicy="no-referrer"
          className="h-7 w-7 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-ink"
        >
          G
        </span>
      )}
      <span className="min-w-0 truncate text-xs font-medium text-ink-soft">
        {user.name ?? t("auth.safeFallbackName")}
      </span>
      <form action={endGoogleSession}>
        <SignOutButton />
      </form>
    </div>
  );
}
