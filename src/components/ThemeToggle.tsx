"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  applyTheme,
  oppositeTheme,
  readAppliedTheme,
  readStoredTheme,
  readSystemTheme,
  resolveTheme,
  writeStoredTheme,
  type Theme,
} from "@/lib/theme/theme";

/**
 * AYDINLIK / KARANLIK TEMA ANAHTARI.
 *
 * DIS SISTEME ABONELIK: tema React durumunda degil BELGEDE (`<html data-theme`)
 * yasar; onu erken baslatma betigi ilk boyamadan once yazar. Bu yuzden dogru
 * arac `useState + useEffect` degil `useSyncExternalStore`dur: DOM ve isletim
 * sistemi tercihi bir dis kaynaktir ve React ona ABONE olur.
 *
 * HIDRASYON: sunucu temayi bilemez, bu yuzden `getServerSnapshot` `null`
 * doner. React hidrasyonun ILK render'inda da bu anlik goruntuyu kullanir,
 * dolayisiyla sunucu ve istemci isaretlemesi BIREBIR aynidir; uyusmazlik
 * uyarisi olusmaz. Gercek tema hemen ardindan yeniden render ile gelir.
 *
 * PARLAMA (flash) YOK: dogru simge JavaScript'le degil CSS ile secilir
 * (`.theme-icon-light` / `.theme-icon-dark`). Durum henuz `null` iken bile
 * kullanici DOGRU simgeyi gorur, cunku `<html data-theme>` zaten yazilmistir.
 *
 * JAVASCRIPT YOKSA: tema CSS medya sorgusuyla sistem tercihine gore dogru
 * kalir; yalnizca dugme is gormez ve etiket notr kalarak yanlis vaatte
 * bulunmaz.
 */

const LABEL_TO_DARK = "Karanlık moda geç";
const LABEL_TO_LIGHT = "Aydınlık moda geç";
/** Tema henuz cozulmeden onceki, yaniltmayan notr etiket. */
const LABEL_NEUTRAL = "Temayı değiştir";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Anahtar temayi degistirdiginde aboneleri uyandiran kucuk yayin kanali. */
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Dis kaynaga abonelik.
 *
 * Iki olayi dinler: kullanicinin anahtara basmasi (yerel yayin) ve isletim
 * sistemi tercihinin degismesi. Sistem degisikligi YALNIZCA kayitli bir
 * tercih YOKKEN uygulanir — acik secim her zaman kazanir.
 *
 * Donen fonksiyon hem aboneyi hem de `matchMedia` dinleyicisini TEMIZLER.
 */
function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);

  let media: MediaQueryList | null = null;
  const onSystemChange = () => {
    if (readStoredTheme() !== null) {
      return;
    }
    applyTheme(readSystemTheme());
    emit();
  };

  try {
    media = globalThis.matchMedia?.(DARK_QUERY) ?? null;
    media?.addEventListener("change", onSystemChange);
  } catch {
    media = null;
  }

  return () => {
    listeners.delete(onStoreChange);
    try {
      media?.removeEventListener("change", onSystemChange);
    } catch {
      // Dinleyici zaten kaldirilmis olabilir; sessizce gecilir.
    }
  };
}

/**
 * Istemci anlik goruntusu: once BELGEYE yazilmis deger okunur (betigin
 * sonucu), yoksa ayni oncelik sirasi yeniden uygulanir. Yan etkisizdir.
 */
function getSnapshot(): Theme {
  return (
    readAppliedTheme() ??
    resolveTheme({ stored: readStoredTheme(), system: readSystemTheme() })
  );
}

/** Sunucuda tema BILINEMEZ; `null` hidrasyonun eslesmesini garanti eder. */
function getServerSnapshot(): Theme | null {
  return null;
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const current =
      readAppliedTheme() ??
      resolveTheme({ stored: readStoredTheme(), system: readSystemTheme() });
    const next = oppositeTheme(current);
    applyTheme(next);
    // Kaydetme basarisiz olsa bile tema bu oturumda uygulanmis kalir.
    writeStoredTheme(next);
    emit();
  }, []);

  const label =
    theme === null
      ? LABEL_NEUTRAL
      : theme === "dark"
        ? LABEL_TO_LIGHT
        : LABEL_TO_DARK;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={[
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
        "border border-line bg-card text-ink-soft",
        "transition-colors hover:bg-muted hover:text-ink",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        className ?? "",
      ].join(" ")}
    >
      {/* Aydinlik temada AY gorunur: eylem "karanliga gec". */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="theme-icon-light h-4 w-4"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
      </svg>
      {/* Karanlik temada GUNES gorunur: eylem "aydinliga gec". */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="theme-icon-dark h-4 w-4"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    </button>
  );
}
