import { walletAddressesEqual } from "@/lib/arc/address";
import {
  convertTryMinorBigIntToMicroUsdc,
  formatMicroUsdcAmount,
  formatMicroUsdcForDisplay,
} from "@/lib/arc/conversion";
import { scanForDuplicateKeys } from "@/lib/arc/json-duplicate-keys";
import { parsePositiveMinorUnits } from "@/lib/arc/minor-units";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import { SEND_MIN_REMAINING_SECONDS } from "@/lib/arc/send";
import type { ArcPaymentSnapshot } from "@/lib/arc/send";
import { parseQuoteRate } from "@/lib/rates/quote";

import { createPaymentId } from "./shared-bill-auth";
import {
  PAYMENT_NOT_AVAILABLE,
  PAYMENT_STORAGE_UNAVAILABLE,
  describeNotClaimable,
  paymentFailure,
  readAuthenticatedPaymentContext,
  type PaymentServiceFailure,
} from "./shared-bill-payment-service";
import type { SharedBillRepository } from "./shared-bill-repository";
import type { StoredPaymentAttempt } from "./shared-bill-payment-repository";

/**
 * ATOMİK REZERVASYON — `kit.send` çağrılabilmesinden HEMEN ÖNCE.
 *
 * Bu adım cüzdanı AÇMAZ ve hiçbir işlem göndermez; yalnızca borcu sunucuda
 * kilitler ve gönderim sınırına verilecek DEĞİŞMEZ snapshot'ı üretir.
 *
 * HER ŞEY YENİDEN OKUNUR VE YENİDEN TÜRETİLİR. Hazırlık adımının döndürdüğü
 * hiçbir değere güvenilmez: oturum yeniden doğrulanır, hesap/borç/teklif
 * depodan yeniden okunur, mikro USDC saklanan TRY tutarı ve saklanan KANONİK
 * kurdan YENİDEN hesaplanır ve teklifle BİREBİR eşitlik aranır.
 *
 * SINIR — VERİTABANI BİR AKILLI SÖZLEŞME DEĞİLDİR. Buradaki kilit, aynı
 * borcun UYGULAMA ÜZERİNDEN iki cihazdan/oturumdan aynı anda ödenmesini
 * engeller. Kullanıcının kendi cüzdanından, uygulamanın DIŞINDA ikinci bir
 * ERC-20 transferi göndermesini ENGELLEYEMEZ. Zincir üstü tek kullanım
 * garantisi YOKTUR ve kullanıcıya böyle sunulmaz.
 */

export type ClaimedPayment = Readonly<{
  attemptId: string;
  /** Gönderim sınırına verilecek DEĞİŞMEZ snapshot. */
  snapshot: ArcPaymentSnapshot;
  /** İstemcinin incelediğiyle karşılaştıracağı teklif kimliği. */
  offerId: string;
  reservedAt: number;
}>;

export type ClaimResult = { ok: true; claim: ClaimedPayment } | PaymentServiceFailure;

const OFFER_UNUSABLE = paymentFailure(
  409,
  "OFFER_UNUSABLE",
  "Ödeme teklifi artık kullanılamıyor (süresi dolmuş ya da zaten kullanılmış). Kuru yenileyip tekrar dene.",
);

const ALREADY_ACTIVE = paymentFailure(
  409,
  "ATTEMPT_ALREADY_ACTIVE",
  "Bu borç için hâlihazırda süren bir ödeme var (başka bir cihaz veya sekme olabilir). Aynı ödemeyi ikinci kez göndermemek için yeni bir deneme açılmadı.",
);

const INCONSISTENT = paymentFailure(
  409,
  "INCONSISTENT_OFFER",
  "Teklifin tutarı, borç ve kurdan yeniden hesaplananla uyuşmuyor; ödeme başlatılmadı. Kuru yenileyip tekrar dene.",
);

const MARGIN = paymentFailure(
  409,
  "INSUFFICIENT_TIME",
  "Kur teklifinin bitişine çok az kaldı; cüzdan onayı sırasında süresi dolabilirdi. Ödeme başlatılmadı.",
);

/** Gövde yalnızca teklif kimliği taşır; ekonomik alan KABUL EDİLMEZ. */
export function readClaimBody(
  bodyText: string,
): { ok: true; offerId: string } | PaymentServiceFailure {
  const scan = scanForDuplicateKeys(bodyText);
  if (scan === "duplicate") {
    return paymentFailure(
      400,
      "DUPLICATE_FIELD",
      "İstek gövdesinde yinelenen alan var.",
    );
  }
  if (scan === "malformed") {
    return paymentFailure(400, "MALFORMED_JSON", "İstek gövdesi okunamadı.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return paymentFailure(400, "MALFORMED_JSON", "İstek gövdesi okunamadı.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return paymentFailure(
      400,
      "INVALID_BODY",
      "İstek gövdesi beklenen biçimde değil.",
    );
  }
  const body = parsed as Record<string, unknown>;
  /*
   * TEK İZİN VERİLEN ALAN. İstemci tutar, kur, alıcı veya borç bildiremez:
   * fazladan bir alan görmek isteğin reddedilmesi için yeterlidir.
   */
  for (const key of Object.keys(body)) {
    if (key !== "offerId") {
      return paymentFailure(
        400,
        "UNEXPECTED_FIELD",
        "İstek gövdesinde beklenmeyen alan var. Tutar, kur ve alıcı istemciden kabul edilmez.",
      );
    }
  }
  if (
    typeof body.offerId !== "string" ||
    !/^0x[0-9a-f]{64}$/.test(body.offerId)
  ) {
    return paymentFailure(
      400,
      "INVALID_OFFER_ID",
      "Ödeme teklifi kimliği geçersiz.",
    );
  }
  return { ok: true, offerId: body.offerId };
}

export type ClaimInput = {
  bodyText: string;
  sessionToken: string | null;
  pathBillId: string;
  repository: SharedBillRepository;
  nowMs: number;
  /** Testlerde belirlenimci kimlik vermek için. */
  attemptId?: string;
};

/**
 * Borcu rezerve eder ve gönderim snapshot'ını üretir.
 *
 * Sıra: gövde → oturum → hesap/borç yeniden okuma → ödenebilirlik → teklifi
 * yeniden okuma → zaman ve PAY kontrolü → TUTARIN YENİDEN TÜRETİLMESİ ve
 * birebir eşitlik → ATOMİK rezervasyon → snapshot.
 */
export async function claimSharedBillPayment(
  input: ClaimInput,
): Promise<ClaimResult> {
  const body = readClaimBody(input.bodyText);
  if (!body.ok) {
    return body;
  }

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

  // Ödenmiş, rezerve, inceleme bekleyen borç FAIL-CLOSED reddedilir.
  if (context.debtPaymentStatus !== "unpaid") {
    return describeNotClaimable(context.debtPaymentStatus);
  }

  const read = await input.repository.readPaymentOffer({
    offerId: body.offerId,
    billId: context.billId,
    debtor: context.debtor,
  });
  if (!read.ok) {
    return read.reason === "unavailable"
      ? PAYMENT_STORAGE_UNAVAILABLE
      : OFFER_UNUSABLE;
  }
  const offer = read.offer;

  // Teklif başka bir borçluya/alıcıya ait olamaz.
  if (
    !walletAddressesEqual(offer.debtor, context.debtor) ||
    !walletAddressesEqual(offer.recipient, context.recipient) ||
    offer.consumedAt !== null
  ) {
    return OFFER_UNUSABLE;
  }
  // Tutar teklif basıldığından beri DEĞİŞMEMİŞ olmalı.
  if (offer.tryMinor !== context.tryMinor) {
    return INCONSISTENT;
  }

  const nowSeconds = Math.floor(input.nowMs / 1000);
  if (
    !Number.isSafeInteger(offer.expiresAt) ||
    !Number.isSafeInteger(offer.quoteExpiresAt) ||
    !Number.isSafeInteger(offer.issuedAt) ||
    offer.expiresAt <= offer.issuedAt ||
    // Teklif dayandığı kurdan UZUN yaşayamaz.
    offer.expiresAt > offer.quoteExpiresAt
  ) {
    return OFFER_UNUSABLE;
  }
  if (offer.expiresAt <= nowSeconds || offer.quoteExpiresAt <= nowSeconds) {
    return OFFER_UNUSABLE;
  }
  /*
   * GÖNDERİM PAYI — cüzdan istemi AÇILMADAN önce ölçülür. Gönderim sınırının
   * kendi payıyla AYNI sabit kullanılır; iki yerde farklı bir eşik olamaz.
   */
  const horizon = Math.min(
    offer.expiresAt,
    offer.quoteExpiresAt,
    context.billExpiresAt,
  );
  if (horizon - nowSeconds < SEND_MIN_REMAINING_SECONDS) {
    return MARGIN;
  }

  /*
   * TUTAR YENİDEN TÜRETİLİR. Saklanan TRY borcu ve saklanan KANONİK kur
   * alınır, aynı BigInt çekirdeğinden geçirilir ve teklifin mikro USDC'siyle
   * BİREBİR eşitlik aranır. Depoda bir alan bozulmuşsa gönderim yapılmaz.
   */
  const tryMinor = parsePositiveMinorUnits(offer.tryMinor);
  const rate = parseQuoteRate(offer.rateNumerator, offer.rateDenominator);
  if (tryMinor === null || !rate.ok) {
    return INCONSISTENT;
  }
  const recomputed = convertTryMinorBigIntToMicroUsdc(tryMinor, rate.rate);
  const declared = parsePositiveMinorUnits(offer.microUsdc);
  if (
    !recomputed.ok ||
    declared === null ||
    recomputed.microUsdc !== declared
  ) {
    return INCONSISTENT;
  }

  const attemptId = input.attemptId ?? createPaymentId();
  const claimed = await input.repository.claimPaymentAttempt({
    billId: context.billId,
    offerId: offer.offerId,
    attemptId,
    debtor: context.debtor,
    sessionHash: context.sessionHash,
    nowMs: input.nowMs,
  });
  if (!claimed.ok) {
    switch (claimed.reason) {
      case "unavailable":
        return PAYMENT_STORAGE_UNAVAILABLE;
      case "alreadyActive":
        return ALREADY_ACTIVE;
      case "notClaimable":
        return describeNotClaimable(claimed.debtStatus);
      case "offerUnusable":
        return OFFER_UNUSABLE;
      default:
        return PAYMENT_NOT_AVAILABLE;
    }
  }

  const snapshot = buildClaimedSnapshot(claimed.attempt, {
    debtKey: context.debtKey,
    debtorLabel: context.debtorLabel,
    recipientLabel: context.recipientLabel,
  });
  if (snapshot === null) {
    /*
     * Snapshot kurulamadıysa GÖNDERİM YAPILMAZ. Rezervasyon KİLİTLİ KALIR:
     * burada otomatik serbest bırakma yoktur; kullanıcı durum uç noktasından
     * yönlendirilir.
     */
    return INCONSISTENT;
  }

  return {
    ok: true,
    claim: Object.freeze({
      attemptId: claimed.attempt.attemptId,
      snapshot,
      offerId: claimed.attempt.offerId,
      reservedAt: claimed.attempt.reservedAt,
    }),
  };
}

/**
 * Saklanan denemeden gönderim snapshot'ını kurar.
 *
 * `requestId` YER TUTUCU DEĞİLDİR: rezervasyonun kimliğidir. Gönderim
 * sınırının katı biçim kontrolü (0x + 64 hex) böylece aynen geçerlidir ve
 * sonuç, sunucudaki denemeye bağlanır.
 */
export function buildClaimedSnapshot(
  attempt: StoredPaymentAttempt,
  labels: { debtKey: string; debtorLabel: string; recipientLabel: string },
): ArcPaymentSnapshot | null {
  const micro = parsePositiveMinorUnits(attempt.microUsdc);
  const tryMinor = parsePositiveMinorUnits(attempt.tryMinor);
  if (micro === null || tryMinor === null) {
    return null;
  }
  return Object.freeze({
    debtKey: labels.debtKey,
    debtorParticipantId: labels.debtorLabel,
    recipientParticipantId: labels.recipientLabel,
    debtorAddress: attempt.debtor,
    recipientAddress: attempt.recipient,
    tryMinor: attempt.tryMinor,
    rateNumerator: attempt.rateNumerator,
    rateDenominator: attempt.rateDenominator,
    microUsdc: attempt.microUsdc,
    amount: formatMicroUsdcAmount(micro),
    displayAmount: formatMicroUsdcForDisplay(micro),
    chainId: ACTIVE_NETWORK_PROFILE.chainId,
    // Rezervasyonun kimliği: sonucu sunucudaki denemeye bağlar.
    requestId: attempt.attemptId,
    issuedAt: attempt.reservedAt,
    expiresAt: attempt.expiresAt,
    quoteId: attempt.quoteId,
    /*
     * Denemenin bitişi ZATEN kurun ve hesabın EN ERKEN bitişidir (teklif
     * basılırken `min` alınır). Bu yüzden gönderim sınırının kur penceresi
     * olarak aynı an verilir: hiçbir koşulda gerçekte olduğundan DAHA UZUN
     * bir kur ömrü iddia edilmez.
     */
    quoteExpiresAt: attempt.expiresAt,
  });
}
