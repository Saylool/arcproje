import type { MetadataRoute } from "next";

import { BRAND_COLOR, SURFACE_LIGHT } from "@/lib/brand/mark";
import { translate } from "@/lib/i18n/dictionary";
import { DEFAULT_LOCALE } from "@/lib/i18n/locale";

/**
 * PWA MANİFESTİ — `/manifest.webmanifest`.
 *
 * NEDEN STATİK VE TEK DİLLİ: `<link rel="manifest">` varsayılan olarak çerez
 * GÖNDERMEZ, bu yüzden dil çerezine bakan bir manifest güvenilir çalışmaz.
 * Uygulamanın varsayılan dili Türkçedir ve kurulu uygulamanın adı da odur;
 * sayfa metinleri her zamanki gibi kullanıcının dilinde kalır.
 *
 * `theme_color` MARKA rengidir, sayfa zemini değil: manifest tek bir değer
 * alabilir ve kullanıcının açık/koyu tercihini izleyemez. Kasıtlı bir marka
 * rengi, yanlış tahmin edilmiş bir zeminden iyidir. Tarayıcı çubuğu ise
 * `layout.tsx` içindeki tema duyarlı `<meta name="theme-color">` ile ayarlanır.
 *
 * SERVİS ÇALIŞANI YOKTUR ve bilerek yoktur: sayfalar `no-store`'dur, bir
 * önbellek ödeme sayfasını ya da imzalı bir yükü saklayabilirdi.
 */
export default function manifest(): MetadataRoute.Manifest {
  const name = translate(DEFAULT_LOCALE, "app.name");
  return {
    name,
    short_name: name,
    description: translate(DEFAULT_LOCALE, "app.tagline"),
    lang: DEFAULT_LOCALE,
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: SURFACE_LIGHT,
    theme_color: BRAND_COLOR,
    icons: [
      /*
       * AYNI dosya iki amaçla da bildirilir. İşaret maskelenebilir güvenli
       * alanın (merkezi %80 çaplı daire) içinde kaldığı için ikinci bir
       * görsel gerekmez; `brand-mark.test.ts` bunu ölçer. Spec amaçları
       * boşlukla ayırmaya izin verse de Next'in tipi tek değer aldığı için
       * girişler ayrı yazılır.
       */
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
