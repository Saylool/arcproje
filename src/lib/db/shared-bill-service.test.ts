import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  buildSharedBillTypedData,
  createSharedBill,
  type SharedBillDebt,
  type SharedBillManifest,
} from "@/lib/arc/shared-bill";

import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";
import { createSharedBillFromSubmission } from "./shared-bill-service";

/**
 * Paylasilan hesap olusturma is mantigi.
 *
 * Gercek bir Neon veritabani KULLANILMAZ: enjekte edilen sahte depo, gercek
 * deponun sozlesmesini (atomiklik, benzersizlik, idempotent tekrar) taklit
 * eder. Imzalar test icinde uretilen rastgele anahtarlarla atilir.
 */

const NOW = 1_700_000_000_000;
const BILL_ID = `0x${"7a".repeat(32)}`;

const DEBTOR_A = "0x0000000000000000000000000000000000000aBc";
const DEBTOR_B = "0x00000000000000000000000000000000000000De";

function rawDebts() {
  return [
    { debtor: DEBTOR_A, debtorLabel: "Ada", debtKey: "a->p", tryMinor: "12345" },
    { debtor: DEBTOR_B, debtorLabel: "Bora", debtKey: "b->p", tryMinor: "6789" },
  ];
}

type Prepared = {
  account: ReturnType<typeof privateKeyToAccount>;
  manifest: SharedBillManifest;
  debts: readonly SharedBillDebt[];
  signature: string;
  body: string;
};

async function prepare(
  over: { billId?: string; lifetimeMs?: number; nowMs?: number } = {},
): Promise<Prepared> {
  const account = privateKeyToAccount(generatePrivateKey());
  const created = createSharedBill({
    recipient: account.address,
    recipientLabel: "Poyraz",
    debts: rawDebts(),
    nowMs: over.nowMs ?? NOW,
    billId: over.billId ?? BILL_ID,
    lifetimeMs: over.lifetimeMs,
  });
  if (!created.ok) throw new Error(`hesap uretilemedi: ${created.problem}`);

  const typedData = buildSharedBillTypedData(created.manifest);
  const signature = await account.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });

  return {
    account,
    manifest: created.manifest,
    debts: created.debts,
    signature,
    body: JSON.stringify({
      manifest: created.manifest,
      debts: created.debts,
      signature,
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("basarili atomik olusturma", () => {
  it("hesap ve borclar yazilir, asgari yanit doner", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare();

    const result = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.billId).toBe(BILL_ID);
    expect(result.path).toBe(`/pay/${BILL_ID}`);
    expect(result.expiresAt).toBe(prepared.manifest.expiresAt);

    const stored = repository.bills.get(BILL_ID.toLowerCase());
    expect(stored).toBeDefined();
    expect(stored?.debts).toHaveLength(2);
  });

  it("yanit HICBIR hassas alan tasimaz", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare();

    const result = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Yanit yalnizca kimlik, yol ve bitis anini icerir.
    expect(Object.keys(result).sort()).toEqual([
      "billId",
      "created",
      "expiresAt",
      "ok",
      "path",
    ]);

    const serialized = JSON.stringify(result);
    for (const secret of [
      prepared.signature,
      prepared.manifest.debtsRoot,
      prepared.manifest.recipient,
      DEBTOR_A,
      DEBTOR_B,
      "Ada",
      "Bora",
      "Poyraz",
      "12345",
    ]) {
      expect(serialized, secret.slice(0, 12)).not.toContain(secret);
    }
  });

  it("hicbir sey LOGLANMAZ", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare();
    const spies = {
      log: vi.spyOn(console, "log").mockImplementation(() => undefined),
      info: vi.spyOn(console, "info").mockImplementation(() => undefined),
      warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
      error: vi.spyOn(console, "error").mockImplementation(() => undefined),
      debug: vi.spyOn(console, "debug").mockImplementation(() => undefined),
    };

    await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });

    for (const [name, spy] of Object.entries(spies)) {
      expect(spy, name).not.toHaveBeenCalled();
    }
  });

  it("borc sirasi degisse de ayni hesap yazilir", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare();
    const reordered = JSON.stringify({
      manifest: prepared.manifest,
      debts: [...prepared.debts].reverse(),
      signature: prepared.signature,
    });

    const result = await createSharedBillFromSubmission({
      bodyText: reordered,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });
    expect(result.ok).toBe(true);
  });
});

describe("idempotent tekrar karari", () => {
  it("BIREBIR AYNI gonderim yeniden yazilmaz ve basarili sayilir", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare();

    const first = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });
    const second = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });

    expect(first.ok && first.created).toBe(true);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Ikinci cagri YENIDEN YAZMADI.
    expect(second.created).toBe(false);
    expect(second.billId).toBe(first.ok ? first.billId : "");
    expect(repository.bills.size).toBe(1);
  });

  it("AYNI kimlik FARKLI icerikle gelirse uzerine YAZILMAZ", async () => {
    const repository = createFakeSharedBillRepository();
    const first = await prepare();
    await createSharedBillFromSubmission({
      bodyText: first.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });

    // Ayni hesap kimligi, BASKA bir alici ve baska bir borc listesi.
    const second = await prepare({ billId: BILL_ID });
    expect(second.manifest.recipient).not.toBe(first.manifest.recipient);

    const result = await createSharedBillFromSubmission({
      bodyText: second.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: "BILL_ID_UNAVAILABLE",
    });
    // Ilk kayit korunur.
    expect(repository.bills.get(BILL_ID.toLowerCase())?.manifest.recipient).toBe(
      first.manifest.recipient,
    );
  });

  it("hata mesaji hangi cuzdanin kayitli oldugunu ACIGA VURMAZ", async () => {
    const repository = createFakeSharedBillRepository();
    const first = await prepare();
    await createSharedBillFromSubmission({
      bodyText: first.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });
    const second = await prepare({ billId: BILL_ID });
    const result = await createSharedBillFromSubmission({
      bodyText: second.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const secret of [
      first.manifest.recipient,
      first.signature,
      DEBTOR_A,
      "Ada",
    ]) {
      expect(result.message, secret.slice(0, 12)).not.toContain(secret);
    }
  });
});

describe("depo hatalari kontrollu yansitilir", () => {
  it("veritabani erisilemezse 503 doner", async () => {
    const repository = createFakeSharedBillRepository({
      failWithUnavailable: true,
    });
    const prepared = await prepare();

    const result = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("veritabani kisiti reddederse 400 doner", async () => {
    const repository = createFakeSharedBillRepository({
      failWithConstraint: true,
    });
    const prepared = await prepare();

    const result = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "STORAGE_REJECTED",
    });
  });

  it("islem geri alinirsa KISMI hesap kalmaz", async () => {
    const repository = createFakeSharedBillRepository({
      throwDuringWrite: true,
    });
    const prepared = await prepare();

    const result = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });
    expect(result.ok).toBe(false);
    // Hicbir kayit yazilmadi.
    expect(repository.bills.size).toBe(0);
  });

  it("depo hatasi veritabani ayrintisi SIZDIRMAZ", async () => {
    const repository = createFakeSharedBillRepository({
      failWithUnavailable: true,
    });
    const prepared = await prepare();
    const result = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const leak of ["postgres", "neon", "DATABASE_URL", "23505", "relation"]) {
      expect(result.message.toLowerCase(), leak).not.toContain(
        leak.toLowerCase(),
      );
    }
  });
});

describe("dogrulama depoya ULASMADAN once calisir", () => {
  it("imzalayan alici degilse depoya HIC gidilmez", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare();
    const attacker = privateKeyToAccount(generatePrivateKey());
    const typedData = buildSharedBillTypedData(prepared.manifest);
    const foreign = await attacker.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    const result = await createSharedBillFromSubmission({
      bodyText: JSON.stringify({
        manifest: prepared.manifest,
        debts: prepared.debts,
        signature: foreign,
      }),
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "INVALID_SIGNATURE",
    });
    expect(repository.calls).toBe(0);
    expect(repository.bills.size).toBe(0);
  });

  it("taahhut uyusmazsa depoya HIC gidilmez", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare();
    const tampered = prepared.debts.map((debt, index) =>
      index === 0 ? { ...debt, tryMinor: "999999" } : debt,
    );

    const result = await createSharedBillFromSubmission({
      bodyText: JSON.stringify({
        manifest: prepared.manifest,
        debts: tampered,
        signature: prepared.signature,
      }),
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });

    expect(result).toMatchObject({ ok: false, status: 400 });
    if (result.ok) return;
    expect(result.code).toBe("INVALID_SHARED_BILL");
    expect(repository.calls).toBe(0);
  });

  it("suresi dolmus manifest reddedilir", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare();
    // Bitis aninin cok sonrasinda gonderilir.
    const later = (prepared.manifest.expiresAt + 60) * 1000;

    const result = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: later,
          createdByUserId: null,
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(repository.calls).toBe(0);
  });

  it("henuz gecerli olmayan manifest reddedilir", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare();
    // Cok daha erken bir saatte gonderilir (saat kaymasi toleransinin otesi).
    const earlier = NOW - 60 * 60 * 1000;

    const result = await createSharedBillFromSubmission({
      bodyText: prepared.body,
      repository,
      nowMs: earlier,
          createdByUserId: null,
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(repository.calls).toBe(0);
  });
});

describe("govde bicimi", () => {
  it("bozuk JSON reddedilir", async () => {
    const repository = createFakeSharedBillRepository();
    for (const bad of ["{", "", "abc", "{'a':1}"]) {
      const result = await createSharedBillFromSubmission({
        bodyText: bad,
        repository,
        nowMs: NOW,
              createdByUserId: null,
      });
      expect(result, JSON.stringify(bad)).toMatchObject({
        ok: false,
        status: 400,
        code: "MALFORMED_JSON",
      });
    }
    expect(repository.calls).toBe(0);
  });

  it("YINELENEN JSON anahtari reddedilir", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare();
    // Ayni anahtar iki kez: JSON.parse sessizce sonuncuyu alirdi.
    const duplicated = `{"manifest":${JSON.stringify(
      prepared.manifest,
    )},"debts":${JSON.stringify(prepared.debts)},"signature":"${
      prepared.signature
    }","signature":"0x${"00".repeat(65)}"}`;

    const result = await createSharedBillFromSubmission({
      bodyText: duplicated,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "DUPLICATE_FIELD",
    });
    expect(repository.calls).toBe(0);
  });

  it("ic ice yinelenen anahtar da reddedilir", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare();
    const manifestJson = JSON.stringify(prepared.manifest);
    const tampered = `${manifestJson.slice(0, -1)},"billId":"${BILL_ID}"}`;
    const body = `{"manifest":${tampered},"debts":${JSON.stringify(
      prepared.debts,
    )},"signature":"${prepared.signature}"}`;

    const result = await createSharedBillFromSubmission({
      bodyText: body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });
    expect(result).toMatchObject({ ok: false, code: "DUPLICATE_FIELD" });
  });

  it("beklenmeyen zarf alani reddedilir", async () => {
    const repository = createFakeSharedBillRepository();
    const prepared = await prepare();
    const body = JSON.stringify({
      manifest: prepared.manifest,
      debts: prepared.debts,
      signature: prepared.signature,
      fazladan: 1,
    });

    const result = await createSharedBillFromSubmission({
      bodyText: body,
      repository,
      nowMs: NOW,
          createdByUserId: null,
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_SHARED_BILL" });
    expect(repository.calls).toBe(0);
  });
});
