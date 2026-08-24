import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ACTIVE_NETWORK_PROFILE } from "./profile";
import {
  PAYMENT_REQUEST_DOMAIN_NAME,
  PAYMENT_REQUEST_DOMAIN_VERSION,
} from "./payment-request";
import {
  SHARED_BILL_DOMAIN_NAME,
  SHARED_BILL_DOMAIN_VERSION,
} from "./shared-bill";
import {
  MAX_AUDIENCE_LENGTH,
  SHARED_BILL_ACCESS_DOMAIN_NAME,
  SHARED_BILL_ACCESS_DOMAIN_VERSION,
  SHARED_BILL_ACCESS_MAX_LIFETIME_MS,
  SHARED_BILL_ACCESS_TYPES,
  SHARED_BILL_ACCESS_VERSION,
  buildSharedBillAccessTypedData,
  describeAccessChallengeProblem,
  toSharedBillAccessEip712Json,
  validateSharedBillAccessChallenge,
  verifySharedBillAccessSignature,
  type SharedBillAccessChallenge,
} from "./shared-bill-access";

/**
 * Borclu erisim meydan okumasi.
 *
 * Imzalar test icinde uretilen RASTGELE anahtarlarla atilir; hicbir gercek
 * cuzdan cagrilmaz ve hicbir islem gonderilmez.
 */

const CHAIN = ACTIVE_NETWORK_PROFILE.chainId;
const NOW = 1_700_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);
const BILL_ID = `0x${"7a".repeat(32)}`;
const NONCE = `0x${"3c".repeat(32)}`;
const AUDIENCE = "https://ornek.test";
const DEBTOR = "0x0000000000000000000000000000000000000aBc";

function challengeOf(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    authVersion: SHARED_BILL_ACCESS_VERSION,
    billId: BILL_ID,
    chainId: CHAIN,
    debtor: DEBTOR,
    nonce: NONCE,
    audience: AUDIENCE,
    issuedAt: NOW_SECONDS,
    expiresAt: NOW_SECONDS + 300,
    ...over,
  };
}

function canonicalChallenge(debtor: string): SharedBillAccessChallenge {
  const result = validateSharedBillAccessChallenge(
    challengeOf({ debtor }),
    NOW,
    AUDIENCE,
  );
  if (!result.ok) throw new Error(`gecersiz: ${result.problem}`);
  return result.challenge;
}

async function signChallenge(
  account: ReturnType<typeof privateKeyToAccount>,
  challenge: SharedBillAccessChallenge,
): Promise<string> {
  const typedData = buildSharedBillAccessTypedData(challenge);
  return account.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
}

describe("meydan okuma dogrulamasi", () => {
  it("durust meydan okuma kabul edilir", () => {
    const result = validateSharedBillAccessChallenge(challengeOf(), NOW, AUDIENCE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenge.chainId).toBe(CHAIN);
    expect(result.challenge.audience).toBe(AUDIENCE);
  });

  it("YANLIS hedef (origin) reddedilir", () => {
    for (const audience of [
      "https://kotu.test",
      "http://ornek.test",
      "https://ornek.test.kotu.com",
      "",
    ]) {
      expect(
        validateSharedBillAccessChallenge(
          challengeOf({ audience }),
          NOW,
          AUDIENCE,
        ).ok,
        audience,
      ).toBe(false);
    }
  });

  it("asiri uzun hedef reddedilir", () => {
    const long = `https://${"a".repeat(MAX_AUDIENCE_LENGTH)}.test`;
    expect(
      validateSharedBillAccessChallenge(challengeOf({ audience: long }), NOW, long),
    ).toEqual({ ok: false, problem: "invalidAudience" });
  });

  it("YANLIS zincir reddedilir", () => {
    for (const chainId of [1, 11155111, CHAIN + 1]) {
      expect(
        validateSharedBillAccessChallenge(
          challengeOf({ chainId }),
          NOW,
          AUDIENCE,
        ),
        String(chainId),
      ).toEqual({ ok: false, problem: "invalidChainId" });
    }
  });

  it("bozuk hesap kimligi, adres ve nonce reddedilir", () => {
    expect(
      validateSharedBillAccessChallenge(challengeOf({ billId: "0xkisa" }), NOW, AUDIENCE),
    ).toEqual({ ok: false, problem: "invalidBillId" });
    expect(
      validateSharedBillAccessChallenge(challengeOf({ debtor: "0x1" }), NOW, AUDIENCE),
    ).toEqual({ ok: false, problem: "invalidDebtor" });
    expect(
      validateSharedBillAccessChallenge(challengeOf({ nonce: "0xkisa" }), NOW, AUDIENCE),
    ).toEqual({ ok: false, problem: "invalidNonce" });
  });

  it("SURESI DOLMUS ve GELECEKTEKI meydan okuma reddedilir", () => {
    expect(
      validateSharedBillAccessChallenge(
        // Omur sinirini asmadan gecmiste kalan bir pencere.
        challengeOf({ issuedAt: NOW_SECONDS - 400, expiresAt: NOW_SECONDS - 100 }),
        NOW,
        AUDIENCE,
      ),
    ).toEqual({ ok: false, problem: "expired" });

    expect(
      validateSharedBillAccessChallenge(
        challengeOf({ issuedAt: NOW_SECONDS + 600, expiresAt: NOW_SECONDS + 900 }),
        NOW,
        AUDIENCE,
      ),
    ).toEqual({ ok: false, problem: "notYetValid" });
  });

  it("omur BES DAKIKAYI asamaz", () => {
    const maxSeconds = SHARED_BILL_ACCESS_MAX_LIFETIME_MS / 1000;
    expect(
      validateSharedBillAccessChallenge(
        challengeOf({ expiresAt: NOW_SECONDS + maxSeconds }),
        NOW,
        AUDIENCE,
      ).ok,
    ).toBe(true);
    expect(
      validateSharedBillAccessChallenge(
        challengeOf({ expiresAt: NOW_SECONDS + maxSeconds + 1 }),
        NOW,
        AUDIENCE,
      ),
    ).toEqual({ ok: false, problem: "lifetimeTooLong" });
  });

  it("beklenmeyen ve eksik alan reddedilir", () => {
    expect(
      validateSharedBillAccessChallenge(
        { ...challengeOf(), fazladan: 1 },
        NOW,
        AUDIENCE,
      ),
    ).toEqual({ ok: false, problem: "unexpectedField" });

    const { nonce: _omitted, ...missing } = challengeOf();
    void _omitted;
    expect(
      validateSharedBillAccessChallenge(missing, NOW, AUDIENCE),
    ).toEqual({ ok: false, problem: "missingField" });
  });

  it("surum katidir", () => {
    for (const version of [0, 2, "1", null]) {
      expect(
        validateSharedBillAccessChallenge(
          challengeOf({ authVersion: version }),
          NOW,
          AUDIENCE,
        ).ok,
        String(version),
      ).toBe(false);
    }
  });

  it("her sorun icin bir aciklama vardir", () => {
    for (const problem of [
      "audienceMismatch",
      "expired",
      "invalidNonce",
      "invalidChainId",
    ] as const) {
      expect(describeAccessChallengeProblem(problem).length).toBeGreaterThan(0);
    }
  });
});

describe("imza dogrulamasi", () => {
  it("dogru cuzdanin imzasi kabul edilir", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const challenge = canonicalChallenge(account.address);
    const signature = await signChallenge(account, challenge);
    const verified = await verifySharedBillAccessSignature(challenge, signature);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.signer.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("IMZALAYAN UYUSMAZLIGI reddedilir", async () => {
    const debtor = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const challenge = canonicalChallenge(debtor.address);
    const signature = await signChallenge(attacker, challenge);
    expect(await verifySharedBillAccessSignature(challenge, signature)).toEqual({
      ok: false,
      reason: "signerMismatch",
    });
  });

  it("HER alanin mutasyonu imzayi bozar", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const challenge = canonicalChallenge(account.address);
    const signature = await signChallenge(account, challenge);

    const other = privateKeyToAccount(generatePrivateKey());
    const mutations: readonly [string, Partial<SharedBillAccessChallenge>][] = [
      ["billId", { billId: `0x${"5b".repeat(32)}` }],
      ["debtor", { debtor: other.address }],
      ["nonce", { nonce: `0x${"9d".repeat(32)}` }],
      ["audience", { audience: "https://kotu.test" }],
      ["issuedAt", { issuedAt: challenge.issuedAt + 1 }],
      ["expiresAt", { expiresAt: challenge.expiresAt + 1 }],
      ["chainId", { chainId: CHAIN + 1 }],
      ["authVersion", { authVersion: 2 }],
    ];
    for (const [label, mutation] of mutations) {
      const mutated = { ...challenge, ...mutation } as SharedBillAccessChallenge;
      expect(
        (await verifySharedBillAccessSignature(mutated, signature)).ok,
        label,
      ).toBe(false);
    }
  });

  it("bozuk imza bicimi kurtarmadan ONCE reddedilir", async () => {
    const challenge = canonicalChallenge(DEBTOR);
    for (const bad of ["", "0x", `0x${"11".repeat(64)}`]) {
      expect(
        await verifySharedBillAccessSignature(challenge, bad),
        bad,
      ).toEqual({ ok: false, reason: "format" });
    }
  });
});

describe("EIP-712 ALAN AYRIMI", () => {
  it("erisim alani, hesap ve odeme taleplerinden FARKLIDIR", () => {
    expect(SHARED_BILL_ACCESS_DOMAIN_NAME).not.toBe(SHARED_BILL_DOMAIN_NAME);
    expect(SHARED_BILL_ACCESS_DOMAIN_NAME).not.toBe(PAYMENT_REQUEST_DOMAIN_NAME);
    expect(buildSharedBillAccessTypedData(canonicalChallenge(DEBTOR)).primaryType)
      .toBe("SharedBillAccess");
  });

  it("erisim imzasi PAYLASILAN HESAP alaninda gecerli olamaz", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const challenge = canonicalChallenge(account.address);
    const typedData = buildSharedBillAccessTypedData(challenge);

    // Ayni mesaj, PAYLASILAN HESAP alaninda imzalanirsa erisim icin gecmez.
    const foreign = await account.signTypedData({
      domain: {
        name: SHARED_BILL_DOMAIN_NAME,
        version: SHARED_BILL_DOMAIN_VERSION,
        chainId: CHAIN,
      },
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    expect((await verifySharedBillAccessSignature(challenge, foreign)).ok).toBe(
      false,
    );
  });

  it("erisim imzasi ODEME TALEBI alaninda da gecerli olamaz", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const challenge = canonicalChallenge(account.address);
    const typedData = buildSharedBillAccessTypedData(challenge);

    const foreign = await account.signTypedData({
      domain: {
        name: PAYMENT_REQUEST_DOMAIN_NAME,
        version: PAYMENT_REQUEST_DOMAIN_VERSION,
        chainId: CHAIN,
      },
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    expect((await verifySharedBillAccessSignature(challenge, foreign)).ok).toBe(
      false,
    );
  });

  it("alan SURUMU de imzaya girer", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const challenge = canonicalChallenge(account.address);
    const typedData = buildSharedBillAccessTypedData(challenge);
    const foreign = await account.signTypedData({
      domain: {
        name: SHARED_BILL_ACCESS_DOMAIN_NAME,
        version: `${SHARED_BILL_ACCESS_DOMAIN_VERSION}9`,
        chainId: CHAIN,
      },
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    expect((await verifySharedBillAccessSignature(challenge, foreign)).ok).toBe(
      false,
    );
  });
});

describe("cuzdana gonderilen JSON", () => {
  it("alan listesi tip taniminan TURETILIR", () => {
    const json = JSON.parse(
      toSharedBillAccessEip712Json(canonicalChallenge(DEBTOR)),
    ) as {
      types: Record<string, { name: string; type: string }[]>;
      message: Record<string, unknown>;
      primaryType: string;
      domain: Record<string, unknown>;
    };
    expect(json.primaryType).toBe("SharedBillAccess");
    expect(json.types.SharedBillAccess).toEqual(
      SHARED_BILL_ACCESS_TYPES.SharedBillAccess.map((field) => ({
        name: field.name,
        type: field.type,
      })),
    );
    expect(Object.keys(json.message).sort()).toEqual(
      SHARED_BILL_ACCESS_TYPES.SharedBillAccess.map((f) => f.name).sort(),
    );
    expect(json.domain.name).toBe(SHARED_BILL_ACCESS_DOMAIN_NAME);
  });

  it("hicbir token onayi veya tutar ALANI tasimaz", () => {
    const json = toSharedBillAccessEip712Json(canonicalChallenge(DEBTOR));
    for (const forbidden of [
      "approve",
      "allowance",
      "value",
      "amount",
      "tryMinor",
      "microUsdc",
      "spender",
      "transfer",
    ]) {
      expect(json.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});
