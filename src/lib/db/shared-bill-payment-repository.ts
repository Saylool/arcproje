/**
 * ÖDEME YAŞAM DÖNGÜSÜNÜN DEPO SINIRI.
 *
 * Bu modül SAF tiptir: hiçbir sürücü import etmez. İş kuralları Neon'a değil
 * bu arayüze bağlanır; testler enjekte edilen sahte bir depo kullanır ve
 * hiçbir zaman gerçek bir veritabanına gitmez.
 *
 * ÖNEMLİ SINIR — BU BİR AKILLI SÖZLEŞME DEĞİLDİR. Buradaki rezervasyon,
 * UYGULAMA DÜZEYİNDE bir kilittir: aynı borcun uygulama üzerinden iki cihazdan
 * aynı anda ödenmesini engeller. Kullanıcının kendi cüzdanından, uygulamanın
 * DIŞINDA ikinci bir ERC-20 transferi göndermesini ENGELLEYEMEZ ve zincir üstü
 * bir TEK KULLANIM garantisi VERMEZ.
 */

/*
 * ---------------------------------------------------------------------------
 * DURUM MAKİNELERİ
 * ---------------------------------------------------------------------------
 */

/**
 * Borcun ödeme durumu.
 *
 *   unpaid ──claim──> reserved ──onaylı makbuz──> paid (SON)
 *     ^                  │
 *     │                  ├── kanıtlı yayın öncesi hata ──> unpaid
 *     │                  ├── onaylı REVERT makbuzu ──────> unpaid
 *     └──────────────────┘
 *                        └── belirsiz sonuç ────────> review_required
 *
 *   review_required ── onaylı makbuz ──> paid
 *   review_required ── OTOMATİK ──/──> unpaid   (ASLA; elle mutabakat)
 *   paid ──/──> herhangi bir durum              (ASLA geri dönmez)
 */
export type DebtPaymentStatus = "unpaid" | "reserved" | "paid" | "review_required";

/**
 * Ödeme denemesinin durumu.
 *
 *   reserved ── istemci hash bildirdi ──────> submitted
 *   reserved ── KANITLI yayın öncesi hata ──> released   (SON)
 *   reserved | submitted ── onaylı makbuz ──> confirmed  (SON)
 *   reserved | submitted ── revert makbuzu ─> reverted   (SON)
 *   reserved | submitted ── çözülemedi ─────> unknown    (SON)
 *
 * `confirmed`, `reverted`, `unknown` ve `released` SON durumlardır.
 */
export type PaymentAttemptStatus =
  | "reserved"
  | "submitted"
  | "confirmed"
  | "reverted"
  | "unknown"
  | "released";

/** Rezervasyonu HÂLÂ TUTAN durumlar. `unknown` de tutar: kendiliğinden açılmaz. */
export const ACTIVE_ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] =
  Object.freeze(["reserved", "submitted", "unknown"]);

export function isActiveAttemptStatus(status: PaymentAttemptStatus): boolean {
  return ACTIVE_ATTEMPT_STATUSES.includes(status);
}

/** Denemenin yerleşim (settlement) sonucu. `submitted` burada YOKTUR. */
export type AttemptSettlement = "confirmed" | "reverted" | "unknown" | "released";

/**
 * İzin verilen deneme geçişleri. Listede olmayan HER geçiş reddedilir.
 *
 * SON durumlardan çıkış YOKTUR: `confirmed`, `reverted`, `unknown` ve
 * `released` hiçbir koşulda başka bir duruma taşınmaz. Belirsiz bir deneme
 * OTOMATİK olarak serbest bırakılmaz.
 */
const ALLOWED_SETTLEMENTS: Readonly<
  Record<PaymentAttemptStatus, readonly AttemptSettlement[]>
> = Object.freeze({
  reserved: Object.freeze<AttemptSettlement[]>([
    "confirmed",
    "reverted",
    "unknown",
    "released",
  ]),
  // Yayın SONRASI: serbest bırakma YOKTUR.
  submitted: Object.freeze<AttemptSettlement[]>([
    "confirmed",
    "reverted",
    "unknown",
  ]),
  confirmed: Object.freeze<AttemptSettlement[]>([]),
  reverted: Object.freeze<AttemptSettlement[]>([]),
  unknown: Object.freeze<AttemptSettlement[]>([]),
  released: Object.freeze<AttemptSettlement[]>([]),
});

export function isAllowedSettlement(
  from: PaymentAttemptStatus,
  to: AttemptSettlement,
): boolean {
  return ALLOWED_SETTLEMENTS[from].includes(to);
}

/**
 * Bir yerleşimin borcu hangi duruma taşıdığı.
 *
 * `confirmed` → `paid` YALNIZCA sunucunun doğruladığı makbuzla yazılır.
 * `reverted` → `unpaid`: zincir işlemin GERÇEKLEŞMEDİĞİNİ kanıtladı; yeni bir
 * deneme AÇIK ve GÜVENLİ bir geçişle mümkündür.
 * `unknown` → `review_required`: kilit KALIR, otomatik tekrar YOKTUR.
 * `released` → `unpaid`: yalnızca KANITLI yayın öncesi hatalar buraya girer.
 */
export function debtStatusAfterSettlement(
  settlement: AttemptSettlement,
): DebtPaymentStatus {
  switch (settlement) {
    case "confirmed":
      return "paid";
    case "unknown":
      return "review_required";
    case "reverted":
    case "released":
      return "unpaid";
  }
}

/*
 * ---------------------------------------------------------------------------
 * KAYITLAR
 * ---------------------------------------------------------------------------
 */

/**
 * Sunucunun bastığı YETKİLİ teklif.
 *
 * Tutar, kur, alıcı ve borç İSTEMCİDEN GELMEZ: hepsi saklanan hesaptan ve
 * sunucunun kur servisinden türetilir. Tam sayı alanlar KANONİK ondalık
 * metindir (bkz. `@/lib/arc/minor-units`).
 */
export type StoredPaymentOffer = Readonly<{
  offerId: string;
  billId: string;
  debtor: string;
  recipient: string;
  tryMinor: string;
  quoteId: string;
  rateNumerator: string;
  rateDenominator: string;
  /** Unix saniye. */
  quoteIssuedAt: number;
  quoteExpiresAt: number;
  microUsdc: string;
  issuedAt: number;
  expiresAt: number;
  /** Teklif bir denemeye dönüştüyse dolu; ikinci kez kullanılamaz. */
  consumedAt: number | null;
}>;

/** Borcu rezerve eden deneme. */
export type StoredPaymentAttempt = Readonly<{
  attemptId: string;
  billId: string;
  debtor: string;
  recipient: string;
  offerId: string;
  quoteId: string;
  rateNumerator: string;
  rateDenominator: string;
  tryMinor: string;
  microUsdc: string;
  status: PaymentAttemptStatus;
  txHash: string | null;
  /** Unix saniye. */
  reservedAt: number;
  expiresAt: number;
  confirmedAt: number | null;
}>;

/*
 * ---------------------------------------------------------------------------
 * İŞLEMLER
 * ---------------------------------------------------------------------------
 */

export type CreatePaymentOfferInput = Readonly<{
  offer: Omit<StoredPaymentOffer, "consumedAt">;
  nowMs: number;
}>;

export type CreatePaymentOfferOutcome =
  | { ok: true; offer: StoredPaymentOffer }
  /** Hesap yok/kapalı/süresi dolmuş ya da bu adrese ait borç yok. */
  | { ok: false; reason: "notFound" }
  /** Borç ödenmiş, rezerve, inceleme bekliyor: teklif basılmaz. */
  | { ok: false; reason: "notClaimable"; debtStatus: DebtPaymentStatus }
  | { ok: false; reason: "constraint" }
  | { ok: false; reason: "unavailable" };

export type ClaimPaymentAttemptInput = Readonly<{
  billId: string;
  offerId: string;
  /** Kriptografik olarak rastgele deneme kimliği (0x + 64 hex). */
  attemptId: string;
  /** Oturumdan gelen, KİMLİĞİ DOĞRULANMIŞ borçlu. */
  debtor: string;
  /** Oturum jetonunun ÖZETİ; ham jeton ASLA gönderilmez. */
  sessionHash: string;
  nowMs: number;
}>;

export type ClaimPaymentAttemptOutcome =
  | { ok: true; attempt: StoredPaymentAttempt }
  /** Bu borç için zaten aktif bir deneme var (başka cihaz/oturum olabilir). */
  | { ok: false; reason: "alreadyActive" }
  /** Borç ödenmiş, rezerve ya da inceleme bekliyor. */
  | { ok: false; reason: "notClaimable"; debtStatus: DebtPaymentStatus }
  /** Teklif yok, süresi dolmuş, başkasına ait ya da zaten kullanılmış. */
  | { ok: false; reason: "offerUnusable" }
  | { ok: false; reason: "notFound" }
  | { ok: false; reason: "unavailable" };

export type SettleAttemptInput = Readonly<{
  attemptId: string;
  billId: string;
  /** Oturumdan gelen borçlu; sahiplik burada da doğrulanır. */
  debtor: string;
  settlement: AttemptSettlement;
  /**
   * `confirmed` ve `reverted` için ZORUNLU, `released` için YASAK.
   * `unknown` için isteğe bağlıdır: hash varsa ArcScan mutabakatı için korunur.
   */
  txHash: string | null;
  nowMs: number;
}>;

export type SettleAttemptOutcome =
  | {
      ok: true;
      attempt: StoredPaymentAttempt;
      debtStatus: DebtPaymentStatus;
      /** TÜM borçlar bağımsız olarak onaylandıysa hesap kapatıldı. */
      billClosed: boolean;
      /** Zaten aynı sonuçta olan bir deneme yeniden yazılmadı (idempotent). */
      alreadySettled: boolean;
    }
  | { ok: false; reason: "invalidTransition"; status: PaymentAttemptStatus }
  /** Bu işlem hash'i başka bir denemeye ait. */
  | { ok: false; reason: "hashInUse" }
  | { ok: false; reason: "notFound" }
  | { ok: false; reason: "unavailable" };

export type RecordSubmissionInput = Readonly<{
  attemptId: string;
  billId: string;
  debtor: string;
  txHash: string;
  nowMs: number;
}>;

export type RecordSubmissionOutcome =
  | { ok: true; attempt: StoredPaymentAttempt }
  | { ok: false; reason: "invalidTransition"; status: PaymentAttemptStatus }
  | { ok: false; reason: "hashInUse" }
  | { ok: false; reason: "notFound" }
  | { ok: false; reason: "unavailable" };

export type ReadPaymentOfferOutcome =
  | { ok: true; offer: StoredPaymentOffer }
  | { ok: false; reason: "notFound" }
  | { ok: false; reason: "unavailable" };

export type ReadPaymentAttemptOutcome =
  | { ok: true; attempt: StoredPaymentAttempt }
  | { ok: false; reason: "notFound" }
  | { ok: false; reason: "unavailable" };

/**
 * Ödeme yaşam döngüsünün depo sözleşmesi.
 *
 * TÜM durum geçişleri KARŞILAŞTIR-VE-YAZ'dır (compare-and-set): beklenen
 * kaynak durum sorgunun İÇİNDE aranır. Son yazan kazanan (last-write-wins)
 * hiçbir güncelleme yoktur.
 */
export type SharedBillPaymentRepository = Readonly<{
  /**
   * Teklifi ATOMİK olarak yazar. Borcu REZERVE ETMEZ.
   *
   * Çağıran, oturumu doğrulamış ve taze kur teklifini SUNUCU tarafında almış
   * olmalıdır; depo hiçbir ekonomik değeri istemciden kabul etmez.
   */
  createPaymentOffer(
    input: CreatePaymentOfferInput,
  ): Promise<CreatePaymentOfferOutcome>;

  readPaymentOffer(input: {
    offerId: string;
    billId: string;
    debtor: string;
  }): Promise<ReadPaymentOfferOutcome>;

  /**
   * Borcu ATOMİK olarak rezerve eder ve TEK bir deneme yaratır.
   *
   * Eşzamanlı iki claim'den EN FAZLA BİRİ başarılı olur; hangi cihazdan veya
   * oturumdan geldiği fark etmez. Teklif aynı işlemde tüketilmiş işaretlenir.
   */
  claimPaymentAttempt(
    input: ClaimPaymentAttemptInput,
  ): Promise<ClaimPaymentAttemptOutcome>;

  readPaymentAttempt(input: {
    attemptId: string;
    billId: string;
    debtor: string;
  }): Promise<ReadPaymentAttemptOutcome>;

  /** Borçlunun EN SON denemesi (durumu ne olursa olsun). */
  readLatestAttempt(input: {
    billId: string;
    debtor: string;
  }): Promise<ReadPaymentAttemptOutcome>;

  /** `reserved` → `submitted`. Hash KÜRESEL olarak benzersiz olmalıdır. */
  recordAttemptSubmission(
    input: RecordSubmissionInput,
  ): Promise<RecordSubmissionOutcome>;

  /**
   * Denemeyi, borcu ve gerekiyorsa hesabı ATOMİK olarak yerleştirir.
   *
   * `confirmed` YALNIZCA sunucunun doğruladığı makbuzdan sonra çağrılır;
   * istemcinin "başarılı" bildirimi bu çağrının gerekçesi OLAMAZ.
   * Aynı sonuçla tekrar çağrılmak GÜVENLİDİR (idempotent).
   */
  settleAttempt(input: SettleAttemptInput): Promise<SettleAttemptOutcome>;

  /**
   * SINIRLI temizlik.
   *
   * YALNIZCA süresi dolmuş ve HİÇ KULLANILMAMIŞ teklifler ile KESİN olarak
   * serbest bırakılmış denemeler silinir. `confirmed`, `reverted` ve
   * `unknown` denemelerin kanıtı ASLA otomatik silinmez.
   */
  cleanupExpiredPaymentRecords(input: {
    nowMs: number;
    limit: number;
  }): Promise<void>;
}>;
