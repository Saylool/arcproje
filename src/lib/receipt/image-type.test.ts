import { describe, expect, it } from "vitest";

import { detectImageMimeType, resolveImageMimeType } from "./image-type";

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]);
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
// "RIFF" + boyut + "WEBP"
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const TEXT_BYTES = new Uint8Array([0x62, 0x75, 0x20, 0x6d, 0x65, 0x74, 0x69]);

describe("detectImageMimeType", () => {
  it("JPEG, PNG ve WEBP imzalarını tanır", () => {
    expect(detectImageMimeType(JPEG_BYTES)).toBe("image/jpeg");
    expect(detectImageMimeType(PNG_BYTES)).toBe("image/png");
    expect(detectImageMimeType(WEBP_BYTES)).toBe("image/webp");
  });

  it("görsel olmayan içerik için null döner", () => {
    expect(detectImageMimeType(TEXT_BYTES)).toBeNull();
    expect(detectImageMimeType(new Uint8Array())).toBeNull();
  });

  it("imzası eksik kalan kısa içeriği kabul etmez", () => {
    // "RIFF" var ama "WEBP" yok.
    expect(detectImageMimeType(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull();
  });
});

describe("resolveImageMimeType", () => {
  it("bildirilen tür ile içerik uyuşuyorsa kabul eder", () => {
    expect(resolveImageMimeType("image/png", PNG_BYTES)).toEqual({
      ok: true,
      mimeType: "image/png",
    });
    expect(resolveImageMimeType("image/jpeg", JPEG_BYTES)).toEqual({
      ok: true,
      mimeType: "image/jpeg",
    });
    expect(resolveImageMimeType("image/webp", WEBP_BYTES)).toEqual({
      ok: true,
      mimeType: "image/webp",
    });
  });

  it("MIME type boşken geçerli imzayı kabul eder", () => {
    // Bazı sistemler dosya türü göndermez; istemci de bu durumda uzantıya bakıyor.
    expect(resolveImageMimeType("", PNG_BYTES)).toEqual({
      ok: true,
      mimeType: "image/png",
    });
    expect(resolveImageMimeType("   ", JPEG_BYTES)).toEqual({
      ok: true,
      mimeType: "image/jpeg",
    });
    expect(resolveImageMimeType("", WEBP_BYTES)).toEqual({
      ok: true,
      mimeType: "image/webp",
    });
  });

  it("application/octet-stream'i tür bildirilmemiş sayar", () => {
    // Tarayıcı, type'ı boş olan bir File için telde bunu gönderir.
    expect(resolveImageMimeType("application/octet-stream", PNG_BYTES)).toEqual({
      ok: true,
      mimeType: "image/png",
    });
    expect(resolveImageMimeType("application/octet-stream", JPEG_BYTES)).toEqual({
      ok: true,
      mimeType: "image/jpeg",
    });
    expect(resolveImageMimeType("application/octet-stream", WEBP_BYTES)).toEqual({
      ok: true,
      mimeType: "image/webp",
    });
  });

  it("application/octet-stream + geçersiz imzayı reddeder", () => {
    expect(resolveImageMimeType("application/octet-stream", TEXT_BYTES)).toEqual({
      ok: false,
      reason: "notAnImage",
    });
  });

  it("MIME type boşken geçersiz imzayı reddeder", () => {
    expect(resolveImageMimeType("", TEXT_BYTES)).toEqual({
      ok: false,
      reason: "notAnImage",
    });
  });

  it("bildirilen tür ile içerik farklıysa reddeder", () => {
    expect(resolveImageMimeType("image/png", JPEG_BYTES)).toEqual({
      ok: false,
      reason: "mismatch",
    });
    expect(resolveImageMimeType("image/webp", PNG_BYTES)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("desteklenmeyen bir tür bildirildiyse içeriğe bakmadan reddeder", () => {
    // Uzantıya veya içeriğe bakıp kurtarmaya çalışmaz.
    expect(resolveImageMimeType("text/plain", PNG_BYTES)).toEqual({
      ok: false,
      reason: "unsupportedDeclared",
    });
    expect(resolveImageMimeType("image/gif", JPEG_BYTES)).toEqual({
      ok: false,
      reason: "unsupportedDeclared",
    });
  });

  it("geçersiz içeriği her durumda reddeder", () => {
    expect(resolveImageMimeType("image/png", TEXT_BYTES)).toEqual({
      ok: false,
      reason: "notAnImage",
    });
  });

  it("büyük harfli MIME type'ı normalleştirir", () => {
    expect(resolveImageMimeType("IMAGE/PNG", PNG_BYTES)).toEqual({
      ok: true,
      mimeType: "image/png",
    });
  });
});
