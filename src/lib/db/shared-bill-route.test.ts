import { describe, expect, it, vi } from "vitest";

import { createSharedBillPost } from "@/app/api/shared-bills/route";

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

const authenticatedPOST = createSharedBillPost({
  authenticate: async () => ({
    status: "authenticated",
    user: { id: "app-user", name: null, image: null },
  }),
});

describe("icerik turu", () => {
  it("application/json olmayan istek reddedilir", async () => {
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", ""]) {
      const response = await authenticatedPOST(
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
    const response = await authenticatedPOST(
      jsonRequest("{}", { "content-length": String(64 * 1024) }),
    );
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BODY_TOO_LARGE");
  });

  it("gercek govde sinirin ustundeyse 413 doner", async () => {
    // Content-Length gonderilmese bile akis sayilarak sinirlanir.
    const huge = JSON.stringify({ dolgu: "a".repeat(40 * 1024) });
    const response = await authenticatedPOST(jsonRequest(huge));
    expect(response.status).toBe(413);
  });
});

describe("depo yapilandirilmamissa", () => {
  it("kontrollu 503 doner ve bellege DUSMEZ", async () => {
    const response = await authenticatedPOST(jsonRequest(JSON.stringify({ a: 1 })));
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
    const response = await authenticatedPOST(jsonRequest("{}"));
    expect(response.headers.get("cache-control")).toBe(
      "no-store, private, max-age=0",
    );
  });

  it("hata yanitlari yalnizca kod ve mesaj tasir", async () => {
    const response = await authenticatedPOST(jsonRequest("{}"));
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error as Record<string, unknown>).sort()).toEqual([
      "code",
      "message",
    ]);
  });
});

describe("Google oturum kapisi", () => {
  it("oturumsuz istek govdeyi okumadan ve depoya dokunmadan genel 401 doner", async () => {
    const readBody = vi.fn();
    const createRepository = vi.fn();
    const response = await createSharedBillPost({
      authenticate: async () => ({ status: "signedOut" }),
      readBody,
      createRepository,
    })(jsonRequest('{"manifest":"hassas"}'));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe(
      "no-store, private, max-age=0",
    );
    expect(await response.json()).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Bu işlem için oturum açman gerekiyor.",
      },
    });
    expect(readBody).not.toHaveBeenCalled();
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("auth yapilandirmasi gecersizken govde ve depodan once genel 503 doner", async () => {
    const readBody = vi.fn();
    const createRepository = vi.fn();
    const response = await createSharedBillPost({
      authenticate: async () => ({ status: "unavailable" }),
      readBody,
      createRepository,
    })(jsonRequest('{"manifest":"hassas"}'));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe(
      "no-store, private, max-age=0",
    );
    expect(await response.json()).toEqual({
      error: {
        code: "SERVICE_NOT_CONFIGURED",
        message: "Kimlik doğrulama servisi şu anda kullanılamıyor.",
      },
    });
    expect(readBody).not.toHaveBeenCalled();
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("oturumsuz POST redirect HTML yerine JSON 401 doner", async () => {
    const response = await createSharedBillPost({
      authenticate: async () => ({ status: "signedOut" }),
    })(jsonRequest("{}"));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).error.code).toBe("AUTH_REQUIRED");
  });

  it("oturumlu istekte mevcut dogrulama ve idempotent durum kodlari korunur", async () => {
    const createBill = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        code: "INVALID_SHARED_BILL",
        message: "gecersiz",
      })
      .mockResolvedValueOnce({
        ok: true,
        billId: `0x${"11".repeat(32)}`,
        path: `/pay/0x${"11".repeat(32)}`,
        expiresAt: 1_700_000_000,
        created: false,
      });
    const repository = {} as never;
    const route = createSharedBillPost({
      authenticate: async () => ({
        status: "authenticated",
        user: { id: "app-user", name: null, image: null },
      }),
      createRepository: async () => repository,
      createBill,
    });

    expect((await route(jsonRequest("{}"))).status).toBe(400);
    expect((await route(jsonRequest("{}"))).status).toBe(200);
    expect(createBill).toHaveBeenCalledTimes(2);
  });
});

describe("olusturan kullanicinin atfi", () => {
  const SESSION_USER = "55555555-5555-4555-8555-555555555555";

  function postWith(userId: string) {
    const createBill = vi.fn(async () => ({
      ok: true as const,
      billId: `0x${"6d".repeat(32)}`,
      path: `/pay/0x${"6d".repeat(32)}`,
      expiresAt: 1_700_600_000,
      created: true,
    }));
    const POST = createSharedBillPost({
      authenticate: async () => ({
        status: "authenticated",
        user: { id: userId, name: null, image: null },
      }),
      createRepository: async () => ({}) as never,
      createBill,
    });
    return { POST, createBill };
  }

  it("oturumdaki kullanici kimligi is katmanina gecer", async () => {
    const { POST, createBill } = postWith(SESSION_USER);
    const response = await POST(jsonRequest(JSON.stringify({ a: 1 })));

    expect(response.status).toBe(201);
    expect(createBill).toHaveBeenCalledWith(
      expect.objectContaining({ createdByUserId: SESSION_USER }),
    );
  });

  it("kimlik bicimsizse hesap YINE olusur, yalnizca sahipsiz kalir", async () => {
    /*
     * Atif ugruna hesap kaybedilmez: dogrulamanin hicbir adimi bu degere
     * bagli degildir. (Okuma yolunda tercih TERSIDIR: orada bos liste yerine
     * kontrollu hata donulur.)
     */
    const { POST, createBill } = postWith("app-user");
    const response = await POST(jsonRequest(JSON.stringify({ a: 1 })));

    expect(response.status).toBe(201);
    expect(createBill).toHaveBeenCalledWith(
      expect.objectContaining({ createdByUserId: null }),
    );
  });

  it("yanit sahiplik kimligini ISTEMCIYE sizdirmaz", async () => {
    const { POST } = postWith(SESSION_USER);
    const response = await POST(jsonRequest(JSON.stringify({ a: 1 })));
    const text = await response.text();

    expect(text).not.toContain(SESSION_USER);
    expect(text).not.toMatch(/createdByUserId|appUserId/);
  });

  it("govde bir kullanici kimligi ONERSE bile dikkate alinmaz", async () => {
    const { POST, createBill } = postWith(SESSION_USER);
    await POST(
      jsonRequest(
        JSON.stringify({
          createdByUserId: "66666666-6666-4666-8666-666666666666",
          appUserId: "kotucul",
        }),
      ),
    );

    expect(createBill).toHaveBeenCalledWith(
      expect.objectContaining({ createdByUserId: SESSION_USER }),
    );
  });
});
