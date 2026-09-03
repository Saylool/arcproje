import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { prepareReceiptUpload, type ImageCodec } from "./prepare-upload";
import {
  FALLBACK_STEPS,
  MAX_SOURCE_BYTES,
  MAX_TRANSMIT_BYTES,
  TARGET_LONG_EDGE,
  exceedsSourceLimit,
  fitsWithoutCompression,
  scaleToLongEdge,
} from "./upload-limits";

/**
 * FIS GORSELINI GONDERMEYE HAZIRLAMA.
 *
 * Bu kodun VAROLUS sebebi olculmus bir olgudur: uretimde 4,4 MB'lik gövde
 * uygulama koduna ulasirken 4,6 MB'lik gövde Vercel tarafindan 413 ile
 * reddediliyor ve kod HIC calismiyor. Yani sunucudaki hicbir dogrulama bu
 * duruma yetisemez; kucultme tarayicida olmak ZORUNDA.
 *
 * Iki sey ayri ayri kanitlanir:
 *   1. Sinirin ALTINDAKI dosyaya DOKUNULMAZ (gereksiz kalite kaybi yok).
 *   2. Ustundeki dosya, sigana kadar kademeli olarak kucultulur; sigmazsa
 *      basarili sayilmaz.
 */

const KB = 1024;
const MB = 1024 * KB;

function fileOf(bytes: number, name = "fis.png", type = "image/png"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** Verilen boyutlari sirayla donduren sahte kodek. */
function codecOf(
  sizes: readonly number[],
  dimensions = { width: 4000, height: 3000 },
): ImageCodec & { decoded: number; encodes: number[] } {
  let index = 0;
  const state = {
    decoded: 0,
    encodes: [] as number[],
    qualities: [] as number[],
    closed: 0,
    decode: vi.fn(async () => {
      state.decoded += 1;
      return {
        ...dimensions,
        close: () => {
          state.closed += 1;
        },
      } as unknown as Awaited<ReturnType<ImageCodec["decode"]>>;
    }),
    encode: vi.fn(
      async (
        source: CanvasImageSource,
        width: number,
        height: number,
        quality: number,
      ) => {
        void source;
        void height;
        state.encodes.push(width);
        state.qualities.push(quality);
        const size = sizes[index] ?? sizes[sizes.length - 1] ?? 0;
        index += 1;
        return new Blob([new Uint8Array(size)]);
      },
    ),
  };
  return state as unknown as ImageCodec & {
    decoded: number;
    encodes: number[];
    closed: number;
  };
}

describe("sinir altindaki dosyaya DOKUNULMAZ", () => {
  it("kucuk dosya oldugu gibi gonderilir", async () => {
    const file = fileOf(500 * KB);
    const codec = codecOf([1]);

    const result = await prepareReceiptUpload(file, codec);

    expect(result).toEqual({ ok: true, file, compressed: false });
    /* Ayni File nesnesi: yeniden kodlanmadigi buradan bellidir. */
    expect(result.ok && result.file).toBe(file);
    expect(codec.decode).not.toHaveBeenCalled();
  });

  it("tam sinirdaki dosya da dokunulmadan gecer", async () => {
    const file = fileOf(MAX_TRANSMIT_BYTES);
    const codec = codecOf([1]);

    const result = await prepareReceiptUpload(file, codec);

    expect(result.ok && result.compressed).toBe(false);
    expect(codec.decode).not.toHaveBeenCalled();
  });

  it("sinirin BIR BAYT ustu artik kucultulur", async () => {
    const codec = codecOf([300 * KB]);

    const result = await prepareReceiptUpload(
      fileOf(MAX_TRANSMIT_BYTES + 1),
      codec,
    );

    expect(result.ok && result.compressed).toBe(true);
    expect(codec.decode).toHaveBeenCalledTimes(1);
  });
});

describe("buyuk dosya sigana kadar kucultulur", () => {
  it("ilk deneme sigiyorsa daha sert ayara GECILMEZ", async () => {
    const codec = codecOf([800 * KB]);

    const result = await prepareReceiptUpload(fileOf(8 * MB), codec);

    expect(result.ok && result.compressed).toBe(true);
    expect(codec.encode).toHaveBeenCalledTimes(1);
    /* Ilk deneme hedef uzun kenari kullanir. */
    expect(codec.encodes[0]).toBe(TARGET_LONG_EDGE);
  });

  it("sigmazsa DAHA SERT ayarla yeniden denenir", async () => {
    const codec = codecOf([5 * MB, 900 * KB]);

    const result = await prepareReceiptUpload(fileOf(9 * MB), codec);

    expect(result.ok && result.compressed).toBe(true);
    expect(codec.encode).toHaveBeenCalledTimes(2);
    expect(codec.encodes[1]).toBe(FALLBACK_STEPS[0]?.longEdge);
    /* Her adim bir oncekinden KUCUK olmalidir. */
    expect(codec.encodes[1]).toBeLessThan(codec.encodes[0] ?? 0);
    /* Kalite de dusmelidir; yalnizca boyut kucultmek yetmeyebilir. */
    const qualities = (codec as unknown as { qualities: number[] }).qualities;
    expect(qualities[1]).toBeLessThan(qualities[0] ?? 0);
  });

  it("hicbir adim sigmazsa BASARILI sayilmaz", async () => {
    const codec = codecOf([9 * MB, 8 * MB, 7 * MB]);

    const result = await prepareReceiptUpload(fileOf(9 * MB), codec);

    expect(result).toEqual({ ok: false, reason: "tooLarge" });
    expect(codec.encode).toHaveBeenCalledTimes(1 + FALLBACK_STEPS.length);
  });

  it("kucultulen dosya JPEG'dir ve adi da oyle soyler", async () => {
    const codec = codecOf([700 * KB]);

    const result = await prepareReceiptUpload(
      fileOf(8 * MB, "IMG_0042.png", "image/png"),
      codec,
    );

    expect(result.ok && result.file.type).toBe("image/jpeg");
    expect(result.ok && result.file.name).toBe("IMG_0042.jpg");
  });
});

describe("basarisizliklar sessiz gecilmez", () => {
  it("kaynak dosya cok buyukse ACILMAYA bile calisilmaz", async () => {
    const codec = codecOf([1]);

    const result = await prepareReceiptUpload(
      fileOf(MAX_SOURCE_BYTES + 1),
      codec,
    );

    expect(result).toEqual({ ok: false, reason: "tooLarge" });
    expect(codec.decode).not.toHaveBeenCalled();
  });

  it("gorsel cozulemezse ayri bir sebep doner", async () => {
    const codec = codecOf([1]);
    (codec.decode as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("bozuk"),
    );

    const result = await prepareReceiptUpload(fileOf(8 * MB), codec);

    /* "tooLarge" DEGIL: kullaniciya yanlis sebep gosterilmemeli. */
    expect(result).toEqual({ ok: false, reason: "decodeFailed" });
  });

  it("kodlama basarisiz olursa da ayri sebep doner", async () => {
    const codec = codecOf([1]);
    (codec.encode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const result = await prepareReceiptUpload(fileOf(8 * MB), codec);

    expect(result).toEqual({ ok: false, reason: "decodeFailed" });
  });

  it("bitmap HER yolda kapatilir", async () => {
    const failing = codecOf([9 * MB, 9 * MB, 9 * MB]);
    await prepareReceiptUpload(fileOf(8 * MB), failing);
    expect((failing as unknown as { closed: number }).closed).toBe(1);

    const succeeding = codecOf([700 * KB]);
    await prepareReceiptUpload(fileOf(8 * MB), succeeding);
    expect((succeeding as unknown as { closed: number }).closed).toBe(1);
  });
});

describe("olcekleme en-boy oranini korur", () => {
  it("uzun kenar hedefe iner", () => {
    expect(scaleToLongEdge(4000, 3000, 1600)).toEqual({
      width: 1600,
      height: 1200,
    });
    expect(scaleToLongEdge(3000, 4000, 1600)).toEqual({
      width: 1200,
      height: 1600,
    });
  });

  it("zaten kucuk olan gorsel BUYUTULMEZ", () => {
    /* Buyutmek bayt kazandirmaz, yalnizca bulaniklastirir. */
    expect(scaleToLongEdge(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("cok uzun ve dar fiste bile kenar sifirlanmaz", () => {
    const scaled = scaleToLongEdge(300, 9000, 1600);
    expect(scaled.height).toBe(1600);
    expect(scaled.width).toBeGreaterThanOrEqual(1);
  });
});

describe("sinirlar OLCULEN platform sinirinin altinda kalir", () => {
  /*
   * Uretimde olculdu: 4,4 MB -> 401 (koda ulasti), 4,6 MB -> 413. Gonderim
   * sinirinin bu esigin altinda kalmasi, bu duzeltmenin TAMAMININ dayanagi.
   */
  const MEASURED_413_AT = 4.6 * 1000 * 1000;

  it("gonderim siniri, 413 gorulen boyutun altindadir", () => {
    expect(MAX_TRANSMIT_BYTES).toBeLessThan(MEASURED_413_AT);
  });

  it("multipart zarfi icin gercek bir pay birakilir", () => {
    /* Sinira dayanmak, zarf yuzunden 413 almak demektir. */
    expect(MEASURED_413_AT - MAX_TRANSMIT_BYTES).toBeGreaterThan(256 * KB);
  });

  it("kaynak siniri gonderim sinirindan BUYUKTUR", () => {
    /* Aksi halde kucultmenin bir anlami kalmazdi. */
    expect(MAX_SOURCE_BYTES).toBeGreaterThan(MAX_TRANSMIT_BYTES);
  });

  it("esik fonksiyonlari sinirlarla tutarlidir", () => {
    expect(fitsWithoutCompression(MAX_TRANSMIT_BYTES)).toBe(true);
    expect(fitsWithoutCompression(MAX_TRANSMIT_BYTES + 1)).toBe(false);
    expect(exceedsSourceLimit(MAX_SOURCE_BYTES)).toBe(false);
    expect(exceedsSourceLimit(MAX_SOURCE_BYTES + 1)).toBe(true);
  });
});

/**
 * TARAYICI KODEGI SOZLESMESI.
 *
 * Bu depoda jsdom yoktur; gercek kodek calistirilamaz. Sessizce kaliteyi
 * dusuren iki ayrinti kaynak duzeyinde sabitlenir.
 */
describe("tarayici kodegi", () => {
  const source = readFileSync("src/lib/receipt/prepare-upload.ts", "utf8");

  it("EXIF yonunu KORUR", () => {
    /*
     * Varsayilan davranis donus bilgisini uygulamaz; dikey cekilmis fis yan
     * yatarak kodlanir ve okunmasi zorlasir.
     *
     * CAGRININ KENDISI aranir. Ayni metin dosyanin basindaki aciklamada da
     * geciyor; yalnizca dizgeyi aramak, cagri bozuldugu halde gecerdi.
     */
    expect(source).toContain(
      'createImageBitmap(file, { imageOrientation: "from-image" })',
    );
  });

  it("JPEG olarak ve KALITE vererek kodlar", () => {
    /* Kalite verilmezse tarayici varsayilani kullanir ve boyut ongorulemez. */
    expect(source).toContain('"image/jpeg", quality');
  });
});

/**
 * AKISA BAGLANMA.
 *
 * Modulun dogru olmasi yetmez; gonderim yolunda GERCEKTEN kullanilmasi ve
 * platformun 413'unun karsilanmasi gerekir.
 */
describe("gonderim yolu hazirlamayi kullanir", () => {
  const flow = readFileSync("src/components/ReceiptFlow.tsx", "utf8");

  it("gonderilen dosya HAZIRLANMIS dosyadir", () => {
    expect(flow).toContain("const prepared = await prepareReceiptUpload(file)");
    expect(flow).toContain('body.append("receipt", prepared.file)');
    /* Ham dosya artik dogrudan gonderilmez. */
    expect(flow).not.toContain('body.append("receipt", file)');
  });

  it("hazirlik basarisizsa istek HIC atilmaz", () => {
    const guard = flow.slice(
      flow.indexOf("const prepared = await prepareReceiptUpload(file)"),
      flow.indexOf("const body = new FormData()"),
    );
    expect(guard).toContain("if (!prepared.ok)");
    expect(guard).toContain("return;");
  });

  it("iki basarisizlik sebebi AYRI cumle gosterir", () => {
    /* "acilamadi" ile "cok buyuk" ayni sey degil; kullaniciya dogrusu soylenir. */
    expect(flow).toContain('errors.receiptTooLargeToSend');
    expect(flow).toContain('errors.receiptUnreadableImage');
  });

  it("platformun 413'u KARSILANIR", () => {
    /*
     * 413 duz metindir ve okunacak kod tasimaz; karsilanmazsa kullanici
     * sebebini anlatmayan genel bir hata gorur.
     */
    expect(flow).toContain("response.status === 413");
    const branch = flow.slice(flow.indexOf("response.status === 413"));
    expect(branch.slice(0, 260)).toContain("errors.receiptTooLargeToSend");
  });
});

/**
 * TEK DOGRULUK KAYNAGI.
 *
 * Sayi daha once istemcide, sunucuda ve sozlukte ayri ayri yaziliydi.
 */
describe("sinir tek yerden gelir", () => {
  it("yukleyici sabiti kendi yazmaz", () => {
    const uploader = readFileSync("src/components/ReceiptUploader.tsx", "utf8");
    expect(uploader).toContain("MAX_FILE_SIZE_BYTES = MAX_SOURCE_BYTES");
    expect(uploader).not.toContain("10 * 1024 * 1024");
  });

  it("arayuzdeki cumle gercek sinirla AYNI seyi soyler", () => {
    const tr = readFileSync("src/lib/i18n/tr.ts", "utf8");
    const megabytes = MAX_SOURCE_BYTES / MB;
    expect(tr).toContain(`en fazla ${megabytes} MB`);
  });
});
