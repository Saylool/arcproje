import { describe, expect, it, vi } from "vitest";

import { createContactsGet } from "@/app/api/contacts/route";

import type { SharedBillRepository } from "./shared-bill-repository";

/**
 * `GET /api/contacts` tasima katmani.
 *
 * Rehber, oturumun bir YETKI oldugu ikinci yuzeydir: hangi satirlarin donecegi
 * oturumdan belirlenir. Istek bir kullanici kimligi TASIYAMAZ.
 */

const SESSION_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const authenticated = async () => ({
  status: "authenticated" as const,
  user: { id: SESSION_USER, name: "Ada", image: null },
});

function forbiddenRepository() {
  return vi.fn(async () => {
    throw new Error("depo yaratilmamaliydi");
  });
}

describe("oturum kapisi", () => {
  it("oturum yoksa 401 doner ve depo YARATILMAZ", async () => {
    const createRepository = forbiddenRepository();
    const listContacts = vi.fn();
    const GET = createContactsGet({
      authenticate: async () => ({ status: "signedOut" }),
      createRepository,
      listContacts,
    });

    const response = await GET();
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(createRepository).not.toHaveBeenCalled();
    expect(listContacts).not.toHaveBeenCalled();
  });

  it("kimlik servisi yoksa 503 doner", async () => {
    const GET = createContactsGet({
      authenticate: async () => ({ status: "unavailable" }),
      createRepository: forbiddenRepository(),
      listContacts: vi.fn(),
    });
    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_NOT_CONFIGURED");
  });

  it("depo yapilandirilmamissa kontrollu 503 doner", async () => {
    const GET = createContactsGet({
      authenticate: authenticated,
      createRepository: async () => null,
      listContacts: vi.fn(),
    });
    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.message).toContain("DATABASE_URL");
    expect(body.error.message).not.toContain("postgres://");
  });
});

describe("suzme olcutu", () => {
  it("servise YALNIZCA oturumdaki kimlik gecer", async () => {
    const repository = {} as SharedBillRepository;
    const listContacts = vi.fn(async () => ({
      ok: true as const,
      contacts: [],
    }));
    const GET = createContactsGet({
      authenticate: authenticated,
      createRepository: async () => repository,
      listContacts,
    });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(listContacts).toHaveBeenCalledWith({
      createdByUserId: SESSION_USER,
      repository,
    });
  });

  it("FARKLI oturumlar FARKLI kimlik gecirir", async () => {
    /*
     * Tek oturumla olcmek yetmez: rota oturumu yok sayip sabit bir kimlik
     * kullansa da o test gecerdi. Iki ayri oturum, kimligin GERCEKTEN
     * oturumdan geldigini kanitlar.
     */
    const seen: string[] = [];
    const listContacts = vi.fn(async (input: { createdByUserId: string }) => {
      seen.push(input.createdByUserId);
      return { ok: true as const, contacts: [] };
    });

    const other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    for (const id of [SESSION_USER, other]) {
      const GET = createContactsGet({
        authenticate: async () => ({
          status: "authenticated",
          user: { id, name: null, image: null },
        }),
        createRepository: async () => ({}) as SharedBillRepository,
        listContacts,
      });
      expect((await GET()).status).toBe(200);
    }

    expect(seen).toEqual([SESSION_USER, other]);
  });

  it("islevin ARITESI sifirdir: istegi hic okuyamaz", () => {
    /*
     * Sorgu dizesinden bir kullanici kimligi kabul edilseydi, oturum acmis
     * herkes baskasinin rehberini isteyebilirdi.
     */
    expect(createContactsGet().length).toBe(0);
  });
});

describe("yanit", () => {
  const contact = {
    address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    label: "Ada",
    lastUsedAt: 1_700_000_000,
  };

  it("onbelleklenmez ve oturum kimligini sizdirmaz", async () => {
    const GET = createContactsGet({
      authenticate: authenticated,
      createRepository: async () => ({}) as SharedBillRepository,
      listContacts: async () => ({ ok: true as const, contacts: [contact] }),
    });

    const response = await GET();
    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).toContain("private");

    const text = await response.text();
    expect(text).not.toContain(SESSION_USER);
    expect(text).not.toMatch(/createdByUserId|appUserId/);
    expect(JSON.parse(text)).toEqual({ contacts: [contact] });
  });

  it("okunamazsa 503 doner, BOS LISTE degil", async () => {
    const GET = createContactsGet({
      authenticate: authenticated,
      createRepository: async () => ({}) as SharedBillRepository,
      listContacts: async () => ({
        ok: false as const,
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "okunamiyor",
      }),
    });
    const response = await GET();
    expect(response.status).toBe(503);
  });
});
