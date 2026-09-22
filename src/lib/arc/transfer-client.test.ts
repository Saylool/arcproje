import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ARC_TESTNET_RPC_URL,
  ARC_TESTNET_RPC_URLS,
  ARC_USDC_ERC20_ADDRESS,
} from "./network";
import { ACTIVE_NETWORK_PROFILE } from "./profile";

/**
 * viem SEAM'İ.
 *
 * Gerçek bir zincire bağlanılmaz; viem taklit edilir ve seam'in ona NE
 * verdiği kanıtlanır. Yanlış bir ABI ya da yanlış bir sözleşme adresi,
 * doğrulamaların hepsi geçtikten sonra bile parayı yanlış yere gönderirdi.
 */

const simulateContract = vi.fn();
const estimateContractGas = vi.fn();
const estimateFeesPerGas = vi.fn();
const waitForTransactionReceipt = vi.fn();
const writeContract = vi.fn();
const publicConfig = vi.fn();
const walletConfig = vi.fn();
const httpArgs = vi.fn();

vi.mock("viem", () => ({
  createPublicClient: (config: unknown) => {
    publicConfig(config);
    return {
      simulateContract,
      estimateContractGas,
      estimateFeesPerGas,
      waitForTransactionReceipt,
    };
  },
  createWalletClient: (config: unknown) => {
    walletConfig(config);
    return { writeContract };
  },
  custom: (provider: unknown) => ({ kind: "custom", provider }),
  http: (url: string) => {
    httpArgs(url);
    return { kind: "http", url };
  },
  defineChain: (config: unknown) => config,
  formatUnits: (value: bigint, decimals: number) =>
    `${value}/1e${decimals}`,
}));

const { createArcTransferClient, ERC20_TRANSFER_ABI, RECEIPT_TIMEOUT_MS } =
  await import("./transfer-client");

const DEBTOR = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const RECIPIENT = "0x0000000000000000000000000000000000000aBc";
const TX_HASH = `0x${"ab".repeat(32)}`;
const provider = { request: vi.fn() };

const target = {
  debtorAddress: DEBTOR,
  recipientAddress: RECIPIENT,
  microUsdc: "5000000",
};

beforeEach(() => {
  for (const mock of [
    simulateContract,
    estimateContractGas,
    estimateFeesPerGas,
    waitForTransactionReceipt,
    writeContract,
    publicConfig,
    walletConfig,
    httpArgs,
  ]) {
    mock.mockReset();
  }
});

describe("ABI: yanlış imza parayı yanlış yere gönderirdi", () => {
  it("ERC-20 `transfer(address,uint256)` tam olarak budur", () => {
    const transfer = ERC20_TRANSFER_ABI.find((e) => e.name === "transfer");
    expect(transfer).toBeDefined();
    expect(transfer?.stateMutability).toBe("nonpayable");
    expect(transfer?.inputs.map((i) => i.type)).toEqual(["address", "uint256"]);
    expect(transfer?.outputs.map((o) => o.type)).toEqual(["bool"]);
  });
});

describe("istemci kurulumu", () => {
  it("zincir profilden gelir; tarayıcıya YALNIZCA birincil RPC verilir", async () => {
    await createArcTransferClient(provider, target);
    const chain = (publicConfig.mock.calls[0][0] as { chain: Record<string, unknown> })
      .chain;
    expect(chain.id).toBe(ACTIVE_NETWORK_PROFILE.chainId);
    expect(chain.rpcUrls).toEqual({ default: { http: [ARC_TESTNET_RPC_URL] } });

    /*
     * YEDEKLER SUNUCUYA AİTTİR. Tarayıcıya verilseydi CSP'nin `connect-src`
     * listesi ve gizlilik bildirimi sessizce genişlerdi.
     */
    expect(httpArgs).toHaveBeenCalledTimes(1);
    expect(httpArgs).toHaveBeenCalledWith(ARC_TESTNET_RPC_URL);
    for (const fallback of ARC_TESTNET_RPC_URLS.slice(1)) {
      expect(httpArgs).not.toHaveBeenCalledWith(fallback);
    }
  });

  it("imzalama cüzdanın KENDİ taşıyıcısından gider", async () => {
    await createArcTransferClient(provider, target);
    const config = walletConfig.mock.calls[0][0] as {
      account: string;
      transport: { kind: string; provider: unknown };
    };
    expect(config.account).toBe(DEBTOR);
    expect(config.transport.kind).toBe("custom");
    expect(config.transport.provider).toBe(provider);
  });
});

describe("çağrı: doğru sözleşme, doğru alıcı, doğru tam sayı", () => {
  it("simülasyon ve gönderim AYNI çağrıyı kullanır", async () => {
    const client = await createArcTransferClient(provider, target);
    writeContract.mockResolvedValue(TX_HASH);

    await client.simulate();
    await client.submit();

    for (const mock of [simulateContract, writeContract]) {
      const call = mock.mock.calls[0][0] as Record<string, unknown>;
      expect(call.address).toBe(ARC_USDC_ERC20_ADDRESS);
      expect(call.functionName).toBe("transfer");
      expect(call.account).toBe(DEBTOR);
      /* Tutar BigInt'tir: ondalık metin ya da sayı DEĞİL. */
      expect(call.args).toEqual([RECIPIENT, BigInt("5000000")]);
    }
  });

  it("gönderim hash'i DOĞRUDAN döner; hata grafiğinden kurtarılmaz", async () => {
    const client = await createArcTransferClient(provider, target);
    writeContract.mockResolvedValue(TX_HASH);
    expect(await client.submit()).toBe(TX_HASH);
  });
});

describe("makbuz: sonuç zincirin `status` alanıdır", () => {
  it("success -> success, reverted -> reverted", async () => {
    const client = await createArcTransferClient(provider, target);

    waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    expect(await client.waitForReceipt(TX_HASH)).toEqual({
      kind: "success",
      txHash: TX_HASH,
    });

    waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });
    expect(await client.waitForReceipt(TX_HASH)).toEqual({
      kind: "reverted",
      txHash: TX_HASH,
    });
  });

  it("tanınmayan bir durum ASLA başarı sayılmaz", async () => {
    const client = await createArcTransferClient(provider, target);
    waitForTransactionReceipt.mockResolvedValue({ status: "beklenmedik" });
    expect(await client.waitForReceipt(TX_HASH)).toEqual({
      kind: "reverted",
      txHash: TX_HASH,
    });
  });

  it("beklemeye süre tavanı verilir", async () => {
    const client = await createArcTransferClient(provider, target);
    waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    await client.waitForReceipt(TX_HASH);
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: TX_HASH,
      timeout: RECEIPT_TIMEOUT_MS,
    });
  });
});

describe("ücret tahmini", () => {
  it("gas ONDALIĞI native gas'ındır, transferin ALTI ondalığı DEĞİL", async () => {
    const client = await createArcTransferClient(provider, target);
    estimateContractGas.mockResolvedValue(BigInt(21000));
    estimateFeesPerGas.mockResolvedValue({ maxFeePerGas: BigInt(2) });
    const fee = await client.estimateFee();
    /* 21000 * 2 = 42000, 18 ondalıkla biçimlenir. */
    expect(fee).toBe(`42000/1e18 ${ACTIVE_NETWORK_PROFILE.nativeGasSymbol}`);
    expect(ACTIVE_NETWORK_PROFILE.nativeGasDecimals).toBe(18);
    expect(ACTIVE_NETWORK_PROFILE.tokenDecimals).toBe(6);
  });

  it("tahmin ÖLÜMCÜL değildir: hata null olur, gönderimi durdurmaz", async () => {
    const client = await createArcTransferClient(provider, target);
    estimateContractGas.mockRejectedValue(new Error("rpc down"));
    await expect(client.estimateFee()).resolves.toBeNull();
  });

  it("ücret birimi okunamazsa null döner, sıfır değil", async () => {
    const client = await createArcTransferClient(provider, target);
    estimateContractGas.mockResolvedValue(BigInt(21000));
    estimateFeesPerGas.mockResolvedValue({});
    await expect(client.estimateFee()).resolves.toBeNull();
  });
});

describe("App Kit geri sızmaz", () => {
  it("ne seam ne de gönderim sınırı Circle SDK'sını import eder", () => {
    for (const file of ["src/lib/arc/transfer-client.ts", "src/lib/arc/send.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from "@circle-fin\//);
      expect(source, file).not.toMatch(/import\("@circle-fin\//);
    }
  });

  it("package.json'da Circle SDK bağımlılığı YOKTUR", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
    };
    const circle = Object.keys(pkg.dependencies).filter((d) =>
      d.startsWith("@circle-fin/"),
    );
    /*
     * Bu bağımlılıklar `@solana/web3.js`'i DOĞRUDAN çekiyordu ve ölçüldü:
     * Solana + anchor + cctp kodu ödeme anında indirilen tembel bir chunk'ta
     * ~580 KB tutuyordu. Üretim denetimi 28 açıktan 4'e indi.
     */
    expect(circle).toEqual([]);
  });
});
