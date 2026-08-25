import { buildArcExplorerTxUrl, isValidTransactionHash } from "./network";
import { translate } from "../i18n/dictionary";
import { DEFAULT_LOCALE } from "../i18n/locale";

/**
 * Aynı tarayıcıda kazara tekrar gönderimi engelleyen YEREL kayıt ve kilit.
 *
 * Yalnızca `chainId` + `requestId` (ikisi de zaten paylaşılan bağlantıda açık),
 * sonucun türü, yazma sahibi/zamanı ve varsa işlem hash'i saklanır. Adres,
 * tutar, imza veya etiket SAKLANMAZ; gizli hiçbir veri içermez.
 *
 * BU YETKİLİ BİR KORUMA DEĞİLDİR. `localStorage`, Web Locks ve
 * `BroadcastChannel` cihaz ve tarayıcı başınadır: gizli sekmede, başka bir
 * cihazda veya temizlenmiş depoda hiçbir şey hatırlanmaz. Gerçek tekrar
 * oynatma engeli için arka uçta veya zincir üstünde ATOMİK `requestId`
 * tüketimi gerekir.
 *
 * TEK ATOMİK İLKEL WEB LOCKS'TIR. `localStorage` durumu KAYDEDER ama kilit
 * olarak KULLANILMAZ. Hem rezervasyon hem de yayın YAPABİLECEK işin TAMAMI
 * tek bir exclusive Web Lock içinde çalışır.
 *
 * ŞEMA v2 — TALEP BAŞINA BİR ANAHTAR. Eskiden tüm kayıtlar tek bir JSON
 * dizisinde tutuluyordu; farklı `requestId`'ler eşzamanlı yazdığında "oku,
 * diziyi değiştir, yaz" adımları birbirinin kaydını SİLEBİLİYORDU ve
 * doğrulama yalnızca dizi UZUNLUĞUNA bakıyordu. Artık her kayıt kendi
 * anahtarındadır: farklı talepler asla aynı anahtara yazmaz, dolayısıyla
 * kayıp güncelleme yarışı yoktur. Yazılan kayıt geri okunur ve chainId,
 * requestId, outcome, owner, at ve varsa txHash alanlarının HEPSİ birebir
 * doğrulanır; doğrulanamazsa gönderime GEÇİLMEZ (fail-closed).
 *
 * Bu özellik henüz dağıtılmadı; v1 verisi için GÖÇ YOKTUR. Eski anahtar
 * okunmaz, yazılmaz ve şemayı kirletmez.
 *
 * SINIR: kayıtlar budanmaz. Her kayıt birkaç yüz bayttır ve ancak on binlerce
 * ayrı ödeme talebinden sonra anlamlı yer kaplar.
 */

/** Talep başına anahtar öneki. Şema sürümü anahtarın içindedir. */
const KEY_PREFIX = "hesabi-bol.submission.v2.";
const SCHEMA_VERSION = 2;
const CHANNEL_NAME = "hesabi-bol.submissions";

export type SubmissionOutcome = "pending" | "success" | "reverted" | "unknown";

const OUTCOMES: readonly SubmissionOutcome[] = [
  "pending",
  "success",
  "reverted",
  "unknown",
];

/** Talep kimliğinin beklenen biçimi: 0x + 64 hex. */
const REQUEST_ID_PATTERN = /^0x[0-9a-f]{64}$/;

/** Depoda tutulan tam kayıt. */
export type SubmissionRecord = Readonly<{
  chainId: number;
  /** Küçük harfe indirgenmiş talep kimliği. */
  requestId: string;
  outcome: SubmissionOutcome;
  /** Yazmanın bize ait olduğunu kanıtlayan rastgele jeton (sır DEĞİL). */
  owner: string;
  at: number;
  /** Yalnızca KATI doğrulamayı geçen işlem hash'i. */
  txHash?: string;
}>;

/** Arayüzün ihtiyaç duyduğu özet. */
export type SubmissionView = Readonly<{
  outcome: SubmissionOutcome;
  txHash: string | null;
  /** Hash varsa doğrulanmış ArcScan bağlantısı. */
  explorerUrl: string | null;
}>;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Web Locks API'sinin bu modülün kullandığı yüzeyi. */
export type LockManagerLike = {
  request(
    name: string,
    options: { mode?: "exclusive" | "shared"; ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<void>;
};

/**
 * Tarayıcı güvenli gönderim için gerekeni sağlamıyor.
 *
 * Kilit veya doğrulanabilir kalıcı kayıt olmadan aynı ödemenin iki sekmeden
 * iki kez gönderilmediği GÖSTERİLEMEZ; bu yüzden gönderim hiç başlatılmaz.
 */
export const SUBMISSION_UNAVAILABLE_MESSAGE = translate(
  DEFAULT_LOCALE,
  "errors.submissionUnavailable",
);

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Depo erişimi engellenmiş olabilir (gizli mod, izin politikası).
    return null;
  }
}

function defaultLocks(): LockManagerLike | null {
  try {
    if (typeof navigator === "undefined") {
      return null;
    }
    const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks;
    return typeof locks?.request === "function" ? locks : null;
  } catch {
    // Güvenli olmayan bağlamda erişim hata atabilir.
    return null;
  }
}

/**
 * Yazmanın bize ait olduğunu kanıtlayan rastgele jeton.
 *
 * Bir SIR DEĞİLDİR ve güvenlik amacı taşımaz; yalnızca "geri okuduğum kayıt
 * gerçekten benim yazdığım mı?" sorusunu cevaplar.
 */
function createOwnerToken(): string {
  try {
    const source = globalThis.crypto;
    if (typeof source?.randomUUID === "function") {
      return source.randomUUID();
    }
    if (typeof source?.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      source.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // Aşağıdaki yedeğe düşülür; jeton gizli olmak zorunda değildir.
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/** Kayıt anahtarı: yalnızca ağ ve talep kimliği. */
export function submissionKey(chainId: number, requestId: string): string {
  return `${chainId}:${requestId.toLowerCase()}`;
}

function storageKeyFor(chainId: number, requestId: string): string {
  return `${KEY_PREFIX}${submissionKey(chainId, requestId)}`;
}

function lockName(chainId: number, requestId: string): string {
  return `hesabi-bol.send.${submissionKey(chainId, requestId)}`;
}

/** Kimlikleri kanonikleştirir; biçim tutmuyorsa `null` (fail-closed). */
function normalizeIds(
  chainId: number,
  requestId: string,
): { chainId: number; requestId: string } | null {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return null;
  }
  if (typeof requestId !== "string") {
    return null;
  }
  const lower = requestId.toLowerCase();
  return REQUEST_ID_PATTERN.test(lower) ? { chainId, requestId: lower } : null;
}

type StoredState =
  | { kind: "none" }
  | { kind: "record"; record: SubmissionRecord }
  /** Ham değer var ama şema tutmuyor: kayıt SAYILIR, engelleme sürer. */
  | { kind: "corrupt" }
  /** Depo okunamadı: durum BİLİNMİYOR, gönderime izin verilmez. */
  | { kind: "unreadable" };

/**
 * Tek kaydı ayrıştırır.
 *
 * Beklenen `chainId`/`requestId` ile BİREBİR eşleşmeyen bir gövde kabul
 * edilmez: başka bir anahtarın içeriği kopyalanmış olsa bile geçerli
 * sayılmaz. Bozuk `txHash` kaydı ÇÖPE ATMAZ — kayıt engellemeye devam eder,
 * yalnızca hash düşürülür.
 */
function parseRecord(
  raw: string,
  chainId: number,
  requestId: string,
): SubmissionRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const body = parsed as Record<string, unknown>;
  if (body.v !== SCHEMA_VERSION) {
    return null;
  }
  if (body.chainId !== chainId) {
    return null;
  }
  if (typeof body.requestId !== "string" || body.requestId !== requestId) {
    return null;
  }
  const outcome = body.outcome;
  if (
    typeof outcome !== "string" ||
    !OUTCOMES.includes(outcome as SubmissionOutcome)
  ) {
    return null;
  }
  if (typeof body.owner !== "string" || body.owner === "") {
    return null;
  }
  const at = body.at;
  if (typeof at !== "number" || !Number.isSafeInteger(at) || at <= 0) {
    return null;
  }
  const txHash = isValidTransactionHash(body.txHash) ? body.txHash : undefined;
  return Object.freeze({
    chainId,
    requestId,
    outcome: outcome as SubmissionOutcome,
    owner: body.owner,
    at,
    ...(txHash !== undefined && { txHash }),
  });
}

function readStored(
  storage: StorageLike,
  chainId: number,
  requestId: string,
): StoredState {
  let raw: string | null;
  try {
    raw = storage.getItem(storageKeyFor(chainId, requestId));
  } catch {
    return { kind: "unreadable" };
  }
  if (raw === null || raw === undefined) {
    return { kind: "none" };
  }
  if (typeof raw !== "string") {
    return { kind: "corrupt" };
  }
  const record = parseRecord(raw, chainId, requestId);
  return record === null ? { kind: "corrupt" } : { kind: "record", record };
}

function recordsIdentical(a: SubmissionRecord, b: SubmissionRecord): boolean {
  return (
    a.chainId === b.chainId &&
    a.requestId === b.requestId &&
    a.outcome === b.outcome &&
    a.owner === b.owner &&
    a.at === b.at &&
    (a.txHash ?? null) === (b.txHash ?? null)
  );
}

/**
 * Kaydı yazar ve YAZDIĞININ AYNISINI geri okuduğunu doğrular.
 *
 * `setItem` sessizce yok sayılabilir (kota, gizli mod, izin politikası) veya
 * araya giren bir yazma değeri değiştirmiş olabilir. Bu yüzden dönüş değeri
 * çağıran tarafından KONTROL EDİLİR; doğrulanamayan yazmadan sonra gönderim
 * yapılmaz.
 */
function persistRecord(storage: StorageLike, record: SubmissionRecord): boolean {
  const payload: Record<string, unknown> = {
    v: SCHEMA_VERSION,
    chainId: record.chainId,
    requestId: record.requestId,
    outcome: record.outcome,
    owner: record.owner,
    at: record.at,
  };
  if (record.txHash !== undefined) {
    payload.txHash = record.txHash;
  }

  try {
    storage.setItem(
      storageKeyFor(record.chainId, record.requestId),
      JSON.stringify(payload),
    );
  } catch {
    return false;
  }

  const stored = readStored(storage, record.chainId, record.requestId);
  if (stored.kind !== "record" || !recordsIdentical(stored.record, record)) {
    // Yazma kaybolmuş, yok sayılmış veya üzerine yazılmış.
    return false;
  }
  announce();
  return true;
}

/** Diğer sekmelere değişikliği duyurur. */
function announce(): void {
  try {
    if (typeof BroadcastChannel === "undefined") {
      return;
    }
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage("changed");
    channel.close();
  } catch {
    // Kanal yoksa `storage` olayı yine de diğer sekmeleri uyandırır.
  }
}

/**
 * Arayüz için kayıt özeti.
 *
 * Bozuk gövde `unknown` olarak görünür: kayıt VARDIR ama sonucu
 * doğrulanamaz. "Başarılı" veya "başarısız" iddia edilmez.
 */
export function readSubmissionView(
  chainId: number,
  requestId: string,
  storage: StorageLike | null = defaultStorage(),
): SubmissionView | null {
  if (storage === null) {
    return null;
  }
  const ids = normalizeIds(chainId, requestId);
  if (ids === null) {
    return null;
  }
  const stored = readStored(storage, ids.chainId, ids.requestId);
  if (stored.kind === "none" || stored.kind === "unreadable") {
    return null;
  }
  if (stored.kind === "corrupt") {
    return Object.freeze({
      outcome: "unknown" as const,
      txHash: null,
      explorerUrl: null,
    });
  }
  const txHash = stored.record.txHash ?? null;
  return Object.freeze({
    outcome: stored.record.outcome,
    txHash,
    explorerUrl: txHash === null ? null : buildArcExplorerTxUrl(txHash),
  });
}

/** Bu tarayıcıda bu talep için bir gönderim kaydı var mı? */
export function readSubmission(
  chainId: number,
  requestId: string,
  storage: StorageLike | null = defaultStorage(),
): SubmissionOutcome | null {
  return readSubmissionView(chainId, requestId, storage)?.outcome ?? null;
}

export type RecordSubmissionOptions = {
  storage?: StorageLike | null;
  nowMs?: number;
  /** Testlerde belirlenimci jeton vermek için. */
  owner?: string;
  /** Yalnızca KATI doğrulamayı geçen hash yazılır; bozuk hash düşürülür. */
  txHash?: string | null;
};

/**
 * Sonucu kaydeder. Yazılamadıysa veya geri okuma tutmadıysa `false` döner.
 *
 * Gönderimden SONRA çağrıldığında başarısız bir yazma artık gönderimi
 * etkileyemez; yine de sessizce başarı VARSAYILMAZ.
 */
export function recordSubmission(
  chainId: number,
  requestId: string,
  outcome: SubmissionOutcome,
  options: RecordSubmissionOptions = {},
): boolean {
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  if (storage === null) {
    return false;
  }
  const ids = normalizeIds(chainId, requestId);
  if (ids === null) {
    return false;
  }
  // Bozuk hash ASLA yazılmaz; kayıt yine de yazılır ki engelleme sürsün.
  const txHash = isValidTransactionHash(options.txHash)
    ? options.txHash
    : undefined;
  return persistRecord(storage, {
    chainId: ids.chainId,
    requestId: ids.requestId,
    outcome,
    owner: options.owner ?? createOwnerToken(),
    at: options.nowMs ?? Date.now(),
    ...(txHash !== undefined && { txHash }),
  });
}

/**
 * Rezervasyonu kaldırır.
 *
 * YALNIZCA yayın ÖNCESİ olduğu kanıtlanmış hatalarda çağrılır. Başarı, revert
 * veya belirsiz sonuçta kayıt KORUNUR. Silme başarısız olursa kayıt `pending`
 * kalır; bu güvenli yöndeki hatadır (kullanıcı engellenir, ikinci gönderim
 * olmaz).
 */
export function clearReservation(
  chainId: number,
  requestId: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (storage === null) {
    return;
  }
  const ids = normalizeIds(chainId, requestId);
  if (ids === null) {
    return;
  }
  const stored = readStored(storage, ids.chainId, ids.requestId);
  // Yalnızca kendi bıraktığımız "pending" kaydı silinir.
  if (stored.kind !== "record" || stored.record.outcome !== "pending") {
    return;
  }
  try {
    storage.removeItem(storageKeyFor(ids.chainId, ids.requestId));
  } catch {
    // Silinemedi: kayıt kalır ve engeller. Güvenli yön budur.
    return;
  }
  announce();
}

/** Başka sekmedeki değişiklikleri dinler. Dönen fonksiyon aboneliği kaldırır. */
export function subscribeToSubmissions(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(KEY_PREFIX)) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);

  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = () => listener();
    }
  } catch {
    channel = null;
  }

  return () => {
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
}

export type ExclusiveSubmissionResult<T> =
  | { ok: true; value: T }
  /** Kilidi başka bir sekme tutuyor: o sekme aynı talebi gönderiyor. */
  | { ok: false; reason: "busy" }
  /** Bu tarayıcıda bu talep için zaten bir kayıt var. */
  | { ok: false; reason: "recorded"; existing: SubmissionOutcome }
  /** Web Locks veya doğrulanabilir kayıt yok/başarısız: gönderime GEÇİLMEDİ. */
  | { ok: false; reason: "unavailable" };

export type ExclusiveSubmissionDeps = {
  storage?: StorageLike | null;
  locks?: LockManagerLike | null;
  nowMs?: number;
  owner?: string;
};

/**
 * Rezervasyon + yayın yapabilen işin TAMAMI tek bir exclusive kilit içinde.
 *
 * Sıra kritiktir: kilit ALINIR, kayıt kilidin İÇİNDE okunur, rezervasyon
 * kilidin İÇİNDE yazılır ve TAM olarak geri okunarak doğrulanır, `run` kilidin
 * İÇİNDE çalışır. Böylece iki sekme aynı anda rezervasyon alamaz ve en fazla
 * BİR `kit.send` olur.
 *
 * Fail-closed noktaları:
 * - Web Locks yoksa veya `request` hata atarsa: `unavailable`.
 * - Depo yoksa, okunamıyorsa veya kimlikler geçersizse: `unavailable`.
 * - Rezervasyon yazılamaz ya da geri okunan kayıt birebir tutmazsa:
 *   `unavailable`.
 * - Kilit doluysa: `busy`.
 * - Kayıt varsa (bozuk gövde dâhil): `recorded`.
 *
 * `run` içinden fırlayan hata çağırana AKTARILIR ve rezervasyon KORUNUR:
 * bu noktada işlem zincire düşmüş olabilir.
 */
export async function runExclusiveSubmission<T>(
  chainId: number,
  requestId: string,
  run: () => Promise<T>,
  deps: ExclusiveSubmissionDeps = {},
): Promise<ExclusiveSubmissionResult<T>> {
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const locks = deps.locks === undefined ? defaultLocks() : deps.locks;
  const nowMs = deps.nowMs ?? Date.now();

  /*
   * Atomik kilit YOKSA, durumu kaydedecek depo yoksa veya kimlikler beklenen
   * biçimde değilse güvenli gönderim gösterilemez.
   */
  const ids = normalizeIds(chainId, requestId);
  if (locks === null || storage === null || ids === null) {
    return { ok: false, reason: "unavailable" };
  }

  let outcome: ExclusiveSubmissionResult<T> = { ok: false, reason: "busy" };
  let started = false;

  try {
    await locks.request(
      lockName(ids.chainId, ids.requestId),
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (lock === null || lock === undefined) {
          // Kilit başka sekmede; `outcome` "busy" kalır.
          return;
        }
        const stored = readStored(storage, ids.chainId, ids.requestId);
        if (stored.kind === "unreadable") {
          outcome = { ok: false, reason: "unavailable" };
          return;
        }
        if (stored.kind === "corrupt") {
          // Gövde okunamıyor ama kayıt VAR: sonucu doğrulanmamış sayılır.
          outcome = { ok: false, reason: "recorded", existing: "unknown" };
          return;
        }
        if (stored.kind === "record") {
          outcome = {
            ok: false,
            reason: "recorded",
            existing: stored.record.outcome,
          };
          return;
        }
        /*
         * Rezervasyon yazılır ve TAM olarak geri okunur. Sessizce yutulan,
         * kaybolan veya üzerine yazılan bir yazmadan sonra gönderim YOK.
         */
        const owner = deps.owner ?? createOwnerToken();
        if (
          !recordSubmission(ids.chainId, ids.requestId, "pending", {
            storage,
            nowMs,
            owner,
          })
        ) {
          outcome = { ok: false, reason: "unavailable" };
          return;
        }
        started = true;
        outcome = { ok: true, value: await run() };
      },
    );
  } catch (error) {
    if (started) {
      // `run` fırlattı: sonucu çağıran sınıflandırır, rezervasyon KORUNUR.
      throw error;
    }
    // Kilit alınamadı (ör. güvenli olmayan bağlam): gönderim yapılmadı.
    return { ok: false, reason: "unavailable" };
  }

  return outcome;
}
