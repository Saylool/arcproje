import { describe, expect, it, vi } from "vitest";

import { createReceiptAnalyzePost } from "@/app/api/receipts/analyze/route";

function multipartRequest(): Request {
  const body = new FormData();
  body.append(
    "receipt",
    new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])], "receipt.jpg", {
      type: "image/jpeg",
    }),
  );
  return new Request("https://ornek.test/api/receipts/analyze", {
    method: "POST",
    body,
  });
}

describe("fis analizi Google oturum kapisi", () => {
  it("oturumsuz istek genel, no-store JSON 401 doner", async () => {
    const response = await createReceiptAnalyzePost({
      authenticate: async () => ({ status: "signedOut" }),
    })(multipartRequest());
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe(
      "no-store, private, max-age=0",
    );
    expect(await response.json()).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Bu işlem için oturum açman gerekiyor.",
      },
    });
  });

  it("oturumsuz istek multipart govdesini ayristirmaz, config veya OpenAI cagirmmaz", async () => {
    const request = multipartRequest();
    const formData = vi.spyOn(request, "formData");
    const configured = vi.fn(() => true);
    const extract = vi.fn();
    const route = createReceiptAnalyzePost({
      authenticate: async () => ({ status: "signedOut" }),
      configured,
      extract,
    });

    const response = await route(request);
    expect(response.status).toBe(401);
    expect(formData).not.toHaveBeenCalled();
    expect(configured).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it("auth yapilandirmasi gecersizken govde, dosya ve OpenAI isinden once genel 503 doner", async () => {
    const request = multipartRequest();
    const formData = vi.spyOn(request, "formData");
    const configured = vi.fn(() => true);
    const extract = vi.fn();
    const response = await createReceiptAnalyzePost({
      authenticate: async () => ({ status: "unavailable" }),
      configured,
      extract,
    })(request);

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
    expect(formData).not.toHaveBeenCalled();
    expect(configured).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it("oturumlu istek mevcut multipart ve analiz davranisina devam eder", async () => {
    const extract = vi.fn(async (imageDataUrl: string) => {
      expect(imageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
      return {
        ok: false as const,
        code: "RECEIPT_NOT_READABLE" as const,
      };
    });
    const route = createReceiptAnalyzePost({
      authenticate: async () => ({
        status: "authenticated",
        user: { id: "app-user", name: null, image: null },
      }),
      configured: () => true,
      extract,
    });

    const response = await route(multipartRequest());
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("RECEIPT_NOT_READABLE");
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0]?.[0]).toMatch(/^data:image\/jpeg;base64,/);
  });
});
