"use client";

import { useTranslator } from "@/lib/i18n/context";

/**
 * `/pay` sayfasinin metin parcalari.
 *
 * Sayfanin kendisi SUNUCU BILESENI olarak kalir; yalnizca dil degistiginde
 * aninda guncellenmesi gereken bu iki kucuk parca istemciye tasinir.
 */

export function PayPageIntro() {
  const { t } = useTranslator();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        {t("payer.pageTitle")}
      </h1>
      <p className="text-sm leading-relaxed text-ink-faint sm:text-base">
        {t("payer.pageDescription")}
      </p>
    </div>
  );
}

/** `Suspense` beklerken gosterilen metin de cevrilir. */
export function PayPageFallback() {
  const { t } = useTranslator();
  return <p className="text-sm text-ink-faint">{t("payer.loadingRequest")}</p>;
}
