import { describe, expect, it, vi } from "vitest";

import { createSharedBillList } from "@/app/api/shared-bills/route";

import type { SharedBillRepository } from "./shared-bill-repository";

/**
 * `GET /api/shared-bills` tasima katmani.
 *
 * Bu rota, Google oturumunun bir KAPI degil YETKI oldugu yerdir: hangi
 * satirlarin donecegini oturum belirler. Testler iki seyi ayri ayri kanitlar:
 *
 *   1. Oturum yoksa hicbir kaynak TUKETILMEZ (depo bile yaratilmaz).
 *   2. Suzme olcutu HER ZAMAN sunucudaki oturumdur; istek bir kullanici
 *      kimligi tasiyamaz.
 */

const SESSION_USER = "44444444-4444-4444-8444-444444444444";

/** Depo yaratimi CAGRILMAMALIYSA bunu kullan: cagrilirsa test patlar. */
function forbiddenRepository() {
  return vi.fn(async () => {
    throw new Error("depo yaratilmamaliydi");
  });
}

const authenticated = async () =>
  ({
    status: "authenticated" as const,
    user: { id: SESSION_USER, name: "Ada", image: null },
  });

describe("oturum kapisi", () => {
  it("oturum yoksa 401 doner ve depo YARATILMAZ", async () => {
    const createRepository = forbiddenRepository();
    const listBills = vi.fn();
    const GET = createSharedBillList({
      authenticate: async () => ({ status: "signedOut" }),
      createRepository,
      listBills,
    });

    const response = await GET();
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(createRepository).not.toHaveBeenCalled();
    expect(listBills).not.toHaveBeenCalled();
  });

  it("kimlik servisi yoksa 503 doner ve depo YARATILMAZ", async () => {
    const createRepository = forbiddenRepository();
    const GET = createSharedBillList({
      authenticate: async () => ({ status: "unavailable" }),
      createRepository,
      listBills: vi.fn(),
    });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_NOT_CONFIGURED");
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("depo yapilandirilmamissa kontrollu 503 doner", async () => {
    const GET = createSharedBillList({
      authenticate: authenticated,
      createRepository: async () => null,
      listBills: vi.fn(),
    });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("SERVICE_NOT_CONFIGURED");
    expect(body.error.message).toContain("DATABASE_URL");
    expect(body.error.message).not.toContain("postgres://");
  });
});

describe("suzme olcutu", () => {
  it("depoya YALNIZCA oturumdaki kullanici kimligi gecer", async () => {
    const repository = {} as SharedBillRepository;
    const listBills = vi.fn(async () => ({ ok: true as const, bills: [] }));
    const GET = createSharedBillList({
      authenticate: authenticated,
      createRepository: async () => repository,
      listBills,
    });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(listBills).toHaveBeenCalledWith({
      createdByUserId: SESSION_USER,
      repository,
    });
  });

  it("islevin ARITESI sifirdir: istegi hic okuyamaz", () => {
    /*
     * Yapisal kanit. Sorgu dizesinden bir kullanici kimligi kabul edilseydi,
     * oturum acmis herkes baskasinin listesini isteyebilirdi. Isleyici hicbir
     * parametre almadigi icin boyle bir sizinti MUMKUN DEGILDIR.
     */
    expect(createSharedBillList().length).toBe(0);
  });
});

describe("basarili yanit", () => {
  const summary = {
    billId: `0x${"5c".repeat(32)}`,
    path: `/pay/0x${"5c".repeat(32)}`,
    issuedAt: 1_700_000_000,
    expiresAt: 1_700_600_000,
    status: "open" as const,
    debtCount: 2,
    paidCount: 1,
    totalTryMinor: "19134",
    paidTryMinor: "12345",
  };

  it("hesap ozetlerini onbelleklenmeden dondurur", async () => {
    const GET = createSharedBillList({
      authenticate: authenticated,
      createRepository: async () => ({}) as SharedBillRepository,
      listBills: async () => ({ ok: true as const, bills: [summary] }),
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).toContain("private");

    const body = (await response.json()) as { bills: unknown[] };
    expect(body.bills).toEqual([summary]);
  });

  it("yanit sahiplik kimligini ISTEMCIYE sizdirmaz", async () => {
    const GET = createSharedBillList({
      authenticate: authenticated,
      createRepository: async () => ({}) as SharedBillRepository,
      listBills: async () => ({ ok: true as const, bills: [summary] }),
    });

    const response = await GET();
    const text = await response.text();
    /*
     * Kimin oldugu zaten oturumdan bilinir; govdede tekrar edilmesi gereksiz
     * bir yayilimdir ve loglara dusebilir.
     */
    expect(text).not.toContain(SESSION_USER);
    expect(text).not.toMatch(/createdByUserId|appUserId/);
  });

  it("liste okunamazsa 503 doner, BOS LISTE degil", async () => {
    const GET = createSharedBillList({
      authenticate: authenticated,
      createRepository: async () => ({}) as SharedBillRepository,
      listBills: async () => ({
        ok: false as const,
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "okunamiyor",
      }),
    });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
