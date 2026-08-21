export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AcceptedImageMimeType = (typeof ACCEPTED_IMAGE_MIME_TYPES)[number];

export type ImageTypeResolution =
  | { ok: true; mimeType: AcceptedImageMimeType }
  | {
      ok: false;
      /**
       * unsupportedDeclared: istemci desteklenmeyen bir tür bildirdi
       * notAnImage:          içerik JPEG/PNG/WEBP imzası taşımıyor
       * mismatch:            bildirilen tür ile gerçek içerik farklı
       */
      reason: "unsupportedDeclared" | "notAnImage" | "mismatch";
    };

/**
 * "Tür bildirilmedi" anlamına gelen değerler.
 *
 * Bir File'ın `type`'ı boş olduğunda tarayıcı multipart gövdesine ya hiç
 * Content-Type başlığı yazmaz ya da `application/octet-stream` yazar; her iki
 * durumda da sunucudaki `File.type` `application/octet-stream` olur. Boş string
 * yalnızca doğrudan kurulan isteklerde görülür. İkisi de bir tür iddiası
 * taşımadığı için aynı biçimde ele alınır: karar tamamen magic-byte'a kalır.
 */
const UNDECLARED_MIME_TYPES = ["", "application/octet-stream"];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Dosyanın gerçek türünü yalnızca içeriğinden (magic byte) tespit eder.
 * Dosya adına veya uzantısına bakmaz.
 */
export function detectImageMimeType(
  bytes: Uint8Array,
): AcceptedImageMimeType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  ) {
    return "image/png";
  }

  // "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

function isAcceptedMimeType(value: string): value is AcceptedImageMimeType {
  return (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * İstemcinin bildirdiği MIME type ile dosyanın gerçek içeriğini uzlaştırır.
 *
 * - Tür bildirilmemişse (boş veya application/octet-stream) yalnızca magic-byte
 *   sonucuna güvenilir; uzantıya asla bakılmaz.
 * - Bildirilen tür doluysa desteklenen listede olmalıdır.
 * - Bildirilen tür ile gerçek içerik farklıysa dosya reddedilir.
 *
 * Kabul edilen dosyalarda kullanılacak tür daima magic-byte ile tespit edilendir.
 */
export function resolveImageMimeType(
  declaredMimeType: string,
  bytes: Uint8Array,
): ImageTypeResolution {
  const declared = declaredMimeType.trim().toLowerCase();
  const isUndeclared = UNDECLARED_MIME_TYPES.includes(declared);

  if (!isUndeclared && !isAcceptedMimeType(declared)) {
    return { ok: false, reason: "unsupportedDeclared" };
  }

  const detected = detectImageMimeType(bytes);
  if (detected === null) {
    return { ok: false, reason: "notAnImage" };
  }

  if (!isUndeclared && declared !== detected) {
    return { ok: false, reason: "mismatch" };
  }

  return { ok: true, mimeType: detected };
}
