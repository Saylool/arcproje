"use client";

import { useEffect } from "react";

import { LanguageSelect } from "@/components/LanguageSelect";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTranslator } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/dictionary";

/**
 * UYGULAMA BAŞLIĞI — marka, dil seçici ve tema anahtarı.
 *
 * Üç sayfada da AYNI bileşen kullanılır, böylece dil ve tema denetimleri
 * paylaşılan ödeme sayfası dâhil HER kullanıcı ekranında bulunur ve aynı
 * hizada durur.
 *
 * İSTEMCİ BİLEŞENİDİR çünkü marka adı ve denetimlerin etiketleri dil
 * değiştiğinde ANINDA güncellenmelidir. Sayfaların kendisi sunucu bileşeni
 * olarak KALIR; yalnızca bu küçük yaprak istemciye taşınır.
 *
 * `titleKey`: verilirse sekme başlığı da etkin dile göre güncellenir. Sunucu
 * zaten doğru dilde bir `<title>` basar; bu efekt yalnızca dil SAYFA AÇIKKEN
 * değiştiğinde başlığın geride kalmasını önler.
 */
export function AppHeader({
  titleKey,
  className,
}: {
  titleKey?: TranslationKey;
  className?: string;
}) {
  const { t, locale } = useTranslator();

  useEffect(() => {
    if (titleKey === undefined || typeof document === "undefined") {
      return;
    }
    document.title = t(titleKey);
  }, [t, titleKey, locale]);

  return (
    <div className={`flex items-center justify-between gap-3 ${className ?? ""}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand text-xs font-bold text-white"
        >
          ₺
        </span>
        <span className="truncate text-sm font-semibold tracking-tight text-ink">
          {t("app.name")}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <LanguageSelect />
        <ThemeToggle />
      </div>
    </div>
  );
}
