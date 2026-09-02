"use client";

import Link from "next/link";

import { useTranslator } from "@/lib/i18n/context";

/**
 * Altbilgi.
 *
 * Tek işi gizlilik politikasına giden kalıcı bir bağlantı vermek: Play
 * Console politikanın herkese açık bir adreste durmasını şart koşuyor ve
 * kullanıcının onu uygulamanın içinden de bulabilmesi gerekiyor.
 */
export function SiteFooter() {
  const { t } = useTranslator();

  return (
    <footer
      aria-label={t("legal.footerLabel")}
      className="mx-auto flex w-full max-w-3xl justify-center px-4 py-6 sm:px-6"
    >
      <Link
        href="/privacy"
        className="rounded-full px-2 py-1 text-xs text-ink-faint underline underline-offset-4 hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {t("legal.privacyLink")}
      </Link>
    </footer>
  );
}
