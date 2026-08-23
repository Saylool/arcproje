/**
 * Aynı tarayıcıda kazara tekrar gönderimi engelleyen YEREL kayıt ve kilit.
 *
 * Yalnızca `chainId` + `requestId` (ikisi de zaten paylaşılan bağlantıda açık)
 * ve sonucun türü saklanır. Adres, tutar, imza veya etiket SAKLANMAZ; gizli
 * hiçbir veri içermez.
 *
 * BU YETKİLİ BİR KORUMA DEĞİLDİR. `localStorage`, Web Locks ve
 * `BroadcastChannel` cihaz ve tarayıcı başınadır: gizli sekmede, başka bir
 * cihazda veya temizlenmiş depoda hiçbir şey hatırlanmaz. Gerçek tekrar
 * oynatma engeli için arka uçta veya zincir üstünde ATOMİK `requestId`
 * tüketimi gerekir.
 *
 * TEK ATOMİK İLKEL WEB LOCKS'TIR. `localStorage` durumu KAYDEDER ama kilit
 * olarak KULLANILMAZ: iki sekme aynı anda okuyup aynı anda yazabilir, bu
 * yüzden "oku sonra yaz" bir rezervasyon iki sekmede birden başarılı olabilir.
 * Bu yüzden hem rezervasyon hem de yayın YAPABİLECEK işin TAMAMI tek bir
 * exclusive Web Lock içinde çalışır. Kilit veya kalıcılık yoksa ya da yazma
 * başarısız olursa gönderime GEÇİLMEZ (fail-closed).
 */

const STORAGE_KEY = "hesabi-bol.submissions.v1";
const CHANNEL_NAME = "hesabi-bol.submissions";
/** Depo sınırsız büyümesin diye tutulan en fazla kayıt. */
const MAX_ENTRIES = 50;

export type SubmissionOutcome = "pending" | "success" | "unknown";

type SubmissionRecord = { key: string; outcome: SubmissionOutcome; at: number };

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

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
 * Kilit veya kalıcı kayıt olmadan aynı ödemenin iki sekmeden iki kez
 * gönderilmediği GÖSTERİLEMEZ; bu yüzden gönderim hiç başlatılmaz.
 */
export const SUBMISSION_UNAVAILABLE_MESSAGE =
  "Bu tarayıcı, aynı ödemenin iki kez gönderilmesini engelleyecek kilidi (Web Locks) veya yerel kaydı sağlamıyor. Güvenlik gereği gönderim BAŞLATILMADI. Güncel bir tarayıcıda, gizli olmayan bir sekmede ve site verilerine izin vererek tekrar dene.";

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

/** Kayıt anahtarı: yalnızca ağ ve talep kimliği. */
export function submissionKey(chainId: number, requestId: string): string {
  return `${chainId}:${requestId.toLowerCase()}`;
}

function lockName(chainId: number, requestId: string): string {
  return `hesabi-bol.send.${submissionKey(chainId, requestId)}`;
}

function readAll(storage: StorageLike): SubmissionRecord[] {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (entry): entry is SubmissionRecord =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as SubmissionRecord).key === "string" &&
      ["pending", "success", "unknown"].includes(
        (entry as SubmissionRecord).outcome,
      ),
  );
}

/**
 * Kaydı yazar ve GERÇEKTEN yazıldığını okuyarak doğrular.
 *
 * `setItem` sessizce yok sayılabilir (kota, gizli mod, izin politikası).
 * Yutulmuş bir yazma hatasından sonra "rezervasyon aldım" varsayılamaz; bu
 * yüzden dönüş değeri çağıran tarafından KONTROL EDİLİR.
 */
function writeAll(storage: StorageLike, records: SubmissionRecord[]): boolean {
  const kept = records.slice(-MAX_ENTRIES);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    return false;
  }
  if (readAll(storage).length !== kept.length) {
    // Depo yazmayı kabul etmiş gibi göründü ama içerik kalıcı olmadı.
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

/** Bu tarayıcıda bu talep için bir gönderim kaydı var mı? */
export function readSubmission(
  chainId: number,
  requestId: string,
  storage: StorageLike | null = defaultStorage(),
): SubmissionOutcome | null {
  if (storage === null) {
    return null;
  }
  const key = submissionKey(chainId, requestId);
  return readAll(storage).find((entry) => entry.key === key)?.outcome ?? null;
}

/**
 * Sonucu kaydeder. Yazılamadıysa `false` döner.
 *
 * Gönderimden SONRA çağrıldığında başarısız bir yazma artık gönderimi
 * etkileyemez; yine de sessizce başarı VARSAYILMAZ.
 */
export function recordSubmission(
  chainId: number,
  requestId: string,
  outcome: SubmissionOutcome,
  storage: StorageLike | null = defaultStorage(),
  nowMs: number = Date.now(),
): boolean {
  if (storage === null) {
    return false;
  }
  const key = submissionKey(chainId, requestId);
  const existing = readAll(storage).filter((entry) => entry.key !== key);
  return writeAll(storage, [...existing, { key, outcome, at: nowMs }]);
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
  const key = submissionKey(chainId, requestId);
  const all = readAll(storage);
  const existing = all.find((entry) => entry.key === key);
  // Yalnızca kendi bıraktığımız "pending" kaydı silinir.
  if (existing === undefined || existing.outcome !== "pending") {
    return;
  }
  writeAll(
    storage,
    all.filter((entry) => entry.key !== key),
  );
}

/** Başka sekmedeki değişiklikleri dinler. Dönen fonksiyon aboneliği kaldırır. */
export function subscribeToSubmissions(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) {
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
  /** Web Locks veya kalıcı kayıt yok/başarısız: gönderime GEÇİLMEDİ. */
  | { ok: false; reason: "unavailable" };

export type ExclusiveSubmissionDeps = {
  storage?: StorageLike | null;
  locks?: LockManagerLike | null;
  nowMs?: number;
};

/**
 * Rezervasyon + yayın yapabilen işin TAMAMI tek bir exclusive kilit içinde.
 *
 * Sıra kritiktir: kilit ALINIR, kayıt kilidin İÇİNDE okunur, rezervasyon
 * kilidin İÇİNDE yazılır ve doğrulanır, `run` kilidin İÇİNDE çalışır. Böylece
 * iki sekme aynı anda rezervasyon alamaz ve en fazla BİR `kit.send` olur.
 *
 * Fail-closed noktaları:
 * - Web Locks yoksa veya `request` hata atarsa: `unavailable` (gönderim yok).
 * - Depo yoksa veya rezervasyon yazılamazsa: `unavailable` (gönderim yok).
 * - Kilit doluysa: `busy` (gönderim yok).
 * - Kayıt varsa: `recorded` (gönderim yok).
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
   * Atomik kilit YOKSA veya durumu kaydedecek depo yoksa güvenli gönderim
   * gösterilemez. Eski davranış "yine de gönder" idi; bu, iki sekmenin de
   * `kit.send` çağırmasına izin veriyordu.
   */
  if (locks === null || storage === null) {
    return { ok: false, reason: "unavailable" };
  }

  let outcome: ExclusiveSubmissionResult<T> = { ok: false, reason: "busy" };
  let started = false;

  try {
    await locks.request(
      lockName(chainId, requestId),
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (lock === null || lock === undefined) {
          // Kilit başka sekmede; `outcome` "busy" kalır.
          return;
        }
        const existing = readSubmission(chainId, requestId, storage);
        if (existing !== null) {
          outcome = { ok: false, reason: "recorded", existing };
          return;
        }
        // Yazma yutulmaz: doğrulanamayan rezervasyondan sonra gönderim YOK.
        if (!recordSubmission(chainId, requestId, "pending", storage, nowMs)) {
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
