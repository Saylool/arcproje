import {
  FALLBACK_STEPS,
  MAX_TRANSMIT_BYTES,
  TARGET_LONG_EDGE,
  TARGET_QUALITY,
  exceedsSourceLimit,
  fitsWithoutCompression,
  scaleToLongEdge,
} from "./upload-limits";

/**
 * FİŞ GÖRSELİNİ GÖNDERMEYE HAZIRLAR.
 *
 * Platform sınırı uygulama koduna ULAŞMADAN devreye girdiği için (bkz.
 * `upload-limits.ts`) küçültme tarayıcıda, gönderimden önce yapılır.
 *
 * DOKUNMAMA ÖNCELİKLİDİR: sınırın altındaki dosya olduğu gibi gider. Yeniden
 * kodlamak her durumda kalite kaybıdır ve gereksiz yere yapılmaz.
 *
 * EXIF YÖNÜ KORUNUR. `createImageBitmap` varsayılan olarak dönüş bilgisini
 * UYGULAMAZ; dikey çekilmiş bir fiş yan yatarak kodlanır ve okunması zorlaşır.
 * `imageOrientation: "from-image"` bunu engeller.
 */

export type PreparedUpload =
  | { ok: true; file: File; compressed: boolean }
  /** Kaynak dosya açılamayacak kadar büyük ya da küçültme yetmedi. */
  | { ok: false; reason: "tooLarge" }
  /** Görsel çözülemedi (bozuk dosya, desteklenmeyen kodek, canvas yok). */
  | { ok: false; reason: "decodeFailed" };

/** Tarayıcı yetenekleri; testlerde yerine geçilebilsin diye ayrı. */
export type ImageCodec = Readonly<{
  decode: (file: File) => Promise<{ width: number; height: number; close: () => void } & CanvasImageSource>;
  encode: (
    source: CanvasImageSource,
    width: number,
    height: number,
    quality: number,
  ) => Promise<Blob | null>;
}>;

const browserCodec: ImageCodec = {
  decode: (file) =>
    createImageBitmap(file, { imageOrientation: "from-image" }),
  encode: async (source, width, height, quality) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) {
      return null;
    }
    context.drawImage(source, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    });
  },
};

/** Küçültülmüş dosyanın adı; uzantı gerçek türle tutarlı olmalıdır. */
function jpegName(original: string): string {
  const withoutExtension = original.replace(/\.[^.]+$/, "");
  const base = withoutExtension.length > 0 ? withoutExtension : "fis";
  return `${base}.jpg`;
}

export async function prepareReceiptUpload(
  file: File,
  codec: ImageCodec = browserCodec,
): Promise<PreparedUpload> {
  if (fitsWithoutCompression(file.size)) {
    return { ok: true, file, compressed: false };
  }
  if (exceedsSourceLimit(file.size)) {
    /* Açmayı bile denemeyiz: bellek tüketen dosya sekmeyi düşürebilir. */
    return { ok: false, reason: "tooLarge" };
  }

  let bitmap: Awaited<ReturnType<ImageCodec["decode"]>>;
  try {
    bitmap = await codec.decode(file);
  } catch {
    return { ok: false, reason: "decodeFailed" };
  }

  try {
    const attempts = [
      { longEdge: TARGET_LONG_EDGE, quality: TARGET_QUALITY },
      ...FALLBACK_STEPS,
    ];
    for (const attempt of attempts) {
      const size = scaleToLongEdge(
        bitmap.width,
        bitmap.height,
        attempt.longEdge,
      );
      const blob = await codec.encode(
        bitmap,
        size.width,
        size.height,
        attempt.quality,
      );
      if (blob === null) {
        return { ok: false, reason: "decodeFailed" };
      }
      if (blob.size <= MAX_TRANSMIT_BYTES) {
        return {
          ok: true,
          file: new File([blob], jpegName(file.name), {
            type: "image/jpeg",
            lastModified: file.lastModified,
          }),
          compressed: true,
        };
      }
    }
    /* Her adım denendi ve hiçbiri sığmadı. */
    return { ok: false, reason: "tooLarge" };
  } finally {
    // Bitmap her yolda kapatılır; aksi hâlde bellek sekmede kalır.
    bitmap.close();
  }
}
