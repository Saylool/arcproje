import {
  normalizeWalletAddress,
  walletAddressesEqual,
} from "./address";
import {
  MICRO_USDC_PER_USDC,
  convertTryMinorBigIntToMicroUsdc,
  parseSignedRate,
} from "./conversion";
import {
  ARC_TESTNET_APP_KIT_CHAIN,
  ARC_TESTNET_CHAIN_ID,
  buildArcExplorerTxUrl,
  isArcTestnet,
  isValidTransactionHash,
  parseChainId,
} from "./network";
import {
  REQUEST_ID_HEX_LENGTH,
  REQUEST_MAX_CLOCK_SKEW_MS,
  REQUEST_MAX_LIFETIME_MS,
} from "./payment-request";
import { QUOTE_ID_HEX_LENGTH } from "@/lib/rates/quote";
import { withProvider, type Eip1193Provider } from "./wallet";

/**
 * App Kit Send akışının güvenlik sınırı.
 *
 * Bu modül React state'ine güvenmez. Kullanıcının incelediği ödeme değişmez bir
 * snapshot olarak gelir; her alan burada yeniden doğrulanır ve App Kit
 * çağrılmadan hemen önce provider'a `eth_accounts` ve `eth_chainId` sorulur.
 * Hesap veya ağ değişmişse App Kit hiç çağrılmaz.
 *
 * App Kit ve adaptör dinamik import edilir: yalnızca tarayıcıda, yalnızca
 * doğrulama geçtikten sonra yüklenir. Ham SDK/provider hataları dışarı verilmez.
 *
 * Talebin geçerlilik süresi bu sınırda, React'ten BAĞIMSIZ olarak uygulanır ve
 * her adımda yeniden ölçülür: girişte, preflight'tan sonra (App Kit henüz
 * yüklenmeden) ve `estimateSend`/`send` çağrısından hemen önce. İnceleme ile
 * gönderim arasında geçen sürede dolmuş bir talep gönderilemez.
 */

const BIG_ZERO = BigInt(0);

/** Kullanıcının onayladığı ödemenin değişmez kaydı. */
export type ArcPaymentSnapshot = Readonly<{
  /** Borcun kimliği: "<borçlu>-><alacaklı>". */
  debtKey: string;
  debtorParticipantId: string;
  recipientParticipantId: string;
  /** Checksum'lı gönderen adresi. */
  debtorAddress: string;
  /** Checksum'lı alıcı adresi. */
  recipientAddress: string;
  /** TRY minor unit cinsinden borç. */
  tryMinor: number;
  /** Kurun tam rasyonel gösterimi (BigInt metin olarak). */
  rateNumerator: string;
  rateDenominator: string;
  /** Gönderilecek mikro USDC (BigInt metin olarak). */
  microUsdc: string;
  /** App Kit `amount` alanı: en fazla 6 ondalıklı ondalık metin. */
  amount: string;
  /** Kullanıcıya gösterilen tutar. */
  displayAmount: string;
  chainId: number;
  /** İmzalı talebin kimliği (0x + 64 hex). Sonucu talebe bağlar. */
  requestId: string;
  /** İmzalı talepten birebir taşınan Unix saniye alanları. */
  issuedAt: number;
  expiresAt: number;
  /** Sunucu kur teklifinin kimliği ve bitişi; süre burada da uygulanır. */
  quoteId: string;
  quoteExpiresAt: number;
}>;

export type ArcSendErrorCode =
  | "noProvider"
  | "rejected"
  | "noAccount"
  | "accountChanged"
  | "networkChanged"
  | "invalidRecipient"
  | "invalidSender"
  | "selfTransfer"
  | "invalidAmount"
  | "invalidRate"
  | "inconsistentAmount"
  | "invalidRequestId"
  | "invalidRequestTime"
  | "expiredRequest"
  | "invalidQuoteId"
  | "expiredQuote"
  | "insufficientTimeRemaining"
  | "submissionUnknown"
  | "insufficientFunds"
  | "estimateFailed"
  | "sendFailed";

const ARC_SEND_MESSAGES: Record<ArcSendErrorCode, string> = {
  noProvider: "Cüzdan bağlantısı bulunamadı. Cüzdanı yeniden bağla.",
  rejected: "İşlem cüzdanda reddedildi.",
  noAccount: "Cüzdanda açık bir hesap yok. Cüzdanı açıp yeniden bağla.",
  accountChanged:
    "Cüzdandaki aktif hesap, onayladığın ödemenin göndericisi değil. Doğru hesaba geçip tekrar dene.",
  networkChanged:
    "Cüzdan Arc Testnet'te değil. Ağı Arc Testnet'e alıp tekrar dene.",
  invalidRecipient: "Alıcı cüzdan adresi geçerli değil.",
  invalidSender: "Gönderen cüzdan adresi geçerli değil.",
  selfTransfer:
    "Gönderen ve alıcı aynı cüzdan adresi. Kendine ödeme yapılamaz.",
  invalidAmount: "Gönderilecek tutar geçerli değil.",
  invalidRate: "Ödeme talebindeki kur geçerli değil.",
  inconsistentAmount:
    "Gönderilecek tutar, borç ve kurla uyuşmuyor; gönderim yapılmadı. Talebi oluşturan kişiden yeni bir bağlantı iste.",
  invalidRequestId: "Ödeme talebinin kimliği geçersiz.",
  invalidRequestTime:
    "Ödeme talebinin geçerlilik bilgisi geçersiz; gönderim yapılmadı. Talebi oluşturan kişiden yeni bir bağlantı iste.",
  expiredRequest:
    "Bu ödeme talebinin süresi doldu; gönderim yapılmadı. Talebi oluşturan kişiden yeni bir bağlantı iste.",
  invalidQuoteId: "Ödeme talebindeki kur teklifi kimliği geçersiz.",
  expiredQuote:
    "Talebin dayandığı kur teklifinin süresi doldu; gönderim yapılmadı. Talebi oluşturan kişiden yeni bir bağlantı iste.",
  insufficientTimeRemaining:
    "Kur teklifinin bitişine çok az kaldı; işlem onaylanmadan süresi dolabilirdi. Gönderim başlatılmadı. Talebi oluşturan kişiden yeni bir bağlantı iste.",
  submissionUnknown:
    "İşlem cüzdana GÖNDERİLDİ ama sonucu doğrulanamadı. TEKRAR DENEME: aynı ödeme iki kez gidebilir. Önce MetaMask'taki işlem geçmişini ve ArcScan'i kontrol et; işlem görünmüyorsa yeni bir bağlantı iste.",
  insufficientFunds:
    "Bakiye veya gas yetersiz. Circle Faucet'ten test USDC alıp tekrar dene.",
  estimateFailed:
    "İşlem tahmini alınamadı. Ağ veya tutarı kontrol edip tekrar dene.",
  sendFailed: "İşlem gönderilemedi. Lütfen tekrar dene.",
};

export function describeArcSendError(code: ArcSendErrorCode): string {
  return ARC_SEND_MESSAGES[code];
}

/**
 * Gönderim hatasından sonra inceleme ekranı korunmalı mı?
 *
 * Talebin geçerlilik penceresi kapandıysa hata KALICIDIR: aynı imzalı talep
 * bir daha hiçbir denemede gönderilemez. Bu durumda onay kutusu ve gönder
 * düğmesi ekranda bırakılmaz; kullanıcının yeni bir bağlantı istemesi gerekir.
 *
 * Hesap, ağ, bakiye veya geçici SDK hataları kullanıcı tarafından düzeltilip
 * tekrar denenebilir; onlarda inceleme korunur.
 *
 * Bu karar burada saf bir fonksiyon olarak durur ki React'ten bağımsız test
 * edilebilsin; bileşen yalnızca sonucu uygular.
 */
export function reviewStateAfterSendFailure(
  code: ArcSendErrorCode,
): "leaveReview" | "keepReview" {
  return code === "expiredRequest" ||
    code === "invalidRequestTime" ||
    code === "expiredQuote" ||
    code === "insufficientTimeRemaining" ||
    code === "submissionUnknown"
    ? "leaveReview"
    : "keepReview";
}

/**
 * Bu hatadan sonra gönderim kilidi AÇILMAZ.
 *
 * `kit.send` çağrıldıktan sonra sonuç belirsizse tekrar denemek aynı ödemeyi
 * ikinci kez gönderebilir. Kullanıcı önce cüzdanını ve explorer'ı kontrol
 * etmelidir; yeni bir deneme ancak sayfa yenilenerek başlar.
 */
export function keepsSubmissionLocked(code: ArcSendErrorCode): boolean {
  return code === "submissionUnknown";
}

export type ArcSendResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ArcSendErrorCode };

export type ArcEstimate = { summary: string | null };

export type ArcSendSuccess = {
  txHash: string;
  /** Yerelde kurulan, doğrulanmış ArcScan bağlantısı. */
  explorerUrl: string | null;
  state: string | null;
  /** Sonucu, kullanıcının onayladığı ödemeye bağlar. */
  snapshot: ArcPaymentSnapshot;
  completedAt: string;
};

/** App Kit `amount` biçimi: üstel gösterim, işaret ve boşluk kabul edilmez. */
const AMOUNT_PATTERN = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/;

/** Ondalık metni mikro USDC'ye çevirir; float kullanılmaz. */
export function amountToMicroUsdc(amount: string): bigint | null {
  const match = AMOUNT_PATTERN.exec(amount);
  if (match === null) {
    return null;
  }
  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").padEnd(6, "0");
  return whole * MICRO_USDC_PER_USDC + BigInt(fraction);
}

const REQUEST_ID_PATTERN = new RegExp(
  `^0x[0-9a-fA-F]{${REQUEST_ID_HEX_LENGTH}}$`,
);
const QUOTE_ID_PATTERN = new RegExp(`^0x[0-9a-f]{${QUOTE_ID_HEX_LENGTH}}$`);

/**
 * Cüzdan akışı açılmadan önce gereken asgari kalan süre.
 *
 * Kullanıcı cüzdanda onaylarken zaman geçer. Bitişe saniyeler kala gönderim
 * başlatılırsa işlem, süresi dolmuş bir kurla zincire düşebilir. Bu pay
 * YALNIZCA gönderim yolunda uygulanır; tahmin almak serbesttir.
 */
export const SEND_MIN_REMAINING_SECONDS = 60;

export function checkSendSafetyMargin(
  snapshot: ArcPaymentSnapshot,
  nowMs: number,
): ArcSendErrorCode | null {
  const nowSeconds = Math.floor(nowMs / 1000);
  const horizon = Math.min(snapshot.expiresAt, snapshot.quoteExpiresAt);
  return horizon - nowSeconds < SEND_MIN_REMAINING_SECONDS
    ? "insufficientTimeRemaining"
    : null;
}

/**
 * `kit.send` ÇAĞRILDIKTAN sonra ortaya çıkan belirsiz sonuç.
 *
 * Bu noktadan sonra işlem zincire düşmüş OLABİLİR. Hata "gönderilemedi" gibi
 * sunulmaz; kullanıcı önce cüzdanını ve explorer'ı kontrol etmelidir.
 */
export class AmbiguousSubmissionError extends Error {
  constructor() {
    super("submission outcome unknown");
    this.name = "AmbiguousSubmissionError";
  }
}

/**
 * Talebin zaman geçerliliği. Ucuzdur ve gönderim yolunda birden fazla kez
 * çağrılır; sağlayıcıya sorulan hiçbir şeye bağlı değildir.
 */
export function checkSnapshotRequestTime(
  snapshot: ArcPaymentSnapshot,
  nowMs: number,
): ArcSendErrorCode | null {
  const { issuedAt, expiresAt } = snapshot;
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt <= 0 ||
    expiresAt <= issuedAt ||
    (expiresAt - issuedAt) * 1000 > REQUEST_MAX_LIFETIME_MS
  ) {
    return "invalidRequestTime";
  }

  // Talep, dayandığı teklifin ömrünü aşamaz.
  const { quoteExpiresAt } = snapshot;
  if (!Number.isSafeInteger(quoteExpiresAt) || quoteExpiresAt <= 0) {
    return "invalidRequestTime";
  }
  if (expiresAt > quoteExpiresAt) {
    return "invalidRequestTime";
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const skewSeconds = Math.floor(REQUEST_MAX_CLOCK_SKEW_MS / 1000);
  if (issuedAt - skewSeconds > nowSeconds) {
    return "invalidRequestTime";
  }
  if (expiresAt <= nowSeconds) {
    return "expiredRequest";
  }
  /*
   * Teklifin süresi talebinkinden önce dolabilir. Sayfa açıkken süresi dolan
   * bir kurla gönderim yapılamaz; bu kontrol React'ten bağımsızdır.
   */
  if (quoteExpiresAt <= nowSeconds) {
    return "expiredQuote";
  }
  return null;
}

/**
 * Snapshot'ın her alanını yeniden doğrular. React state'inde ne olduğuna
 * bakılmaksızın bu kontroller geçilmeden App Kit çağrılmaz.
 *
 * `nowMs` yalnızca testlerde belirlenimci zaman vermek içindir.
 */
export function validatePaymentSnapshot(
  snapshot: ArcPaymentSnapshot,
  nowMs: number = Date.now(),
): ArcSendErrorCode | null {
  const recipient = normalizeWalletAddress(snapshot.recipientAddress);
  if (recipient === null) {
    return "invalidRecipient";
  }
  const debtor = normalizeWalletAddress(snapshot.debtorAddress);
  if (debtor === null) {
    return "invalidSender";
  }
  // Farklı kişi ID'lerine ait olsalar bile aynı adrese ödeme yapılamaz.
  if (walletAddressesEqual(debtor, recipient)) {
    return "selfTransfer";
  }
  if (!isArcTestnet(snapshot.chainId)) {
    return "networkChanged";
  }

  const micro = amountToMicroUsdc(snapshot.amount);
  if (micro === null || micro <= BIG_ZERO) {
    return "invalidAmount";
  }
  // Gösterilen tutar ile hesaplanan mikro birim birebir tutmalı.
  let declared: bigint;
  try {
    declared = BigInt(snapshot.microUsdc);
  } catch {
    return "invalidAmount";
  }
  if (declared !== micro || declared <= BIG_ZERO) {
    return "invalidAmount";
  }
  if (!Number.isSafeInteger(snapshot.tryMinor) || snapshot.tryMinor <= 0) {
    return "invalidAmount";
  }

  /*
   * Kur alanları da bu sınırda yeniden doğrulanır ve tutar onlardan yeniden
   * TÜRETİLİR. Snapshot'ı bugün yalnızca doğrulanmış imzalı gövdeden kuran bir
   * çağıran var; bu sınır yine de o doğrulamanın yapılmış olmasına değil kendi
   * hesabına güvenir, çünkü modülün sözleşmesi budur.
   */
  const rate = parseSignedRate(snapshot.rateNumerator, snapshot.rateDenominator);
  if (!rate.ok) {
    return "invalidRate";
  }
  const recomputed = convertTryMinorBigIntToMicroUsdc(
    BigInt(snapshot.tryMinor),
    rate.rate,
  );
  if (!recomputed.ok || recomputed.microUsdc !== declared) {
    return "inconsistentAmount";
  }

  if (
    typeof snapshot.requestId !== "string" ||
    !REQUEST_ID_PATTERN.test(snapshot.requestId)
  ) {
    return "invalidRequestId";
  }
  if (
    typeof snapshot.quoteId !== "string" ||
    !QUOTE_ID_PATTERN.test(snapshot.quoteId)
  ) {
    return "invalidQuoteId";
  }
  return checkSnapshotRequestTime(snapshot, nowMs);
}

/** Provider'a doğrudan sorarak hesabı ve ağı App Kit'ten hemen önce doğrular. */
async function preflight(
  provider: Eip1193Provider,
  snapshot: ArcPaymentSnapshot,
): Promise<ArcSendErrorCode | null> {
  const accountsResponse = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accountsResponse)) {
    return "noAccount";
  }
  const activeAccount = accountsResponse.find(
    (entry): entry is string =>
      typeof entry === "string" && normalizeWalletAddress(entry) !== null,
  );
  if (activeAccount === undefined) {
    return "noAccount";
  }
  if (!walletAddressesEqual(activeAccount, snapshot.debtorAddress)) {
    return "accountChanged";
  }

  const chainId = parseChainId(await provider.request({ method: "eth_chainId" }));
  if (chainId === null || !isArcTestnet(chainId)) {
    return "networkChanged";
  }
  return null;
}

/** App Kit yalnızca burada, doğrulama ve preflight geçtikten sonra yüklenir. */
async function buildSendParams(
  provider: Eip1193Provider,
  snapshot: ArcPaymentSnapshot,
) {
  const [{ AppKit }, { createViemAdapterFromProvider }] = await Promise.all([
    import("@circle-fin/app-kit"),
    import("@circle-fin/adapter-viem-v2"),
  ]);

  const adapter = await createViemAdapterFromProvider({
    provider: provider as Parameters<
      typeof createViemAdapterFromProvider
    >[0]["provider"],
  });
  const kit = new AppKit();

  const params = {
    from: { adapter, chain: ARC_TESTNET_APP_KIT_CHAIN },
    to: snapshot.recipientAddress,
    amount: snapshot.amount,
    token: "USDC",
  } as Parameters<typeof kit.send>[0];

  return { kit, params };
}

function readString(source: unknown, key: string): string | null {
  if (typeof source === "object" && source !== null && key in source) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return null;
}

function classifyError(
  error: unknown,
  fallback: ArcSendErrorCode,
): ArcSendErrorCode {
  // Belirsiz gönderim, başka hiçbir sınıflandırmanın önüne geçer.
  if (error instanceof AmbiguousSubmissionError) {
    return "submissionUnknown";
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error as { code: unknown }).code === 4001) {
      return "rejected";
    }
  }
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  if (message.includes("user rejected") || message.includes("user denied")) {
    return "rejected";
  }
  if (message.includes("insufficient")) {
    return "insufficientFunds";
  }
  // Sınıflandırılamayan hata, çağıran adımın kendi koduyla raporlanır
  // (tahmin -> estimateFailed, gönderim -> sendFailed).
  return fallback;
}

type BoundaryOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: ArcSendErrorCode };

/**
 * Doğrulama + preflight + işlem. Preflight her çağrıda tekrarlanır; tahmin
 * daha önce başarılı olsa bile gönderimden hemen önce yeniden çalışır.
 * Talebin süresi üç noktada ölçülür: girişte, App Kit yüklenmeden hemen önce
 * ve zincir çağrısından hemen önce.
 */
async function runGuarded<T>(
  walletUuid: string,
  snapshot: ArcPaymentSnapshot,
  fallbackCode: ArcSendErrorCode,
  now: () => number,
  action: (
    context: { kit: Awaited<ReturnType<typeof buildSendParams>>["kit"]; params: Awaited<ReturnType<typeof buildSendParams>>["params"] },
  ) => Promise<T>,
): Promise<BoundaryOutcome<T>> {
  const invalid = validatePaymentSnapshot(snapshot, now());
  if (invalid !== null) {
    // App Kit hiç import edilmez.
    return { ok: false, code: invalid };
  }

  let guardCode: ArcSendErrorCode | null = null;
  let actionCode: ArcSendErrorCode | null = null;

  const outcome = await withProvider(walletUuid, async (provider) => {
    guardCode = await preflight(provider, snapshot);
    if (guardCode !== null) {
      throw new Error("preflight");
    }
    // Preflight sağlayıcıyla konuşurken zaman ilerlemiş olabilir; süresi dolmuş
    // bir talep için App Kit import bile edilmez.
    guardCode = checkSnapshotRequestTime(snapshot, now());
    if (guardCode !== null) {
      throw new Error("expired");
    }
    const { kit, params } = await buildSendParams(provider, snapshot);
    // Zincire giden çağrıdan hemen önceki son ölçüm.
    guardCode = checkSnapshotRequestTime(snapshot, now());
    if (guardCode !== null) {
      throw new Error("expired");
    }
    try {
      return await action({ kit, params });
    } catch (error) {
      actionCode = classifyError(error, fallbackCode);
      throw error;
    }
  });

  if (outcome.ok) {
    return { ok: true, value: outcome.value };
  }
  if (guardCode !== null) {
    return { ok: false, code: guardCode };
  }
  if (outcome.code === "noProvider") {
    return { ok: false, code: "noProvider" };
  }
  if (actionCode !== null) {
    return { ok: false, code: actionCode };
  }
  return { ok: false, code: fallbackCode };
}

/** `now` yalnızca testlerde belirlenimci zaman vermek içindir. */
export async function estimateArcSend(
  walletUuid: string,
  snapshot: ArcPaymentSnapshot,
  now: () => number = Date.now,
): Promise<ArcSendResult<ArcEstimate>> {
  return runGuarded(walletUuid, snapshot, "estimateFailed", now, async ({ kit, params }) => {
    const estimate = await kit.estimateSend(params);
    return {
      summary:
        readString(estimate, "totalFee") ??
        readString(estimate, "gasFee") ??
        readString(estimate, "estimatedFee"),
    };
  });
}

/** `now` yalnızca testlerde belirlenimci zaman vermek içindir. */
export async function sendArcUsdc(
  walletUuid: string,
  snapshot: ArcPaymentSnapshot,
  now: () => number = Date.now,
): Promise<ArcSendResult<ArcSendSuccess>> {
  /*
   * Cüzdan akışı açılmadan önce asgari kalan süre aranır. Bu kontrol yalnızca
   * gönderim yolundadır; tahmin almak için gerekmez.
   */
  /*
   * Pay yalnızca talep HÂLÂ GEÇERLİYKEN anlamlıdır. Süresi zaten dolmuş bir
   * talebe "az kaldı" demek yanıltıcı olurdu; o durumda kesin hata kodu
   * korunur ve raporlamayı runGuarded yapar.
   */
  if (checkSnapshotRequestTime(snapshot, now()) === null) {
    const margin = checkSendSafetyMargin(snapshot, now());
    if (margin !== null) {
      return { ok: false, code: margin };
    }
  }

  return runGuarded(walletUuid, snapshot, "sendFailed", now, async ({ kit, params }) => {
    let result: unknown;
    try {
      result = await kit.send(params);
    } catch (error) {
      /*
       * Buraya geldiysek `kit.send` ÇAĞRILDI. Yalnızca kesin olarak yayın
       * ÖNCESİ olduğunu bildiğimiz hatalar (kullanıcı reddi, yetersiz bakiye)
       * yeniden denenebilir sayılır. Diğer her şey belirsizdir: işlem zincire
       * düşmüş olabilir.
       */
      const classified = classifyError(error, "sendFailed");
      if (classified === "rejected" || classified === "insufficientFunds") {
        throw error;
      }
      throw new AmbiguousSubmissionError();
    }

    const txHash = readString(result, "txHash");
    if (txHash === null || !isValidTransactionHash(txHash)) {
      // SDK geçerli bir hash vermedi ama işlem gönderilmiş olabilir.
      throw new AmbiguousSubmissionError();
    }
    return {
      txHash,
      // Bağlantı SDK'nın döndürdüğü URL'den değil, doğrulanmış hash'ten kurulur.
      explorerUrl: buildArcExplorerTxUrl(txHash),
      state: readString(result, "state"),
      snapshot,
      completedAt: new Date().toISOString(),
    };
  });
}

export { ARC_TESTNET_CHAIN_ID };
