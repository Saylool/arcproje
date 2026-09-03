import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { deleteAccount } from "./account-deletion-service";
import { listSavedContacts, saveContact } from "./saved-contacts-service";
import { listSharedBillsCreatedBy } from "./shared-bill-listing-service";
import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";
import type { SharedBillManifest } from "@/lib/arc/shared-bill";

/**
 * HESAP SILME.
 *
 * Uc sey ayri ayri kanitlanir:
 *
 *   1. KISISEL VERI GIDER: app_users satiri ve kayitli kisi defteri.
 *   2. BASKALARININ BORCU KALIR: silen kisinin olusturdugu ortak hesaplar
 *      ayakta durur, yalnizca sahiplik bagi kopar. Aksi halde bir kullanici
 *      kendi hesabini silerek BASKA insanlarin odeme yolunu kapatabilirdi.
 *   3. KIMLIGI ISTEMCI VEREMEZ: servis yalnizca dogrulanmis bir kullanici
 *      kimligi kabul eder.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

type Repo = ReturnType<typeof createFakeSharedBillRepository>;

function withUser(userId: string): Repo {
  const repository = createFakeSharedBillRepository();
  repository.appUsers.add(userId);
  return repository;
}

/**
 * Kayitli bir ortak hesap.
 *
 * Deponun KENDI yazma yolu kullanilir; testin ic durumu elle kurmasi, silme
 * sonrasi "kayit hala orada mi" sorusunu anlamsizlastirirdi.
 */
async function seedBill(repository: Repo, billId: string, ownerId: string) {
  const manifest = {
    billId,
    chainId: 5042002,
    recipient: ADDRESS,
    recipientLabel: "Poyraz",
    debtsRoot: `0x${"1".repeat(64)}`,
    debtCount: 0,
    issuedAt: 1_700_000_000,
    expiresAt: 1_800_000_000,
    schemaVersion: 1,
  } as unknown as SharedBillManifest;

  const written = await repository.createSharedBill(
    { manifest, debts: [], signature: `0x${"2".repeat(130)}` },
    { createdByUserId: ownerId },
  );
  expect(written.ok).toBe(true);
}

/** Defteri deponun KENDI okuma yoluyla okur. */
async function contactsOf(repository: Repo, userId: string) {
  const listed = await listSavedContacts({ userId, repository });
  return listed.ok ? listed.contacts : [];
}

describe("hesap silme: kisisel veri gider", () => {
  it("app_users satiri silinir", async () => {
    const repository = withUser(OWNER);

    const result = await deleteAccount({ userId: OWNER, repository });

    expect(result).toEqual({ ok: true, deleted: true });
    expect(repository.appUsers.has(OWNER)).toBe(false);
  });

  it("kayitli kisi defteri de gider", async () => {
    const repository = withUser(OWNER);
    await saveContact({
      userId: OWNER,
      repository,
      label: "Ada",
      address: ADDRESS,
      createContactId: () => "33333333-3333-4333-8333-333333333333",
    });
    expect(await contactsOf(repository, OWNER)).toHaveLength(1);

    await deleteAccount({ userId: OWNER, repository });

    expect(await contactsOf(repository, OWNER)).toHaveLength(0);
  });

  it("BASKA kullanicinin defterine dokunmaz", async () => {
    const repository = withUser(OWNER);
    repository.appUsers.add(OTHER);
    await saveContact({
      userId: OTHER,
      repository,
      label: "Bora",
      address: ADDRESS,
      createContactId: () => "44444444-4444-4444-8444-444444444444",
    });

    await deleteAccount({ userId: OWNER, repository });

    expect(await contactsOf(repository, OTHER)).toHaveLength(1);
    expect(repository.appUsers.has(OTHER)).toBe(true);
  });
});

describe("hesap silme: baskalarinin borcu KALIR", () => {
  it("olusturulan ortak hesaplar silinmez", async () => {
    const repository = withUser(OWNER);
    await seedBill(repository, "bill-a", OWNER);

    await deleteAccount({ userId: OWNER, repository });

    expect(repository.bills.has("bill-a")).toBe(true);
  });

  it("hesabin sahiplik bagi kopar ama kaydin kendisi durur", async () => {
    const repository = withUser(OWNER);
    await seedBill(repository, "bill-a", OWNER);

    await deleteAccount({ userId: OWNER, repository });

    expect(repository.bills.get("bill-a")?.createdByUserId).toBeNull();
    /* Sahipsiz kayit artik kimsenin listesinde cikmaz. */
    const listed = await listSharedBillsCreatedBy({
      createdByUserId: OWNER,
      repository,
    });
    expect(listed.ok && listed.bills).toEqual([]);
  });

  it("BASKA kullanicinin hesabinin sahipligi bozulmaz", async () => {
    const repository = withUser(OWNER);
    repository.appUsers.add(OTHER);
    await seedBill(repository, "bill-a", OWNER);
    await seedBill(repository, "bill-b", OTHER);

    await deleteAccount({ userId: OWNER, repository });

    expect(repository.bills.get("bill-b")?.createdByUserId).toBe(OTHER);
  });
});

describe("hesap silme: sinirlar", () => {
  it("kullanici kimligi gecerli degilse hicbir sey silinmez", async () => {
    const repository = withUser(OWNER);

    for (const bad of ["", "  ", "not-a-uuid", `${OWNER}x`, "1; DROP TABLE"]) {
      const result = await deleteAccount({ userId: bad, repository });
      expect(result.ok).toBe(false);
    }
    expect(repository.appUsers.has(OWNER)).toBe(true);
  });

  it("depo erisilemezse basarili sayilmaz", async () => {
    const repository = createFakeSharedBillRepository({
      failWithUnavailable: true,
    });
    repository.appUsers.add(OWNER);

    const result = await deleteAccount({ userId: OWNER, repository });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(503);
  });

  it("ikinci kez silmek HATA DEGILDIR, yalnizca silinecek sey yoktur", async () => {
    const repository = withUser(OWNER);

    const first = await deleteAccount({ userId: OWNER, repository });
    const second = await deleteAccount({ userId: OWNER, repository });

    expect(first).toEqual({ ok: true, deleted: true });
    expect(second).toEqual({ ok: true, deleted: false });
  });
});

/**
 * SQL <-> BELLEK ICI DEPO ESLESMESI.
 *
 * Bu depoda calisan bir Postgres yoktur; SQL metninin dogru semantigi
 * KODLADIGI olculur. Sahte depo yesil kalirken uretimdeki sorgunun farkli
 * davranmasi bu projede daha once yasandi.
 */
describe("silme SQL'i sahte depoyla AYNI seyi yapar", () => {
  const neon = readFileSync(
    "src/lib/db/neon-shared-bill-repository.ts",
    "utf8",
  );
  const sql = neon.slice(
    neon.indexOf("const DELETE_APP_USER = `"),
    neon.indexOf("`;", neon.indexOf("const DELETE_APP_USER = `")),
  );

  it("YALNIZCA app_users satirini siler", () => {
    expect(sql).toContain("DELETE FROM app_users");
    /* Hesaplari ya da borc satirlarini bu sorgu SILMEZ. */
    expect(sql).not.toContain("shared_bills");
    expect(sql).not.toContain("shared_bill_debts");
  });

  it("tek kullaniciyla sinirlidir", () => {
    expect(sql).toContain("WHERE user_id = $1");
  });

  it("gercekten silinip silinmedigini RAPOR eder", () => {
    /* RETURNING olmadan "deleted" her zaman false olurdu. */
    expect(sql).toContain("RETURNING user_id");
  });

  it("kayitli kisiler ve sahiplik SEMADAKI kisitlara birakilir", () => {
    const migration = readFileSync(
      "migrations/0004_saved_contacts.sql",
      "utf8",
    );
    expect(migration).toContain("ON DELETE CASCADE");

    const owner = readFileSync(
      "migrations/0003_shared_bill_owner.sql",
      "utf8",
    );
    expect(owner).toContain("ON DELETE SET NULL");
  });
});
