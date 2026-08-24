import { describe, expect, it } from "vitest";

import {
  ARC_MIN_CONFIRMATIONS,
  ERC20_TRANSFER_TOPIC,
  decodeTransferLog,
  verifyArcUsdcTransferReceipt,
  type ArcRpcClient,
} from "./arc-receipt";
import { ACTIVE_NETWORK_PROFILE } from "./profile";

/**
 * ARC TESTNET MAKBUZ DOĞRULAMASI.
 *
 * RPC SINIRI ENJEKTE EDİLİR: hiçbir testte ağa çıkılmaz, gerçek bir işlem
 * hash'i kullanılmaz ve hiçbir cüzdan çağrılmaz. Adresler ve hash'ler
 * tamamen uydurmadır.
 */

const TOKEN = ACTIVE_NETWORK_PROFILE.tokenErc20Address;
const CHAIN = ACTIVE_NETWORK_PROFILE.chainId;

const DEBTOR = `0x${"11".repeat(20)}`;
const RECIPIENT = `0x${"22".repeat(20)}`;
const STRANGER = `0x${"33".repeat(20)}`;
const OTHER_TOKEN = `0x${"44".repeat(20)}`;
const TX_HASH = `0x${"ab".repeat(32)}`;

/** 32 baytlık konuya doldurulmuş adres. */
function topicOf(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

/** 32 baytlık `uint256` veri alanı. */
function dataOf(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function transferLog(input: {
  address?: string;
  from?: string;
  to?: string;
  value?: bigint;
  topics?: unknown;
  data?: unknown;
}) {
  return {
    address: input.address ?? TOKEN,
    topics: input.topics ?? [
      ERC20_TRANSFER_TOPIC,
      topicOf(input.from ?? DEBTOR),
      topicOf(input.to ?? RECIPIENT),
    ],
    data: input.data ?? dataOf(input.value ?? BigInt(1000)),
  };
}

function fakeClient(input: {
  chainId?: number;
  receipt?: unknown;
  head?: bigint;
  throwOn?: "chainId" | "receipt" | "head";
}): ArcRpcClient {
  return Object.freeze({
    async getChainId() {
      if (input.throwOn === "chainId") throw new Error("rpc");
      return input.chainId ?? CHAIN;
    },
    async getTransactionReceipt() {
      if (input.throwOn === "receipt") throw new Error("rpc");
      return input.receipt ?? null;
    },
    async getBlockNumber() {
      if (input.throwOn === "head") throw new Error("rpc");
      return input.head ?? BigInt(100);
    },
  });
}

function receiptOf(logs: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    transactionHash: TX_HASH,
    status: "success",
    blockNumber: BigInt(100),
    logs,
    ...overrides,
  };
}

function verify(input: {
  receipt?: unknown;
  expected?: string;
  chainId?: number;
  head?: bigint;
  throwOn?: "chainId" | "receipt" | "head";
  txHash?: string;
  debtor?: string;
  recipient?: string;
}) {
  return verifyArcUsdcTransferReceipt({
    txHash: input.txHash ?? TX_HASH,
    debtor: input.debtor ?? DEBTOR,
    recipient: input.recipient ?? RECIPIENT,
    expectedMicroUsdc: input.expected ?? "1000",
    client: fakeClient({
      chainId: input.chainId,
      receipt: input.receipt,
      head: input.head,
      throwOn: input.throwOn,
    }),
  });
}

describe("Transfer olayı KATI çözümlenir", () => {
  it("bilinen ERC-20 imzasını kullanır", () => {
    // keccak256("Transfer(address,address,uint256)")
    expect(ERC20_TRANSFER_TOPIC).toBe(
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    );
  });

  it("geçerli kaydı çözer", () => {
    const decoded = decodeTransferLog(transferLog({ value: BigInt(42) }));
    expect(decoded?.value).toBe(BigInt(42));
    expect(decoded?.from.toLowerCase()).toBe(DEBTOR.toLowerCase());
    expect(decoded?.to.toLowerCase()).toBe(RECIPIENT.toLowerCase());
  });

  it("bozuk kaydı reddeder", () => {
    const cases: unknown[] = [
      null,
      {},
      // Konu sayısı yanlış.
      transferLog({ topics: [ERC20_TRANSFER_TOPIC, topicOf(DEBTOR)] }),
      transferLog({
        topics: [ERC20_TRANSFER_TOPIC, topicOf(DEBTOR), topicOf(RECIPIENT), "0x0"],
      }),
      // Başka bir olay imzası.
      transferLog({ topics: [`0x${"ee".repeat(32)}`, topicOf(DEBTOR), topicOf(RECIPIENT)] }),
      // Adres konusunun ÜST 12 baytı sıfır değil: gizlenmiş adres.
      transferLog({
        topics: [
          ERC20_TRANSFER_TOPIC,
          `0x01${"0".repeat(22)}${DEBTOR.slice(2)}`,
          topicOf(RECIPIENT),
        ],
      }),
      // Veri alanı 32 bayt değil.
      transferLog({ data: "0x01" }),
      transferLog({ data: `0x${"0".repeat(66)}` }),
      transferLog({ data: 1000 }),
    ];
    for (const value of cases) {
      expect(decodeTransferLog(value)).toBeNull();
    }
  });
});

describe("makbuz doğrulaması", () => {
  it("TAM eşleşen tek transferi onaylar", async () => {
    const result = await verify({
      receipt: receiptOf([transferLog({ value: BigInt(1000) })]),
    });
    expect(result).toMatchObject({ kind: "confirmed", txHash: TX_HASH });
  });

  it("EŞLEŞEN BİRDEN ÇOK transferi TOPLAYARAK onaylar", async () => {
    const result = await verify({
      receipt: receiptOf([
        transferLog({ value: BigInt(600) }),
        transferLog({ value: BigInt(400) }),
      ]),
      expected: "1000",
    });
    expect(result.kind).toBe("confirmed");
  });

  it("toplam BEKLENENİ AŞARSA onaylamaz", async () => {
    const result = await verify({
      receipt: receiptOf([
        transferLog({ value: BigInt(600) }),
        transferLog({ value: BigInt(600) }),
      ]),
      expected: "1000",
    });
    // "EN AZ BİR eşleşen olay" yetmez; toplam BİREBİR olmalıdır.
    expect(result).toMatchObject({ kind: "mismatch", problem: "amountMismatch" });
  });

  it("toplam BEKLENENDEN AZSA onaylamaz", async () => {
    const result = await verify({
      receipt: receiptOf([transferLog({ value: BigInt(999) })]),
      expected: "1000",
    });
    expect(result).toMatchObject({ kind: "mismatch", problem: "amountMismatch" });
  });

  it("ilgisiz transferler toplama KATILMAZ", async () => {
    const result = await verify({
      receipt: receiptOf([
        transferLog({ value: BigInt(1000) }),
        // Üçüncü tarafa giden transfer sayılmaz.
        transferLog({ to: STRANGER, value: BigInt(500) }),
        // Ters yön sayılmaz.
        transferLog({ from: RECIPIENT, to: DEBTOR, value: BigInt(500) }),
      ]),
      expected: "1000",
    });
    expect(result.kind).toBe("confirmed");
  });

  it("YANLIŞ TOKEN sözleşmesinden gelen olay kanıt değildir", async () => {
    const result = await verify({
      receipt: receiptOf([
        transferLog({ address: OTHER_TOKEN, value: BigInt(1000) }),
      ]),
    });
    expect(result).toMatchObject({ kind: "mismatch", problem: "wrongToken" });
  });

  it("yanlış gönderen veya alıcı kabul edilmez", async () => {
    const wrongSender = await verify({
      receipt: receiptOf([transferLog({ from: STRANGER, value: BigInt(1000) })]),
    });
    expect(wrongSender).toMatchObject({
      kind: "mismatch",
      problem: "noMatchingTransfer",
    });

    const wrongRecipient = await verify({
      receipt: receiptOf([transferLog({ to: STRANGER, value: BigInt(1000) })]),
    });
    expect(wrongRecipient).toMatchObject({
      kind: "mismatch",
      problem: "noMatchingTransfer",
    });
  });

  it("doğru sözleşmeden gelen BOZUK Transfer kaydı FAIL-CLOSED reddedilir", async () => {
    const result = await verify({
      receipt: receiptOf([
        transferLog({ value: BigInt(1000) }),
        transferLog({ data: "0x01" }),
      ]),
    });
    expect(result).toMatchObject({ kind: "mismatch", problem: "malformedLog" });
  });

  it("REVERT eden makbuz ödendi sayılmaz", async () => {
    for (const status of ["reverted", "0x0", 0]) {
      const result = await verify({
        receipt: receiptOf([transferLog({ value: BigInt(1000) })], { status }),
      });
      expect(result).toMatchObject({ kind: "reverted", txHash: TX_HASH });
    }
  });

  it("tanınmayan durum başarı sayılmaz", async () => {
    const result = await verify({
      receipt: receiptOf([transferLog({ value: BigInt(1000) })], {
        status: "belki",
      }),
    });
    expect(result).toMatchObject({ kind: "mismatch" });
  });

  it("makbuz YOKSA beklemede döner", async () => {
    const result = await verify({ receipt: null });
    expect(result).toMatchObject({ kind: "pending", reason: "noReceipt" });
  });

  it("ONAY YETERSİZSE ödendi sayılmaz", async () => {
    const result = await verifyArcUsdcTransferReceipt({
      txHash: TX_HASH,
      debtor: DEBTOR,
      recipient: RECIPIENT,
      expectedMicroUsdc: "1000",
      client: fakeClient({
        receipt: receiptOf([transferLog({ value: BigInt(1000) })]),
        head: BigInt(100),
      }),
      minConfirmations: 5,
    });
    expect(result).toMatchObject({
      kind: "pending",
      reason: "insufficientConfirmations",
      confirmations: 1,
    });
  });

  it("bu MVP için TEK onay yeterlidir ve bu sınır açıkça tanımlıdır", async () => {
    expect(ARC_MIN_CONFIRMATIONS).toBe(1);
    const result = await verify({
      receipt: receiptOf([transferLog({ value: BigInt(1000) })]),
      head: BigInt(100),
    });
    expect(result).toMatchObject({ kind: "confirmed", confirmations: 1 });
  });

  it("BAŞKA BİR ZİNCİRE bağlı RPC hiçbir şey doğrulayamaz", async () => {
    const result = await verify({
      chainId: 11155111,
      receipt: receiptOf([transferLog({ value: BigInt(1000) })]),
    });
    expect(result).toMatchObject({ kind: "mismatch", problem: "wrongChain" });
  });

  it("makbuzun hash'i istenen işlemi göstermelidir", async () => {
    const result = await verify({
      receipt: receiptOf([transferLog({ value: BigInt(1000) })], {
        transactionHash: `0x${"cd".repeat(32)}`,
      }),
    });
    expect(result).toMatchObject({
      kind: "mismatch",
      problem: "malformedReceipt",
    });
  });

  it("geçersiz hash biçimi zincire HİÇ gitmez", async () => {
    for (const bad of ["", "0x", "abc", `0x${"ab".repeat(31)}`]) {
      const result = await verify({ txHash: bad });
      expect(result).toMatchObject({ kind: "mismatch", problem: "invalidHash" });
    }
  });

  it("RPC arızasında HİÇBİR sonuç iddia edilmez", async () => {
    for (const throwOn of ["chainId", "receipt", "head"] as const) {
      const result = await verify({
        throwOn,
        receipt: receiptOf([transferLog({ value: BigInt(1000) })]),
      });
      expect(result).toMatchObject({ kind: "unavailable" });
    }
  });

  it("bozuk makbuz alanları başarı sayılmaz", async () => {
    const noLogs = await verify({ receipt: receiptOf([], { logs: "yok" }) });
    expect(noLogs).toMatchObject({ kind: "mismatch" });

    const noBlock = await verify({
      receipt: receiptOf([transferLog({})], { blockNumber: "abc" }),
    });
    expect(noBlock).toMatchObject({ kind: "mismatch" });
  });
});
