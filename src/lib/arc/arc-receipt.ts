import { keccak256, stringToBytes } from "viem";

import { normalizeWalletAddress, walletAddressesEqual } from "./address";
import { isValidTransactionHash } from "./network";
import { ACTIVE_NETWORK_PROFILE } from "./profile";

/**
 * ARC TESTNET MAKBUZ DOĞRULAYICISI — YALNIZCA SUNUCU.
 *
 * Bir ödeme, tarayıcı ya da App Kit "başarılı" dediği için ASLA ödenmiş
 * sayılmaz. Tek kabul edilebilir kanıt, SUNUCUNUN Arc Testnet'ten kendisi
 * okuduğu bir işlem makbuzudur.
 *
 * DOĞRULANANLAR — hepsi birden tutmak zorundadır:
 *  1. işlem hash'i katı biçimde geçerli,
 *  2. RPC ARC TESTNET'e bağlı (zincir kimliği birebir),
 *  3. makbuz VAR ve durumu başarılı,
 *  4. yeterli ONAY sayısı,
 *  5. kayıtlar TAM OLARAK Arc Testnet USDC ERC-20 sözleşmesinden,
 *  6. `Transfer(address,address,uint256)` olayı KATI biçimde çözümlenmiş,
 *  7. gönderen = kimliği doğrulanmış BORÇLU,
 *  8. alıcı = imzalı manifestteki ALICI,
 *  9. eşleşen TÜM transferlerin BigInt TOPLAMI, beklenen mikro USDC'ye
 *     BİREBİR eşit.
 *
 * "EN AZ BİR eşleşen olay" YETMEZ (9). Bir işlem birden çok Transfer
 * yayabilir; yalnızca birine bakmak, beklenenden AZ ya da FAZLA gönderilmiş
 * bir işlemi "ödendi" saydırırdı.
 *
 * RPC SINIRI ENJEKTE EDİLEBİLİRDİR: testler belirlenimci bir sahte verir ve
 * hiçbir zaman ağa çıkmaz.
 */

/** ERC-20 `Transfer(address,address,uint256)` olayının konu (topic) özeti. */
export const ERC20_TRANSFER_TOPIC = keccak256(
  stringToBytes("Transfer(address,address,uint256)"),
).toLowerCase();

/**
 * Gereken ASGARİ ONAY SAYISI.
 *
 * Bu Arc Testnet MVP'si için BİR onay kabul edilir: makbuz bir bloğa
 * girmiştir. SINIR AÇIKÇA SÖYLENİR — tek onay, derin bir yeniden düzenleme
 * (reorg) karşısında kesinlik DEĞİLDİR. Testnet'te test USDC'sinin gerçek
 * parasal değeri olmadığı için bu denge kabul edilmiştir; gerçek değer taşıyan
 * bir ağda bu sayı yükseltilmelidir.
 */
export const ARC_MIN_CONFIRMATIONS = 1;

/** 32 baytlık konunun son 20 baytı adrestir; üst 12 bayt SIFIR olmalıdır. */
const TOPIC_ADDRESS = /^0x000000000000000000000000([0-9a-fA-F]{40})$/;
/** `uint256` veri alanı TAM OLARAK 32 bayttır. */
const UINT256_DATA = /^0x[0-9a-fA-F]{64}$/;

/*
 * ---------------------------------------------------------------------------
 * ENJEKTE EDİLEBİLİR RPC SINIRI
 * ---------------------------------------------------------------------------
 */

/** Ham makbuz; şekli bilinmez ve KATI biçimde çözümlenir. */
export type ArcRpcClient = Readonly<{
  /** Bağlı zincirin kimliği. Arc Testnet değilse hiçbir şey doğrulanmaz. */
  getChainId(): Promise<number>;
  /** Makbuz henüz yoksa `null`. */
  getTransactionReceipt(txHash: string): Promise<unknown>;
  getBlockNumber(): Promise<bigint>;
}>;

export type ReceiptProblem =
  | "invalidHash"
  | "wrongChain"
  | "malformedReceipt"
  | "wrongToken"
  | "malformedLog"
  | "noMatchingTransfer"
  | "amountMismatch";

export type ReceiptVerification =
  /** Zincirde doğrulandı: tutar, taraflar ve onay sayısı tutuyor. */
  | { kind: "confirmed"; txHash: string; confirmations: number; blockNumber: string }
  /** Makbuz yok ya da onay yetersiz. Rezervasyon KİLİTLİ kalır. */
  | {
      kind: "pending";
      txHash: string;
      reason: "noReceipt" | "insufficientConfirmations";
      confirmations: number;
    }
  /** Zincire ulaştı ve BAŞARISIZ oldu. Borç ödenmemiş sayılır. */
  | { kind: "reverted"; txHash: string }
  /**
   * Makbuz başarılı ama BEKLENEN transferi kanıtlamıyor: yanlış token,
   * yanlış taraf, yanlış tutar veya bozuk kayıt. ASLA "ödendi" sayılmaz.
   */
  | { kind: "mismatch"; txHash: string; problem: ReceiptProblem }
  /** RPC'ye ulaşılamadı. Hiçbir sonuç iddia edilmez. */
  | { kind: "unavailable" };

export type VerifyReceiptInput = Readonly<{
  txHash: string;
  /** Kimliği doğrulanmış borçlu (gönderen). */
  debtor: string;
  /** İmzalı manifestteki alıcı. */
  recipient: string;
  /** Beklenen mikro USDC — KANONİK ondalık metin. */
  expectedMicroUsdc: string;
  client: ArcRpcClient;
  minConfirmations?: number;
}>;

/** Fırlatan getter'a karşı korumalı okuma. */
function read(target: unknown, key: string): unknown {
  if (typeof target !== "object" || target === null) {
    return undefined;
  }
  try {
    return (target as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function asBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value === "string" && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  return null;
}

export type DecodedTransfer = Readonly<{
  from: string;
  to: string;
  value: bigint;
}>;

/**
 * Tek bir kaydı KATI biçimde `Transfer` olayına çözümler.
 *
 * Katılık kasıtlıdır: konu sayısı tam üç olmalı, adres konularının üst 12
 * baytı SIFIR olmalı ve veri alanı tam 32 bayt olmalıdır. Gevşek bir
 * çözümleyici, doldurulmuş baytlara gizlenmiş farklı bir adresi kabul
 * edebilirdi.
 *
 * Kaydın hangi sözleşmeden geldiği BURADA denetlenmez; çağıran önce token
 * adresini süzer.
 */
export function decodeTransferLog(log: unknown): DecodedTransfer | null {
  const topics = read(log, "topics");
  if (!Array.isArray(topics) || topics.length !== 3) {
    return null;
  }
  const [signature, fromTopic, toTopic] = topics;
  if (
    typeof signature !== "string" ||
    signature.toLowerCase() !== ERC20_TRANSFER_TOPIC
  ) {
    return null;
  }
  if (typeof fromTopic !== "string" || typeof toTopic !== "string") {
    return null;
  }
  const fromMatch = TOPIC_ADDRESS.exec(fromTopic);
  const toMatch = TOPIC_ADDRESS.exec(toTopic);
  if (fromMatch === null || toMatch === null) {
    return null;
  }
  const from = normalizeWalletAddress(`0x${fromMatch[1]}`);
  const to = normalizeWalletAddress(`0x${toMatch[1]}`);
  if (from === null || to === null) {
    return null;
  }

  const data = read(log, "data");
  if (typeof data !== "string" || !UINT256_DATA.test(data)) {
    return null;
  }
  const value = asBigInt(data);
  if (value === null || value < BigInt(0)) {
    return null;
  }
  return Object.freeze({ from, to, value });
}

/**
 * Makbuzu Arc Testnet'e karşı doğrular.
 *
 * Bu fonksiyon ASLA fırlatmaz: RPC hatası `unavailable` olur ve hiçbir sonuç
 * iddia edilmez. Belirsizlik hiçbir koşulda "ödendi"ye çevrilmez.
 */
export async function verifyArcUsdcTransferReceipt(
  input: VerifyReceiptInput,
): Promise<ReceiptVerification> {
  const txHash = typeof input.txHash === "string" ? input.txHash.trim() : "";
  if (!isValidTransactionHash(txHash)) {
    return { kind: "mismatch", txHash: "", problem: "invalidHash" };
  }
  const normalizedHash = txHash.toLowerCase();

  const debtor = normalizeWalletAddress(input.debtor);
  const recipient = normalizeWalletAddress(input.recipient);
  const expected = /^(0|[1-9][0-9]*)$/.test(input.expectedMicroUsdc)
    ? BigInt(input.expectedMicroUsdc)
    : null;
  if (debtor === null || recipient === null || expected === null || expected <= BigInt(0)) {
    return { kind: "mismatch", txHash: normalizedHash, problem: "malformedReceipt" };
  }

  let chainId: number;
  let receipt: unknown;
  let head: bigint;
  try {
    // YALNIZCA ARC TESTNET. Başka bir zincire bağlı bir istemci reddedilir.
    chainId = await input.client.getChainId();
    if (chainId !== ACTIVE_NETWORK_PROFILE.chainId) {
      return { kind: "mismatch", txHash: normalizedHash, problem: "wrongChain" };
    }
    receipt = await input.client.getTransactionReceipt(normalizedHash);
    if (receipt === null || receipt === undefined) {
      return {
        kind: "pending",
        txHash: normalizedHash,
        reason: "noReceipt",
        confirmations: 0,
      };
    }
    head = await input.client.getBlockNumber();
  } catch {
    // RPC arızası bir sonuç DEĞİLDİR; kilit korunur.
    return { kind: "unavailable" };
  }

  // Makbuzun kendi hash'i istenen işlemi göstermelidir.
  const receiptHash = read(receipt, "transactionHash");
  if (
    typeof receiptHash !== "string" ||
    receiptHash.toLowerCase() !== normalizedHash
  ) {
    return { kind: "mismatch", txHash: normalizedHash, problem: "malformedReceipt" };
  }

  /*
   * BAŞARI ZORUNLU. viem `'success' | 'reverted'` döndürür; ham RPC 0x1/0x0
   * verebilir. TANINMAYAN her değer başarı sayılmaz.
   */
  const status = read(receipt, "status");
  const succeeded = status === "success" || status === "0x1" || status === 1;
  const failed = status === "reverted" || status === "0x0" || status === 0;
  if (failed) {
    return { kind: "reverted", txHash: normalizedHash };
  }
  if (!succeeded) {
    return { kind: "mismatch", txHash: normalizedHash, problem: "malformedReceipt" };
  }

  const blockNumber = asBigInt(read(receipt, "blockNumber"));
  if (blockNumber === null || head < blockNumber) {
    return { kind: "mismatch", txHash: normalizedHash, problem: "malformedReceipt" };
  }
  // İşlemin bloğu da bir onaydır: aynı blokta onay sayısı 1'dir.
  const confirmations = Number(head - blockNumber + BigInt(1));
  const required = input.minConfirmations ?? ARC_MIN_CONFIRMATIONS;
  if (confirmations < required) {
    return {
      kind: "pending",
      txHash: normalizedHash,
      reason: "insufficientConfirmations",
      confirmations,
    };
  }

  const logs = read(receipt, "logs");
  if (!Array.isArray(logs)) {
    return { kind: "mismatch", txHash: normalizedHash, problem: "malformedReceipt" };
  }

  /*
   * KAYITLAR YALNIZCA ARC TESTNET USDC ERC-20 SÖZLEŞMESİNDEN okunur. Başka
   * bir sözleşmenin yaydığı, aynı imzaya sahip bir olay ("sahte USDC")
   * hiçbir şey kanıtlamaz.
   */
  const token = ACTIVE_NETWORK_PROFILE.tokenErc20Address;
  let total = BigInt(0);
  let matched = 0;
  let sawToken = false;

  for (const log of logs) {
    const address = read(log, "address");
    if (typeof address !== "string" || !walletAddressesEqual(address, token)) {
      continue;
    }
    sawToken = true;
    const decoded = decodeTransferLog(log);
    if (decoded === null) {
      /*
       * Doğru sözleşmeden gelen ama çözümlenemeyen bir kayıt FAIL-CLOSED
       * reddedilir: içinde beklenmeyen bir transfer olabilir.
       */
      const topics = read(log, "topics");
      const isTransfer =
        Array.isArray(topics) &&
        typeof topics[0] === "string" &&
        topics[0].toLowerCase() === ERC20_TRANSFER_TOPIC;
      if (isTransfer) {
        return { kind: "mismatch", txHash: normalizedHash, problem: "malformedLog" };
      }
      continue;
    }
    // YÖN ZORUNLU: borçlu -> alıcı. Ters yön ya da üçüncü taraf sayılmaz.
    if (
      walletAddressesEqual(decoded.from, debtor) &&
      walletAddressesEqual(decoded.to, recipient)
    ) {
      // TOPLAM: BigInt. Tek bir olaya bakmak yetmez.
      total += decoded.value;
      matched += 1;
    }
  }

  if (matched === 0) {
    return {
      kind: "mismatch",
      txHash: normalizedHash,
      problem: sawToken ? "noMatchingTransfer" : "wrongToken",
    };
  }
  // BİREBİR EŞİTLİK. Eksik de fazla da kabul edilmez.
  if (total !== expected) {
    return { kind: "mismatch", txHash: normalizedHash, problem: "amountMismatch" };
  }

  return {
    kind: "confirmed",
    txHash: normalizedHash,
    confirmations,
    blockNumber: blockNumber.toString(),
  };
}
