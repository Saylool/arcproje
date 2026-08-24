import { walletAddressesEqual } from "@/lib/arc/address";
import {
  convertTryMinorBigIntToMicroUsdc,
  formatMicroUsdcAmount,
  formatMicroUsdcForDisplay,
} from "@/lib/arc/conversion";
import { parsePositiveMinorUnits } from "@/lib/arc/minor-units";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import {
  QUOTE_MIN_SEND_MARGIN_SECONDS,
  QUOTE_SOURCE,
  formatQuoteRate,
  parseQuoteRate,
  validateRateQuote,
} from "@/lib/rates/quote";
import {
  mintUsdcTryQuote,
  type QuoteMintResult,
} from "@/lib/rates/quote-service";

import { createPaymentId, hashSessionToken } from "./shared-bill-auth";
import type { SharedBillRepository } from "./shared-bill-repository";
import type { StoredPaymentOffer } from "./shared-bill-payment-repository";

/**
 * PAYLAŞILAN HESAP ÖDEMESİ — YETKİLİ TEKLİF (offer).
 *
 * Borçlu, `/me` doğrulamasından SONRA bir teklif ister. Teklifin İÇİNDEKİ
 * HİÇBİR EKONOMİK DEĞER İSTEMCİDEN GELMEZ:
 *
 *  - alıcı adresi     -> imzalı manifestten,
 *  - TRY borcu        -> depodaki borç satırından,
 *  - kur              -> sunucunun kendi kur servisinden (TAZE, HMAC'li),
 *  - mikro USDC       -> ikisinden TAM SAYI aritmetiğiyle TÜRETİLİR.
 *
 * İstemci yalnızca "benim için bir teklif bas" der; tutar, kur, alıcı veya
 * borç bildiremez.
 *
 * KUR SERVİSİ DOĞRUDAN ÇAĞRILIR. Uygulamanın kendi `/api/rates` rotasına
 * HTTP isteği YAPILMAZ: bu, kimlik doğrulamayı kaybettirir, kendi kendine
 * istek zinciri kurar ve dağıtımda kendi kendine DoS riski yaratır. Aynı
 * önbellek, soğuma, doğrulama, HMAC ve altı ondalık kanonikleştirme mantığı
 * süreç içinde yeniden kullanılır.
 *
 * TEKLİF HAZIRLAMAK BORCU REZERVE ETMEZ ve HİÇBİR CÜZDAN ÇAĞIRMAZ.
 * Rezervasyon `claim` adımındadır (bkz. `./shared-bill-claim-service`).
 *
 * ELLE GİRİLEN KURA DÜŞÜLMEZ. Kur servisi çalışmıyorsa teklif BASILMAZ ve
 * kontrollü bir hata döner.
 */

export type PaymentServiceFailure = Readonly<{
  ok: false;
  status: number;
  code: string;
  message: string;
}>;

export function paymentFailure(
  status: number,
  code: string,
  message: string,
): PaymentServiceFailure {
  return Object.freeze({ ok: false as const, status, code, message });
}

/** Üyelik sızdırmayan TEK genel hata. */
export const PAYMENT_NOT_AVAILABLE = paymentFailure(
  404,
  "NOT_AVAILABLE",
  "Bu bağlantı için ödenecek bir borç bulunamadı. Bağlantı geçersiz veya süresi dolmuş olabilir.",
);

export const PAYMENT_STORAGE_UNAVAILABLE = paymentFailure(
  503,
  "SERVICE_UNAVAILABLE",
  "Servis şu anda kullanılamıyor. Lütfen birazdan tekrar dene.",
);

export const PAYMENT_NOT_AUTHENTICATED = paymentFailure(
  401,
  "NOT_AUTHENTICATED",
  "Önce cüzdanınla giriş yap.",
);

export const PAYMENT_SESSION_EXPIRED = paymentFailure(
  401,
  "SESSION_EXPIRED",
  "Oturumun sona erdi. Cüzdanınla yeniden giriş yap.",
);

/**
 * Borcun ödenemez olma nedenleri KULLANICIYA açıkça söylenir; bu bilgi
 * yalnızca KENDİ borcuna aittir, başka bir katılımcıyı açığa vurmaz.
 */
const NOT_CLAIMABLE_MESSAGES: Record<string, string> = {
  paid: "Bu borç zaten ödendi. Yeni bir ödeme başlatılmadı.",
  reserved:
    "Bu borç için hâlihazırda süren bir ödeme var (başka bir cihaz veya sekme olabilir). Aynı ödemeyi ikinci kez göndermemek için yeni bir deneme açılmadı.",
  review_required:
    "Bu borcun önceki denemesinin sonucu doğrulanamadı. Otomatik tekrar KAPALIDIR: önce cüzdanının işlem geçmişini ve ArcScan'i kontrol et.",
};

export function describeNotClaimable(status: string): PaymentServiceFailure {
  return paymentFailure(
    409,
    "DEBT_NOT_CLAIMABLE",
    NOT_CLAIMABLE_MESSAGES[status] ??
      "Bu borç şu anda ödenebilir durumda değil.",
  );
}

/*
 * ---------------------------------------------------------------------------
 * KİMLİĞİ DOĞRULANMIŞ BAĞLAM
 * ---------------------------------------------------------------------------
 */

export type AuthenticatedPaymentContext = Readonly<{
  billId: string;
  /** Oturumdan gelen, kimliği doğrulanmış borçlu. */
  debtor: string;
  debtorLabel: string;
  recipient: string;
  recipientLabel: string;
  debtKey: string;
  tryMinor: string;
  debtPaymentStatus: string;
  billExpiresAt: number;
  sessionHash: string;
}>;

export type AuthenticatedContextResult =
  | { ok: true; context: AuthenticatedPaymentContext }
  | PaymentServiceFailure;

/**
 * Oturumu doğrular ve borcu DEPODAN yeniden okur.
 *
 * Her ödeme adımı bu fonksiyondan geçer: hazırlık, rezervasyon, kesinleştirme
 * ve durum sorgusu. Hiçbiri önceki adımın döndürdüğü değere güvenmez.
 */
export async function readAuthenticatedPaymentContext(input: {
  sessionToken: string | null;
  pathBillId: string;
  repository: SharedBillRepository;
  nowMs: number;
}): Promise<AuthenticatedContextResult> {
  if (input.sessionToken === null || input.sessionToken === "") {
    return PAYMENT_NOT_AUTHENTICATED;
  }
  const sessionHash = hashSessionToken(input.sessionToken);
  const found = await input.repository.readSession({
    sessionHash,
    nowMs: input.nowMs,
  });
  if (!found.ok) {
    return found.reason === "unavailable"
      ? PAYMENT_STORAGE_UNAVAILABLE
      : PAYMENT_SESSION_EXPIRED;
  }

  // A hesabı için alınan çerez B hesabının borcunu ödeyemez.
  if (
    found.bill.manifest.billId.toLowerCase() !== input.pathBillId.toLowerCase()
  ) {
    return PAYMENT_SESSION_EXPIRED;
  }
  // Hesabın süresi ve durumu oturumdan BAĞIMSIZ olarak yeniden ölçülür.
  if (
    found.bill.manifest.expiresAt * 1000 <= input.nowMs ||
    found.bill.status !== "open"
  ) {
    return PAYMENT_NOT_AVAILABLE;
  }
  // Rol ayrımı: alıcı kendi kendine borçlu olamaz.
  if (walletAddressesEqual(found.debt.debtor, found.bill.manifest.recipient)) {
    return PAYMENT_NOT_AVAILABLE;
  }

  return {
    ok: true,
    context: Object.freeze({
      billId: found.bill.manifest.billId,
      debtor: found.debt.debtor,
      debtorLabel: found.debt.debtorLabel,
      recipient: found.bill.manifest.recipient,
      recipientLabel: found.bill.manifest.recipientLabel,
      debtKey: found.debt.debtKey,
      tryMinor: found.debt.tryMinor,
      debtPaymentStatus: found.debt.paymentStatus,
      billExpiresAt: found.bill.manifest.expiresAt,
      sessionHash,
    }),
  };
}

/*
 * ---------------------------------------------------------------------------
 * TEKLİF
 * ---------------------------------------------------------------------------
 */

/** İstemciye dönen, HASSAS OLMAYAN teklif görünümü. */
export type PaymentOfferView = Readonly<{
  offerId: string;
  billId: string;
  debtor: string;
  recipient: string;
  recipientLabel: string;
  debtKey: string;
  /** KANONİK ondalık tam sayı metinleri. */
  tryMinor: string;
  microUsdc: string;
  /** App Kit `amount` alanı: en fazla altı ondalık. */
  amount: string;
  /** Kullanıcıya gösterilen tutar (Türkçe ondalık ayracı). */
  displayAmount: string;
  rateNumerator: string;
  rateDenominator: string;
  /** "42.123456" — gösterim için. */
  rateDisplay: string;
  rateSource: string;
  quoteId: string;
  quoteIssuedAt: number;
  quoteExpiresAt: number;
  issuedAt: number;
  expiresAt: number;
  chainId: number;
  billExpiresAt: number;
}>;

export type PrepareOfferResult =
  | { ok: true; offer: PaymentOfferView }
  | PaymentServiceFailure;

const QUOTE_FAILURE = paymentFailure(
  502,
  "RATE_UNAVAILABLE",
  "Güncel USDC/TRY kuru alınamadı; ödeme başlatılmadı. Elle girilen bir kura DÜŞÜLMEZ. Lütfen birazdan tekrar dene.",
);

const AMOUNT_FAILURE = paymentFailure(
  500,
  "AMOUNT_UNAVAILABLE",
  "Ödenecek USDC tutarı güvenle hesaplanamadı; ödeme başlatılmadı.",
);

/**
 * Her teklif basımında EN FAZLA bu kadar bayat satır süpürülür.
 *
 * Sınırsız silme yapan bir istek yolu YARATILMAZ; temizlik fırsatçıdır ve
 * erişim tarafındaki nonce/oturum temizliğiyle aynı sınırı kullanır.
 */
export const PAYMENT_CLEANUP_LIMIT = 50;

const MARGIN_FAILURE = paymentFailure(
  409,
  "INSUFFICIENT_TIME",
  "Kur teklifinin ya da bağlantının bitişine çok az kaldı; cüzdan onayı sırasında süresi dolabilirdi. Ödeme başlatılmadı.",
);

export type PrepareOfferInput = {
  sessionToken: string | null;
  pathBillId: string;
  repository: SharedBillRepository;
  nowMs: number;
  /**
   * SUNUCU kur servisi. Varsayılan gerçek servistir; TESTLER belirlenimci bir
   * sahte enjekte eder ve hiçbir zaman CoinGecko'ya gidilmez.
   */
  mintQuote?: () => Promise<QuoteMintResult>;
  /** Testlerde belirlenimci kimlik vermek için. */
  offerId?: string;
};

/**
 * Taze, sunucu kimliklendirmeli bir teklif basar ve ATOMİK olarak saklar.
 *
 * Sıra: oturum → hesap/borç yeniden okuma → ödenebilirlik → TAZE KUR →
 * teklif doğrulama → TAM SAYI tutar türetme → ekonomik tutarlılık → pay
 * kontrolü → atomik yazma. Herhangi biri düşerse hiçbir şey saklanmaz.
 */
export async function prepareSharedBillPaymentOffer(
  input: PrepareOfferInput,
): Promise<PrepareOfferResult> {
  const authenticated = await readAuthenticatedPaymentContext({
    sessionToken: input.sessionToken,
    pathBillId: input.pathBillId,
    repository: input.repository,
    nowMs: input.nowMs,
  });
  if (!authenticated.ok) {
    return authenticated;
  }
  const context = authenticated.context;

  if (context.debtPaymentStatus !== "unpaid") {
    return describeNotClaimable(context.debtPaymentStatus);
  }

  const tryMinor = parsePositiveMinorUnits(context.tryMinor);
  if (tryMinor === null) {
    return AMOUNT_FAILURE;
  }

  /*
   * TAZE KUR — doğrudan sunucu servisinden. Elle girilen bir kura ASLA
   * düşülmez; servis çalışmıyorsa teklif basılmaz.
   */
  const minted = await (input.mintQuote ?? mintUsdcTryQuote)();
  if (!minted.ok) {
    return QUOTE_FAILURE;
  }
  /*
   * Ürettiğimiz teklif de tükettiğimiz teklifle AYNI katı yoldan geçer:
   * bayat gözlem, ileri saat, uzun ömür ve bozuk kur burada da yakalanır.
   */
  const validated = validateRateQuote(minted.signed.quote, input.nowMs);
  if (!validated.ok) {
    return QUOTE_FAILURE;
  }
  const quote = validated.quote;
  if (quote.source !== QUOTE_SOURCE) {
    return QUOTE_FAILURE;
  }

  const rate = parseQuoteRate(quote.rateNumerator, quote.rateDenominator);
  if (!rate.ok) {
    return QUOTE_FAILURE;
  }

  // TAM SAYI dönüşüm: üretim ve doğrulama AYNI BigInt çekirdeği kullanır.
  const converted = convertTryMinorBigIntToMicroUsdc(tryMinor, rate.rate);
  if (!converted.ok) {
    return AMOUNT_FAILURE;
  }
  const microUsdc = converted.microUsdc;

  /*
   * EKONOMİK TUTARLILIK: tutar, borç ve kurdan YENİDEN türetilip birebir
   * karşılaştırılır. Sıfır, taşma ve bozuk sonuç burada reddedilir.
   */
  const recomputed = convertTryMinorBigIntToMicroUsdc(tryMinor, rate.rate);
  if (!recomputed.ok || recomputed.microUsdc !== microUsdc) {
    return AMOUNT_FAILURE;
  }

  /*
   * TEKLİFİN VERİLİŞ ANI, İÇİNDEKİ KURDAN ÖNCE OLAMAZ.
   *
   * Sağlayıcı çağrısı sürerken saat ilerler: kur, isteğin GİRİŞ anından
   * SONRA basılmış olabilir. Veriliş anını giriş anına çıpalamak, kurun
   * bitişini teklifin ömür penceresinin DIŞINA taşırır
   * (`expires_at > issued_at + 5 dk`) ve depo kısıtı satırı REDDEDER —
   * aralıklı, nedeni gizlenmiş bir hata olarak görünür.
   *
   * Çıpa, ikisinin GEÇ olanıdır. Bu hem kısıtı her zaman sağlar hem de kalan
   * süreyi olduğundan UZUN göstermez: pay ölçümü de bu ana göre yapılır.
   */
  const issuedAt = Math.max(Math.floor(input.nowMs / 1000), quote.issuedAt);
  /*
   * TEKLİF, NE KURDAN NE DE HESAPTAN UZUN YAŞAR. Üçünün en erken bitişi
   * alınır; böylece süresi dolmuş bir kurla ya da kapanmış bir hesapla
   * gönderim yapılamaz.
   */
  const expiresAt = Math.min(quote.expiresAt, context.billExpiresAt);
  if (expiresAt <= issuedAt) {
    return MARGIN_FAILURE;
  }
  /*
   * GÖNDERİM PAYI: cüzdanda onay verilirken zaman geçer. Bu paydan kısa
   * ömürlü bir teklif zaten gönderilemez; basılması yanıltıcı olurdu.
   */
  if (expiresAt - issuedAt < QUOTE_MIN_SEND_MARGIN_SECONDS) {
    return MARGIN_FAILURE;
  }

  const offerId = input.offerId ?? createPaymentId();
  const candidate: Omit<StoredPaymentOffer, "consumedAt"> = {
    offerId,
    billId: context.billId,
    debtor: context.debtor,
    recipient: context.recipient,
    tryMinor: context.tryMinor,
    quoteId: quote.quoteId,
    rateNumerator: quote.rateNumerator,
    rateDenominator: quote.rateDenominator,
    quoteIssuedAt: quote.issuedAt,
    quoteExpiresAt: quote.expiresAt,
    microUsdc: microUsdc.toString(),
    issuedAt,
    expiresAt,
  };

  const stored = await input.repository.createPaymentOffer({
    offer: candidate,
    nowMs: input.nowMs,
  });
  if (!stored.ok) {
    if (stored.reason === "unavailable") {
      return PAYMENT_STORAGE_UNAVAILABLE;
    }
    if (stored.reason === "notClaimable") {
      return describeNotClaimable(stored.debtStatus);
    }
    if (stored.reason === "constraint") {
      return AMOUNT_FAILURE;
    }
    return PAYMENT_NOT_AVAILABLE;
  }

  /*
   * FIRSATÇI ve SINIRLI temizlik.
   *
   * YALNIZCA süresi dolmuş ve HİÇ KULLANILMAMIŞ teklifler ile KESİN olarak
   * serbest bırakılmış denemeler silinir. `confirmed`, `reverted` ve
   * `unknown` denemelerin — ve onlara bağlı TÜKETİLMİŞ tekliflerin — kanıtı
   * ASLA otomatik silinmez.
   *
   * Erişim tarafındaki nonce/oturum temizliğiyle aynı desen: depo çağrısı
   * kendi içinde hata yutar, bu yüzden ödeme yolunu düşüremez.
   */
  await input.repository.cleanupExpiredPaymentRecords({
    nowMs: input.nowMs,
    limit: PAYMENT_CLEANUP_LIMIT,
  });

  return {
    ok: true,
    offer: toOfferView(stored.offer, {
      recipientLabel: context.recipientLabel,
      debtKey: context.debtKey,
      billExpiresAt: context.billExpiresAt,
      rateDisplay: formatQuoteRate(quote),
    }),
  };
}

/**
 * Depodaki teklifi istemci görünümüne çevirir.
 *
 * YALNIZCA kimliği doğrulanmış borçlunun KENDİ alanları döner. Başka bir borç
 * satırı, oturum jetonu, HMAC etiketi, sağlayıcı anahtarı ya da veritabanı
 * ayrıntısı DÖNMEZ.
 */
export function toOfferView(
  offer: StoredPaymentOffer,
  extra: {
    recipientLabel: string;
    debtKey: string;
    billExpiresAt: number;
    rateDisplay: string;
  },
): PaymentOfferView {
  const micro = BigInt(offer.microUsdc);
  return Object.freeze({
    offerId: offer.offerId,
    billId: offer.billId,
    debtor: offer.debtor,
    recipient: offer.recipient,
    recipientLabel: extra.recipientLabel,
    debtKey: extra.debtKey,
    tryMinor: offer.tryMinor,
    microUsdc: offer.microUsdc,
    amount: formatMicroUsdcAmount(micro),
    displayAmount: formatMicroUsdcForDisplay(micro),
    rateNumerator: offer.rateNumerator,
    rateDenominator: offer.rateDenominator,
    rateDisplay: extra.rateDisplay,
    rateSource: QUOTE_SOURCE,
    quoteId: offer.quoteId,
    quoteIssuedAt: offer.quoteIssuedAt,
    quoteExpiresAt: offer.quoteExpiresAt,
    issuedAt: offer.issuedAt,
    expiresAt: offer.expiresAt,
    chainId: ACTIVE_NETWORK_PROFILE.chainId,
    billExpiresAt: extra.billExpiresAt,
  });
}
