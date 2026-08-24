import type { Metadata } from "next";
import type { ReactNode } from "react";

import { THEME_INIT_SCRIPT } from "@/lib/theme/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "Hesabı Böl — Fişini yükle",
  description:
    "Fişini yükle, ürünleri arkadaşlarına dağıt, herkesin payını hesapla.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    /*
     * `suppressHydrationWarning`: erken baslatma betigi `<html>` uzerine
     * `data-theme` ve `style.color-scheme` yazar. Bu, sunucunun urettigi
     * isaretlemede YOKTUR; React'in bu farki uyari olarak bildirmesi
     * engellenir. Bayrak YALNIZCA `<html>` ogesini kapsar, icerigi degil.
     */
    <html lang="tr" suppressHydrationWarning>
      <head>
        {/*
          TEMA ILK BOYAMADAN ONCE UYGULANIR.
          Govde cizilmeden calisan engelleyici betik, sayfanin bir an yanlis
          temada gorunmesini ("theme flash") onler.

          Betik TAMAMEN SABITTIR: kullanici ya da sunucu verisi enterpole
          EDILMEZ, bu yuzden XSS yuzeyi yoktur. Icerik `theme.ts` icinde tek
          bir yerde tanimlidir ve onceligi `resolveTheme` ile birebir aynidir.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
