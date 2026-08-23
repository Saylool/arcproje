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
import {
  QUOTE_ID_HEX_LENGTH,
  QUOTE_MIN_SEND_MARGIN_SECONDS,
} from "@/lib/rates/quote";
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
  | "reverted"
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
  reverted:
    "İşlem zincire ulaştı ama BAŞARISIZ oldu (revert). Ödeme yapılmadı ama gas harcanmış olabilir. Aşağıdaki işlem bağlantısından ArcScan'de ayrıntıyı gör; tekrar denemeden önce MetaMask geçmişini de kontrol et.",
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
    code === "submissionUnknown" ||
    code === "reverted"
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
  // Revert de kalıcıdır: işlem zincire ulaştı, körlemesine tekrar denenmez.
  return code === "submissionUnknown" || code === "reverted";
}

export type ArcSendResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: ArcSendErrorCode;
      /**
       * Revert VEYA belirsiz sonuçta ArcScan mutabakatı için korunur.
       * `kit.send` bir hash döndürdüyse kaybedilmez.
       */
      txHash?: string;
      explorerUrl?: string | null;
    };

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
export const SEND_MIN_REMAINING_SECONDS = QUOTE_MIN_SEND_MARGIN_SECONDS;

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
/**
 * `kit.send` sonucunun (App Kit `BridgeStep`) yorumlanması.
 *
 * Kurulu SDK sözleşmesi: `state: 'pending' | 'success' | 'error' | 'noop'`,
 * isteğe bağlı `txHash` ve makine tarafından okunabilir `errorCategory`.
 * SDK dokümanı, makine kararları için `errorMessage` metnini eşleştirmek
 * yerine `errorCategory` kullanılmasını söyler.
 *
 * BAŞARI için İKİSİ de gerekir: belgelenmiş `success` durumu VE geçerli hash.
 * Sadece geçerli bir hash görmek yetmez; revert eden bir işlemin de hash'i
 * vardır ve asla "ödendi" sayılmaz.
 */
export type SendResultClassification =
  | { kind: "success"; txHash: string }
  | { kind: "reverted"; txHash: string | null }
  | { kind: "rejected" }
  /** Sonuç kanıtlanamadı; hash varsa ArcScan mutabakatı için KORUNUR. */
  | { kind: "unknown"; txHash: string | null };

/** Zincire ulaşıp başarısız olmuş sayılan BELGELENMİŞ hata kategorileri. */
const REVERTED_CATEGORIES = new Set<string>([
  "chain_revert",
  "reverted_onchain",
  "partial_reverted",
]);

/** `BridgeStep` üzerinde incelenen alanlar. */
const STEP_KEYS = ["state", "txHash", "errorCategory"] as const;

export function classifySendResult(result: unknown): SendResultClassification {
  if (typeof result !== "object" || result === null) {
    return { kind: "unknown", txHash: null };
  }
  const snapshot = snapshotProperties(result, STEP_KEYS);
  const step = snapshot.values;
  const txHash = isValidTransactionHash(step.txHash) ? step.txHash : null;

  /*
   * Alanlardan biri okunamadıysa sonuç KANITLANAMAZ. Başarı da revert de
   * iddia edilmez; varsa hash korunur.
   */
  if (!snapshot.complete) {
    return { kind: "unknown", txHash };
  }

  if (step.state === "success") {
    // Durum başarı ama hash yoksa/bozuksa sonucu doğrulayamayız.
    return txHash === null
      ? { kind: "unknown", txHash: null }
      : { kind: "success", txHash };
  }

  if (step.state === "error") {
    const category = step.errorCategory;
    /*
     * Kullanıcı reddi YALNIZCA hiç geçerli hash yokken yayın öncesi sayılır.
     * Hash varsa bir işlem zincire gitmiştir; "reddedildi" deyip tekrar
     * denemeye izin vermek aynı ödemeyi ikinci kez gönderebilirdi.
     */
    if (category === "user_rejected") {
      return txHash === null
        ? { kind: "rejected" }
        : { kind: "unknown", txHash };
    }
    if (typeof category === "string" && REVERTED_CATEGORIES.has(category)) {
      return { kind: "reverted", txHash };
    }
    /*
     * KURULU SDK'nın (@circle-fin/app-kit 1.12.1) aynı zincir `send` yolu
     * makbuzu bekler ve durumu doğrudan makbuzdan türetir:
     *   state: receipt.status === 'success' ? 'success' : 'error'
     * Bu yolda `errorCategory` HİÇ set edilmez. Dolayısıyla "error + geçerli
     * hash + kategori yok", ONAYLANMIŞ bir revert makbuzudur: işlem zincire
     * ulaştı ve başarısız oldu. Ödendi sayılmaz; belirsiz de değildir.
     */
    if (txHash !== null && category === undefined) {
      return { kind: "reverted", txHash };
    }
    // Kalan kategoriler yayın öncesi olduğunu KANITLAMAZ; hash korunur.
    return { kind: "unknown", txHash };
  }

  // 'pending', 'noop' veya tanınmayan durum: belirsiz, hash korunur.
  return { kind: "unknown", txHash };
}

/**
 * `kit.send` ÇAĞRILDIKTAN sonra fırlayan istisnanın sınıflandırılması.
 *
 * Yayın ÖNCESİ sayılmanın İKİ koşulu vardır:
 * 1. Hata grafiğinin HİÇBİR yerinde geçerli işlem hash'i OLMAMALIDIR. Hash
 *    varsa bir şey zincire gitmiştir ve hiçbir "yeniden denenebilir" sınıf
 *    uygulanmaz.
 * 2. Sinyal BELGELENMİŞ ve OLUMLU bir kimlik olmalıdır: viem'in
 *    `UserRejectedRequestError`'ı, App Kit'in `user_rejected` kategorisi,
 *    ham EIP-1193 4001 reddi ya da kurulu SDK'nın bakiye `KitError` ad+kod
 *    çifti (9001/9002/9003).
 *
 * Serbest metin eşleştirmesi YAPILMAZ: "insufficient confirmations" gibi bir
 * mesaj işlemin gönderilmediğini kanıtlamaz. Kalan her şey belirsizdir.
 */
export type SendExceptionClass =
  | "rejected"
  | "insufficientFunds"
  | "submissionUnknown";

/**
 * Kurulu SDK'nın YAYIN ÖNCESİ, yapısal bakiye hataları (ad + sayısal kod).
 *
 * `@circle-fin/app-kit` 1.12.1'de bu `KitError`'lar `prepareSend` içindeki
 * bakiye doğrulamasından gelir; `execute()` henüz çağrılmamıştır, yani hiçbir
 * işlem yayınlanmamıştır. Ad ve kod BİRLİKTE eşleşmelidir; mesaj metnine
 * asla bakılmaz.
 */
const PRE_BROADCAST_BALANCE_ERRORS = new Map<string, number>([
  ["BALANCE_INSUFFICIENT_TOKEN", 9001],
  ["BALANCE_INSUFFICIENT_GAS", 9002],
  ["BALANCE_INSUFFICIENT_ALLOWANCE", 9003],
]);

/**
 * Kurulu viem'in onay bekleme zaman aşımı hatasının TAM adı.
 *
 * `viem` 2.55.19 (`_esm/errors/transaction.js`):
 *
 *   export class WaitForTransactionReceiptTimeoutError extends BaseError {
 *     constructor({ hash }) {
 *       super(`Timed out while waiting for transaction with hash "${hash}"
 *              to be confirmed.`, { name: 'WaitForTransactionReceiptTimeoutError' })
 *     }
 *   }
 *
 * Hash TİPLİ BİR ALANDA TUTULMAZ; yalnızca cümlenin içinde geçer. Kurulu
 * `@circle-fin/adapter-viem-v2` bu çağrıyı sarmalamaz (`waitForTransaction`
 * doğrudan `publicClient.waitForTransactionReceipt` çağırır), yani hata ham
 * hâliyle `kit.send` dışına çıkar. Bu hash olmadan işlem ArcScan'de
 * bulunamaz; bu yüzden metin YALNIZCA bu ada birebir uyan hata için ve
 * YALNIZCA tam cümle kalıbıyla okunur.
 */
const VIEM_RECEIPT_TIMEOUT_ERROR = "WaitForTransactionReceiptTimeoutError";

/** Kalıp cümlenin TAMAMINA çapalıdır; genel mesaj taraması yapılmaz. */
const VIEM_TIMEOUT_HASH_PATTERN =
  /^Timed out while waiting for transaction with hash "(0x[0-9a-fA-F]{64})" to be confirmed\.$/;

/**
 * GÜVENLİ ÖZELLİK OKUMA.
 *
 * Cüzdan/sağlayıcı hataları fırlatan getter, durumlu erişimci veya İPTAL
 * EDİLMİŞ proxy içerebilir. Böyle bir nesnede basit bir `error.code` bile
 * TypeError fırlatır. `kit.send` ÇAĞRILDIKTAN sonra bu tür bir çökme
 * "gönderilemedi" gibi raporlanırsa kullanıcı, zincire düşmüş olabilecek bir
 * ödemeyi ikinci kez gönderebilir. Bu yüzden incelenen HER özellik buradan
 * okunur ve hata yutulup `ok: false` olarak bildirilir.
 */
type PropertyRead = { ok: true; value: unknown } | { ok: false };

function readProperty(target: object, key: string): PropertyRead {
  try {
    return { ok: true, value: (target as Record<string, unknown>)[key] };
  } catch {
    return { ok: false };
  }
}

/**
 * `Array.isArray` proxy'ye duyarlıdır: iptal edilmiş bir proxy'de TypeError
 * fırlatır. Bu yüzden o da korumalı çağrılır.
 */
function safeIsArray(
  value: object,
): { ok: true; value: boolean } | { ok: false } {
  try {
    return { ok: true, value: Array.isArray(value) };
  } catch {
    return { ok: false };
  }
}

/**
 * `instanceof` de proxy'ye duyarlıdır (prototip zinciri okunur).
 */
type AnyConstructor = abstract new (...args: never[]) => unknown;

function safeInstanceOf(value: unknown, ctor: AnyConstructor): boolean {
  try {
    return value instanceof ctor;
  } catch {
    return false;
  }
}

/**
 * Bir nesnenin incelenen alanlarının DÜZ anlık görüntüsü.
 *
 * Her alan EN FAZLA BİR KEZ okunur ve prototipsiz düz bir nesnede saklanır.
 * Böylece durumlu bir getter, hash analizi ile ret analizi ARASINDA farklı
 * değer döndüremez: iki analiz de aynı donmuş görüntüyü okur.
 */
type PropertySnapshot = {
  readonly values: Readonly<Record<string, unknown>>;
  /** Alanların HEPSİ okunabildi mi? */
  readonly complete: boolean;
};

function snapshotProperties(
  target: object,
  keys: readonly string[],
): PropertySnapshot {
  const values = Object.create(null) as Record<string, unknown>;
  let complete = true;
  for (const key of keys) {
    const read = readProperty(target, key);
    if (!read.ok) {
      complete = false;
      continue;
    }
    values[key] = read.value;
  }
  return { values, complete };
}

/**
 * Hata grafiğinde izlenen TEK bağlantı adları.
 *
 * Kurulu yığın hatayı birden çok katmanda sarmalar: `KitError` bağlamı
 * `cause.trace` altına koyar, `trace` ise özgün hatayı belgelenmiş
 * `rawError` alanında taşır ve bu iç içe geçebilir
 * (`cause.trace.rawError.rawError`). viem ise klasik `cause` zinciri kullanır.
 *
 * `errors` standart `AggregateError` alanıdır: birden çok alt hata taşır ve
 * gerçek ret kimliği ya da işlem hash'i orada saklanabilir. Diğerleri gibi
 * korumalı ve TEK OKUMA ile alınır.
 *
 * Yürüyüş YALNIZCA bu adlara bakar. Nesnenin tüm alanlarında gezinmek,
 * alakasız bir yükün içindeki `code: 4001` gibi bir değeri "kullanıcı reddi"
 * sanmaya yol açardı.
 */
const ERROR_GRAPH_LINKS = ["cause", "trace", "rawError", "errors"] as const;

/** Ziyaret edilecek en fazla DÜĞÜM; döngü ve aşırı derinlik burada durur. */
export const MAX_ERROR_GRAPH_NODES = 32;

/**
 * Dizi/kap dâhil incelenen en fazla NESNE.
 *
 * Diziler düğüm sayılmaz (anlık görüntüleri alınmaz), bu yüzden iç içe
 * dizilerin işi süresiz büyütmemesi için ayrı bir tavan gerekir.
 */
const MAX_INSPECTED_OBJECTS = MAX_ERROR_GRAPH_NODES * 4;

/** Her düğümde okunan alanlar. Başka hiçbir alana DOKUNULMAZ. */
const INSPECTED_KEYS = [
  ...ERROR_GRAPH_LINKS,
  "name",
  "type",
  "code",
  "errorCategory",
  "txHash",
  "hash",
  "shortMessage",
  "message",
] as const;

/**
 * Kap (dizi) elemanlarını KORUMALI biçimde kuyruğa alır.
 *
 * `length` ve indeks erişimi fırlatabilir (proxy, durumlu erişimci); hepsi
 * korumalı okunur ve ilk başarısızlıkta tarama bırakılır. Bu tarama YALNIZCA
 * gizli bir işlem hash'ini kurtarmak içindir: kabın kendisi dolaşımı zaten
 * EKSİK işaretlemiştir, dolayısıyla içeride bulunan hiçbir şey "yeniden
 * denenebilir" bir sonuç üretemez.
 */
function enqueueContainerElements(container: object, queue: unknown[]): void {
  const lengthRead = readProperty(container, "length");
  if (
    !lengthRead.ok ||
    typeof lengthRead.value !== "number" ||
    !Number.isFinite(lengthRead.value)
  ) {
    return;
  }
  const limit = Math.min(
    Math.max(0, Math.floor(lengthRead.value)),
    MAX_ERROR_GRAPH_NODES,
  );
  for (let index = 0; index < limit; index += 1) {
    const element = readProperty(container, String(index));
    if (!element.ok) {
      // Fırlatan veya iptal edilmiş indeks erişimi: kalanı denenmez.
      return;
    }
    if (typeof element.value === "object" && element.value !== null) {
      queue.push(element.value);
    }
  }
}

/**
 * Dolaşımın sonucu: anlık görüntüler VE bütünlük bayrağı.
 *
 * `complete: false` iken grafiğin bir kısmı GÖRÜLMEMİŞTİR; orada bir iptal
 * kimliği ya da işlem hash'i saklı olabilir. Bu durumda hiçbir "yeniden
 * denenebilir" sınıflandırma yapılamaz.
 */
type ErrorGraph = {
  readonly nodes: readonly Readonly<Record<string, unknown>>[];
  readonly complete: boolean;
};

/**
 * Hata grafiğinin SINIRLI, DÖNGÜYE DAYANIKLI ve HİÇ FIRLATMAYAN dolaşımı.
 *
 * Genişlik öncelikli; görülen nesneler kimlik (`Set`) ile işaretlenir, bu
 * yüzden `a.cause = b; b.cause = a` gibi bir döngü sonsuza gitmez. Her düğüm
 * düz bir anlık görüntüye çevrilir; sonraki tüm analizler yalnızca bu
 * görüntüleri okur.
 *
 * `complete` şu hâllerde `false` olur:
 * - düğüm bütçesi dolduğu hâlde kuyrukta iş kaldıysa;
 * - toplam nesne tavanı aşıldıysa;
 * - bir özellik okuması fırlattıysa (getter/durumlu erişimci);
 * - `Array.isArray` fırlattıysa (iptal edilmiş proxy);
 * - bir bağlantı DİZİ/KAP değerliyse (desteklenen tekil nesne şekli değil);
 * - başka bir inceleme hatası oluştuysa.
 */
function collectErrorGraph(error: unknown): ErrorGraph {
  const nodes: Readonly<Record<string, unknown>>[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  let complete = true;
  let inspected = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    // `typeof` ve `Set` işlemleri tuzak çalıştırmaz; güvenlidir.
    if (typeof current !== "object" || current === null) {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    inspected += 1;
    if (inspected > MAX_INSPECTED_OBJECTS) {
      // İç içe kaplar işi büyüttü: geri kalanı incelenmedi.
      complete = false;
      break;
    }

    if (nodes.length >= MAX_ERROR_GRAPH_NODES) {
      // Bütçe doldu ve hâlâ incelenmemiş düğüm var.
      complete = false;
      break;
    }

    const arrayCheck = safeIsArray(current);
    if (!arrayCheck.ok) {
      // İptal edilmiş proxy: bu düğümden hiçbir şey okunamaz.
      complete = false;
      continue;
    }
    if (arrayCheck.value) {
      /*
       * DİZİ/KAP bağlantı. Desteklenen tekil nesne şekli DEĞİLDİR: bir
       * `AggregateError.errors` listesi ya da dizi değerli bir `cause`
       * içinde gerçek ret kimliği veya işlem hash'i saklı olabilir.
       *
       * FAIL-CLOSED: dolaşım EKSİK işaretlenir, yani sonuç hiçbir koşulda
       * yeniden denenebilir (`rejected` / `insufficientFunds`) olamaz.
       * Elemanlar yine de taranır — ama yalnızca gizli bir işlem hash'ini
       * ArcScan mutabakatı için kurtarmak amacıyla.
       */
      complete = false;
      enqueueContainerElements(current, queue);
      continue;
    }

    const snapshot = snapshotProperties(current, INSPECTED_KEYS);
    if (!snapshot.complete) {
      complete = false;
    }
    nodes.push(snapshot.values);

    for (const link of ERROR_GRAPH_LINKS) {
      const next = snapshot.values[link];
      if (typeof next === "object" && next !== null && !seen.has(next)) {
        queue.push(next);
      }
    }
  }

  return { nodes, complete };
}

/** viem'in kullanıcı reddi hatasının TAM adı (`_esm/errors/rpc.js`). */
const VIEM_USER_REJECTED_ERROR = "UserRejectedRequestError";

/** App Kit'in belgelenmiş iptal kategorisi. */
const APP_KIT_USER_REJECTED = "user_rejected";

/** EIP-1193 kullanıcı reddi kodu. */
const EIP1193_USER_REJECTED_CODE = 4001;

/**
 * App Kit `KitError` adları BÜYÜK_HARF_ALT_ÇİZGİ biçimindedir; SDK bunu
 * `^[A-Z_][A-Z0-9_]*$` ile doğrular. `type` alanı da yalnızca `KitError`'da
 * bulunur. İkisi birlikte, ham EIP-1193 hatasını App Kit sarmalayıcısından
 * ayırmaya yeter.
 */
const KIT_ERROR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

function isKitErrorNode(node: Readonly<Record<string, unknown>>): boolean {
  const name = node.name;
  if (typeof name === "string" && KIT_ERROR_NAME_PATTERN.test(name)) {
    return true;
  }
  return typeof node.type === "string" && node.type !== "";
}

/**
 * Bu düğüm OLUMLU bir kullanıcı iptali kimliği mi?
 *
 * Kod 4001 TEK BAŞINA yeterli DEĞİLDİR: kurulu App Kit'te
 * `RpcError.ENDPOINT_ERROR` da `code: 4001` (`name: "RPC_ENDPOINT_ERROR"`,
 * `type: "RPC"`) kullanır. Bu bir uç nokta arızasıdır, kullanıcı reddi
 * DEĞİLDİR ve `kit.send` sonrası belirsiz bir gönderimi temsil edebilir.
 * Bu yüzden 4001 yalnızca düğüm bir `KitError` DEĞİLKEN kabul edilir.
 */
function isUserRejectionNode(node: Readonly<Record<string, unknown>>): boolean {
  if (node.errorCategory === APP_KIT_USER_REJECTED) {
    return true;
  }
  if (node.name === VIEM_USER_REJECTED_ERROR) {
    return true;
  }
  return (
    node.code === EIP1193_USER_REJECTED_CODE && !isKitErrorNode(node)
  );
}

/**
 * Zaman aşımı hatasından hash kurtarma.
 *
 * Önce ileride eklenebilecek TİPLİ alan denenir; yoksa yalnızca adı birebir
 * tutan hatanın `shortMessage`/`message` ilk satırı tam kalıpla okunur ve
 * katı hash doğrulayıcısından geçirilir.
 */
function readViemTimeoutHash(
  node: Readonly<Record<string, unknown>>,
): string | null {
  if (node.name !== VIEM_RECEIPT_TIMEOUT_ERROR) {
    return null;
  }
  if (isValidTransactionHash(node.hash)) {
    return node.hash;
  }
  for (const field of [node.shortMessage, node.message]) {
    if (typeof field !== "string") {
      continue;
    }
    const match = VIEM_TIMEOUT_HASH_PATTERN.exec(field.split("\n")[0].trim());
    if (match !== null && isValidTransactionHash(match[1])) {
      return match[1];
    }
  }
  return null;
}

/**
 * Hata grafiğinin TAMAMINDA aranan geçerli işlem hash'i.
 *
 * Her düğümde önce TİPLİ `txHash` alanı denenir (App Kit'in `trace.txHash`'i
 * de `trace` bağlantısı üzerinden aynı yolla görülür), sonra yalnızca ADI
 * birebir tutan viem zaman aşımı hatası için tam kalıplı metin okuması
 * yapılır. Rastgele bir mesajın içinden hash ÇIKARILMAZ.
 */
function findTxHashInGraph(
  nodes: readonly Readonly<Record<string, unknown>>[],
): string | null {
  for (const node of nodes) {
    if (isValidTransactionHash(node.txHash)) {
      return node.txHash;
    }
    const fromTimeout = readViemTimeoutHash(node);
    if (fromTimeout !== null) {
      return fromTimeout;
    }
  }
  return null;
}

export function readErrorTxHash(error: unknown): string | null {
  return analyzeSendException(error).txHash;
}

/** İstisna analizinin TAM sonucu. */
export type SendExceptionAnalysis = {
  classification: SendExceptionClass;
  /** Kurtarılabilen geçerli hash; inceleme yarıda kalsa bile KORUNUR. */
  txHash: string | null;
  /** Grafiğin tamamı güvenle incelenebildi mi? */
  complete: boolean;
};

/**
 * `kit.send` istisnasının TOTAL analizi. Bu fonksiyon ASLA fırlatmaz.
 *
 * Sıra değişmez: önce anlık görüntü alınır, sonra HASH aranır, sonra ret
 * kimliği. Yeniden denenebilir bir sonuç (`rejected` / `insufficientFunds`)
 * YALNIZCA dolaşım eksiksiz tamamlandıysa VE hiç geçerli hash yoksa verilir.
 */
export function analyzeSendException(error: unknown): SendExceptionAnalysis {
  if (typeof error !== "object" || error === null) {
    return { classification: "submissionUnknown", txHash: null, complete: true };
  }

  let graph: ErrorGraph;
  try {
    graph = collectErrorGraph(error);
  } catch {
    // Dolaşımın kendisi beklenmedik biçimde patladı: hiçbir kanıt yok.
    return { classification: "submissionUnknown", txHash: null, complete: false };
  }

  /*
   * ÖNCE hash. Grafiğin herhangi bir yerinde geçerli bir işlem hash'i varsa
   * yayın ÖNCESİ olduğu KANITLANAMAZ; iptal kimliği bulunsa bile yeniden
   * denenebilir sayılmaz. Hash, dolaşım yarıda kalmış olsa da KORUNUR:
   * ArcScan mutabakatının tek ipucu odur.
   */
  const txHash = findTxHashInGraph(graph.nodes);
  if (txHash !== null) {
    return {
      classification: "submissionUnknown",
      txHash,
      complete: graph.complete,
    };
  }

  /*
   * Dolaşım eksikse görülmeyen bir düğümde hash ya da başka bir kanıt
   * olabilir. Kanıtsız hiçbir şey yeniden denenebilir sayılmaz.
   */
  if (!graph.complete) {
    return { classification: "submissionUnknown", txHash: null, complete: false };
  }

  /*
   * Sonra OLUMLU iptal kimliği. Sarmalayıcı bir `KitError` grafiğin tepesinde
   * dursa bile, gerçek `UserRejectedRequestError` derinlerde
   * (`cause.trace.rawError.rawError`) bulunabilir.
   */
  if (graph.nodes.some(isUserRejectionNode)) {
    return { classification: "rejected", txHash: null, complete: true };
  }

  /*
   * Bakiye hataları YALNIZCA en üst düğümde aranır: bunlar `prepareSend`
   * tarafından doğrudan fırlatılır. Grafiğin derinliklerinde bulunan bir
   * bakiye izi, sarmalayan RPC/ağ arızasının yayın öncesi olduğunu kanıtlamaz.
   */
  const top = graph.nodes[0];
  if (top !== undefined && typeof top.name === "string") {
    const expected = PRE_BROADCAST_BALANCE_ERRORS.get(top.name);
    if (expected !== undefined && expected === top.code) {
      return { classification: "insufficientFunds", txHash: null, complete: true };
    }
  }

  // RPC/ağ arızaları dâhil kanıtlanmamış her şey belirsizdir.
  return { classification: "submissionUnknown", txHash: null, complete: true };
}

export function classifySendException(error: unknown): SendExceptionClass {
  return analyzeSendException(error).classification;
}

/**
 * `kit.send` ÇAĞRILDIKTAN sonra üretilmesine izin verilen TEK kodlar.
 *
 * `rejected` ve `insufficientFunds` yalnızca eksiksiz ve hash'siz bir analiz
 * onları KANITLADIĞINDA buraya girer. Listede olmayan her kod — özellikle
 * sınıflandırıcının kendisi çöktüğü için düşülen `sendFailed` — yeniden
 * denenebilir sayılamaz; aynı ödeme ikinci kez gidebilirdi.
 */
const POST_SEND_CODES: ReadonlySet<ArcSendErrorCode> = new Set([
  "rejected",
  "insufficientFunds",
  "reverted",
  "submissionUnknown",
]);

/** Kurulum payı tükettiğinde cüzdan akışı açılmaz. */
export class SendMarginError extends Error {
  constructor() {
    super("send safety margin exhausted");
    this.name = "SendMarginError";
  }
}

/** Zincire ulaşıp revert etmiş işlem. */
export class RevertedSubmissionError extends Error {
  readonly txHash: string | null;
  constructor(txHash: string | null) {
    super("transaction reverted on chain");
    this.name = "RevertedSubmissionError";
    this.txHash = txHash;
  }
}

export class AmbiguousSubmissionError extends Error {
  /** Varsa ArcScan mutabakatı için korunan hash. */
  readonly txHash: string | null;
  constructor(txHash: string | null = null) {
    super("submission outcome unknown");
    this.name = "AmbiguousSubmissionError";
    this.txHash = txHash;
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

/** Fırlatan getter'a karşı korumalı; okunamayan alan `null` sayılır. */
function readString(source: unknown, key: string): string | null {
  if (typeof source !== "object" || source === null) {
    return null;
  }
  const read = readProperty(source, key);
  if (!read.ok) {
    return null;
  }
  return typeof read.value === "string" && read.value.trim() !== ""
    ? read.value
    : null;
}

function classifyError(
  error: unknown,
  fallback: ArcSendErrorCode,
): ArcSendErrorCode {
  /*
   * Tipli sentineller her türlü sınıflandırmanın önüne geçer. `instanceof`
   * bile iptal edilmiş bir proxy'de fırlatabildiği için korumalı çağrılır.
   */
  if (safeInstanceOf(error, AmbiguousSubmissionError)) {
    return "submissionUnknown";
  }
  if (safeInstanceOf(error, RevertedSubmissionError)) {
    return "reverted";
  }
  if (safeInstanceOf(error, SendMarginError)) {
    return "insufficientTimeRemaining";
  }
  /*
   * YALNIZCA belgelenmiş yapısal alanlar (EIP-1193 kodu, `errorCategory`,
   * `KitError` ad+kod çifti) kullanılır. Serbest metin eşleştirmesi
   * YAPILMAZ: "insufficient ..." gibi bir mesaj işlemin yayınlanmadığını
   * KANITLAMAZ ve yanlışlıkla yeniden denemeye izin verirdi.
   */
  const structured = classifySendException(error);
  if (structured === "rejected") {
    return "rejected";
  }
  if (structured === "insufficientFunds") {
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

  /** Revert veya belirsiz sonuçta korunan hash; ArcScan mutabakatı için. */
  let terminalHash: string | null = null;
  /** `kit.send` çağrısına GİRİLDİ mi? Sonrasında geri dönüş yoktur. */
  let sendAttempted = false;

  const outcome = await runGuarded(
    walletUuid,
    snapshot,
    "sendFailed",
    now,
    async ({ kit, params }) => {
      /*
       * SON kontrol: preflight ve App Kit kurulumu payı tüketmiş olabilir.
       * Cüzdan istemi açıldıktan sonra doğrudan ERC-20 transferinde son tarihi
       * zincire dayatmanın yolu yoktur; bu yüzden istem AÇILMADAN önce bakılır.
       */
      if (checkSendSafetyMargin(snapshot, now()) !== null) {
        throw new SendMarginError();
      }

      let result: unknown;
      try {
        // Bu noktadan SONRA işlem zincire düşmüş OLABİLİR.
        sendAttempted = true;
        result = await kit.send(params);
      } catch (error) {
        /*
         * Buraya geldiysek `kit.send` ÇAĞRILDI. Yalnızca hash TAŞIMAYAN ve
         * yapısal olarak tanınan hatalar (cüzdan reddi, SDK'nın yayın öncesi
         * bakiye hataları) yeniden denenebilir sayılır; serbest metin
         * eşleştirilmez. Diğer her şeyde işlem zincire düşmüş OLABİLİR ve
         * varsa hash mutabakat için KORUNUR.
         */
        /*
         * TEK analiz: hash ve sınıflandırma AYNI anlık görüntüden gelir.
         * İki ayrı çağrı yapılsaydı durumlu bir getter ikisine farklı yanıt
         * verebilirdi. Analiz hiçbir koşulda fırlatmaz.
         */
        const analysis = analyzeSendException(error);
        terminalHash = analysis.txHash;
        if (
          analysis.classification === "rejected" ||
          analysis.classification === "insufficientFunds"
        ) {
          throw error;
        }
        throw new AmbiguousSubmissionError(analysis.txHash);
      }

      const classified = classifySendResult(result);
      if (classified.kind === "rejected") {
        throw Object.assign(new Error("user rejected"), { code: 4001 });
      }
      if (classified.kind === "reverted") {
        // Revert ASLA "ödendi" sayılmaz; hash ArcScan için korunur.
        terminalHash = classified.txHash;
        throw new RevertedSubmissionError(classified.txHash);
      }
      if (classified.kind === "unknown") {
        // Belirsiz sonuçta da hash KORUNUR: mutabakatın tek ipucu odur.
        terminalHash = classified.txHash;
        throw new AmbiguousSubmissionError(classified.txHash);
      }

      return {
        txHash: classified.txHash,
        // Bağlantı SDK'nın döndürdüğü URL'den değil, doğrulanmış hash'ten kurulur.
        explorerUrl: buildArcExplorerTxUrl(classified.txHash),
        state: readString(result, "state"),
        snapshot,
        completedAt: new Date().toISOString(),
      };
    },
  );

  /*
   * EMNİYET AĞI. `kit.send` çağrıldıysa, izin verilen kodların dışındaki her
   * sonuç `submissionUnknown`a çekilir. Sınıflandırıcı bir fırlatan getter
   * yüzünden çökse ve `sendFailed`e düşülse bile kullanıcıya "gönderilemedi"
   * denmez; rezervasyon kilitli kalır.
   */
  const settled: ArcSendResult<ArcSendSuccess> =
    !outcome.ok && sendAttempted && !POST_SEND_CODES.has(outcome.code)
      ? { ok: false, code: "submissionUnknown" }
      : outcome;

  /*
   * Zincire ulaşmış OLABİLECEK her sonuçta hash dışarı taşınır: hem revert
   * hem de belirsizlik ArcScan'de kontrol edilerek çözülür.
   */
  if (
    !settled.ok &&
    (settled.code === "reverted" || settled.code === "submissionUnknown") &&
    terminalHash !== null
  ) {
    return {
      ok: false,
      code: settled.code,
      txHash: terminalHash,
      explorerUrl: buildArcExplorerTxUrl(terminalHash),
    };
  }
  return settled;
}

export { ARC_TESTNET_CHAIN_ID };
