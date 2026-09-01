import { describe, expect, it, vi } from "vitest";

import {
  createContactDelete,
  createContactPatch,
} from "@/app/api/contacts/[contactId]/route";
import {
  createContactsDelete,
  createContactsPost,
} from "@/app/api/contacts/route";

import type { SharedBillRepository } from "./shared-bill-repository";

/**
 * Kayitli kisi YAZMA uclari.
 *
 * Ortak kural: hangi deftere dokunuldugunu OTURUM belirler. Yol ve govde
 * yalnizca hangi SATIR oldugunu soyler; kimin defteri oldugunu ASLA.
 */

const SESSION_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const ADA = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

const authenticated = async () => ({
  status: "authenticated" as const,
  user: { id: SESSION_USER, name: "Ada", image: null },
});

const repository = {} as SharedBillRepository;
const params = (contactId: string) => ({ params: Promise.resolve({ contactId }) });

function jsonRequest(body: unknown, method = "POST") {
  return new Request("https://ornek.test/api/contacts", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contacts", () => {
  it("oturum yoksa 401 doner ve depo YARATILMAZ", async () => {
    const createRepository = vi.fn(async () => {
      throw new Error("depo yaratilmamaliydi");
    });
    const POST = createContactsPost({
      authenticate: async () => ({ status: "signedOut" }),
      createRepository,
      save: vi.fn(),
    });
    const response = await POST(jsonRequest({ label: "Ada", address: ADA }));
    expect(response.status).toBe(401);
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("kime kaydedilecegini GOVDE belirleyemez", async () => {
    const save = vi.fn(async () => ({
      ok: true as const,
      contact: { contactId: CONTACT_ID, label: "Ada", address: ADA },
    }));
    const POST = createContactsPost({
      authenticate: authenticated,
      createRepository: async () => repository,
      save,
      createContactId: () => CONTACT_ID,
    });

    await POST(
      jsonRequest({
        label: "Ada",
        address: ADA,
        userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        contactId: "kotucul",
      }),
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SESSION_USER }),
    );
  });

  it("application/json olmayan istek reddedilir", async () => {
    const POST = createContactsPost({
      authenticate: authenticated,
      createRepository: async () => repository,
      save: vi.fn(),
    });
    const response = await POST(
      new Request("https://ornek.test/api/contacts", {
        method: "POST",
        body: "merhaba",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("bozuk JSON reddedilir", async () => {
    const POST = createContactsPost({
      authenticate: authenticated,
      createRepository: async () => repository,
      save: vi.fn(),
    });
    const response = await POST(
      new Request("https://ornek.test/api/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{bozuk",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("basarili kayit 201 ve onbelleksiz doner", async () => {
    const POST = createContactsPost({
      authenticate: authenticated,
      createRepository: async () => repository,
      save: async () => ({
        ok: true as const,
        contact: { contactId: CONTACT_ID, label: "Ada", address: ADA },
      }),
    });
    const response = await POST(jsonRequest({ label: "Ada", address: ADA }));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text();
    expect(text).not.toContain(SESSION_USER);
  });
});

describe("DELETE /api/contacts (tumu)", () => {
  it("ARITESI sifirdir: hangi defter oldugunu istek soyleyemez", () => {
    expect(createContactsDelete().length).toBe(0);
  });

  it("yalnizca oturumdaki kullanicinin defteri silinir", async () => {
    const remove = vi.fn(async () => ({ ok: true as const, deleted: 3 }));
    const DELETE = createContactsDelete({
      authenticate: authenticated,
      createRepository: async () => repository,
      remove,
    });
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith({
      userId: SESSION_USER,
      repository,
    });
  });

  it("oturum yoksa 401", async () => {
    const DELETE = createContactsDelete({
      authenticate: async () => ({ status: "signedOut" }),
      createRepository: async () => repository,
      remove: vi.fn(),
    });
    expect((await DELETE()).status).toBe(401);
  });
});

describe("PATCH ve DELETE /api/contacts/[contactId]", () => {
  it("bicimsiz kimlik 404 doner ve depo YARATILMAZ", async () => {
    const createRepository = vi.fn(async () => {
      throw new Error("depo yaratilmamaliydi");
    });
    for (const bad of ["kotucul", "", "../../etc", "11111111"]) {
      const PATCH = createContactPatch({
        authenticate: authenticated,
        createRepository,
        update: vi.fn(),
      });
      const response = await PATCH(
        jsonRequest({ label: "Ada", address: ADA }, "PATCH"),
        params(bad),
      );
      expect(response.status, bad).toBe(404);
    }
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("guncelleme OTURUMDAKI kullanici ile sinirlanir", async () => {
    const update = vi.fn(async () => ({
      ok: true as const,
      contact: { contactId: CONTACT_ID, label: "Ada", address: ADA },
    }));
    const PATCH = createContactPatch({
      authenticate: authenticated,
      createRepository: async () => repository,
      update,
    });
    await PATCH(
      jsonRequest({ label: "Ada", address: ADA }, "PATCH"),
      params(CONTACT_ID),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SESSION_USER, contactId: CONTACT_ID }),
    );
  });

  it("silme OTURUMDAKI kullanici ile sinirlanir", async () => {
    const remove = vi.fn(async () => ({ ok: true as const, deleted: 1 }));
    const DELETE = createContactDelete({
      authenticate: authenticated,
      createRepository: async () => repository,
      remove,
    });
    const response = await DELETE(
      new Request("https://ornek.test", { method: "DELETE" }),
      params(CONTACT_ID),
    );
    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith({
      userId: SESSION_USER,
      repository,
      contactId: CONTACT_ID,
    });
  });

  it("hicbir satir silinmediyse 404 doner", async () => {
    // Baskasinin kaydi da bu yoldan gecer: "yok" ile "senin degil" ayni cevap.
    const DELETE = createContactDelete({
      authenticate: authenticated,
      createRepository: async () => repository,
      remove: async () => ({ ok: true as const, deleted: 0 }),
    });
    const response = await DELETE(
      new Request("https://ornek.test", { method: "DELETE" }),
      params(CONTACT_ID),
    );
    expect(response.status).toBe(404);
  });

  it("oturum yoksa 401", async () => {
    const PATCH = createContactPatch({
      authenticate: async () => ({ status: "signedOut" }),
      createRepository: async () => repository,
      update: vi.fn(),
    });
    const response = await PATCH(
      jsonRequest({ label: "Ada", address: ADA }, "PATCH"),
      params(CONTACT_ID),
    );
    expect(response.status).toBe(401);
  });
});
