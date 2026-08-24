import { walletAddressesEqual } from "./address";
import {
  convertTryMinorBigIntToMicroUsdc,
  formatMicroUsdcAmount,
  formatMicroUsdcForDisplay,
} from "./conversion";
import { parsePositiveMinorUnits } from "./minor-units";
import { isArcTestnet } from "./network";
import { ACTIVE_NETWORK_PROFILE } from "./profile";
import {
  SEND_MIN_REMAINING_SECONDS,
  isProvablyPreBroadcast,
  validatePaymentSnapshot,
  type ArcPaymentSnapshot,
  type ArcSendErrorCode,
} from "./send";
import { parseQuoteRate } from "@/lib/rates/quote";
import { SHARED_BILL_API_BASE } from "./shared-bill-access-client";

/**
 * ORTAK HESAP ÖDEMESİ — İSTEMCİ TARAFI.
 *
 * Bu modül SUNUCUYA GÜVENMEZ. Sunucu yetkilidir ama istemci, kullanıcıya bir
 * şey göstermeden ve cüzdanı açmadan ÖNCE her ekonomik alanı BAĞIMSIZ olarak
 * yeniden doğrular:
 *
 *  - teklif bağlı cüzdana mı ait,
 *  - alıcı, İMZASI DOĞRULANMIŞ manifestteki alıcı mı,
 *  - TRY tutarı, Merkle kanıtıyla doğrulanmış borç satırıyla aynı mı,
 *  - mikro USDC, borç ve kurdan YENİDEN türetildiğinde birebir tutuyor mu,
 *  - zincir Arc Testnet mi ve zaman pencereleri geçerli mi.
 *
 * Herhangi biri düşerse ödeme kontrolü AÇILMAZ.
 *
 * SINIR — bu doğrulamalar tarayıcıdadır ve ZİNCİR ÜSTÜ GÜVENLİK DEĞİLDİR.
 * Tek kullanım kararı sunucudaki rezervasyondadır; o da bir akıllı sözleşme
 * değildir ve kullanıcının uygulama DIŞINDA ikinci bir transfer göndermesini
 * engelleyemez.
 */

const HEX32 = /^0x[0-9a-f]{64}$/;
const GENERIC_FAILURE = "Ödeme başlatılamadı. Lütfen tekrar dene.";

export type PaymentFetchResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function messageOf(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { error?: { message?: unknown } }).error?.message ===
      "string"
  ) {
    return (payload as { error: { message: string } }).error.message;
  }
  return GENERIC_FAILURE;
}

async function postJson(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<PaymentFetchResult<unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, message: GENERIC_FAILURE };
  }
  const payload = await readJson(response);
  return response.ok
    ? { ok: true, value: payload }
    : { ok: false, message: messageOf(payload) };
}

/*
 * ---------------------------------------------------------------------------
 * TEKLİF: getirme ve BAĞIMSIZ doğrulama
 * ---------------------------------------------------------------------------
 */

/** Sunucudan gelen, İSTEMCİDE yeniden doğrulanmış teklif. */
export type VerifiedOffer = Readonly<{
  offerId: string;
  tryMinor: string;
  microUsdc: string;
  amount: string;
  displayAmount: string;
  rateDisplay: string;
  rateSource: string;
  rateNumerator: string;
  rateDenominator: string;
  quoteId: string;
  quoteExpiresAt: number;
  issuedAt: number;
  expiresAt: number;
  recipient: string;
  debtor: string;
}>;

export type OfferProblem =
  | "malformedResponse"
  | "walletMismatch"
  | "recipientMismatch"
  | "amountMismatch"
  | "inconsistentAmount"
  | "wrongChain"
  | "expired"
  | "insufficientTime";

const OFFER_MESSAGES: Record<OfferProblem, string> = {
  malformedResponse:
    "Sunucudan beklenmeyen bir ödeme teklifi geldi. Ödeme açılmadı.",
  walletMismatch:
    "Teklif bağlı cüzdana ait değil. Doğru cüzdana geçip tekrar dene.",
  recipientMismatch:
    "Teklifin alıcısı, imzalı hesaptaki alıcı değil. Bu teklife güvenme; ödeme açılmadı.",
  amountMismatch:
    "Teklifin TRY tutarı, doğrulanmış borcunla uyuşmuyor. Ödeme açılmadı.",
  inconsistentAmount:
    "Teklifin USDC tutarı, borç ve kurdan yeniden hesaplananla uyuşmuyor. Ödeme açılmadı.",
  wrongChain: "Cüzdan Arc Testnet'te değil. Ödeme açılmadı.",
  expired: "Ödeme teklifinin süresi doldu. Kuru yenile.",
  insufficientTime:
    "Kur teklifinin bitişine çok az kaldı. Kuru yenileyip tekrar dene.",
};

export function describeOfferProblem(problem: OfferProblem): string {
  return OFFER_MESSAGES[problem];
}

export type VerifyOfferResult =
  | { ok: true; offer: VerifiedOffer }
  | { ok: false; problem: OfferProblem };

function isSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Sunucunun bastığı teklifin TAM BAĞIMSIZ doğrulaması.
 *
 * `verifiedDebt` ve `verifiedRecipient`, bileşenin daha önce manifest imzası
 * ve Merkle kanıtıyla KENDİ doğruladığı değerlerdir; sunucunun bu çağrıdaki
 * yanıtından DEĞİL.
 */
export function verifyPaymentOffer(input: {
  payload: unknown;
  connectedAddress: string;
  connectedChainId: number | null;
  billId: string;
  verifiedRecipient: string;
  verifiedTryMinor: string;
  nowMs: number;
}): VerifyOfferResult {
  if (!isArcTestnet(input.connectedChainId)) {
    return { ok: false, problem: "wrongChain" };
  }
  const envelope =
    typeof input.payload === "object" && input.payload !== null
      ? (input.payload as Record<string, unknown>).offer
      : null;
  if (typeof envelope !== "object" || envelope === null) {
    return { ok: false, problem: "malformedResponse" };
  }
  const record = envelope as Record<string, unknown>;

  for (const key of [
    "offerId",
    "quoteId",
    "tryMinor",
    "microUsdc",
    "amount",
    "displayAmount",
    "rateNumerator",
    "rateDenominator",
    "rateDisplay",
    "rateSource",
    "debtor",
    "recipient",
  ]) {
    if (typeof record[key] !== "string") {
      return { ok: false, problem: "malformedResponse" };
    }
  }
  if (
    !HEX32.test(record.offerId as string) ||
    !HEX32.test(record.quoteId as string)
  ) {
    return { ok: false, problem: "malformedResponse" };
  }
  if (
    !isSeconds(record.issuedAt) ||
    !isSeconds(record.expiresAt) ||
    !isSeconds(record.quoteExpiresAt) ||
    !isSeconds(record.billExpiresAt)
  ) {
    return { ok: false, problem: "malformedResponse" };
  }
  if (record.chainId !== ACTIVE_NETWORK_PROFILE.chainId) {
    return { ok: false, problem: "wrongChain" };
  }
  if (
    typeof record.billId !== "string" ||
    record.billId.toLowerCase() !== input.billId.toLowerCase()
  ) {
    return { ok: false, problem: "malformedResponse" };
  }

  // 1) Teklif BAĞLI cüzdana mı ait?
  if (!walletAddressesEqual(record.debtor as string, input.connectedAddress)) {
    return { ok: false, problem: "walletMismatch" };
  }
  /*
   * 2) Alıcı, İMZASI DOĞRULANMIŞ manifestteki alıcı mı? Sunucu farklı bir
   * adres gönderse bile burada durur ve cüzdan HİÇ açılmaz.
   */
  if (
    !walletAddressesEqual(record.recipient as string, input.verifiedRecipient)
  ) {
    return { ok: false, problem: "recipientMismatch" };
  }
  // 3) TRY tutarı, Merkle kanıtıyla doğrulanmış satırla AYNI mı?
  if (record.tryMinor !== input.verifiedTryMinor) {
    return { ok: false, problem: "amountMismatch" };
  }

  // 4) Mikro USDC borç ve kurdan YENİDEN türetilir; birebir eşitlik aranır.
  const tryMinor = parsePositiveMinorUnits(record.tryMinor);
  const declared = parsePositiveMinorUnits(record.microUsdc);
  const rate = parseQuoteRate(record.rateNumerator, record.rateDenominator);
  if (tryMinor === null || declared === null || !rate.ok) {
    return { ok: false, problem: "malformedResponse" };
  }
  const recomputed = convertTryMinorBigIntToMicroUsdc(tryMinor, rate.rate);
  if (!recomputed.ok || recomputed.microUsdc !== declared) {
    return { ok: false, problem: "inconsistentAmount" };
  }
  // Gösterilen ve gönderilecek metinler de AYNI tam sayıdan türemelidir.
  if (
    record.amount !== formatMicroUsdcAmount(declared) ||
    record.displayAmount !== formatMicroUsdcForDisplay(declared)
  ) {
    return { ok: false, problem: "inconsistentAmount" };
  }

  // 5) Zaman: teklif kurdan ve hesaptan uzun yaşayamaz.
  const nowSeconds = Math.floor(input.nowMs / 1000);
  if (
    record.expiresAt <= record.issuedAt ||
    record.expiresAt > record.quoteExpiresAt ||
    record.expiresAt > record.billExpiresAt
  ) {
    return { ok: false, problem: "malformedResponse" };
  }
  if (record.expiresAt <= nowSeconds) {
    return { ok: false, problem: "expired" };
  }
  if (record.expiresAt - nowSeconds < SEND_MIN_REMAINING_SECONDS) {
    return { ok: false, problem: "insufficientTime" };
  }

  return {
    ok: true,
    offer: Object.freeze({
      offerId: record.offerId as string,
      tryMinor: record.tryMinor as string,
      microUsdc: record.microUsdc as string,
      amount: record.amount as string,
      displayAmount: record.displayAmount as string,
      rateDisplay: record.rateDisplay as string,
      rateSource: record.rateSource as string,
      rateNumerator: record.rateNumerator as string,
      rateDenominator: record.rateDenominator as string,
      quoteId: record.quoteId as string,
      quoteExpiresAt: record.quoteExpiresAt,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      // Adres ve alıcı, DOĞRULANMIŞ değerlerden taşınır.
      recipient: input.verifiedRecipient,
      debtor: record.debtor as string,
    }),
  };
}

/**
 * TAHMİN için geçici snapshot kurar. REZERVASYON YAPMAZ.
 *
 * Talep kimliği olarak TEKLİFİN kimliği kullanılır: gönderim sınırının katı
 * biçim kuralını (0x + 64 hex) sağlar ve tahmini incelenen TEKLİFE bağlar.
 * Gönderilecek snapshot bu DEĞİLDİR; o, sunucunun rezervasyondan döndürdüğü
 * ve DENEME kimliğini taşıyan snapshot'tır.
 */
export function buildOfferSnapshot(
  offer: VerifiedOffer,
  labels: { debtKey: string; debtorLabel: string; recipientLabel: string },
): ArcPaymentSnapshot {
  return Object.freeze({
    debtKey: labels.debtKey,
    debtorParticipantId: labels.debtorLabel,
    recipientParticipantId: labels.recipientLabel,
    debtorAddress: offer.debtor,
    recipientAddress: offer.recipient,
    tryMinor: offer.tryMinor,
    rateNumerator: offer.rateNumerator,
    rateDenominator: offer.rateDenominator,
    microUsdc: offer.microUsdc,
    amount: offer.amount,
    displayAmount: offer.displayAmount,
    chainId: ACTIVE_NETWORK_PROFILE.chainId,
    requestId: offer.offerId,
    issuedAt: offer.issuedAt,
    expiresAt: offer.expiresAt,
    quoteId: offer.quoteId,
    quoteExpiresAt: offer.expiresAt,
  });
}

export async function requestPaymentOffer(
  billId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PaymentFetchResult<unknown>> {
  // Gövde BİLEREK boştur: istemci hiçbir ekonomik değer bildiremez.
  return postJson(
    `${SHARED_BILL_API_BASE}/${billId}/payment/prepare`,
    {},
    fetchImpl,
  );
}

/*
 * ---------------------------------------------------------------------------
 * REZERVASYON: talep ve İNCELENENLE KARŞILAŞTIRMA
 * ---------------------------------------------------------------------------
 */

export type ClaimedSnapshot = Readonly<{
  attemptId: string;
  offerId: string;
  snapshot: ArcPaymentSnapshot;
}>;

export type ClaimProblem =
  | "malformedResponse"
  | "snapshotRejected"
  | "changedFromReview";

const CLAIM_MESSAGES: Record<ClaimProblem, string> = {
  malformedResponse:
    "Sunucudan beklenmeyen bir rezervasyon yanıtı geldi. Gönderim yapılmadı.",
  snapshotRejected:
    "Rezervasyon kendi doğrulamamızdan geçmedi; cüzdana hiçbir şey gönderilmedi.",
  changedFromReview:
    "Rezervasyonun içeriği, incelediğin ödemeyle birebir aynı değil; gönderim YAPILMADI. Baştan başla.",
};

export function describeClaimProblem(problem: ClaimProblem): string {
  return CLAIM_MESSAGES[problem];
}

export type VerifyClaimResult =
  | { ok: true; claim: ClaimedSnapshot }
  | { ok: false; problem: ClaimProblem };

/**
 * Sunucunun döndürdüğü snapshot'ı KATI biçimde doğrular ve İNCELENEN teklifle
 * BİREBİR karşılaştırır.
 *
 * Tek bir alan bile farklıysa GÖNDERİM YAPILMAZ: kullanıcı ekranda gördüğü
 * ödemeyi onayladı, başkasını değil.
 */
export function verifyClaimedSnapshot(input: {
  payload: unknown;
  reviewed: VerifiedOffer;
  connectedAddress: string;
  connectedChainId: number | null;
  nowMs: number;
}): VerifyClaimResult {
  if (typeof input.payload !== "object" || input.payload === null) {
    return { ok: false, problem: "malformedResponse" };
  }
  const record = input.payload as Record<string, unknown>;
  if (
    typeof record.attemptId !== "string" ||
    !HEX32.test(record.attemptId) ||
    typeof record.offerId !== "string" ||
    typeof record.snapshot !== "object" ||
    record.snapshot === null
  ) {
    return { ok: false, problem: "malformedResponse" };
  }
  const snapshot = record.snapshot as ArcPaymentSnapshot;

  /*
   * ÖNCE gönderim sınırının KENDİ doğrulaması. Aynı katı kurallar cüzdan
   * açılmadan önce burada da uygulanır; App Kit hiç yüklenmez.
   */
  if (validatePaymentSnapshot(snapshot, input.nowMs) !== null) {
    return { ok: false, problem: "snapshotRejected" };
  }

  // Sonra İNCELENENLE BİREBİR karşılaştırma.
  if (
    record.offerId !== input.reviewed.offerId ||
    snapshot.tryMinor !== input.reviewed.tryMinor ||
    snapshot.microUsdc !== input.reviewed.microUsdc ||
    snapshot.amount !== input.reviewed.amount ||
    snapshot.rateNumerator !== input.reviewed.rateNumerator ||
    snapshot.rateDenominator !== input.reviewed.rateDenominator ||
    snapshot.quoteId !== input.reviewed.quoteId ||
    !walletAddressesEqual(snapshot.recipientAddress, input.reviewed.recipient) ||
    !walletAddressesEqual(snapshot.debtorAddress, input.reviewed.debtor)
  ) {
    return { ok: false, problem: "changedFromReview" };
  }
  // Gönderen HÂLÂ bağlı cüzdan mı, zincir HÂLÂ Arc Testnet mi?
  if (
    !walletAddressesEqual(snapshot.debtorAddress, input.connectedAddress) ||
    !isArcTestnet(input.connectedChainId) ||
    snapshot.chainId !== input.connectedChainId
  ) {
    return { ok: false, problem: "changedFromReview" };
  }
  // Rezervasyonun kimliği snapshot'ın talep kimliği olmalıdır.
  if (snapshot.requestId !== record.attemptId) {
    return { ok: false, problem: "malformedResponse" };
  }

  return {
    ok: true,
    claim: Object.freeze({
      attemptId: record.attemptId,
      offerId: record.offerId,
      snapshot,
    }),
  };
}

export async function claimPayment(
  billId: string,
  offerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PaymentFetchResult<unknown>> {
  return postJson(
    `${SHARED_BILL_API_BASE}/${billId}/payment/claim`,
    { offerId },
    fetchImpl,
  );
}

/*
 * ---------------------------------------------------------------------------
 * SONUÇ BİLDİRİMİ ve MUTABAKAT
 * ---------------------------------------------------------------------------
 */

export type ClientOutcome =
  | "rejected"
  | "insufficientFunds"
  | "preflightFailed"
  | "submitted"
  | "ambiguous";

export type OutcomeDecision = Readonly<{
  outcome: ClientOutcome;
  txHash: string | null;
}>;

/**
 * Gönderim sınırının hata kodunu, sunucuya bildirilecek KATI sonuca çevirir.
 *
 * SINIFLANDIRICI YENİDEN YAZILMAZ. Karar tamamen `send.ts`in kendi
 * çıktılarına dayanır:
 *
 *  - Bir işlem hash'i varsa sonuç HER ZAMAN `submitted`tır: zincire bir şey
 *    gitmiş olabilir, mutabakatı sunucu yapar ve rezervasyon KİLİTLİ kalır.
 *  - `rejected` ve `insufficientFunds` yalnızca sınıflandırıcı onları
 *    yapısal olarak KANITLADIĞINDA üretilir; serbest bırakılabilirler.
 *  - `isProvablyPreBroadcast`, `kit.send`in HİÇ çağrılmadığını kanıtlar.
 *  - Geriye kalan her şey BELİRSİZDİR ve kilidi açmaz.
 */
export function outcomeForSendFailure(
  code: ArcSendErrorCode,
  txHash: string | null,
): OutcomeDecision {
  if (txHash !== null) {
    return Object.freeze({ outcome: "submitted", txHash });
  }
  if (code === "rejected") {
    return Object.freeze({ outcome: "rejected", txHash: null });
  }
  if (code === "insufficientFunds") {
    return Object.freeze({ outcome: "insufficientFunds", txHash: null });
  }
  if (isProvablyPreBroadcast(code)) {
    // `kit.send` HİÇ çağrılmadı: rezervasyon güvenle serbest bırakılabilir.
    return Object.freeze({ outcome: "preflightFailed", txHash: null });
  }
  // `submissionUnknown` / `reverted`: kilit KALIR.
  return Object.freeze({ outcome: "ambiguous", txHash: null });
}

export async function reportOutcome(
  billId: string,
  body: { attemptId: string; outcome: ClientOutcome; txHash: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<PaymentFetchResult<unknown>> {
  return postJson(
    `${SHARED_BILL_API_BASE}/${billId}/payment/outcome`,
    body,
    fetchImpl,
  );
}

export async function finalizePayment(
  billId: string,
  body: { attemptId: string; txHash: string },
  fetchImpl: typeof fetch = fetch,
): Promise<PaymentFetchResult<unknown>> {
  return postJson(
    `${SHARED_BILL_API_BASE}/${billId}/payment/finalize`,
    body,
    fetchImpl,
  );
}

export async function readPaymentStatus(
  billId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PaymentFetchResult<unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${SHARED_BILL_API_BASE}/${billId}/payment/status`,
      { method: "GET", cache: "no-store", credentials: "same-origin" },
    );
  } catch {
    return { ok: false, message: GENERIC_FAILURE };
  }
  const payload = await readJson(response);
  return response.ok
    ? { ok: true, value: payload }
    : { ok: false, message: messageOf(payload) };
}

/*
 * ---------------------------------------------------------------------------
 * YOKLAMA (polling) SINIRI
 * ---------------------------------------------------------------------------
 */

/** Mutabakat yoklaması SINIRLIDIR: sonsuz döngü yoktur. */
export const RECONCILE_POLL_INTERVAL_MS = 4000;
export const RECONCILE_MAX_ATTEMPTS = 15;

export type FinalizeState =
  | "confirmed"
  | "pending"
  | "reverted"
  | "review_required"
  | "unavailable";

export type FinalizeReportView = Readonly<{
  state: FinalizeState;
  debtStatus: string;
  txHash: string | null;
  explorerUrl: string | null;
  confirmations: number | null;
  requiredConfirmations: number;
}>;

const FINALIZE_STATES: readonly FinalizeState[] = [
  "confirmed",
  "pending",
  "reverted",
  "review_required",
  "unavailable",
];

/** Sunucu mutabakat yanıtını KATI biçimde çözer. */
export function readFinalizeReport(payload: unknown): FinalizeReportView | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (
    typeof record.state !== "string" ||
    !(FINALIZE_STATES as readonly string[]).includes(record.state) ||
    typeof record.debtStatus !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    state: record.state as FinalizeState,
    debtStatus: record.debtStatus,
    txHash: typeof record.txHash === "string" ? record.txHash : null,
    explorerUrl:
      typeof record.explorerUrl === "string" ? record.explorerUrl : null,
    confirmations:
      typeof record.confirmations === "number" ? record.confirmations : null,
    requiredConfirmations:
      typeof record.requiredConfirmations === "number"
        ? record.requiredConfirmations
        : 1,
  });
}
