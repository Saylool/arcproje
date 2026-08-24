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

/** Depodan okunan tek borç satırı; kanonik Merkle indeksiyle birlikte. */
export type StoredSharedBillDebt = Readonly<{
  debtor: string;
  debtorLabel: string;
  debtKey: string;
  tryMinor: string;
  /** Kanıt üretimi için saklanan kanonik indeks. */
  leafIndex: number;
}>;

/** Depodan okunan hesap. Fiş, ürün veya kur verisi İÇERMEZ. */
export type StoredSharedBill = Readonly<{
  manifest: SharedBillManifest;
  signature: string;
  status: SharedBillStatus;
  /** TÜM satırlar — YALNIZCA sunucu tarafında; kanıt üretimi için gerekir. */
  debts: readonly StoredSharedBillDebt[];
}>;

export type ResolveAccessInput = Readonly<{
  billId: string;
  debtor: string;
  /** Tek kullanımlık değer; atomik olarak tüketilir. */
  nonce: string;
  nonceExpiresAt: number;
  /** Oturum jetonunun SHA-256 özeti; ham jeton ASLA gönderilmez. */
  sessionHash: string;
  sessionExpiresAt: number;
  chainId: number;
  nowMs: number;
}>;

/**
 * Erişim çözümlemesinin sonucu.
 *
 * `notFound` GENEL bir hatadır: hesabın olmaması, kapalı olması, süresinin
 * dolmuş olması ve bu adrese ait borç bulunmaması AYNI cevabı verir. Böylece
 * bir saldırgan "bu cüzdan bu hesapta var mı?" sorusunu YANIT ÜZERİNDEN
 * ayırt edemez.
 */
export type ResolveAccessOutcome =
  | { ok: true; bill: StoredSharedBill; debt: StoredSharedBillDebt }
  /** Nonce daha önce kullanılmış: tekrar oynatma. */
  | { ok: false; reason: "replay" }
  | { ok: false; reason: "notFound" }
  | { ok: false; reason: "unavailable" };

export type SessionLookupOutcome =
  | {
      ok: true;
      bill: StoredSharedBill;
      /** Oturumun bağlı olduğu, kimliği doğrulanmış borçlu. */
      debtor: string;
      debt: StoredSharedBillDebt;
    }
  | { ok: false; reason: "notFound" }
  | { ok: false; reason: "unavailable" };

export type SharedBillRepository = Readonly<{
  /**
   * Hesabı ve TÜM borç satırlarını ATOMİK olarak yazar.
   *
   * Kısmi bir yazma bırakmaz: satırlardan biri reddedilirse hesap da
   * yazılmaz. Çağıran, doğrulamanın TAMAMINI bu çağrıdan ÖNCE yapmış olmalıdır.
   */
  createSharedBill(record: SharedBillRecord): Promise<CreateSharedBillOutcome>;

  /**
   * Erişimi ATOMİK olarak çözer: nonce'u tüketir VE oturumu yaratır.
   *
   * Nonce tüketimi ile oturum yaratma aynı işlemdedir; ikisi birden olur ya
   * da hiçbiri olmaz. Aynı nonce ile eşzamanlı iki istek gelirse EN FAZLA
   * BİRİ başarılı olur.
   *
   * Çağıran, meydan okuma etiketini ve borçlunun EIP-712 imzasını bu
   * çağrıdan ÖNCE doğrulamış olmalıdır.
   */
  resolveAccess(input: ResolveAccessInput): Promise<ResolveAccessOutcome>;

  /**
   * Oturum özetinden hesabı ve kimliği doğrulanmış borçlunun satırını okur.
   *
   * Süresi dolmuş oturum ve hesap FİZİKSEL olarak silinmemiş olsa bile
   * KULLANILAMAZ sayılır.
   */
  readSession(input: {
    sessionHash: string;
    nowMs: number;
  }): Promise<SessionLookupOutcome>;
}>;
