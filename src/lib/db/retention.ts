import { SHARED_BILL_MAX_LIFETIME_MS } from "@/lib/arc/shared-bill";

/**
 * SAKLAMA SÜRESİ — ortak hesap kayıtları.
 *
 * Bir hesap, süresi dolduktan sonra AÇILAMAZ ve ÖDENEMEZ hâle gelir; amacı
 * o anda biter. Kaydın veritabanında süresiz durması, biten bir amaç için
 * cüzdan adresi ve insan etiketi tutmak demektir.
 *
 * Süre dolar dolmaz silmek fazla serttir: birinin "ne oldu" diye sorması ve
 * bir sorunun fark edilmesi için pay bırakılır.
 *
 * BU DOSYA HİÇBİR ŞEY SİLMEZ. Yalnızca "hangi kayıtlar silinmeye uygun"
 * sorusunu ve her çalışmanın üst sınırını tanımlar; silmenin kendisi depo
 * katmanındadır.
 */

/** Süre dolduktan SONRA kaydın tutulmaya devam ettiği süre. */
export const BILL_RETENTION_AFTER_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Bir kaydın yaratıldığı andan silinmeye uygun hâle gelmesine kadar geçen
 * EN UZUN süre. Politikada geçen sayı budur.
 */
export const BILL_TOTAL_RETENTION_MS =
  SHARED_BILL_MAX_LIFETIME_MS + BILL_RETENTION_AFTER_EXPIRY_MS;

export const BILL_RETENTION_DAYS =
  BILL_TOTAL_RETENTION_MS / (24 * 60 * 60 * 1000);

/**
 * Bu andan ÖNCE süresi dolmuş kayıtlar silinmeye uygundur.
 *
 * Sınır tek yerde hesaplanır. Sorgu her zaman bu değeri alır; "şimdi"den
 * kendi başına bir eşik türeten ikinci bir yer olmaz.
 */
export function retentionCutoffMs(nowMs: number): number {
  return nowMs - BILL_RETENTION_AFTER_EXPIRY_MS;
}

/**
 * Süresi `expiresAtMs`te dolan bir kayıt, `nowMs` anında silinmeye uygun mu?
 *
 * Sınırın KENDİSİ uygun değildir: eşit olan an henüz geçmemiştir.
 */
export function isPastRetention(
  expiresAtMs: number,
  nowMs: number,
): boolean {
  return expiresAtMs < retentionCutoffMs(nowMs);
}

/**
 * Bir çalışmada silinecek EN FAZLA hesap sayısı.
 *
 * Sınırsız bir temizlik, birikmiş bir kuyrukta uzun süren tek bir işlem
 * demektir. Görev günlük çalıştığı için artan kısım ertesi gün gider; acele
 * edilecek bir şey yok.
 */
export const RETENTION_BATCH_LIMIT = 500;
