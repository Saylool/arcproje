import {
  normalizeWalletAddress,
  walletAddressesEqual,
} from "./address";
import {
  MICRO_USDC_PER_USDC,
  convertTryMinorBigIntToMicroUsdc,
  parseSignedRate,
} from "./conversion";
import { parsePositiveMinorUnits } from "./minor-units";
import {
  ARC_TESTNET_CHAIN_ID,
  buildArcExplorerTxUrl,
  isArcTestnet,
  isValidTransactionHash,
  parseChainId,
} from "./network";
import {
  createArcTransferClient,
  type ArcTransferClient,
} from "./transfer-client";
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
import { translate } from "../i18n/dictionary";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";

/**
 * Gönderim akışının güvenlik sınırı.
 *
 * Bu modül React state'ine güvenmez. Kullanıcının incelediği ödeme değişmez bir
 * snapshot olarak gelir; her alan burada yeniden doğrulanır ve zincire giden
 * çağrıdan hemen önce provider'a `eth_accounts` ile `eth_chainId` sorulur.
 * Hesap veya ağ değişmişse cüzdan istemi hiç açılmaz.
 *
 * Zincire dokunan tek yol `./transfer-client` (viem). O da dinamik import
 * edilir: yalnızca tarayıcıda, yalnızca doğrulama geçtikten sonra yüklenir.
 * Ham sağlayıcı hataları dışarı verilmez.
 *
 * Talebin geçerlilik süresi bu sınırda, React'ten BAĞIMSIZ olarak uygulanır ve
 * her adımda yeniden ölçülür: girişte, preflight'tan sonra, istemci
 * kurulduktan sonra ve cüzdan istemi açılmadan hemen önce.
 *
 * ÜÇ ADIMLI GÖNDERİM ve neden ayrı durdukları:
 *
 *  1. `simulate()` cüzdana DOKUNMAZ ve işlem YAYINLAMAZ; oradaki hata
 *     kanıtlanabilir biçimde yayın öncesidir.
 *  2. `submit()` istemi açar ve BAŞARIYSA hash'i döndürür. Belirsizlik
 *     penceresi bu yüzden yalnızca "fırlattı ve hiç hash yok" hâlidir.
 *  3. `waitForReceipt()` sonucu zincirin `status` alanından okur. Bekleme
 *     fırlarsa hash elimizdedir ve sonuç hash'iyle birlikte belirsiz sayılır.
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
  /**
   * TRY minor unit cinsinden borç — KANONİK ONDALIK METİN.
   *
   * `number` DEĞİLDİR: paylaşılan hesap borçları güvenli tam sayı aralığının
   * ötesine çıkabilir ve `numeric(30, 0)` olarak saklanır. Metin taşımak,
   * gösterilen / tahmin edilen / rezerve edilen / gönderilen / mutabakatı
   * yapılan tutarın AYNI tam sayıdan türemesini garanti eder.
   */
  tryMinor: string;
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

/**
 * Kodun kullanıcıya gösterilecek karşılığı.
 *
 * Metin SÖZLÜKTEN gelir; kod MAKİNE OKUNUR kalır ve çevrilmez. `locale`
 * verilmezse Türkçeye düşülür, böylece sunucu tarafındaki çağıranlar
 * (API yanıtları) değişmeden aynı metni üretir.
 */
export function describeArcSendError(
  code: ArcSendErrorCode,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return translate(locale, `errors.send.${code}`);
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
 * `submit()` çağrıldıktan sonra sonuç belirsizse tekrar denemek aynı ödemeyi
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
       * `submit()` bir hash döndürdüyse kaybedilmez.
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
 * `submit()` ÇAĞRILDIKTAN sonra ortaya çıkan belirsiz sonuç.
 *
 * Bu noktadan sonra işlem zincire düşmüş OLABİLİR. Hata "gönderilemedi" gibi
 * sunulmaz; kullanıcı önce cüzdanını ve explorer'ı kontrol etmelidir.
 */

/**
 * `submit()` ÇAĞRILDIKTAN sonra fırlayan istisnanın sınıflandırılması.
 *
 * Yayın ÖNCESİ sayılmanın İKİ koşulu vardır:
 * 1. Hata grafiğinin HİÇBİR yerinde geçerli işlem hash'i OLMAMALIDIR. Hash
 *    varsa bir şey zincire gitmiştir ve hiçbir "yeniden denenebilir" sınıf
 *    uygulanmaz.
 * 2. Sinyal BELGELENMİŞ ve OLUMLU bir kimlik olmalıdır: viem'in
 *    `UserRejectedRequestError`'ı ya da ham EIP-1193 4001 reddi.
 *
 * Serbest metin eşleştirmesi YAPILMAZ: "insufficient confirmations" gibi bir
 * mesaj işlemin gönderilmediğini kanıtlamaz. Kalan her şey belirsizdir.
 *
 * BAKİYE HATALARI ARTIK BURADA ARANMAZ. App Kit'in `prepareSend`'i onları
 * `KitError` ad+kod çiftiyle (9001/9002/9003) fırlatıyordu ve tek ipucu oydu;
 * viem yolunda yetersiz bakiye `simulate()` adımında, cüzdan hiç açılmadan
 * ortaya çıkar. Yani artık çıkarsanan değil KANITLANMIŞ bir yayın öncesi
 * hatadır ve `classifySimulationError` onu ayrı ele alır.
 */
export type SendExceptionClass = "rejected" | "submissionUnknown";

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
 * hâliyle dışarı çıkar. Bu hash olmadan işlem ArcScan'de
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
 * TypeError fırlatır. `submit()` ÇAĞRILDIKTAN sonra bu tür bir çökme
 * "gönderilemedi" gibi raporlanırsa kullanıcı, zincire düşmüş olabilecek bir
 * ödemeyi ikinci kez gönderebilir. Bu yüzden incelenen HER özellik buradan
 * okunur ve hata yutulup `ok: false` olarak bildirilir.
 */
type PropertyRead = { ok: true; value: unknown } | { ok: false };

function readProperty(target: object, key: PropertyKey): PropertyRead {
  try {
    return { ok: true, value: (target as Record<PropertyKey, unknown>)[key] };
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
 * viem klasik `cause` zinciri kullanır; cüzdan köprüleri ve uzantı
 * sarmalayıcıları ise özgün hatayı `trace` ya da `rawError` altında iç içe
 * taşıyabilir. Adlar App Kit kaldırıldıktan sonra da LİSTEDE BIRAKILDI:
 * maliyeti yok ve bir sarmalayıcı onları kullanırsa gerçek ret kimliği ya da
 * işlem hash'i görülmeden kalırdı.
 *
 * Bu sınır hangi köprünün kullanıldığını BİLMEZ ve bilmemelidir: sağlayıcıya
 * yalnızca `withProvider(walletUuid, …)` üzerinden ulaşılır.
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

/** Standart `AggregateError` alanı: YALNIZCA dizi şekli desteklenir. */
const AGGREGATE_LINK = "errors";

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

/** Prototip zincirinde bakılacak en fazla adım. */
const MAX_PROTOTYPE_DEPTH = 8;

/**
 * Değerin prototipi SIRADAN mı?
 *
 * Kabul edilenler: prototipsiz nesne (`Object.create(null)`), düz nesne
 * (`Object.prototype`) ve `Error` türevleri (viem `BaseError` gibi).
 *
 * `Set`, `Map`, `WeakSet`, `WeakMap`, tipli diziler/`ArrayBuffer` görünümleri,
 * `Promise` ve özel kap sınıfları bu testten GEÇEMEZ: prototipleri ne
 * `Object.prototype`tir ne de `Error` zincirine ulaşır. Bu bir İZİN LİSTESİDİR;
 * her kap türü için ayrı bir uygulama eklenmez.
 *
 * `Object.getPrototypeOf` proxy tuzağı çalıştırır ve fırlatabilir; korumalıdır.
 */
function hasOrdinaryPrototype(
  value: object,
): { ok: true; value: boolean } | { ok: false } {
  let current: unknown;
  try {
    current = Object.getPrototypeOf(value);
  } catch {
    return { ok: false };
  }
  if (current === null || current === Object.prototype) {
    return { ok: true, value: true };
  }
  for (let depth = 0; depth < MAX_PROTOTYPE_DEPTH; depth += 1) {
    if (current === Error.prototype) {
      return { ok: true, value: true };
    }
    if (current === null || typeof current !== "object") {
      break;
    }
    try {
      current = Object.getPrototypeOf(current);
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, value: false };
}

/**
 * Prototipi sıradan görünse bile KAP gibi davranan nesneler.
 *
 * Düz prototipli özel yinelenebilirler, dizi benzeri nesneler
 * (`{ 0: …, length: 1 }`), thenable'lar ve `size` taşıyan koleksiyon
 * taklitleri gizli girdi saklayabilir. Hepsi desteklenmez.
 */
function looksLikeContainer(
  value: object,
): { ok: true; value: boolean } | { ok: false } {
  const iterator = readProperty(value, Symbol.iterator);
  if (!iterator.ok) {
    return { ok: false };
  }
  if (iterator.value !== undefined) {
    return { ok: true, value: true };
  }
  for (const key of ["length", "size"] as const) {
    const read = readProperty(value, key);
    if (!read.ok) {
      return { ok: false };
    }
    if (typeof read.value === "number") {
      return { ok: true, value: true };
    }
  }
  const thenable = readProperty(value, "then");
  if (!thenable.ok) {
    return { ok: false };
  }
  return { ok: true, value: typeof thenable.value === "function" };
}

/**
 * Bir düğümün desteklenen şekli.
 *
 * - `record`: sıradan kayıt/hata nesnesi; anlık görüntüsü alınır ve
 *   bağlantıları izlenir.
 * - `array`: dizi; DESTEKLENEN kap olarak yalnızca hash kurtarmak için
 *   taranır ve dolaşımı EKSİK işaretler.
 * - `unsupported`: `Set`/`Map`/`WeakSet`/`WeakMap`/tipli dizi/yinelenebilir/
 *   dizi benzeri/thenable/özel prototip. İçi güvenle görülemez.
 * - `unreadable`: iptal edilmiş proxy veya fırlatan erişimci.
 */
type NodeShape = "record" | "array" | "unsupported" | "unreadable";

function classifyNodeShape(value: object): NodeShape {
  const arrayCheck = safeIsArray(value);
  if (!arrayCheck.ok) {
    return "unreadable";
  }
  if (arrayCheck.value) {
    return "array";
  }
  const ordinary = hasOrdinaryPrototype(value);
  if (!ordinary.ok) {
    return "unreadable";
  }
  if (!ordinary.value) {
    return "unsupported";
  }
  const container = looksLikeContainer(value);
  if (!container.ok) {
    return "unreadable";
  }
  return container.value ? "unsupported" : "record";
}

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

    const shape = classifyNodeShape(current);
    if (shape === "unreadable") {
      // İptal edilmiş proxy veya fırlatan erişimci: hiçbir şey okunamaz.
      complete = false;
      continue;
    }
    if (shape === "unsupported") {
      /*
       * DESTEKLENMEYEN KAP: `Set`, `Map`, `WeakSet`, `WeakMap`, tipli dizi,
       * `ArrayBuffer` görünümü, özel yinelenebilir, dizi benzeri nesne,
       * thenable veya tanınmayan bir kap prototipi.
       *
       * Girdileri güvenle sayılamaz/okunamaz; içinde gizli bir ret kimliği ya
       * da işlem hash'i olabilir. FAIL-CLOSED: dolaşım EKSİK işaretlenir,
       * içine GİRİLMEZ ve sonuç hiçbir koşulda yeniden denenebilir olamaz.
       * Her kap türü için ayrı bir gezinme uygulaması EKLENMEZ.
       */
      complete = false;
      continue;
    }
    if (shape === "array") {
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
      if (next === null || next === undefined) {
        // Yokluk desteklenen bir şekildir.
        continue;
      }
      if (typeof next === "function") {
        // Fonksiyon değerli bağlantı desteklenmez.
        complete = false;
        continue;
      }
      if (typeof next !== "object") {
        // İlkel değer alt hata taşıyamaz; güvenlidir.
        continue;
      }
      if (link === AGGREGATE_LINK) {
        /*
         * Standart `AggregateError.errors` YALNIZCA dizi şeklinde desteklenir.
         * Başka her non-null şekil (Set, Map, yinelenebilir, düz nesne…)
         * dolaşımı EKSİK bırakır ve içine girilmez.
         */
        const arrayCheck = safeIsArray(next);
        if (!arrayCheck.ok || !arrayCheck.value) {
          complete = false;
          continue;
        }
      }
      if (!seen.has(next)) {
        queue.push(next);
      }
    }
  }

  return { nodes, complete };
}

/** viem'in kullanıcı reddi hatasının TAM adı (`_esm/errors/rpc.js`). */
const VIEM_USER_REJECTED_ERROR = "UserRejectedRequestError";

/** EIP-1193 kullanıcı reddi kodu. */
const EIP1193_USER_REJECTED_CODE = 4001;

/**
 * Bu düğüm OLUMLU bir kullanıcı iptali kimliği mi?
 *
 * İki kabul edilen kimlik: viem'in `UserRejectedRequestError` adı ve ham
 * EIP-1193 4001 kodu. Serbest metne BAKILMAZ.
 *
 * App Kit kaldırıldığında bir tuzak da kalktı: SDK'nın `RpcError`'ı uç nokta
 * arızası için de `code: 4001` kullanıyordu, bu yüzden 4001'i kabul etmeden
 * önce düğümün bir `KitError` OLMADIĞINI doğrulamak gerekiyordu. Zincire
 * giden tek yol artık viem olduğu için 4001'in tek anlamı EIP-1193 reddidir.
 */
function isUserRejectionNode(node: Readonly<Record<string, unknown>>): boolean {
  return (
    node.name === VIEM_USER_REJECTED_ERROR ||
    node.code === EIP1193_USER_REJECTED_CODE
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
 * Gönderim istisnasının TOTAL analizi. Bu fonksiyon ASLA fırlatmaz.
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
   * Sonra OLUMLU iptal kimliği. Cüzdan sarmalayıcıları hatayı katmanlar;
   * gerçek `UserRejectedRequestError` derinlerde bulunabilir.
   */
  if (graph.nodes.some(isUserRejectionNode)) {
    return { classification: "rejected", txHash: null, complete: true };
  }

  // RPC/ağ arızaları dâhil kanıtlanmamış her şey belirsizdir.
  return { classification: "submissionUnknown", txHash: null, complete: true };
}

export function classifySendException(error: unknown): SendExceptionClass {
  return analyzeSendException(error).classification;
}

/**
 * `submit()` ÇAĞRILDIKTAN sonra üretilmesine izin verilen TEK kodlar.
 *
 * `rejected` ve `insufficientFunds` yalnızca eksiksiz ve hash'siz bir analiz
 * onları KANITLADIĞINDA buraya girer. Listede olmayan her kod — özellikle
 * sınıflandırıcının kendisi çöktüğü için düşülen `sendFailed` — yeniden
 * denenebilir sayılamaz; aynı ödeme ikinci kez gidebilirdi.
 */
export const POST_SEND_CODES: ReadonlySet<ArcSendErrorCode> = new Set([
  "rejected",
  "insufficientFunds",
  "reverted",
  "submissionUnknown",
]);

/**
 * Bu hata cüzdan istemi AÇILMADAN ÖNCE mi doğdu?
 *
 * `sendArcUsdc`in emniyet ağı, `submit()` çağrıldıktan sonra üretilen HER
 * kodu `POST_SEND_CODES` içine çeker. Dolayısıyla listede OLMAYAN bir kod,
 * cüzdan akışının HİÇ açılmadığının KANITIDIR ve rezervasyon güvenle serbest
 * bırakılabilir.
 *
 * Bu karar burada, sınıflandırıcının YANINDA durur; çağıranlar kendi
 * kopyalarını tutmaz.
 */
export function isProvablyPreBroadcast(code: ArcSendErrorCode): boolean {
  return !POST_SEND_CODES.has(code);
}

/**
 * `simulate()` adımında doğan, KANITLANABİLİR biçimde yayın öncesi hata.
 *
 * `simulate` cüzdana dokunmaz ve işlem yayınlamaz, bu yüzden buradaki her
 * başarısızlık güvenle yeniden denenebilir. Tipli sentinel olarak taşınır ki
 * `classifyError` onu belirsizlikle karıştırmasın.
 */
export class PreBroadcastError extends Error {
  readonly code: ArcSendErrorCode;
  constructor(code: ArcSendErrorCode) {
    super("pre-broadcast failure");
    this.name = "PreBroadcastError";
    this.code = code;
  }
}

/**
 * Yetersiz bakiyenin zincirden gelen imzası.
 *
 * ERC-20 `transfer`, bakiye yetmediğinde revert eder ve viem bunu
 * `ContractFunctionExecutionError` olarak yükseltir. Bu ad YALNIZCA
 * `simulate()` bağlamında okunur: orada hiçbir işlem yayınlanmadığı için
 * yanlış sınıflandırmanın parayı iki kez gönderme riski YOKTUR.
 */
const VIEM_CONTRACT_EXECUTION_ERROR = "ContractFunctionExecutionError";

/**
 * `simulate()` hatasını kullanıcıya gösterilecek koda çevirir.
 *
 * Yalnızca hata ADI okunur; revert mesajının metni eşleştirilmez.
 */
export function classifySimulationError(error: unknown): ArcSendErrorCode {
  const graph = (() => {
    try {
      return collectErrorGraph(error);
    } catch {
      return { nodes: [], complete: false } as const;
    }
  })();
  for (const node of graph.nodes) {
    if (node.name === VIEM_CONTRACT_EXECUTION_ERROR) {
      return "insufficientFunds";
    }
  }
  return "sendFailed";
}

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
  const tryMinor = parsePositiveMinorUnits(snapshot.tryMinor);
  if (tryMinor === null) {
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
  const recomputed = convertTryMinorBigIntToMicroUsdc(tryMinor, rate.rate);
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

/**
 * viem YALNIZCA burada, doğrulama ve preflight geçtikten sonra yüklenir.
 *
 * İstemci kurmak zincire hiçbir şey göndermez ve cüzdana dokunmaz; yalnızca
 * modülü indirir ve iki taşıyıcıyı hazırlar.
 */
function buildTransferClient(
  provider: Eip1193Provider,
  snapshot: ArcPaymentSnapshot,
): Promise<ArcTransferClient> {
  return createArcTransferClient(provider, {
    debtorAddress: snapshot.debtorAddress,
    recipientAddress: snapshot.recipientAddress,
    /*
     * Tutar snapshot'ın MİKRO BİRİMİNDEN gelir, gösterilen ondalık metinden
     * DEĞİL. `validatePaymentSnapshot` ikisinin birbirini tuttuğunu ve
     * tutarın borç ile kurdan yeniden türediğini zaten kanıtladı; zincire
     * giden sayı o kanıtlanmış tam sayıdır.
     */
    microUsdc: snapshot.microUsdc,
  });
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
  if (safeInstanceOf(error, PreBroadcastError)) {
    return (error as PreBroadcastError).code;
  }
  /*
   * YALNIZCA belgelenmiş yapısal alanlar (viem'in hata adı, EIP-1193 kodu)
   * kullanılır. Serbest metin eşleştirmesi YAPILMAZ: "insufficient ..." gibi
   * bir mesaj işlemin yayınlanmadığını KANITLAMAZ ve yanlışlıkla yeniden
   * denemeye izin verirdi.
   */
  if (classifySendException(error) === "rejected") {
    return "rejected";
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
 * Talebin süresi üç noktada ölçülür: girişte, viem yüklenmeden hemen önce ve
 * zincire giden çağrıdan hemen önce.
 */
async function runGuarded<T>(
  walletUuid: string,
  snapshot: ArcPaymentSnapshot,
  fallbackCode: ArcSendErrorCode,
  now: () => number,
  action: (client: ArcTransferClient) => Promise<T>,
): Promise<BoundaryOutcome<T>> {
  const invalid = validatePaymentSnapshot(snapshot, now());
  if (invalid !== null) {
    // viem hiç import edilmez.
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
    // bir talep için viem import bile edilmez.
    guardCode = checkSnapshotRequestTime(snapshot, now());
    if (guardCode !== null) {
      throw new Error("expired");
    }
    const client = await buildTransferClient(provider, snapshot);
    // Zincire giden çağrıdan hemen önceki son ölçüm.
    guardCode = checkSnapshotRequestTime(snapshot, now());
    if (guardCode !== null) {
      throw new Error("expired");
    }
    try {
      return await action(client);
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
  return runGuarded(walletUuid, snapshot, "estimateFailed", now, async (client) => ({
    summary: await client.estimateFee(),
  }));
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
  /** Cüzdan istemi AÇILDI mı? Sonrasında geri dönüş yoktur. */
  let sendAttempted = false;

  const outcome = await runGuarded(
    walletUuid,
    snapshot,
    "sendFailed",
    now,
    async (client) => {
      /*
       * 1. SİMÜLASYON — cüzdana dokunmaz, işlem yayınlamaz.
       *
       * Yetersiz bakiye gibi zincirin reddedeceği her şey burada ortaya
       * çıkar. `sendAttempted` hâlâ `false` olduğu için sonuç KANITLANABİLİR
       * biçimde yayın öncesidir ve rezervasyon güvenle serbest bırakılabilir.
       */
      try {
        await client.simulate();
      } catch (error) {
        throw new PreBroadcastError(classifySimulationError(error));
      }

      /*
       * 2. SON PAY ÖLÇÜMÜ — istem açılmadan hemen önce.
       *
       * Simülasyon ve viem kurulumu payı tüketmiş olabilir. Cüzdan istemi
       * açıldıktan sonra doğrudan ERC-20 transferinde son tarihi zincire
       * dayatmanın yolu yoktur; bu yüzden istem AÇILMADAN önce bakılır.
       */
      if (checkSendSafetyMargin(snapshot, now()) !== null) {
        throw new SendMarginError();
      }

      /*
       * 3. GÖNDERİM — bu noktadan SONRA işlem zincire düşmüş OLABİLİR.
       */
      let txHash: string;
      try {
        sendAttempted = true;
        txHash = await client.submit();
      } catch (error) {
        /*
         * TEK analiz: hash ve sınıflandırma AYNI anlık görüntüden gelir.
         * İki ayrı çağrı yapılsaydı durumlu bir getter ikisine farklı yanıt
         * verebilirdi. Analiz hiçbir koşulda fırlatmaz.
         *
         * Yalnızca hash TAŞIMAYAN ve yapısal olarak tanınan cüzdan reddi
         * yeniden denenebilir sayılır; serbest metin eşleştirilmez.
         */
        const analysis = analyzeSendException(error);
        terminalHash = analysis.txHash;
        if (analysis.classification === "rejected") {
          throw error;
        }
        throw new AmbiguousSubmissionError(analysis.txHash);
      }

      /*
       * Hash'in kendisi de doğrulanır. Bozuk bir değer "gönderildi" sayılamaz
       * ama "gönderilmedi" de sayılamaz: çağrı dönmüştür, işlem yolda
       * olabilir. Mutabakat ipucu olmadan belirsiz bildirilir.
       */
      if (!isValidTransactionHash(txHash)) {
        throw new AmbiguousSubmissionError(null);
      }
      terminalHash = txHash;

      /*
       * 4. MAKBUZ — sonuç zincirin kendi `status` alanından okunur.
       *
       * Bekleme fırlarsa (zaman aşımı, RPC arızası) hash ELİMİZDEDİR: sonuç
       * belirsizdir ama kullanıcı ArcScan'de bakabilir. App Kit yolunda hash
       * hata grafiğinden kurtarılmak zorundaydı; artık gerekmiyor.
       */
      let receipt: Awaited<ReturnType<ArcTransferClient["waitForReceipt"]>>;
      try {
        receipt = await client.waitForReceipt(txHash);
      } catch {
        throw new AmbiguousSubmissionError(txHash);
      }

      if (receipt.kind === "reverted") {
        // Revert ASLA "ödendi" sayılmaz; hash ArcScan için korunur.
        throw new RevertedSubmissionError(txHash);
      }

      return {
        txHash,
        // Bağlantı doğrulanmış hash'ten kurulur.
        explorerUrl: buildArcExplorerTxUrl(txHash),
        state: "success",
        snapshot,
        completedAt: new Date().toISOString(),
      };
    },
  );

  /*
   * EMNİYET AĞI. Cüzdan istemi açıldıysa, izin verilen kodların dışındaki her
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
