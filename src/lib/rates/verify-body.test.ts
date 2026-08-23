import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/rates/verify/route";
import { TEST_QUOTE_SECRET, buildTestQuote } from "./quote-fixture";

/**
 * Doğrulama rotasının gövde sınırı.
 *
 * `request.text()` gövdenin tamamını önce belleğe alır ve `length` UTF-16 kod
 * birimi sayar; çok baytlı UTF-8 içerikte bu gerçek bayt sayısından sapar.
 * Rota artık BAYT sayarak sınırlı okur.
 */

const LIMIT = 4 * 1024;
const SIGNED = buildTestQuote({ nowMs: Date.now() });

function requestWithBody(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/rates/verify", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    // Akış gövdesi için gerekli.
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
}

/** Content-Length göndermeyen, parçalı gövde. */
function chunkedBody(text: string) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + 256, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

beforeEach(() => {
  vi.stubEnv("RATE_QUOTE_SECRET", TEST_QUOTE_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gövde bayt sınırı", () => {
  it("bildirilen Content-Length sınırı aşarsa erken reddedilir", async () => {
    const response = await POST(
      requestWithBody("{}", { "content-length": String(LIMIT + 1) }),
    );
    expect(response.status).toBe(413);
  });

  it("Content-Length OLMADAN gelen aşırı büyük parçalı gövde reddedilir", async () => {
    const huge = JSON.stringify({ quote: "x".repeat(LIMIT + 2048) });
    const response = await POST(requestWithBody(chunkedBody(huge)));
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BODY_TOO_LARGE");
  });

  it("çok baytlı UTF-8 bayt sınırını aşarsa reddedilir", async () => {
    /*
     * "ü" UTF-8'de 2 bayt ama UTF-16'da 1 birim. 3000 karakter = 6000 bayt;
     * eski string uzunluğu kontrolü bunu (3000 < 4096) kabul ederdi.
     */
    const multibyte = "ü".repeat(3000);
    expect(multibyte.length).toBeLessThan(LIMIT);
    expect(new TextEncoder().encode(multibyte).byteLength).toBeGreaterThan(LIMIT);

    const response = await POST(
      requestWithBody(chunkedBody(JSON.stringify({ quote: multibyte }))),
    );
    expect(response.status).toBe(413);
  });

  it("tam sınırdaki gövde okunur (boyut yüzünden reddedilmez)", async () => {
    const filler = "a".repeat(LIMIT - 14);
    const text = JSON.stringify({ q: filler });
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(LIMIT);

    const response = await POST(requestWithBody(chunkedBody(text)));
    // Boyut değil, şema nedeniyle reddedilir.
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).not.toBe("BODY_TOO_LARGE");
  });

  it("geçersiz UTF-8 kontrollü hatayla reddedilir", async () => {
    const invalid = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]));
        controller.close();
      },
    });
    const response = await POST(requestWithBody(invalid));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ENCODING");
  });

  it("sınır içindeki geçerli gövde normal işlenir", async () => {
    const response = await POST(
      requestWithBody(
        chunkedBody(JSON.stringify({ quote: SIGNED.quote, tag: SIGNED.tag })),
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { valid: boolean };
    expect(body.valid).toBe(true);
  });

  it("bozuk JSON kontrollü hatayla reddedilir", async () => {
    const response = await POST(requestWithBody(chunkedBody("{bozuk")));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MALFORMED_JSON");
  });

  it("içerik türü kontrolü korunur", async () => {
    const response = await POST(
      requestWithBody("{}", { "content-type": "text/plain" }),
    );
    expect(response.status).toBe(400);
  });
});
