import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  PAYMENT_REQUEST_DOMAIN_NAME,
  PAYMENT_REQUEST_DOMAIN_VERSION,
} from "./payment-request";
import { ACTIVE_NETWORK_PROFILE } from "./profile";
import {
  SHARED_BILL_DOMAIN_NAME,
  SHARED_BILL_DOMAIN_VERSION,
  SHARED_BILL_TYPES,
  buildSharedBillTypedData,
  canonicalizeSharedBillDebts,
  computeSharedBillRoot,
  createSharedBill,
  type SharedBillManifest,
} from "./shared-bill";
import {
  describeSharedBillSigningError,
  toSharedBillEip712Json,
  verifySharedBillSignature,
} from "./shared-bill-signing";

/**
 * Paylasilan hesap manifestinin EIP-712 imzasi.
 *
 * Imzalar test icinde uretilen RASTGELE anahtarlarla atilir; hicbir gercek
 * cuzdan cagrilmaz ve depoya hicbir gercek adres yazilmaz.
 *
 * Bu testler imzanin manifestin HER alanini kapsadigini kanitlar: bir alani
 * degistirmek dogrulamayi bozmalidir.
 */

const CHAIN = ACTIVE_NETWORK_PROFILE.chainId;
const NOW = 1_700_000_000_000;
const BILL_ID = `0x${"7a".repeat(32)}`;

const RECIPIENT = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const DEBTOR_A = "0x0000000000000000000000000000000000000aBc";
const DEBTOR_B = "0x00000000000000000000000000000000000000De";

function rawDebts() {
  return [
    { debtor: DEBTOR_A, debtorLabel: "Ada", debtKey: "a->p", tryMinor: "12345" },
    { debtor: DEBTOR_B, debtorLabel: "Bora", debtKey: "b->p", tryMinor: "6789" },
  ];
}

function billFor(recipient: string): SharedBillManifest {
  const created = createSharedBill({
    recipient,
    recipientLabel: "Poyraz",
    debts: rawDebts(),
    nowMs: NOW,
    billId: BILL_ID,
  });
  if (!created.ok) throw new Error(`hesap uretilemedi: ${created.problem}`);
  return created.manifest;
}

async function signWith(
  account: ReturnType<typeof privateKeyToAccount>,
  manifest: SharedBillManifest,
): Promise<string> {
  const typedData = buildSharedBillTypedData(manifest);
  return account.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
}

describe("dogru imza kabul edilir", () => {
  it("alicinin imzasi dogrulanir", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const manifest = billFor(account.address);
    const signature = await signWith(account, manifest);

    const verified = await verifySharedBillSignature(manifest, signature);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.signer.toLowerCase()).toBe(account.address.toLowerCase());
  });
});

describe("manifestin HER alani imza tarafindan kapsanir", () => {
  it("alan degisirse dogrulama BOZULUR", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const manifest = billFor(account.address);
    const signature = await signWith(account, manifest);

    const other = privateKeyToAccount(generatePrivateKey());
    const otherDebts = canonicalizeSharedBillDebts(
      [{ ...rawDebts()[0], tryMinor: "1" }],
      account.address,
    );
    expect(otherDebts.ok).toBe(true);
    if (!otherDebts.ok) return;

    const mutations: readonly [string, Partial<SharedBillManifest>][] = [
      ["recipient", { recipient: other.address }],
      ["recipientLabel", { recipientLabel: "Poyraz2" }],
      [
        "debtsRoot",
        {
          debtsRoot: computeSharedBillRoot({
            chainId: CHAIN,
            billId: BILL_ID,
            debts: otherDebts.debts,
          }),
        },
      ],
      ["debtCount", { debtCount: manifest.debtCount + 1 }],
      ["billId", { billId: `0x${"5b".repeat(32)}` }],
      ["issuedAt", { issuedAt: manifest.issuedAt + 1 }],
      ["expiresAt", { expiresAt: manifest.expiresAt + 1 }],
      ["chainId", { chainId: CHAIN + 1 }],
      ["schemaVersion", { schemaVersion: 3 }],
    ];

    for (const [label, mutation] of mutations) {
      const mutated = { ...manifest, ...mutation } as SharedBillManifest;
      const verified = await verifySharedBillSignature(mutated, signature);
      // Ya imzalayan baska cikar ya da kurtarma tumden basarisiz olur.
      expect(verified.ok, label).toBe(false);
    }
  });

  it("borc satiri degisirse taahhut ve dolayisiyla imza bozulur", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const manifest = billFor(account.address);
    const signature = await signWith(account, manifest);

    // Tek bir kurus degisikligi bile yeni bir taahhut uretir.
    const tampered = canonicalizeSharedBillDebts(
      [{ ...rawDebts()[0], tryMinor: "12346" }, rawDebts()[1]],
      account.address,
    );
    expect(tampered.ok).toBe(true);
    if (!tampered.ok) return;

    const mutated: SharedBillManifest = {
      ...manifest,
      debtsRoot: computeSharedBillRoot({
        chainId: CHAIN,
        billId: BILL_ID,
        debts: tampered.debts,
      }),
    };
    expect(mutated.debtsRoot).not.toBe(manifest.debtsRoot);
    expect((await verifySharedBillSignature(mutated, signature)).ok).toBe(false);
  });
});

describe("imzalayan alici DEGILSE reddedilir", () => {
  it("baskasinin imzasi kabul edilmez", async () => {
    const recipient = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const manifest = billFor(recipient.address);

    const signature = await signWith(attacker, manifest);
    expect(await verifySharedBillSignature(manifest, signature)).toEqual({
      ok: false,
      reason: "signerMismatch",
    });
  });
});

describe("bozuk imza bicimi", () => {
  it("bicim reddi kurtarma denemesinden ONCE gelir", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const manifest = billFor(account.address);
    for (const bad of ["", "0x", "0xzz", `0x${"11".repeat(64)}`]) {
      expect(await verifySharedBillSignature(manifest, bad), bad).toEqual({
        ok: false,
        reason: "format",
      });
    }
  });

  it("bicimi dogru ama kurtarilamayan imza reddedilir", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const manifest = billFor(account.address);
    const result = await verifySharedBillSignature(
      manifest,
      `0x${"00".repeat(65)}`,
    );
    expect(result.ok).toBe(false);
  });
});

describe("EIP-712 alan ayrimi", () => {
  it("odeme talebi alani ile paylasilan hesap alani FARKLIDIR", () => {
    expect(SHARED_BILL_DOMAIN_NAME).not.toBe(PAYMENT_REQUEST_DOMAIN_NAME);
    expect(buildSharedBillTypedData(billFor(RECIPIENT)).primaryType).toBe(
      "SharedBillManifest",
    );
  });

  it("ayni mesaj BASKA bir alanda imzalanirsa kabul edilmez", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const manifest = billFor(account.address);
    const typedData = buildSharedBillTypedData(manifest);

    // Yalnizca alan adi degistirilir; mesaj ve tipler aynidir.
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

    expect(await verifySharedBillSignature(manifest, foreign)).toEqual({
      ok: false,
      reason: "signerMismatch",
    });
  });

  it("alan surumu de imzaya girer", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const manifest = billFor(account.address);
    const typedData = buildSharedBillTypedData(manifest);

    const foreign = await account.signTypedData({
      domain: {
        name: SHARED_BILL_DOMAIN_NAME,
        version: `${SHARED_BILL_DOMAIN_VERSION}9`,
        chainId: CHAIN,
      },
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    expect((await verifySharedBillSignature(manifest, foreign)).ok).toBe(false);
  });
});

describe("cuzdana gonderilen JSON tek kaynaktan turetilir", () => {
  it("alan listesi ELLE yazilmaz: tip tanimiyla birebir ayni", () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const manifest = billFor(account.address);
    const json = JSON.parse(toSharedBillEip712Json(manifest)) as {
      domain: Record<string, unknown>;
      types: Record<string, { name: string; type: string }[]>;
      primaryType: string;
      message: Record<string, unknown>;
    };

    expect(json.primaryType).toBe("SharedBillManifest");
    expect(json.types.SharedBillManifest).toEqual(
      SHARED_BILL_TYPES.SharedBillManifest.map((field) => ({
        name: field.name,
        type: field.type,
      })),
    );
    // Mesaj tam olarak tip tanimindaki alanlari tasir; eksik/fazla yok.
    expect(Object.keys(json.message).sort()).toEqual(
      SHARED_BILL_TYPES.SharedBillManifest.map((field) => field.name).sort(),
    );
    expect(json.types.EIP712Domain).toBeDefined();
    expect(json.domain.name).toBe(SHARED_BILL_DOMAIN_NAME);
    expect(json.domain.chainId).toBe(CHAIN);
  });

  it("BigInt alanlar ondalik METIN olarak gonderilir", () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const manifest = billFor(account.address);
    const json = JSON.parse(toSharedBillEip712Json(manifest)) as {
      message: Record<string, unknown>;
    };
    expect(typeof json.message.chainId).toBe("string");
    expect(typeof json.message.issuedAt).toBe("string");
    expect(typeof json.message.expiresAt).toBe("string");
    expect(json.message.chainId).toBe(String(CHAIN));
  });

  it("JSON hicbir kur veya fis verisi tasimaz", () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const json = toSharedBillEip712Json(billFor(account.address));
    for (const forbidden of ["quote", "rate", "microUsdc", "receipt", "item"]) {
      expect(json.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});

describe("hata mesajlari", () => {
  it("her kod icin bir aciklama vardir", () => {
    for (const code of [
      "noProvider",
      "rejected",
      "accountChanged",
      "networkChanged",
      "invalidManifest",
      "signerMismatch",
    ] as const) {
      const message = describeSharedBillSigningError(code);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("undefined");
    }
  });

  it("imzanin transfer yetkisi VERMEDIGI mesajlarda ima edilmez", () => {
    // Kullaniciya "para cekilebilir" izlenimi verecek bir ifade olmamali.
    const message = describeSharedBillSigningError("invalidManifest");
    expect(message).toMatch(/c\u00fczdana hi\u00e7bir \u015fey g\u00f6nderilmedi/);
  });
});
