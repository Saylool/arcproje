import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/SiteFooter";
import { SURFACE_DARK, SURFACE_LIGHT } from "@/lib/brand/mark";
import { LocaleProvider } from "@/lib/i18n/context";
import { translate } from "@/lib/i18n/dictionary";
import { resolveRequestLocale } from "@/lib/i18n/server";
import { CSP_NONCE_REQUEST_HEADER } from "@/lib/security/headers";
import { THEME_INIT_SCRIPT } from "@/lib/theme/theme";

import "./globals.css";

/**
 * Tarayıcı çubuğunun rengi SAYFA ZEMİNİYLE aynı olur.
 *
 * Yalnızca işletim sistemi tercihini izleyebilir: kullanıcının uygulama
 * içinden seçtiği tema `localStorage`'ta yaşar ve statik bir meta etiketi onu
 * göremez. Kurulu uygulamanın rengi ise manifestten gelir ve markadır.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: SURFACE_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: SURFACE_DARK },
  ],
};

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
  /*
   * NONCE `src/proxy.ts`'ten gelir. Tema betigi satir icidir ve CSP artik
   * satir ici betige yalnizca bu damgayla izin verir. Proxy calismadiysa
   * (yerel test kosumu gibi) CSP de yoktur; `undefined` dogru davranistir.
   */
  const nonce =
    (await headers()).get(CSP_NONCE_REQUEST_HEADER) ?? undefined;

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

          `nonce`: CSP satir ici betigi yalnizca bu damgayla calistirir.

          DIL icin boyle bir betik GEREKMEZ: dogru metin zaten sunucuda
          basilir.
        */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
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
