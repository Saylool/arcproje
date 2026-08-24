import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import {
  buildSharedBillAccessTypedData,
  type SharedBillAccessChallenge,
} from "@/lib/arc/shared-bill-access";
import {
  buildSharedBillTypedData,
  createSharedBill,
  verifySharedBillDebtInclusion,
} from "@/lib/arc/shared-bill";

import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";
import {
  SHARED_BILL_SESSION_LIFETIME_MS,
  issueAccessChallenge,
  readAccessConfig,
  readAuthenticatedDebtView,
  resolveSharedBillAccess,
} from "./shared-bill-access-service";
import { hashSessionToken, readAppOrigin } from "./shared-bill-auth";

/**
 * Borclu erisiminin is mantigi.
 *
 * Gercek Neon KULLANILMAZ. Imzalar test icinde uretilen rastgele anahtarlarla
 * atilir; hicbir islem gonderilmez ve hicbir gercek cuzdan cagrilmaz.
 */

const CHAIN = ACTIVE_NETWORK_PROFILE.chainId;
const NOW = 1_700_000_000_000;
const BILL_ID = `0x${"7a".repeat(32)}`;
const AUDIENCE = "https://ornek.test";
const CONFIG = { secret: "a".repeat(48), audience: AUDIENCE } as const;

type Wallet = ReturnType<typeof privateKeyToAccount>;

/** Uc borclulu bir hesap kurar ve depoya yazar. */
async function seedBill(repository: ReturnType<typeof createFakeSharedBillRepository>) {
  const recipient = privateKeyToAccount(generatePrivateKey());
  const debtors: Wallet[] = [
    privateKeyToAccount(generatePrivateKey()),
    privateKeyToAccount(generatePrivateKey()),
    privateKeyToAccount(generatePrivateKey()),
  ];

  const created = createSharedBill({
    recipient: recipient.address,
    recipientLabel: "Poyraz",
    debts: debtors.map((wallet, index) => ({
      debtor: wallet.address,
      debtorLabel: `Kisi${index}`,
      debtKey: `k${index}->p`,
      tryMinor: String(1000 + index),
    })),
    nowMs: NOW,
    billId: BILL_ID,
  });
  if (!created.ok) throw new Error(`hesap uretilemedi: ${created.problem}`);

  const typed = buildSharedBillTypedData(created.manifest);
  const signature = await recipient.signTypedData({
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
  });

  const stored = await repository.createSharedBill({
    manifest: created.manifest,
    debts: created.debts,
    signature,
  });
  if (!stored.ok) throw new Error("depoya yazilamadi");

  return { recipient, debtors, manifest: created.manifest, debts: created.debts };
}

async function signChallenge(
  wallet: Wallet,
  challenge: SharedBillAccessChallenge,
): Promise<string> {
  const typed = buildSharedBillAccessTypedData(challenge);
  return wallet.signTypedData({
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
  });
}

function issued(debtor: string, nonce?: string) {
  const result = issueAccessChallenge({
    billId: BILL_ID,
    debtor,
    nowMs: NOW,
    config: CONFIG,
    nonce,
  });
  if (!result.ok) throw new Error("meydan okuma uretilemedi");
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("meydan okuma uretimi UYELIK SIZDIRMAZ", () => {
  it("hesap VAR OLMASA bile meydan okuma uretilir ve depoya dokunulmaz", () => {
    const repository = createFakeSharedBillRepository();
    const result = issueAccessChallenge({
      billId: `0x${"ff".repeat(32)}`,
      debtor: "0x0000000000000000000000000000000000000aBc",
      nowMs: NOW,
      config: CONFIG,
    });
    expect(result.ok).toBe(true);
    expect(repository.calls).toBe(0);
  });

  it("hedef SUNUCU yapilandirmasindan gelir", () => {
    const result = issued("0x0000000000000000000000000000000000000aBc");
    expect(result.challenge.audience).toBe(AUDIENCE);
    expect(result.challenge.chainId).toBe(CHAIN);
    expect(result.tag).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("bozuk kimlik ve adres reddedilir", () => {
    expect(
      issueAccessChallenge({ billId: "0xkisa", debtor: "0x0000000000000000000000000000000000000aBc", nowMs: NOW, config: CONFIG }).ok,
    ).toBe(false);
    expect(
      issueAccessChallenge({ billId: BILL_ID, debtor: "0x1", nowMs: NOW, config: CONFIG }).ok,
    ).toBe(false);
  });
});

describe("cozumleme (resolve)", () => {
  it("dogru imzayla oturum kurulur ve HAM jeton depoya YAZILMAZ", async () => {
    const repository = createFakeSharedBillRepository();
    const seeded = await seedBill(repository);
    const debtor = seeded.debtors[0];
    const challenge = issued(debtor.address);
    const signature = await signChallenge(debtor, challenge.challenge);

    const result = await resolveSharedBillAccess({
      bodyText: JSON.stringify({
        challenge: challenge.challenge,
        tag: challenge.tag,
        signature,
      }),
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
      config: CONFIG,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionExpiresAtMs).toBe(NOW + SHARED_BILL_SESSION_LIFETIME_MS);

    // Depoda YALNIZCA ozet vardir; ham jeton hicbir yerde saklanmaz.
    const stored = [...repository.sessions.keys()];
    expect(stored).toEqual([hashSessionToken(result.sessionToken)]);
    expect(stored[0]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(stored[0]).not.toBe(result.sessionToken);
    expect(JSON.stringify([...repository.sessions.values()])).not.toContain(
      result.sessionToken,
    );
  });

  it("NONCE TEKRARI atomik olarak reddedilir", async () => {
    const repository = createFakeSharedBillRepository();
    const seeded = await seedBill(repository);
    const debtor = seeded.debtors[0];
    const challenge = issued(debtor.address);
    const signature = await signChallenge(debtor, challenge.challenge);
    const body = JSON.stringify({
      challenge: challenge.challenge,
      tag: challenge.tag,
      signature,
    });

    const first = await resolveSharedBillAccess({
      bodyText: body,
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
      config: CONFIG,
    });
    const second = await resolveSharedBillAccess({
      bodyText: body,
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
      config: CONFIG,
    });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, code: "CHALLENGE_ALREADY_USED" });
    expect(repository.sessions.size).toBe(1);
  });

  it("ESZAMANLI cozumlemede EN FAZLA BIRI basarili olur", async () => {
    const repository = createFakeSharedBillRepository();
    const seeded = await seedBill(repository);
    const debtor = seeded.debtors[1];
    const challenge = issued(debtor.address);
    const signature = await signChallenge(debtor, challenge.challenge);
    const body = JSON.stringify({
      challenge: challenge.challenge,
      tag: challenge.tag,
      signature,
    });

    const attempts = await Promise.all(
      [0, 1, 2, 3].map(() =>
        resolveSharedBillAccess({
          bodyText: body,
          pathBillId: BILL_ID,
          repository,
          nowMs: NOW,
          config: CONFIG,
        }),
      ),
    );
    expect(attempts.filter((attempt) => attempt.ok)).toHaveLength(1);
    expect(repository.sessions.size).toBe(1);
  });

  it("KURCALANMIS etiket reddedilir", async () => {
    const repository = createFakeSharedBillRepository();
    const seeded = await seedBill(repository);
    const debtor = seeded.debtors[0];
    const challenge = issued(debtor.address);
    const signature = await signChallenge(debtor, challenge.challenge);

    for (const tag of [
      `0x${"00".repeat(32)}`,
      // Son karakter HER ZAMAN degisir: etiket "0" ile bitiyorsa "1" yazilir.
      // Sabit "0" yazmak, etiket zaten "0" ile bitiyorsa (16'da 1 olasilik)
      // hic kurcalamaz; o zaman gecerli etiket dogru sekilde KABUL edilir ve
      // test sebepsiz duserdi.
      challenge.tag.replace(/.$/, (last) => (last === "0" ? "1" : "0")),
      "0xkisa",
      "",
    ]) {
      const result = await resolveSharedBillAccess({
        bodyText: JSON.stringify({ challenge: challenge.challenge, tag, signature }),
        pathBillId: BILL_ID,
        repository,
        nowMs: NOW,
        config: CONFIG,
      });
      expect(result.ok, tag).toBe(false);
    }
    expect(repository.sessions.size).toBe(0);
  });

  it("meydan okuma KURCALANIRSA etiket tutmaz", async () => {
    const repository = createFakeSharedBillRepository();
    const seeded = await seedBill(repository);
    const debtor = seeded.debtors[0];
    const challenge = issued(debtor.address);
    const signature = await signChallenge(debtor, challenge.challenge);

    // Tutar/adres degil, meydan okumanin kendi alanlari degistirilir.
    const tampered = {
      ...challenge.challenge,
      expiresAt: challenge.challenge.expiresAt + 60,
    };
    const result = await resolveSharedBillAccess({
      bodyText: JSON.stringify({
        challenge: tampered,
        tag: challenge.tag,
        signature,
      }),
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
      config: CONFIG,
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_CHALLENGE" });
  });

  it("IMZALAYAN UYUSMAZLIGI reddedilir", async () => {
    const repository = createFakeSharedBillRepository();
    const seeded = await seedBill(repository);
    const challenge = issued(seeded.debtors[0].address);
    // Baska bir cuzdan imzalar.
    const signature = await signChallenge(seeded.debtors[1], challenge.challenge);

    const result = await resolveSharedBillAccess({
      bodyText: JSON.stringify({
        challenge: challenge.challenge,
        tag: challenge.tag,
        signature,
      }),
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
      config: CONFIG,
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_SIGNATURE" });
    expect(repository.sessions.size).toBe(0);
  });

  it("YOLDAKI hesap kimligi imzalanandan farkliysa reddedilir", async () => {
    const repository = createFakeSharedBillRepository();
    const seeded = await seedBill(repository);
    const debtor = seeded.debtors[0];
    const challenge = issued(debtor.address);
    const signature = await signChallenge(debtor, challenge.challenge);

    const result = await resolveSharedBillAccess({
      bodyText: JSON.stringify({
        challenge: challenge.challenge,
        tag: challenge.tag,
        signature,
      }),
      pathBillId: `0x${"5b".repeat(32)}`,
      repository,
      nowMs: NOW,
      config: CONFIG,
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_CHALLENGE" });
  });

  it("UYE OLMAYAN cuzdan GENEL hata alir (uyelik sizdirmaz)", async () => {
    const repository = createFakeSharedBillRepository();
    await seedBill(repository);
    const outsider = privateKeyToAccount(generatePrivateKey());
    const challenge = issued(outsider.address);
    const signature = await signChallenge(outsider, challenge.challenge);

    const result = await resolveSharedBillAccess({
      bodyText: JSON.stringify({
        challenge: challenge.challenge,
        tag: challenge.tag,
        signature,
      }),
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
      config: CONFIG,
    });
    expect(result).toMatchObject({ ok: false, status: 404, code: "NOT_AVAILABLE" });
    if (result.ok) return;
    // Mesaj hangi adresin uye oldugunu ima etmez.
    expect(result.message).not.toContain(outsider.address);
    expect(result.message.toLowerCase()).not.toContain("uye");
  });

  it("VAR OLMAYAN hesap AYNI genel hatayi verir", async () => {
    const repository = createFakeSharedBillRepository();
    const wallet = privateKeyToAccount(generatePrivateKey());
    const challenge = issued(wallet.address);
    const signature = await signChallenge(wallet, challenge.challenge);

    const result = await resolveSharedBillAccess({
      bodyText: JSON.stringify({
        challenge: challenge.challenge,
        tag: challenge.tag,
        signature,
      }),
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
      config: CONFIG,
    });
    expect(result).toMatchObject({ ok: false, status: 404, code: "NOT_AVAILABLE" });
  });

  it("SURESI DOLMUS hesap genel hata verir", async () => {
    const repository = createFakeSharedBillRepository();
    const seeded = await seedBill(repository);
    const debtor = seeded.debtors[0];
    const later = (seeded.manifest.expiresAt + 60) * 1000;
    const challenge = issueAccessChallenge({
      billId: BILL_ID,
      debtor: debtor.address,
      nowMs: later,
      config: CONFIG,
    });
    if (!challenge.ok) return;
    const signature = await signChallenge(debtor, challenge.challenge);

    const result = await resolveSharedBillAccess({
      bodyText: JSON.stringify({
        challenge: challenge.challenge,
        tag: challenge.tag,
        signature,
      }),
      pathBillId: BILL_ID,
      repository,
      nowMs: later,
      config: CONFIG,
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("veritabani erisilemezse kontrollu 503 doner", async () => {
    const repository = createFakeSharedBillRepository();
    const seeded = await seedBill(repository);
    const debtor = seeded.debtors[0];
    const challenge = issued(debtor.address);
    const signature = await signChallenge(debtor, challenge.challenge);
    repository.controls.failWithUnavailable = true;

    const result = await resolveSharedBillAccess({
      bodyText: JSON.stringify({
        challenge: challenge.challenge,
        tag: challenge.tag,
        signature,
      }),
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
      config: CONFIG,
    });
    expect(result).toMatchObject({ ok: false, status: 503 });
    if (result.ok) return;
    for (const leak of ["postgres", "neon", "DATABASE_URL", "23505"]) {
      expect(result.message.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it("bozuk ve YINELENEN anahtarli govde reddedilir", async () => {
    const repository = createFakeSharedBillRepository();
    await seedBill(repository);
    for (const bad of ["{", "", "abc"]) {
      expect(
        await resolveSharedBillAccess({
          bodyText: bad,
          pathBillId: BILL_ID,
          repository,
          nowMs: NOW,
          config: CONFIG,
        }),
      ).toMatchObject({ ok: false, code: "MALFORMED_JSON" });
    }
    expect(
      await resolveSharedBillAccess({
        bodyText: '{"challenge":{},"tag":"0x1","tag":"0x2","signature":"0x3"}',
        pathBillId: BILL_ID,
        repository,
        nowMs: NOW,
        config: CONFIG,
      }),
    ).toMatchObject({ ok: false, code: "DUPLICATE_FIELD" });
  });

  it("hicbir sey LOGLANMAZ", async () => {
    const repository = createFakeSharedBillRepository();
    const seeded = await seedBill(repository);
    const debtor = seeded.debtors[0];
    const challenge = issued(debtor.address);
    const signature = await signChallenge(debtor, challenge.challenge);
    const spies = {
      log: vi.spyOn(console, "log").mockImplementation(() => undefined),
      info: vi.spyOn(console, "info").mockImplementation(() => undefined),
      warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
      error: vi.spyOn(console, "error").mockImplementation(() => undefined),
      debug: vi.spyOn(console, "debug").mockImplementation(() => undefined),
    };

    await resolveSharedBillAccess({
      bodyText: JSON.stringify({
        challenge: challenge.challenge,
        tag: challenge.tag,
        signature,
      }),
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
      config: CONFIG,
    });
    for (const [name, spy] of Object.entries(spies)) {
      expect(spy, name).not.toHaveBeenCalled();
    }
  });
});

describe("/me — YALNIZCA kendi satiri", () => {
  async function authenticated() {
    const repository = createFakeSharedBillRepository();
    const seeded = await seedBill(repository);
    const debtor = seeded.debtors[1];
    const challenge = issued(debtor.address);
    const signature = await signChallenge(debtor, challenge.challenge);
    const resolved = await resolveSharedBillAccess({
      bodyText: JSON.stringify({
        challenge: challenge.challenge,
        tag: challenge.tag,
        signature,
      }),
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
      config: CONFIG,
    });
    if (!resolved.ok) throw new Error("cozumlenemedi");
    return { repository, seeded, debtor, token: resolved.sessionToken };
  }

  it("yalnizca kimligi dogrulanmis satir ve kaniti doner", async () => {
    const { repository, seeded, debtor, token } = await authenticated();
    const view = await readAuthenticatedDebtView({
      sessionToken: token,
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
    });
    expect(view.ok).toBe(true);
    if (!view.ok) return;

    expect(view.debt.debtor.toLowerCase()).toBe(debtor.address.toLowerCase());
    expect(view.recipient.address).toBe(seeded.manifest.recipient);

    // Kanit gercekten imzalanan koke gotururur.
    expect(
      verifySharedBillDebtInclusion({
        manifest: seeded.manifest,
        debt: view.debt,
        proof: view.proof,
      }),
    ).toEqual({ ok: true });
  });

  it("yanit DIGER borclularin hicbir verisini TASIMAZ", async () => {
    const { repository, seeded, debtor, token } = await authenticated();
    const view = await readAuthenticatedDebtView({
      sessionToken: token,
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
    });
    if (!view.ok) return;
    const serialized = JSON.stringify(view);

    for (const other of seeded.debts) {
      if (other.debtor.toLowerCase() === debtor.address.toLowerCase()) continue;
      expect(serialized).not.toContain(other.debtor);
      expect(serialized).not.toContain(other.debtorLabel);
      expect(serialized).not.toContain(other.debtKey);
      expect(serialized).not.toContain(other.tryMinor);
    }
    // Ham oturum jetonu da yanitta yer almaz.
    expect(serialized).not.toContain(token);
  });

  it("oturum YOKSA hicbir hesap verisi verilmez", async () => {
    const { repository } = await authenticated();
    for (const token of [null, "", "uydurma-jeton"]) {
      const view = await readAuthenticatedDebtView({
        sessionToken: token,
        pathBillId: BILL_ID,
        repository,
        nowMs: NOW,
      });
      expect(view.ok, String(token)).toBe(false);
    }
  });

  it("BASKA bir hesap icin ayni oturum kullanilamaz", async () => {
    const { repository, token } = await authenticated();
    const view = await readAuthenticatedDebtView({
      sessionToken: token,
      pathBillId: `0x${"5b".repeat(32)}`,
      repository,
      nowMs: NOW,
    });
    expect(view).toMatchObject({ ok: false, status: 401 });
  });

  it("SURESI DOLMUS oturum reddedilir", async () => {
    const { repository, token } = await authenticated();
    const view = await readAuthenticatedDebtView({
      sessionToken: token,
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW + SHARED_BILL_SESSION_LIFETIME_MS + 1000,
    });
    expect(view).toMatchObject({ ok: false, status: 401 });
  });

  it("SURESI DOLMUS hesapta genel hata doner", async () => {
    const { repository, seeded, token } = await authenticated();
    const view = await readAuthenticatedDebtView({
      sessionToken: token,
      pathBillId: BILL_ID,
      repository,
      nowMs: (seeded.manifest.expiresAt + 60) * 1000,
    });
    expect(view).toMatchObject({ ok: false });
  });

  it("veritabani erisilemezse 503 doner", async () => {
    const { repository, token } = await authenticated();
    repository.controls.failWithUnavailable = true;
    const view = await readAuthenticatedDebtView({
      sessionToken: token,
      pathBillId: BILL_ID,
      repository,
      nowMs: NOW,
    });
    expect(view).toMatchObject({ ok: false, status: 503 });
  });
});

describe("sunucu yapilandirmasi FAIL-CLOSED", () => {
  it("uretimde eksik APP_ORIGIN reddedilir", () => {
    expect(readAppOrigin({}, "production")).toEqual({
      ok: false,
      problem: "missing",
    });
    expect(
      readAccessConfig({ SHARED_BILL_AUTH_SECRET: "a".repeat(48) }, "production").ok,
    ).toBe(false);
  });

  it("uretimde duz HTTP ve yol tasiyan origin reddedilir", () => {
    for (const origin of [
      "http://ornek.test",
      "https://ornek.test/yol",
      "https://ornek.test/?a=1",
      "degil",
    ]) {
      expect(readAppOrigin({ APP_ORIGIN: origin }, "production").ok, origin).toBe(
        false,
      );
    }
  });

  it("gelistirmede ACIK localhost yedegi kullanilir", () => {
    const result = readAppOrigin({}, "development");
    expect(result).toEqual({ ok: true, origin: "http://localhost:3000" });
  });

  it("eksik veya kisa sir reddedilir", () => {
    expect(readAccessConfig({ APP_ORIGIN: AUDIENCE }, "production").ok).toBe(false);
    expect(
      readAccessConfig(
        { APP_ORIGIN: AUDIENCE, SHARED_BILL_AUTH_SECRET: "kisa" },
        "production",
      ).ok,
    ).toBe(false);
  });

  it("KUR sirri erisim sirri olarak KULLANILAMAZ", () => {
    // RATE_QUOTE_SECRET tanimli olsa bile erisim yapilandirmasi acilmaz.
    expect(
      readAccessConfig(
        { APP_ORIGIN: AUDIENCE, RATE_QUOTE_SECRET: "b".repeat(48) },
        "production",
      ).ok,
    ).toBe(false);
  });
});
