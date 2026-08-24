import { buildArcExplorerTxUrl, isValidTransactionHash } from "@/lib/arc/network";
import { scanForDuplicateKeys } from "@/lib/arc/json-duplicate-keys";
import {
  ARC_MIN_CONFIRMATIONS,
  verifyArcUsdcTransferReceipt,
  type ArcRpcClient,
} from "@/lib/arc/arc-receipt";

import {
  PAYMENT_STORAGE_UNAVAILABLE,
  paymentFailure,
  readAuthenticatedPaymentContext,
  type PaymentServiceFailure,
} from "./shared-bill-payment-service";
import type { SharedBillRepository } from "./shared-bill-repository";
import type {
  DebtPaymentStatus,
  PaymentAttemptStatus,
  StoredPaymentAttempt,
} from "./shared-bill-payment-repository";

/**
 * SUNUCU TARAFI MUTABAKAT — ödeme YALNIZCA burada kesinleşir.
 *
 * Tarayıcının ya da App Kit'in "başarılı" demesi bir KANIT DEĞİLDİR ve hiçbir
 * borcu ödenmiş yapmaz. Borç ancak sunucunun Arc Testnet'ten KENDİ okuduğu,
 * yeterli onaya sahip, tam tutarı taşıyan bir makbuzla `paid` olur.
 *
 * İSTEMCİ SONUCU BİLDİRİMİ (`outcome`) yalnızca İKİ şey yapabilir:
 *  - mutabakatı TETİKLEMEK (bir hash vererek),
 *  - KANITLI yayın öncesi bir hatada rezervasyonu serbest bırakmak.
 *
 * KÖTÜ NİYETLİ İSTEMCİ "reddedildi" diye YALAN SÖYLEYEBİLİR ve uygulama
 * düzeyindeki rezervasyonu serbest bıraktırabilir. Bu, uygulama içi bir
 * kolaylıktır, ZİNCİR ÜSTÜ BİR GARANTİ DEĞİLDİR. Her transfer için cüzdan
 * yine borçlunun KENDİ onayını ister; serbest bırakma kimseye para
 * harcatamaz, yalnızca ikinci bir denemeye izin verir.
 */

/** Bekleyen mutabakat için istemciye önerilen yoklama aralığı. */
export const RECONCILE_RETRY_AFTER_MS = 4000;

const ATTEMPT_NOT_FOUND = paymentFailure(
  404,
  "ATTEMPT_NOT_FOUND",
  "Bu ödeme denemesi bulunamadı.",
);

const INVALID_HASH = paymentFailure(
  400,
  "INVALID_TX_HASH",
  "İşlem kimliği (hash) geçersiz.",
);

const HASH_IN_USE = paymentFailure(
  409,
  "TX_HASH_IN_USE",
  "Bu işlem kimliği başka bir ödeme denemesine ait. Aynı işlem iki borcu kapatamaz.",
);

const INVALID_TRANSITION = paymentFailure(
  409,
  "INVALID_TRANSITION",
  "Bu ödeme denemesi artık bu adımda değil. Durumu yeniden sorgula.",
);

/*
 * ---------------------------------------------------------------------------
 * ORTAK: kimliği doğrulanmış deneme
 * ---------------------------------------------------------------------------
 */

type AttemptContext = Readonly<{
  attempt: StoredPaymentAttempt;
  billId: string;
  debtor: string;
  debtPaymentStatus: string;
}>;

type AttemptContextResult = { ok: true; context: AttemptContext } | PaymentServiceFailure;

/**
 * Oturumu doğrular ve denemenin SAHİPLİĞİNİ kanıtlar.
 *
 * Deneme, oturumun borçlusuna VE yoldaki hesaba ait olmalıdır; başka bir
 * borçlunun denemesi hiçbir koşulda okunamaz veya değiştirilemez.
 */
async function readOwnedAttempt(input: {
  sessionToken: string | null;
  pathBillId: string;
  attemptId: string;
  repository: SharedBillRepository;
  nowMs: number;
}): Promise<AttemptContextResult> {
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

  const found = await input.repository.readPaymentAttempt({
    attemptId: input.attemptId,
    billId: context.billId,
    debtor: context.debtor,
  });
  if (!found.ok) {
    return found.reason === "unavailable"
      ? PAYMENT_STORAGE_UNAVAILABLE
      : ATTEMPT_NOT_FOUND;
  }
  return {
    ok: true,
    context: Object.freeze({
      attempt: found.attempt,
      billId: context.billId,
      debtor: context.debtor,
      debtPaymentStatus: context.debtPaymentStatus,
    }),
  };
}

/*
 * ---------------------------------------------------------------------------
 * İSTEMCİ SONUCU BİLDİRİMİ (Phase 9)
 * ---------------------------------------------------------------------------
 */

/**
 * İstemcinin bildirebileceği SONUÇLAR — KATI enum.
 *
 * `success` YOKTUR: istemci bir ödemeyi başarılı İLAN EDEMEZ. Elinde bir hash
 * varsa `submitted` bildirir ve sunucu makbuzu KENDİSİ doğrular.
 *
 * Serbest bırakan üç sonuç, mevcut gönderim sınıflandırıcısının YAYIN ÖNCESİ
 * olduğunu KANITLADIĞI durumlardır:
 *  - `rejected`           : cüzdanda kesin kullanıcı reddi (hash YOK),
 *  - `insufficientFunds`  : SDK'nın yapısal bakiye hatası (hash YOK),
 *  - `preflightFailed`    : `kit.send` HİÇ çağrılmadan düşen doğrulama.
 */
export const CLIENT_OUTCOMES = [
  "rejected",
  "insufficientFunds",
  "preflightFailed",
  "submitted",
  "ambiguous",
] as const;

export type ClientOutcome = (typeof CLIENT_OUTCOMES)[number];

/** Rezervasyonu serbest bırakmaya İZİN VERİLEN sonuçlar. */
const RELEASING_OUTCOMES: ReadonlySet<ClientOutcome> = new Set([
  "rejected",
  "insufficientFunds",
  "preflightFailed",
]);

export type OutcomeBody = Readonly<{
  attemptId: string;
  outcome: ClientOutcome;
  txHash: string | null;
}>;

export function readOutcomeBody(
  bodyText: string,
): { ok: true; body: OutcomeBody } | PaymentServiceFailure {
  const scan = scanForDuplicateKeys(bodyText);
  if (scan === "duplicate") {
    return paymentFailure(400, "DUPLICATE_FIELD", "İstek gövdesinde yinelenen alan var.");
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
    return paymentFailure(400, "INVALID_BODY", "İstek gövdesi beklenen biçimde değil.");
  }
  const record = parsed as Record<string, unknown>;
  const allowed = ["attemptId", "outcome", "txHash"];
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      return paymentFailure(
        400,
        "UNEXPECTED_FIELD",
        "İstek gövdesinde beklenmeyen alan var.",
      );
    }
  }
  if (
    typeof record.attemptId !== "string" ||
    !/^0x[0-9a-f]{64}$/.test(record.attemptId)
  ) {
    return paymentFailure(400, "INVALID_ATTEMPT_ID", "Deneme kimliği geçersiz.");
  }
  if (
    typeof record.outcome !== "string" ||
    !(CLIENT_OUTCOMES as readonly string[]).includes(record.outcome)
  ) {
    return paymentFailure(400, "INVALID_OUTCOME", "Bildirilen sonuç tanınmıyor.");
  }
  const outcome = record.outcome as ClientOutcome;

  let txHash: string | null = null;
  if ("txHash" in record && record.txHash !== null && record.txHash !== undefined) {
    if (!isValidTransactionHash(record.txHash)) {
      return INVALID_HASH;
    }
    txHash = record.txHash.trim().toLowerCase();
  }
  /*
   * SERBEST BIRAKAN bir sonuç hash TAŞIYAMAZ. Hash varsa bir şey zincire
   * gitmiş OLABİLİR ve rezervasyon hiçbir koşulda açılmaz.
   */
  if (txHash !== null && RELEASING_OUTCOMES.has(outcome)) {
    return paymentFailure(
      400,
      "OUTCOME_HASH_CONFLICT",
      "Yayın öncesi olduğu bildirilen bir sonuç işlem kimliği taşıyamaz.",
    );
  }
  if (outcome === "submitted" && txHash === null) {
    return paymentFailure(
      400,
      "OUTCOME_HASH_REQUIRED",
      "Gönderildiği bildirilen bir sonuç için işlem kimliği gerekir.",
    );
  }
  return {
    ok: true,
    body: Object.freeze({ attemptId: record.attemptId, outcome, txHash }),
  };
}

export type OutcomeReport = Readonly<{
  attemptStatus: PaymentAttemptStatus;
  debtStatus: DebtPaymentStatus;
  txHash: string | null;
  explorerUrl: string | null;
  /** Mutabakat gerekiyor mu? İstemci `finalize` çağırmalıdır. */
  reconcile: boolean;
}>;

export type ReportOutcomeResult =
  | { ok: true; report: OutcomeReport }
  | PaymentServiceFailure;

/**
 * İstemcinin bildirdiği sonucu KATI biçimde işler. IDEMPOTENT ve YARIŞA
 * DAYANIKLIDIR: aynı bildirim tekrar gelirse durum değişmez.
 */
export async function reportClientOutcome(input: {
  bodyText: string;
  sessionToken: string | null;
  pathBillId: string;
  repository: SharedBillRepository;
  nowMs: number;
}): Promise<ReportOutcomeResult> {
  const parsed = readOutcomeBody(input.bodyText);
  if (!parsed.ok) {
    return parsed;
  }
  const body = parsed.body;

  const owned = await readOwnedAttempt({
    sessionToken: input.sessionToken,
    pathBillId: input.pathBillId,
    attemptId: body.attemptId,
    repository: input.repository,
    nowMs: input.nowMs,
  });
  if (!owned.ok) {
    return owned;
  }
  const { attempt, billId, debtor } = owned.context;

  /*
   * ZATEN SON DURUMDA: hiçbir bildirim onu değiştiremez. Özellikle
   * `confirmed` bir deneme, sonradan gelen bir "reddedildi" bildirimiyle
   * ASLA geri alınmaz.
   */
  if (
    attempt.status === "confirmed" ||
    attempt.status === "reverted" ||
    attempt.status === "unknown" ||
    attempt.status === "released"
  ) {
    return {
      ok: true,
      report: describeAttempt(attempt, owned.context.debtPaymentStatus, false),
    };
  }

  if (body.outcome === "submitted" && body.txHash !== null) {
    // Hash denemeye BAĞLANIR; küresel benzersizlik depoda uygulanır.
    const recorded = await input.repository.recordAttemptSubmission({
      attemptId: attempt.attemptId,
      billId,
      debtor,
      txHash: body.txHash,
      nowMs: input.nowMs,
    });
    if (!recorded.ok) {
      if (recorded.reason === "unavailable") return PAYMENT_STORAGE_UNAVAILABLE;
      if (recorded.reason === "hashInUse") return HASH_IN_USE;
      if (recorded.reason === "notFound") return ATTEMPT_NOT_FOUND;
      return INVALID_TRANSITION;
    }
    return {
      ok: true,
      // Hash var: mutabakat GEREKLİ. Ödendi DEĞİL, "doğrulanıyor".
      report: describeAttempt(recorded.attempt, "reserved", true),
    };
  }

  if (body.outcome === "ambiguous") {
    /*
     * BELİRSİZ: işlem zincire düşmüş OLABİLİR. Rezervasyon KİLİTLİ kalır,
     * borç `review_required` olur ve OTOMATİK TEKRAR YOKTUR.
     */
    const settled = await input.repository.settleAttempt({
      attemptId: attempt.attemptId,
      billId,
      debtor,
      settlement: "unknown",
      txHash: null,
      nowMs: input.nowMs,
    });
    if (!settled.ok) {
      if (settled.reason === "unavailable") return PAYMENT_STORAGE_UNAVAILABLE;
      if (settled.reason === "notFound") return ATTEMPT_NOT_FOUND;
      if (settled.reason === "hashInUse") return HASH_IN_USE;
      return INVALID_TRANSITION;
    }
    return {
      ok: true,
      report: describeAttempt(settled.attempt, settled.debtStatus, false),
    };
  }

  /*
   * SERBEST BIRAKMA — yalnızca sınıflandırıcının YAYIN ÖNCESİ olduğunu
   * kanıtladığı sonuçlar. Depo, `released` bir denemenin hash TAŞIMASINI
   * zaten yasaklar ve yalnızca `reserved` durumundan geçişe izin verir:
   * `kit.send` çağrıldıktan sonra (`submitted`) serbest bırakma İMKÂNSIZDIR.
   */
  const released = await input.repository.settleAttempt({
    attemptId: attempt.attemptId,
    billId,
    debtor,
    settlement: "released",
    txHash: null,
    nowMs: input.nowMs,
  });
  if (!released.ok) {
    if (released.reason === "unavailable") return PAYMENT_STORAGE_UNAVAILABLE;
    if (released.reason === "notFound") return ATTEMPT_NOT_FOUND;
    if (released.reason === "hashInUse") return HASH_IN_USE;
    return INVALID_TRANSITION;
  }
  return {
    ok: true,
    report: describeAttempt(released.attempt, released.debtStatus, false),
  };
}

/*
 * ---------------------------------------------------------------------------
 * ZİNCİR ÜSTÜ MUTABAKAT (Phase 7)
 * ---------------------------------------------------------------------------
 */

export function readFinalizeBody(
  bodyText: string,
): { ok: true; attemptId: string; txHash: string } | PaymentServiceFailure {
  const scan = scanForDuplicateKeys(bodyText);
  if (scan === "duplicate") {
    return paymentFailure(400, "DUPLICATE_FIELD", "İstek gövdesinde yinelenen alan var.");
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
    return paymentFailure(400, "INVALID_BODY", "İstek gövdesi beklenen biçimde değil.");
  }
  const record = parsed as Record<string, unknown>;
  /*
   * YALNIZCA deneme kimliği ve aday işlem hash'i. TÜM ekonomik alanlar
   * (tutar, kur, alıcı, borç) SAKLANAN denemeden okunur.
   */
  const allowed = ["attemptId", "txHash"];
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      return paymentFailure(
        400,
        "UNEXPECTED_FIELD",
        "İstek gövdesinde beklenmeyen alan var. Tutar ve alıcı istemciden kabul edilmez.",
      );
    }
  }
  if (
    typeof record.attemptId !== "string" ||
    !/^0x[0-9a-f]{64}$/.test(record.attemptId)
  ) {
    return paymentFailure(400, "INVALID_ATTEMPT_ID", "Deneme kimliği geçersiz.");
  }
  if (!isValidTransactionHash(record.txHash)) {
    return INVALID_HASH;
  }
  return {
    ok: true,
    attemptId: record.attemptId,
    txHash: record.txHash.trim().toLowerCase(),
  };
}

export type FinalizeState =
  | "confirmed"
  | "pending"
  | "reverted"
  | "review_required"
  | "unavailable";

export type FinalizeReport = Readonly<{
  state: FinalizeState;
  attemptStatus: PaymentAttemptStatus;
  debtStatus: DebtPaymentStatus;
  txHash: string | null;
  explorerUrl: string | null;
  confirmations: number | null;
  requiredConfirmations: number;
  billClosed: boolean;
  /** Yoklama önerisi; yalnızca `pending` ve `unavailable` için doludur. */
  retryAfterMs: number | null;
}>;

export type FinalizeResult =
  | { ok: true; report: FinalizeReport }
  | PaymentServiceFailure;

export type FinalizeInput = {
  bodyText: string;
  sessionToken: string | null;
  pathBillId: string;
  repository: SharedBillRepository;
  nowMs: number;
  /** RPC SINIRI enjekte edilir; testler ağa ÇIKMAZ. */
  client: ArcRpcClient;
  minConfirmations?: number;
};

/**
 * Aday hash'i Arc Testnet'e karşı doğrular ve borcu YALNIZCA kanıt varsa
 * `paid` yapar.
 *
 * Sıra: gövde → oturum → deneme SAHİPLİĞİ → hash biçimi → hash'i denemeye
 * BAĞLA (küresel benzersizlik) → ZİNCİRDEN MAKBUZ → dağıtım.
 */
export async function finalizeSharedBillPayment(
  input: FinalizeInput,
): Promise<FinalizeResult> {
  const parsed = readFinalizeBody(input.bodyText);
  if (!parsed.ok) {
    return parsed;
  }

  const owned = await readOwnedAttempt({
    sessionToken: input.sessionToken,
    pathBillId: input.pathBillId,
    attemptId: parsed.attemptId,
    repository: input.repository,
    nowMs: input.nowMs,
  });
  if (!owned.ok) {
    return owned;
  }
  const { attempt, billId, debtor } = owned.context;
  const required = input.minConfirmations ?? ARC_MIN_CONFIRMATIONS;

  /*
   * ZATEN ONAYLANMIŞ: idempotent. Aynı hash ile tekrar çağrılmak durumu
   * değiştirmez; farklı bir hash ile çağrılmak REDDEDİLİR — onaylanmış bir
   * ödeme ikinci bir işleme bağlanamaz.
   */
  if (attempt.status === "confirmed") {
    if (attempt.txHash?.toLowerCase() !== parsed.txHash) {
      return HASH_IN_USE;
    }
    return {
      ok: true,
      report: buildFinalizeReport({
        state: "confirmed",
        attempt,
        debtStatus: "paid",
        confirmations: null,
        required,
        billClosed: false,
      }),
    };
  }
  if (attempt.status === "released") {
    return INVALID_TRANSITION;
  }
  /*
   * SON DURUMLAR (`reverted`, `unknown`) yeni bir hash ile YENİDEN
   * AÇILMAZ, ama ZATEN bağlı oldukları hash için mutabakat tekrar
   * denenebilir: bu, `review_required` bir borcun sonradan zincirden
   * çözülmesini mümkün kılar.
   */
  if (attempt.status === "reverted" || attempt.status === "unknown") {
    if (attempt.txHash?.toLowerCase() !== parsed.txHash) {
      return INVALID_TRANSITION;
    }
  } else {
    /*
     * HASH'İ DENEMEYE BAĞLA. Depo, aynı hash'in başka bir denemeye ait
     * olmasını KÜRESEL olarak engeller: bir işlem iki borcu kapatamaz.
     */
    const recorded = await input.repository.recordAttemptSubmission({
      attemptId: attempt.attemptId,
      billId,
      debtor,
      txHash: parsed.txHash,
      nowMs: input.nowMs,
    });
    if (!recorded.ok) {
      if (recorded.reason === "unavailable") return PAYMENT_STORAGE_UNAVAILABLE;
      if (recorded.reason === "hashInUse") return HASH_IN_USE;
      if (recorded.reason === "notFound") return ATTEMPT_NOT_FOUND;
      return INVALID_TRANSITION;
    }
  }

  /*
   * ZİNCİRDEN DOĞRULAMA. Tutar, gönderen ve alıcı SAKLANAN denemeden gelir;
   * istemcinin bildirdiği hiçbir ekonomik değer kullanılmaz.
   */
  const verified = await verifyArcUsdcTransferReceipt({
    txHash: parsed.txHash,
    debtor: attempt.debtor,
    recipient: attempt.recipient,
    expectedMicroUsdc: attempt.microUsdc,
    client: input.client,
    minConfirmations: required,
  });

  if (verified.kind === "unavailable") {
    /*
     * RPC'ye ulaşılamadı. HİÇBİR durum değişmez, kilit KORUNUR ve istemci
     * yoklamaya devam edebilir. Belirsizlik "ödendi"ye ÇEVRİLMEZ.
     */
    return {
      ok: true,
      report: buildFinalizeReport({
        state: "unavailable",
        attempt: { ...attempt, txHash: parsed.txHash },
        debtStatus: "reserved",
        confirmations: null,
        required,
        billClosed: false,
        retryAfterMs: RECONCILE_RETRY_AFTER_MS,
      }),
    };
  }

  if (verified.kind === "pending") {
    // Makbuz yok ya da onay yetersiz: kilit KALIR, ödendi DEĞİL.
    return {
      ok: true,
      report: buildFinalizeReport({
        state: "pending",
        attempt: { ...attempt, txHash: parsed.txHash, status: "submitted" },
        debtStatus: "reserved",
        confirmations: verified.confirmations,
        required,
        billClosed: false,
        retryAfterMs: RECONCILE_RETRY_AFTER_MS,
      }),
    };
  }

  const settlement =
    verified.kind === "confirmed"
      ? "confirmed"
      : verified.kind === "reverted"
        ? "reverted"
        : // `mismatch`: makbuz başarılı ama BEKLENEN transferi kanıtlamıyor.
          "unknown";

  const settled = await input.repository.settleAttempt({
    attemptId: attempt.attemptId,
    billId,
    debtor,
    settlement,
    txHash: parsed.txHash,
    nowMs: input.nowMs,
  });
  if (!settled.ok) {
    if (settled.reason === "unavailable") return PAYMENT_STORAGE_UNAVAILABLE;
    if (settled.reason === "hashInUse") return HASH_IN_USE;
    if (settled.reason === "notFound") return ATTEMPT_NOT_FOUND;
    return INVALID_TRANSITION;
  }

  return {
    ok: true,
    report: buildFinalizeReport({
      state:
        settlement === "confirmed"
          ? "confirmed"
          : settlement === "reverted"
            ? "reverted"
            : "review_required",
      attempt: settled.attempt,
      debtStatus: settled.debtStatus,
      confirmations:
        verified.kind === "confirmed" ? verified.confirmations : null,
      required,
      billClosed: settled.billClosed,
    }),
  };
}

/*
 * ---------------------------------------------------------------------------
 * DURUM SORGUSU
 * ---------------------------------------------------------------------------
 */

export type PaymentStatusView = Readonly<{
  billId: string;
  debtor: string;
  debtStatus: DebtPaymentStatus;
  attemptId: string | null;
  attemptStatus: PaymentAttemptStatus | null;
  txHash: string | null;
  explorerUrl: string | null;
  attemptExpiresAt: number | null;
  requiredConfirmations: number;
}>;

export type PaymentStatusResult =
  | { ok: true; status: PaymentStatusView }
  | PaymentServiceFailure;

/**
 * Kimliği doğrulanmış borçlunun KENDİ ödeme durumu.
 *
 * Başka bir borç satırı, başka bir katılımcı, tam manifest listesi, oturum
 * jetonu ya da veritabanı ayrıntısı DÖNMEZ.
 */
export async function readSharedBillPaymentStatus(input: {
  sessionToken: string | null;
  pathBillId: string;
  repository: SharedBillRepository;
  nowMs: number;
}): Promise<PaymentStatusResult> {
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

  const latest = await input.repository.readLatestAttempt({
    billId: context.billId,
    debtor: context.debtor,
  });
  if (!latest.ok && latest.reason === "unavailable") {
    return PAYMENT_STORAGE_UNAVAILABLE;
  }
  const attempt = latest.ok ? latest.attempt : null;

  return {
    ok: true,
    status: Object.freeze({
      billId: context.billId,
      debtor: context.debtor,
      debtStatus: context.debtPaymentStatus as DebtPaymentStatus,
      attemptId: attempt?.attemptId ?? null,
      attemptStatus: attempt?.status ?? null,
      txHash: attempt?.txHash ?? null,
      explorerUrl:
        attempt?.txHash != null ? buildArcExplorerTxUrl(attempt.txHash) : null,
      attemptExpiresAt: attempt?.expiresAt ?? null,
      requiredConfirmations: ARC_MIN_CONFIRMATIONS,
    }),
  };
}

/*
 * ---------------------------------------------------------------------------
 * Yardımcılar
 * ---------------------------------------------------------------------------
 */

function describeAttempt(
  attempt: StoredPaymentAttempt,
  debtStatus: string,
  reconcile: boolean,
): OutcomeReport {
  return Object.freeze({
    attemptStatus: attempt.status,
    debtStatus: debtStatus as DebtPaymentStatus,
    txHash: attempt.txHash,
    // Bağlantı SDK'dan değil, DOĞRULANMIŞ hash'ten yerelde kurulur.
    explorerUrl:
      attempt.txHash === null ? null : buildArcExplorerTxUrl(attempt.txHash),
    reconcile,
  });
}

function buildFinalizeReport(input: {
  state: FinalizeState;
  attempt: StoredPaymentAttempt;
  debtStatus: DebtPaymentStatus;
  confirmations: number | null;
  required: number;
  billClosed: boolean;
  retryAfterMs?: number;
}): FinalizeReport {
  const txHash = input.attempt.txHash;
  return Object.freeze({
    state: input.state,
    attemptStatus: input.attempt.status,
    debtStatus: input.debtStatus,
    txHash,
    explorerUrl: txHash === null ? null : buildArcExplorerTxUrl(txHash),
    confirmations: input.confirmations,
    requiredConfirmations: input.required,
    billClosed: input.billClosed,
    retryAfterMs: input.retryAfterMs ?? null,
  });
}
