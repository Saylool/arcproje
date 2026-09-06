/**
 * DIŞ SAĞLAYICI ÇAĞRI BÜTÇESİ — saf politika. YALNIZCA SUNUCU.
 *
 * `quote-service.ts` içindeki önbellek, tek uçuş ve soğuma SÜREÇ İÇİDİR:
 * yalnızca tek bir Node.js örneğini korur. Vercel'de her soğuk başlangıç ve
 * her eşzamanlı sunucusuz örnek kendi kopyasını taşır, bu yüzden toplam
 * CoinGecko hızını hiçbir şey sınırlamaz — yeterince örnekle Demo kotası
 * yine tükenir.
 *
 * Bu modül o boşluğu kapatan politikanın SAF yarısıdır: kova hesabı ve
 * sınır. Veritabanına dokunmaz, saat okumaz; böylece tek başına sınanabilir
 * ve aynı hesap hem burada hem SQL'de birebir yapılabilir.
 */

/** Bugün tek sağlayıcı var; anahtar tablodaki şekil kısıtına uyar. */
export const COINGECKO_PROVIDER_KEY = "coingecko";

/**
 * Pencere genişliği. Sağlayıcı önbelleği ~60 sn tazelikte olduğu için kova
 * da bir dakikadır: aynı pencerede ikinci bir çağrı zaten yeni veri
 * getirmez.
 */
export const BUDGET_WINDOW_MS = 60 * 1000;

/**
 * Bir pencerede İZİN VERİLEN yukarı akış çağrısı sayısı.
 *
 * Neden 1 değil: tek örnekli ideal durumda dakikada bir çağrı yeter, ama
 * sınırı 1 yapmak soğuk başlangıçların birbirini açlığa itmesine yol açar —
 * pencerenin başında çağrıyı kapan örnek dışındaki herkes o dakika boyunca
 * kur alamaz. Küçük bir pay, örnek sayısını sınırlı tutarken bunu önler.
 *
 * Neden büyük değil: koruma buradan geliyor. Örnek sayısı ne olursa olsun
 * dakikada en fazla bu kadar kredi harcanır.
 */
export const BUDGET_CALLS_PER_WINDOW = 4;

/**
 * Unix milisaniyeyi kova numarasına çevirir: floor(epoch / 60).
 *
 * SQL tarafı da aynı hesabı yapar; bu yüzden dönüş değeri tam sayıdır ve
 * saat dilimine hiç bağlı değildir.
 */
export function budgetWindowStart(
  nowMs: number,
  windowMs: number = BUDGET_WINDOW_MS,
): number {
  return Math.floor(nowMs / windowMs);
}

/** Paylaşılan sayaca sorulan ayırmanın sonucu. */
export type ProviderBudgetOutcome =
  | {
      /** Çağrı yapılabilir; kredi bu örnek adına ayrıldı. */
      ok: true;
      /** Ayırmadan SONRA bu penceredeki toplam kullanım. */
      used: number;
    }
  | {
      ok: false;
      /**
       * `exhausted`: pencere doldu, çağrı yapılmamalı.
       * `unconfigured`: paylaşılan sayaç KURULU DEĞİL (`DATABASE_URL` yok).
       * `unavailable`: sayaç kurulu ama o an ULAŞILAMADI.
       *
       * Son ikisi ayrıdır ve karıştırılmamalıdır: biri bilinen bir dağıtım
       * durumu, öteki bir OLAYDIR. Yerel geliştirmede birincisi normaldir ve
       * günlüğe düşmez; üretimde ikincisi görülmelidir.
       */
      reason: "exhausted" | "unconfigured" | "unavailable";
    };

/**
 * Pencerenin bitmesine kalan saniye; çağırana "sonra dene" demek için.
 *
 * En az 1 döner: sıfır saniye beklemek çağıranı hemen geri getirir.
 */
export function windowRetryAfterSeconds(
  nowMs: number,
  windowMs: number = BUDGET_WINDOW_MS,
): number {
  const elapsed = nowMs - budgetWindowStart(nowMs, windowMs) * windowMs;
  return Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
}
