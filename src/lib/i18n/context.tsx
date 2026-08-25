"use client";

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  splitTemplate,
  translate,
  translatePlural,
  type PluralKey,
  type TranslationKey,
  type TranslationParams,
} from "./dictionary";
import {
  DEFAULT_LOCALE,
  isLocale,
  serializeLocaleCookie,
  type Locale,
} from "./locale";

/**
 * DİL BAĞLAMI — istemci tarafı.
 *
 * SUNUCU İLE İSTEMCİ AYNI DİLE VARIR: sunucu isteği çözer (çerez ->
 * `Accept-Language` -> Türkçe), sonucu `<html lang>` içine yazar ve buraya
 * `initialLocale` olarak verir. İstemci durumu TAM OLARAK bu değerle başlar,
 * bu yüzden ilk render sunucununkiyle birebir aynıdır: hidrasyon uyuşmazlığı
 * ve yanlış dilde bir an görünme ("flash") yapısal olarak mümkün değildir.
 *
 * DİL DEĞİŞİMİ SAYFAYI YENİLEMEZ. Yalnızca bu bağlamın değeri değişir;
 * ağacın altındaki bileşenler YENİDEN RENDER edilir ama SÖKÜLMEZ. Bu yüzden
 * yüklenmiş fiş, analiz sonucu, kişiler, atamalar, borç hesabı ve cüzdan /
 * ödeme durumu OLDUĞU GİBİ KALIR.
 *
 * Tercih tek bir çereze yazılır. Sunucuya, veritabanına veya üçüncü bir
 * tarafa GÖNDERİLMEZ; tema tercihinden tamamen bağımsızdır (tema
 * `localStorage`ta yaşar), bu yüzden biri diğerini sıfırlayamaz.
 */

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Tercihi belgeye yazar.
 *
 * Çerez yazılamıyorsa (gizli sekme, devre dışı çerezler) hata YUTULUR: dil
 * bu oturumda yine değişir, yalnızca kalıcı olmaz. Dil değiştirme hiçbir
 * koşulda uygulamayı düşürmez.
 */
function persistLocale(locale: Locale): void {
  try {
    if (typeof document === "undefined") {
      return;
    }
    document.cookie = serializeLocaleCookie(locale);
  } catch {
    // Yok sayılır; tercih yalnızca bu oturumda geçerli olur.
  }
}

/** `<html lang>` etkin dille aynı kalmalı: ekran okuyucular buna bakar. */
function applyDocumentLanguage(locale: Locale): void {
  try {
    const element = globalThis.document?.documentElement;
    if (element === undefined || element === null) {
      return;
    }
    element.setAttribute("lang", locale);
  } catch {
    // DOM erişilemiyorsa yapacak bir şey yok.
  }
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    isLocale(initialLocale) ? initialLocale : DEFAULT_LOCALE,
  );

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) {
      return;
    }
    setLocaleState(next);
    applyDocumentLanguage(next);
    persistLocale(next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

/**
 * Etkin dil ve dili değiştiren fonksiyon.
 *
 * Sağlayıcı yoksa (izole bir ağaç, bir test) Türkçeye düşülür ve değiştirme
 * işlemsizdir; eksik bir sağlayıcı uygulamayı çökertmez.
 */
export function useLocale(): LocaleContextValue {
  return (
    useContext(LocaleContext) ?? {
      locale: DEFAULT_LOCALE,
      setLocale: () => undefined,
    }
  );
}

export type Translator = {
  locale: Locale;
  /** Düz metin çevirisi. */
  t: (key: TranslationKey, params?: TranslationParams) => string;
  /** Sayıya bağlı çeviri. */
  tp: (key: PluralKey, count: number, params?: TranslationParams) => string;
  /**
   * Cümlenin ortasına React düğümü koyan çeviri.
   *
   * Sözlükten gelen parçalar METİN olarak basılır; yalnızca ÇAĞIRANIN verdiği
   * düğümler işaretleme olabilir. Çeviri metni HTML enjekte EDEMEZ.
   */
  tRich: (
    key: TranslationKey,
    slots: Readonly<Record<string, ReactNode>>,
  ) => ReactNode;
};

export function useTranslator(): Translator {
  const { locale } = useLocale();

  return useMemo<Translator>(
    () => ({
      locale,
      t: (key, params) => translate(locale, key, params),
      tp: (key, count, params) => translatePlural(locale, key, count, params),
      tRich: (key, slots) => {
        const template = translate(locale, key);
        return splitTemplate(template).map((segment, index) => (
          <Fragment key={index}>
            {segment.kind === "text"
              ? segment.value
              : (slots[segment.name] ?? `{${segment.name}}`)}
          </Fragment>
        ));
      },
    }),
    [locale],
  );
}
