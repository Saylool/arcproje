import { describe, expect, it } from "vitest";

import { POST as challengePOST } from "@/app/api/shared-bills/[billId]/challenge/route";
import { GET as mePOST } from "@/app/api/shared-bills/[billId]/me/route";
import { POST as resolvePOST } from "@/app/api/shared-bills/[billId]/resolve/route";

/**
 * Borclu erisim rotalarinin TASIMA katmani.
 *
 * Testlerde `DATABASE_URL`, `SHARED_BILL_AUTH_SECRET` ve `APP_ORIGIN`
 * TANIMSIZDIR; bu yuzden yapilandirma gerektiren her yol kontrollu 503
 * dondurmelidir. Bellek ici bir yedege ASLA dusulmez.
 */

const BILL_ID = `0x${"7a".repeat(32)}`;

function params(billId: string) {
  return { params: Promise.resolve({ billId }) };
}

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request(`https://ornek.test/api/shared-bills/${BILL_ID}/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("meydan okuma rotasi", () => {
  it("JSON olmayan istek reddedilir", async () => {
    const response = await challengePOST(
      new Request("https://ornek.test/x", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
      params(BILL_ID),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_CONTENT_TYPE");
  });

  it("cok buyuk govde 413 doner", async () => {
    const response = await challengePOST(
      jsonRequest("{}", { "content-length": String(64 * 1024) }),
      params(BILL_ID),
    );
    expect(response.status).toBe(413);
  });

  it("YINELENEN anahtar reddedilir", async () => {
    const response = await challengePOST(
      jsonRequest('{"debtor":"0x1","debtor":"0x2"}'),
      params(BILL_ID),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("DUPLICATE_FIELD");
  });

  it("beklenmeyen alan reddedilir", async () => {
    const response = await challengePOST(
      jsonRequest('{"debtor":"0x1","fazladan":2}'),
      params(BILL_ID),
    );
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNEXPECTED_FIELD");
  });

  it("bozuk hesap kimligi reddedilir", async () => {
    const response = await challengePOST(
      jsonRequest('{"debtor":"0x0000000000000000000000000000000000000aBc"}'),
      params("0xkisa"),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BILL_ID");
  });

  it("yapilandirma yoksa kontrollu 503 doner", async () => {
    const response = await challengePOST(
      jsonRequest('{"debtor":"0x0000000000000000000000000000000000000aBc"}'),
      params(BILL_ID),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("SERVICE_NOT_CONFIGURED");
    // Mesaj degisken ADLARINI soyler, DEGERLERINI degil.
    expect(body.error.message).toContain("APP_ORIGIN");
    expect(body.error.message).not.toContain("http");
  });

  it("hassas uc nokta onbelleklenmez", async () => {
    const response = await challengePOST(jsonRequest("{}"), params(BILL_ID));
    expect(response.headers.get("cache-control")).toBe(
      "no-store, private, max-age=0",
    );
  });
});

describe("cozumleme rotasi", () => {
  it("JSON olmayan istek reddedilir", async () => {
    const response = await resolvePOST(
      new Request("https://ornek.test/x", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
      params(BILL_ID),
    );
    expect(response.status).toBe(400);
  });

  it("yapilandirma yoksa 503 doner ve OTURUM CEREZI KURULMAZ", async () => {
    const response = await resolvePOST(jsonRequest("{}"), params(BILL_ID));
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(
      "no-store, private, max-age=0",
    );
  });
});

describe("/me rotasi", () => {
  it("veritabani yoksa kontrollu 503 doner", async () => {
    const response = await mePOST(
      new Request(`https://ornek.test/api/shared-bills/${BILL_ID}/me`),
      params(BILL_ID),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_NOT_CONFIGURED");
  });

  it("bozuk hesap kimligi reddedilir", async () => {
    const response = await mePOST(
      new Request("https://ornek.test/api/shared-bills/0xkisa/me"),
      params("0xkisa"),
    );
    expect(response.status).toBe(400);
  });

  it("yanit onbelleklenmez ve yalnizca kod+mesaj tasir", async () => {
    const response = await mePOST(
      new Request(`https://ornek.test/api/shared-bills/${BILL_ID}/me`),
      params(BILL_ID),
    );
    expect(response.headers.get("cache-control")).toBe(
      "no-store, private, max-age=0",
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error as Record<string, unknown>).sort()).toEqual([
      "code",
      "message",
    ]);
  });
});
