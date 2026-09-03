import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createAccountDelete } from "@/app/api/account/route";
import { en } from "@/lib/i18n/en";
import { tr } from "@/lib/i18n/tr";
import { ACCOUNT_PAGE_PATH } from "@/lib/legal/privacy";

import type { SharedBillRepository } from "./shared-bill-repository";

/**
 * `DELETE /api/account` tasima katmani.
 *
 * Bu uc GERI ALINAMAYAN bir is yapar, o yuzden kapinin kendisi ayrica
 * kanitlanir: oturumsuz istek hicbir kaynak harcamadan reddedilir ve silinecek
 * kullanici HER ZAMAN sunucudaki oturumdan okunur. Istegin govdesi ya da
 * sorgusu bir kullanici kimligi TASIYAMAZ.
 */

const SESSION_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const authenticated = async () => ({
  status: "authenticated" as const,
  user: { id: SESSION_USER, name: "Ada", image: null },
});

function forbiddenRepository() {
  return vi.fn(async () => {
    throw new Error("depo yaratilmamaliydi");
  });
}

const emptyRepository = async () => ({}) as unknown as SharedBillRepository;

describe("oturum kapisi", () => {
  it("oturum yoksa 401 doner ve depo YARATILMAZ", async () => {
    const createRepository = forbiddenRepository();
    const remove = vi.fn();
    const DELETE = createAccountDelete({
      authenticate: async () => ({ status: "signedOut" }),
      createRepository,
      remove,
    });

    const response = await DELETE();

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(createRepository).not.toHaveBeenCalled();
    /* En onemlisi: silme HIC CAGRILMAZ. */
    expect(remove).not.toHaveBeenCalled();
  });

  it("kimlik servisi yoksa 503 doner ve silme cagrilmaz", async () => {
    const remove = vi.fn();
    const DELETE = createAccountDelete({
      authenticate: async () => ({ status: "unavailable" }),
      createRepository: forbiddenRepository(),
      remove,
    });

    const response = await DELETE();

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_NOT_CONFIGURED");
    expect(remove).not.toHaveBeenCalled();
  });

  it("depo yapilandirilmamissa 503 doner ve silme cagrilmaz", async () => {
    const remove = vi.fn();
    const DELETE = createAccountDelete({
      authenticate: authenticated,
      createRepository: async () => null,
      remove,
    });

    const response = await DELETE();

    expect(response.status).toBe(503);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("kimlik OTURUMDAN gelir", () => {
  it("silinen kullanici oturumdaki kullanicidir", async () => {
    const remove = vi.fn(
      async (input: { userId: string; repository: SharedBillRepository }) => {
        void input;
        return { ok: true as const, deleted: true };
      },
    );
    const DELETE = createAccountDelete({
      authenticate: authenticated,
      createRepository: emptyRepository,
      remove,
    });

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]?.[0]?.userId).toBe(SESSION_USER);
    expect(remove.mock.calls[0]?.[0]?.userId).not.toBe(OTHER_USER);
  });

  it("isleyici HICBIR parametre almaz", () => {
    /*
     * Imzada parametre olmamasi, "hangi hesabi silelim" sorusunun istemciye
     * hic sorulmadiginin en dogrudan kanitidir.
     */
    const DELETE = createAccountDelete({
      authenticate: authenticated,
      createRepository: emptyRepository,
      remove: vi.fn(async () => ({ ok: true as const, deleted: true })),
    });
    expect(DELETE.length).toBe(0);
  });
});

describe("sonuc dogru tasinir", () => {
  it("silinecek sey yoksa yine 200 doner", async () => {
    const DELETE = createAccountDelete({
      authenticate: authenticated,
      createRepository: emptyRepository,
      remove: vi.fn(async () => ({ ok: true as const, deleted: false })),
    });

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: false });
  });

  it("servis hatasinin KODU ve durumu korunur", async () => {
    const DELETE = createAccountDelete({
      authenticate: authenticated,
      createRepository: emptyRepository,
      remove: vi.fn(async () => ({
        ok: false as const,
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "olmadi",
      })),
    });

    const response = await DELETE();

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("yanit ONBELLEGE ALINMAZ", async () => {
    const DELETE = createAccountDelete({
      authenticate: authenticated,
      createRepository: emptyRepository,
      remove: vi.fn(async () => ({ ok: true as const, deleted: true })),
    });

    const response = await DELETE();

    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

/**
 * ARAYUZ SOZLESMESI.
 *
 * Bu depoda bilesen testi kosumu yoktur; panelin geri alinamaz bir isi TEK
 * TIKLA yapmadigi kaynak duzeyinde sabitlenir.
 */
describe("panel iki adimlidir", () => {
  const panel = readFileSync(
    "src/components/AccountDeletionPanel.tsx",
    "utf8",
  );

  it("ilk dugme SILMEZ, yalnizca onay adimina gecer", () => {
    expect(panel).toContain('onClick={() => setPhase({ status: "confirming" })}');
    /* Silme YALNIZCA onay adimindaki dugmeye baglidir. */
    expect(panel.split("void remove()").length - 1).toBe(1);
  });

  it("vazgecmek mumkundur", () => {
    expect(panel).toContain('onClick={() => setPhase({ status: "idle" })}');
  });

  it("neyin KALDIGI da yazar, yalnizca neyin gittigi degil", () => {
    expect(panel).toContain("account.staysBills");
    expect(panel).toContain("account.staysChain");
  });

  it("silme istegi gercekten DELETE'tir", () => {
    expect(panel).toContain('fetch("/api/account", { method: "DELETE" })');
  });
});

/**
 * POLITIKA ile ARAYUZ AYNI SEYI soylemelidir.
 *
 * Gizlilik politikasi kullaniciyi bir sayfaya ve o sayfadaki bir bolumun
 * ADINA yonlendiriyor. Ad ya da adres degisip politika guncellenmezse metin
 * olmayan bir yeri tarif eder; bu, yasal bir sayfada yanlis beyandir.
 */
describe("politika, gercekten var olan bir yolu tarif eder", () => {
  const privacy = readFileSync("src/lib/legal/privacy.ts", "utf8");

  it("politikadaki adres gercek sayfadir", () => {
    expect(ACCOUNT_PAGE_PATH).toBe("/account");
    expect(existsSync("src/app/account/page.tsx")).toBe(true);
  });

  it("politikadaki bolum adi ARAYUZDEKI adla ayni", () => {
    /* Iki dilde de: politikadaki etiket sozlukteki basliktan farkli olamaz. */
    expect(privacy).toContain(`const ACCOUNT_DELETE_LABEL = "${tr.account.deleteHeading}"`);
    expect(privacy).toContain(
      `const ACCOUNT_DELETE_LABEL_EN = "${en.account.deleteHeading}"`,
    );
  });

  it("altbilgi sayfaya BAGLANTI verir", () => {
    const footer = readFileSync("src/components/SiteFooter.tsx", "utf8");
    expect(footer).toContain('href="/account"');
  });
});
