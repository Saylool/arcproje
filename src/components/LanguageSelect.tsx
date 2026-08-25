"use client";

import { useId } from "react";

import { useLocale, useTranslator } from "@/lib/i18n/context";
import { LOCALES, isLocale } from "@/lib/i18n/locale";

/**
 * DİL SEÇİCİ.
 *
 * NEDEN YERLİ `<select>`: klavye gezinmesi, ekran okuyucu duyurusu, mobil
 * yerel seçim arayüzü ve odak yönetimi tarayıcıdan HAZIR gelir. Özel bir
 * açılır liste bunların hepsini elle ve daha kırılgan biçimde yeniden
 * yazmak olurdu.
 *
 * SEÇENEK ADLARI ÇEVRİLMEZ: her dil KENDİ adıyla yazılır ("Türkçe",
 * "English"). Böylece kullanıcı hangi dilde olursa olsun aradığı seçeneği
 * okuyabilir. Bayrak KULLANILMAZ: bayrak ülkeyi anlatır, dili değil.
 *
 * ERİŞİLEBİLİR ETİKET dile göre değişir ("Dil seçimi" / "Select language") ve
 * hem görünmez bir `<label>` hem de `aria-label` ile verilir.
 *
 * DEĞİŞİM SAYFAYI YENİLEMEZ: yalnızca bağlam değeri güncellenir, ağaç
 * SÖKÜLMEZ; akıştaki fiş, kişiler, atamalar ve cüzdan durumu korunur.
 *
 * TEMA: renkler anlamsal belirteçlerden gelir, bu yüzden aydınlık ve karanlık
 * temada aynı bileşen doğru görünür. Açılır listenin kendisi `<html>`
 * üzerindeki `color-scheme` sayesinde doğru temada çizilir.
 */
export function LanguageSelect({ className }: { className?: string }) {
  const selectId = useId();
  const { locale, setLocale } = useLocale();
  const { t } = useTranslator();

  const label = t("language.label");

  return (
    <div className={`relative inline-flex shrink-0 ${className ?? ""}`}>
      <label htmlFor={selectId} className="sr-only">
        {label}
      </label>
      <select
        id={selectId}
        value={locale}
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value;
          if (isLocale(next)) {
            setLocale(next);
          }
        }}
        className={[
          "h-8 appearance-none rounded-full border border-line bg-card",
          "py-0 pl-3 pr-7 text-xs font-medium text-ink-soft",
          "transition-colors hover:bg-muted hover:text-ink",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        ].join(" ")}
      >
        {LOCALES.map((option) => (
          <option key={option} value={option}>
            {t(`language.${option}`)}
          </option>
        ))}
      </select>
      {/* Yerli ok gizlendiği icin kendi gostergemiz cizilir. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
