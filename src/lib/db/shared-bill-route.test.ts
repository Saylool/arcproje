import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/shared-bills/route";

/**
 * `POST /api/shared-bills` tasima katmani.
 *
 * Bu testlerde `DATABASE_URL` TANIMSIZDIR; bu yuzden depo gerektiren her yol
 * kontrollu 503 dondurmelidir. Bellek ici bir yedege ASLA dusulmez.
 *
 * Icerik turu ve govde boyutu depodan ONCE denetlenir; o testler 503'e hic
 * ulasmadan reddedilir.
 */

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://ornek.test/api/shared-bills", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("icerik turu", () => {
  it("application/json olmayan istek reddedilir", async () => {
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", ""]) {
      const response = await POST(
        new Request("https://ornek.test/api/shared-bills", {
          method: "POST",
          headers: contentType === "" ? {} : { "content-type": contentType },
          body: "{}",
        }),
      );
      expect(response.status, contentType).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("INVALID_CONTENT_TYPE");
    }
  });
});

describe("govde boyutu", () => {
  it("bildirilen uzunluk sinirin ustundeyse 413 doner", async () => {
    const response = await POST(
      jsonRequest("{}", { "content-length": String(64 * 1024) }),
    );
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BODY_TOO_LARGE");
  });

  it("gercek govde sinirin ustundeyse 413 doner", async () => {
    // Content-Length gonderilmese bile akis sayilarak sinirlanir.
    const huge = JSON.stringify({ dolgu: "a".repeat(40 * 1024) });
    const response = await POST(jsonRequest(huge));
    expect(response.status).toBe(413);
  });
});

describe("depo yapilandirilmamissa", () => {
  it("kontrollu 503 doner ve bellege DUSMEZ", async () => {
    const response = await POST(jsonRequest(JSON.stringify({ a: 1 })));
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("SERVICE_NOT_CONFIGURED");
    // Mesaj degiskenin ADINI soyler, DEGERINI degil.
    expect(body.error.message).toContain("DATABASE_URL");
    expect(body.error.message).not.toContain("postgres://");
  });
});

describe("yanit basliklari", () => {
  it("hassas uc nokta onbelleklenmez", async () => {
    const response = await POST(jsonRequest("{}"));
    expect(response.headers.get("cache-control")).toBe(
      "no-store, private, max-age=0",
    );
  });

  it("hata yanitlari yalnizca kod ve mesaj tasir", async () => {
    const response = await POST(jsonRequest("{}"));
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error as Record<string, unknown>).sort()).toEqual([
      "code",
      "message",
    ]);
  });
});
