import { cookies, headers } from "next/headers";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  resolveLocale,
  type Locale,
} from "./locale";

/**
 * İSTEĞİN DİLİNİ SUNUCUDA ÇÖZER.
 *
 * Bu modül YALNIZCA sunucuda çalışır: `next/headers` istemci paketine
 * giremez. Sunucu ile istemcinin ayrışmaması için asıl karar `./locale`
 * içindeki saf `resolveLocale` fonksiyonunda verilir; burası sadece iki
 * sinyali (çerez ve başlık) okuyup ona verir.
 *
 * URL'e HİÇBİR ŞEY EKLENMEZ: `/tr` veya `/en` gibi ön ekler yoktur, bu yüzden
 * `/`, `/pay`, `/pay/<billId>` ve bütün `/api/*` yolları değişmeden kalır.
 * Paylaşılmış bir ödeme bağlantısı herkeste AYNI adrestir ve onu AÇAN kişinin
 * kendi diliyle görünür.
 *
 * MALİYET: çerez ve başlık okumak rotayı dinamik render'a alır. Bu bilinçli
 * bir tercihtir — doğru dili SUNUCUDA basmadan "yanlış dilde bir an görünme"
 * ve hidrasyon uyuşmazlığı önlenemezdi.
 *
 * HATA DURUMU: okuma başarısız olursa Türkçeye düşülür (fail-safe).
 */
export async function resolveRequestLocale(): Promise<Locale> {
  try {
    const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
    return resolveLocale({
      cookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
      acceptLanguage: headerList.get("accept-language"),
    });
  } catch {
    return DEFAULT_LOCALE;
  }
}
