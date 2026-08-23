/**
 * Aynı tarayıcıda kazara tekrar gönderimi azaltan YEREL kayıt.
 *
 * Yalnızca `chainId` + `requestId` (ikisi de zaten paylaşılan bağlantıda açık)
 * ve sonucun türü saklanır. Adres, tutar, imza veya etiket SAKLANMAZ; gizli
 * hiçbir veri içermez.
 *
 * BU YETKİLİ BİR KORUMA DEĞİLDİR. `localStorage`, Web Locks ve
 * `BroadcastChannel` cihaz ve tarayıcı başınadır: gizli sekmede, başka bir
 * cihazda veya temizlenmiş depoda hiçbir şey hatırlanmaz. Gerçek tekrar
 * oynatma engeli için arka uçta veya zincir üstünde ATOMİK `requestId`
 * tüketimi gerekir. Buradaki amaç yalnızca "yanlışlıkla ikinci kez gönderme"
 * olasılığını azaltmaktır.
 */

const STORAGE_KEY = "hesabi-bol.submissions.v1";
const CHANNEL_NAME = "hesabi-bol.submissions";
/** Depo sınırsız büyümesin diye tutulan en fazla kayıt. */
const MAX_ENTRIES = 50;

export type SubmissionOutcome = "pending" | "success" | "unknown";

type SubmissionRecord = { key: string; outcome: SubmissionOutcome; at: number };

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Depo erişimi engellenmiş olabilir (gizli mod, izin politikası).
    return null;
  }
}

/** Kayıt anahtarı: yalnızca ağ ve talep kimliği. */
export function submissionKey(chainId: number, requestId: string): string {
  return `${chainId}:${requestId.toLowerCase()}`;
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

function writeAll(storage: StorageLike, records: SubmissionRecord[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_ENTRIES)));
  } catch {
    // Kota dolu veya yazma engelli; koruma zaten yetkili değildir.
  }
  announce();
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

/** Sonucu kaydeder. Depo yoksa veya yazılamıyorsa sessizce vazgeçilir. */
export function recordSubmission(
  chainId: number,
  requestId: string,
  outcome: SubmissionOutcome,
  storage: StorageLike | null = defaultStorage(),
  nowMs: number = Date.now(),
): void {
  if (storage === null) {
    return;
  }
  const key = submissionKey(chainId, requestId);
  const existing = readAll(storage).filter((entry) => entry.key !== key);
  writeAll(storage, [...existing, { key, outcome, at: nowMs }]);
}

export type ReservationResult =
  | { ok: true }
  | { ok: false; existing: SubmissionOutcome };

/**
 * Gönderime girmeden HEMEN ÖNCE eşzamanlı rezervasyon.
 *
 * Kayıt okuma ve yazma tek bir eşzamanlı adımda yapılır; araya `await`
 * girmediği için aynı sekmede yarış oluşmaz. Başka bir sekme aynı anda
 * rezervasyon yazdıysa buradaki okuma onu görür ve gönderim engellenir.
 */
export function reserveSubmission(
  chainId: number,
  requestId: string,
  storage: StorageLike | null = defaultStorage(),
  nowMs: number = Date.now(),
): ReservationResult {
  if (storage === null) {
    // Depo yoksa engelleyemeyiz; koruma zaten yetkili değildir.
    return { ok: true };
  }
  const key = submissionKey(chainId, requestId);
  const all = readAll(storage);
  const existing = all.find((entry) => entry.key === key);
  if (existing !== undefined) {
    return { ok: false, existing: existing.outcome };
  }
  writeAll(storage, [...all, { key, outcome: "pending", at: nowMs }]);
  return { ok: true };
}

/**
 * Rezervasyonu kaldırır.
 *
 * YALNIZCA yayın ÖNCESİ olduğu kanıtlanmış hatalarda çağrılır. Başarı, revert
 * veya belirsiz sonuçta kayıt KORUNUR.
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

/**
 * Aynı tarayıcıda özel (exclusive) çalıştırma.
 *
 * Web Locks varsa kilit ALINAMADIĞINDA iş çalıştırılmaz: başka bir sekme aynı
 * talebi göndermektedir. API yoksa muhafazakâr davranılır ve iş çalıştırılır;
 * asıl koruma yine eşzamanlı rezervasyon kaydıdır.
 */
export async function withSubmissionLock<T>(
  chainId: number,
  requestId: string,
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: "busy" }> {
  const name = `hesabi-bol.send.${submissionKey(chainId, requestId)}`;
  const locks =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { locks?: LockManager }).locks;

  if (locks === undefined) {
    return { ok: true, value: await run() };
  }

  let executed = false;
  let value: T | undefined;
  await locks.request(name, { ifAvailable: true }, async (lock) => {
    if (lock === null) {
      return;
    }
    executed = true;
    value = await run();
  });

  return executed
    ? { ok: true, value: value as T }
    : { ok: false, reason: "busy" };
}
