import type { SharedBillDebt, SharedBillManifest } from "@/lib/arc/shared-bill";

/**
 * Paylaşılan hesap deposunun SINIRI (repository boundary).
 *
 * İş kuralları bu arayüze bağlıdır, Neon'a değil. Böylece rota ve doğrulama
 * mantığı gerçek bir veritabanı olmadan test edilebilir; testler enjekte
 * edilen sahte bir depo kullanır.
 *
 * Bu modül SAF tiptir: hiçbir sürücü import etmez, bu yüzden istemci paketine
 * girse bile veritabanı kodu taşımaz.
 */

/** Depoya yazılacak eksiksiz kayıt. Kur, fiş ve ürün verisi İÇERMEZ. */
export type SharedBillRecord = Readonly<{
  manifest: SharedBillManifest;
  debts: readonly SharedBillDebt[];
  signature: string;
}>;

/**
 * Hesabın durumu.
 *
 * `open` yalnızca "hesap hâlâ paylaşılabilir" demektir. Ödemenin yapıldığını
 * ya da borcun kapandığını İDDİA ETMEZ; ödeme kesinleştirme Part 2'dedir.
 */
export type SharedBillStatus = "open" | "closed";

export type CreateSharedBillOutcome =
  /** Yeni kayıt atomik olarak yazıldı. */
  | { ok: true; created: true }
  /**
   * Aynı kimlikte BİREBİR AYNI kayıt zaten vardı (taahhüt ve imza eşleşti):
   * güvenli tekrar (idempotent). Yeniden yazılmadı.
   */
  | { ok: true; created: false }
  /**
   * Aynı kimlikte FARKLI bir kayıt var. Bu 256 bitlik bir kimlikte pratikte
   * imkânsızdır; yine de sessizce üzerine YAZILMAZ.
   */
  | { ok: false; reason: "idConflict" }
  /** Veritabanı kısıtı reddetti (benzersizlik, pozitiflik, yabancı anahtar). */
  | { ok: false; reason: "constraint" }
  /** Depo yapılandırılmamış veya erişilemiyor. */
  | { ok: false; reason: "unavailable" };

export type SharedBillRepository = Readonly<{
  /**
   * Hesabı ve TÜM borç satırlarını ATOMİK olarak yazar.
   *
   * Kısmi bir yazma bırakmaz: satırlardan biri reddedilirse hesap da
   * yazılmaz. Çağıran, doğrulamanın TAMAMINI bu çağrıdan ÖNCE yapmış olmalıdır.
   */
  createSharedBill(record: SharedBillRecord): Promise<CreateSharedBillOutcome>;
}>;
