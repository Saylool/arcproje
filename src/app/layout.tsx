import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/SiteFooter";
import { LocaleProvider } from "@/lib/i18n/context";
import { translate } from "@/lib/i18n/dictionary";
import { resolveRequestLocale } from "@/lib/i18n/server";
import { THEME_INIT_SCRIPT } from "@/lib/theme/theme";

import "./globals.css";

/**
 * Baslik ve aciklama da istegin diline gore uretilir.
 *
 * URL DEGISMEZ: dil bir yol on ekiyle degil cerez ve `Accept-Language` ile
 * tasindigi icin `/`, `/pay` ve `/pay/<billId>` ayni adreslerde kalir.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale();
  return {
    title: translate(locale, "metadata.homeTitle"),
    description: translate(locale, "metadata.homeDescription"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  /*
   * DIL SUNUCUDA COZULUR ve hem `<html lang>` hem de saglayicinin baslangic
   * degeri olur. Istemci TAM OLARAK bu degerle hidrasyona girdigi icin sunucu
   * ile istemci ayrisamaz: yanlis dilde bir an gorunme ve hidrasyon
   * uyusmazligi olmaz.
   */
  const locale = await resolveRequestLocale();

  return (
    /*
     * `suppressHydrationWarning`: erken baslatma betigi `<html>` uzerine
     * `data-theme` ve `style.color-scheme` yazar. Bu, sunucunun urettigi
     * isaretlemede YOKTUR; React'in bu farki uyari olarak bildirmesi
     * engellenir. Bayrak YALNIZCA `<html>` ogesini kapsar, icerigi degil.
     *
     * `lang` bu bayraktan ETKILENMEZ: sunucu dogru degeri basar, istemci de
     * ayni degerle baslar. Dil degistiginde ozniteligi sadece saglayici
     * gunceller.
     */
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/*
          TEMA ILK BOYAMADAN ONCE UYGULANIR.
          Govde cizilmeden calisan engelleyici betik, sayfanin bir an yanlis
          temada gorunmesini ("theme flash") onler.

          Betik TAMAMEN SABITTIR: kullanici ya da sunucu verisi enterpole
          EDILMEZ, bu yuzden XSS yuzeyi yoktur. Icerik `theme.ts` icinde tek
          bir yerde tanimlidir ve onceligi `resolveTheme` ile birebir aynidir.

          DIL icin boyle bir betik GEREKMEZ: dogru metin zaten sunucuda
          basilir.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <LocaleProvider initialLocale={locale}>
          {children}
          <SiteFooter />
        </LocaleProvider>
      </body>
    </html>
  );
}
