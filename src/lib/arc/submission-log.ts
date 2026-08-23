/**
 * Aynı tarayıcıda kazara tekrar gönderimi azaltan YEREL işaretçi.
 *
 * Yalnızca `chainId` + `requestId` (ikisi de zaten paylaşılan bağlantıda açık)
 * ve sonucun türü saklanır. Adres, tutar, imza veya etiket SAKLANMAZ; gizli
 * hiçbir veri içermez.
 *
 * BU YETKİLİ BİR KORUMA DEĞİLDİR. localStorage cihaz ve tarayıcı başınadır:
 * gizli sekmede, başka bir cihazda veya temizlenmiş depoda hiçbir şey
 * hatırlanmaz; kullanıcı tarafından da silinebilir. Gerçek tekrar oynatma
 * engeli için sunucu tarafında veya zincir üstünde atomik `requestId` tüketimi
 * gerekir. Buradaki amaç yalnızca "yanlışlıkla ikinci kez gönderme" olasılığını
 * azaltmaktır.
 */

const STORAGE_KEY = "hesabi-bol.submissions.v1";
/** Depo sınırsız büyümesin diye tutulan en fazla kayıt. */
const MAX_ENTRIES = 50;

export type SubmissionOutcome = "success" | "unknown";

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
      ((entry as SubmissionRecord).outcome === "success" ||
        (entry as SubmissionRecord).outcome === "unknown"),
  );
}

/** Bu tarayıcıda bu talep için daha önce bir gönderim kaydı var mı? */
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
  const next = [...existing, { key, outcome, at: nowMs }].slice(-MAX_ENTRIES);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Kota dolu veya yazma engelli; koruma zaten yetkili değildir.
  }
}
