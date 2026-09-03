"use client";

import Link from "next/link";

import { useTranslator } from "@/lib/i18n/context";

const LINK_CLASS =
  "rounded-full px-2 py-1 text-xs text-ink-faint underline underline-offset-4 hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * Altbilgi.
 *
 * İşi iki kalıcı bağlantı vermek. Play Console ikisini de şart koşuyor ve
 * ikisinin de uygulamanın İÇİNDEN bulunabilmesi gerekiyor:
 *
 *   - gizlilik politikası, herkese açık bir adreste;
 *   - hesap silme, hesap açtıran her uygulamada uygulama içi bir yol olarak.
 */
export function SiteFooter() {
  const { t } = useTranslator();

  return (
    <footer
      aria-label={t("legal.footerLabel")}
      className="mx-auto flex w-full max-w-3xl justify-center gap-3 px-4 py-6 sm:px-6"
    >
      <Link href="/privacy" className={LINK_CLASS}>
        {t("legal.privacyLink")}
      </Link>
      <Link href="/account" className={LINK_CLASS}>
        {t("legal.accountLink")}
      </Link>
    </footer>
  );
}
