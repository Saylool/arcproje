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
      /*
       * Kota analiz yolunun bir parcasi oldu. Bu test kotayi degil, oturum
       * kapisini ve multipart davranisini olcuyor; kota GECER birakilir ve
       * kendi testlerinde ayrica kanitlanir.
       */
      createRepository: async () => ({}) as never,
      userExists: async () => ({ ok: true as const, exists: true }),
      consumeQuota: async () => ({ ok: true as const, remaining: 24 }),
    });

    const response = await route(multipartRequest());
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("RECEIPT_NOT_READABLE");
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0]?.[0]).toMatch(/^data:image\/jpeg;base64,/);
  });
});

/**
 * KOTA DÜŞÜLDÜKTEN SONRAKİ HATALARDA KALAN HAK.
 *
 * Sağlayıcıya ulaşan her deneme hakkı yakar — bilinçli ürün kararı. Ama hata
 * yanıtı sayıyı taşımayınca istemci eski (yüksek) değeri göstermeye devam
 * ediyordu: ekranda 24 yazarken sunucuda 23 oluyordu. Kusur hakkın yanması
 * değil, kullanıcıya YANLIŞ sayı söylenmesiydi.
 */
describe("hata yanitlari kalan hakki bildirir", () => {
  function routeWith(overrides: Parameters<typeof createReceiptAnalyzePost>[0]) {
    return createReceiptAnalyzePost({
      authenticate: async () => ({
        status: "authenticated",
        user: { id: "app-user", name: null, image: null },
      }),
      configured: () => true,
      createRepository: async () => ({}) as never,
      userExists: async () => ({ ok: true as const, exists: true }),
      ...overrides,
    });
  }

  it("SAGLAYICI hatasinda gercek sayi doner", async () => {
    const response = await routeWith({
      consumeQuota: async () => ({ ok: true as const, remaining: 23 }),
      extract: async () => ({
        ok: false as const,
        code: "RECEIPT_NOT_READABLE" as const,
      }),
    })(multipartRequest());

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "RECEIPT_NOT_READABLE" },
      remainingAnalyses: 23,
    });
  });

  it("BEKLENMEYEN hatada da doner", async () => {
    const response = await routeWith({
      consumeQuota: async () => ({ ok: true as const, remaining: 5 }),
      extract: async () => {
        throw new Error("saglayici coktu");
      },
    })(multipartRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
      remainingAnalyses: 5,
    });
  });

  it("SIFIR da bildirilir, atlanmaz", async () => {
    /*
     * `0` yanlış (falsy) bir değerdir. Alan "doğruysa ekle" diye konsaydı
     * sıfır sessizce düşer ve hakkı bitmiş kullanıcı hakkı varmış gibi
     * görünürdü — düzeltmenin en çok gerektiği durumda çalışmazdı.
     */
    const response = await routeWith({
      consumeQuota: async () => ({
        ok: false as const,
        status: 429,
        code: "DAILY_LIMIT_REACHED",
        message: "Bugünlük analiz hakkın doldu.",
        remaining: 0,
      }),
      extract: async () => {
        throw new Error("buraya gelinmemeli");
      },
    })(multipartRequest());

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: { code: "DAILY_LIMIT_REACHED" },
      remainingAnalyses: 0,
    });
  });

  it("BILINMIYORSA alan HIC konmaz", async () => {
    /*
     * Genel tavan dolduğunda kişinin hakkına dokunulmamıştır ve sunucu sayıyı
     * BİLMEZ. Uydurulmuş bir sayı, eski sayıdan daha kötüdür; alan hiç
     * konmaz ve istemci bilinen değeri korur.
     */
    const response = await routeWith({
      consumeQuota: async () => ({
        ok: false as const,
        status: 429,
        code: "SERVICE_BUSY",
        message: "Bugün toplam analiz sınırına ulaşıldı.",
        remaining: null,
      }),
      extract: async () => {
        throw new Error("buraya gelinmemeli");
      },
    })(multipartRequest());

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("SERVICE_BUSY");
    expect("remainingAnalyses" in body).toBe(false);
  });
});

describe("varlik kontrolunden SONRA silinen hesap", () => {
  /*
   * ASIL ZARAR PARA. Varlik kontrolu ile kota ayirma ayri iki istekti; arada
   * hesap silinirse istek yoluna DEVAM EDIYOR ve saglayiciya gidiyordu. Yani
   * silinmis bir hesap bir analiz daha yaptirabiliyordu.
   *
   * Burada varlik kontrolu BILEREK "var" der: yarisin gerceklestigi durum
   * budur. Kararin ayirmadan gelmesi ve saglayiciya HIC gidilmemesi olculur.
   */
  it("401 doner ve SAGLAYICIYA GIDILMEZ", async () => {
    const extract = vi.fn();
    const response = await createReceiptAnalyzePost({
      authenticate: async () => ({
        status: "authenticated",
        user: { id: "app-user", name: null, image: null },
      }),
      configured: () => true,
      createRepository: async () => ({}) as never,
      /* Kontrol aninda hesap DURUYORDU. */
      userExists: async () => ({ ok: true as const, exists: true }),
      /* Ayirma anina gelindiginde silinmisti. */
      consumeQuota: async () => ({
        ok: false as const,
        status: 401,
        code: "ACCOUNT_DELETED",
        message: "Bu hesap silinmiş.",
        remaining: null,
      }),
      extract,
    })(multipartRequest());

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("ACCOUNT_DELETED");
    expect(extract, "silinmis hesap icin para harcanmamali").not.toHaveBeenCalled();
  });
});
