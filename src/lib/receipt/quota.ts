/**
 * FİŞ ANALİZİ KOTASI — sınırlar ve saf yardımcılar.
 *
 * Google girişi vardı ama SAYI sınırı yoktu: oturum açmış bir kullanıcı
 * istediği kadar analiz çağırabiliyordu ve her çağrı OpenAI'de gerçek para
 * harcıyor. Üst sınırı olmayan tek maliyet buydu.
 *
 * İKİ SAYAÇ, İKİ FARKLI İŞ:
 *
 *  - Kullanıcı başına kota ADALET içindir; bir kişi diğerlerinin hakkını
 *    yiyemez. Tek başına faturayı KORUMAZ, çünkü Google hesabı açmak bedava.
 *  - Genel tavan FATURAYI korur; hesap sayısından bağımsızdır.
 */

/** Bir kullanıcının bir gün içinde yapabileceği analiz sayısı. */
export const DAILY_ANALYSES_PER_USER = 25;

/** Tüm kullanıcıların bir gün içinde yapabileceği TOPLAM analiz sayısı. */
export const DAILY_ANALYSES_TOTAL = 250;

/**
 * Genel sayacın anahtarı.
 *
 * Bir uuid asla `@` ile başlamaz; kullanıcı anahtarlarıyla çakışamaz ve bu
 * şemada bir CHECK kısıtıyla da zorlanır.
 */
export const GLOBAL_QUOTA_KEY = "@global";

/**
 * Günü UTC'ye göre `YYYY-MM-DD` verir.
 *
 * Sınırın hangi anda sıfırlandığı SUNUCU AYARINA bırakılmaz: `current_date`
 * veritabanının saat dilimine bağlıdır ve sessizce değişebilir.
 */
export function quotaDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Bir sayaçtan sonra kalan hak. Negatif olamaz. */
export function remainingAfter(used: number, limit: number): number {
  return Math.max(0, limit - used);
}
