import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_URL,
  ARC_USDC_ERC20_ADDRESS,
} from "./network";
import { ACTIVE_NETWORK_PROFILE } from "./profile";

import type { Eip1193Provider } from "./wallet";

/**
 * ERC-20 TRANSFERİNİN viem SEAM'İ.
 *
 * `send.ts`'in zincire dokunan TEK yolu burasıdır; oradaki doğrulama,
 * preflight, süre ve belirsizlik mantığı değişmeden yerinde kalır. Katman
 * bilerek incedir: testler `@circle-fin/*` yerine bu modülü taklit eder.
 *
 * NEDEN App Kit DEĞİL. `@circle-fin/app-kit` ve `@circle-fin/adapter-viem-v2`
 * `@solana/web3.js`'i DOĞRUDAN bağımlılık olarak taşır ve giriş dosyasının en
 * üstünde `require` eder; alt yol import'u (`/chains`, `/bridge`) bunu
 * değiştirmez. Ölçüldü (2026-09-22, canlı paket): Solana + anchor + cctp kodu
 * tek bir tembel chunk'ta ~580 KB ve ödeme anında her borçlunun tarayıcısına
 * iniyordu. Üretim denetimindeki on yüksek açığın sekizi o ağaçtan geliyor.
 * Buradaki iş tek bir ERC-20 `transfer`; köprü, takas ve Solana yolu hiç
 * gerekmiyordu.
 *
 * ÜÇ ADIM, ÜÇÜ DE AYRI. Sınırın tamamı "işlem zincire düştü mü" sorusuna
 * dayanır, bu yüzden adımlar birleştirilmez:
 *
 *  1. `simulate()` — cüzdana DOKUNMAZ, işlem YAYINLAMAZ. Buradaki bir hata
 *     KANITLANABİLİR biçimde yayın öncesidir (yetersiz bakiye gibi).
 *  2. `submit()` — cüzdan istemini açar ve işlem hash'ini DÖNDÜRÜR. App Kit
 *     hash'i hata grafiğinin derinlerine gömüyordu; burada doğrudan elimize
 *     geçer, dolayısıyla belirsizlik penceresi yalnızca "çağrı fırlattı ve
 *     hash yok" hâline daralır.
 *  3. `waitForReceipt()` — makbuzu okur. `status` zincirin kendi cevabıdır;
 *     "başarılı" iddiası başka hiçbir şeyden türetilmez.
 */

/** Yalnızca ihtiyacımız olan iki giriş; tam ERC-20 ABI'si taşınmaz. */
export const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Makbuzun İKİ olası sonucu. Üçüncüsü yoktur; "bilinmiyor" burada üretilmez. */
export type ArcReceiptOutcome =
  | { kind: "success"; txHash: string }
  | { kind: "reverted"; txHash: string };

export type ArcTransferClient = Readonly<{
  /** Ücret tahmini. Başarısızlık ölümcül DEĞİLDİR: `null` döner. */
  estimateFee(): Promise<string | null>;
  /** Yayın ÖNCESİ deneme. Fırlatırsa hiçbir işlem gönderilmemiştir. */
  simulate(): Promise<void>;
  /** Cüzdan istemini açar. Başarılıysa işlem hash'ini döndürür. */
  submit(): Promise<string>;
  waitForReceipt(txHash: string): Promise<ArcReceiptOutcome>;
}>;

export type ArcTransferTarget = Readonly<{
  debtorAddress: string;
  recipientAddress: string;
  /** Mikro USDC, ondalık metin. BigInt'e burada çevrilir. */
  microUsdc: string;
}>;

/**
 * Makbuz beklemesinin üst sınırı.
 *
 * Arc'ın kesinleşmesi saniyenin altındadır; bu pay ağ sıkışıklığı içindir.
 * Zaman aşımı bir ARIZA DEĞİL, "sonuç henüz bilinmiyor" demektir ve `send.ts`
 * onu hash'iyle birlikte belirsiz sayar.
 */
export const RECEIPT_TIMEOUT_MS = 60_000;

/** Tarayıcının bağlandığı TEK RPC: profilin birincili. */
function defineArcChain(defineChain: (config: never) => unknown) {
  return defineChain({
    id: ACTIVE_NETWORK_PROFILE.chainId,
    name: ACTIVE_NETWORK_PROFILE.displayName,
    nativeCurrency: {
      name: ACTIVE_NETWORK_PROFILE.nativeGasSymbol,
      symbol: ACTIVE_NETWORK_PROFILE.nativeGasSymbol,
      decimals: ACTIVE_NETWORK_PROFILE.nativeGasDecimals,
    },
    /*
     * YEDEKLER BURAYA KONMAZ. `network.ts` yedekleri YALNIZCA SUNUCU olarak
     * işaretler: tarayıcıya verilen her adres CSP'nin `connect-src` listesini
     * ve gizlilik bildirimini genişletir.
     */
    rpcUrls: { default: { http: [ARC_TESTNET_RPC_URL] } },
    testnet: ACTIVE_NETWORK_PROFILE.isTestnet,
  } as never);
}

/**
 * İstemciyi kurar. `viem` DİNAMİK import edilir: yalnızca tarayıcıda ve
 * yalnızca `send.ts`'in doğrulama ile preflight'ı geçtikten sonra yüklenir.
 */
export async function createArcTransferClient(
  provider: Eip1193Provider,
  target: ArcTransferTarget,
): Promise<ArcTransferClient> {
  const { createPublicClient, createWalletClient, custom, defineChain, formatUnits, http } =
    await import("viem");

  const chain = defineArcChain(defineChain as never) as never;
  const account = target.debtorAddress as `0x${string}`;
  const to = target.recipientAddress as `0x${string}`;
  const amount = BigInt(target.microUsdc);

  /* Okumalar bizim RPC'mizden; imzalama cüzdanın kendi taşıyıcısından. */
  const publicClient = createPublicClient({ chain, transport: http(ARC_TESTNET_RPC_URL) });
  const walletClient = createWalletClient({
    chain,
    account,
    transport: custom(provider as never),
  });

  const call = {
    address: ARC_USDC_ERC20_ADDRESS as `0x${string}`,
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [to, amount],
    account,
  } as const;

  return Object.freeze({
    async estimateFee(): Promise<string | null> {
      /*
       * Tahmin BİLGİLENDİRİCİDİR ve gönderimin ön koşulu değildir; bu yüzden
       * hatası yutulur. Gönderimi durduran şey `simulate`dir.
       */
      try {
        const [gas, fees] = await Promise.all([
          publicClient.estimateContractGas(call as never),
          publicClient.estimateFeesPerGas(),
        ]);
        const perGas = fees.maxFeePerGas ?? fees.gasPrice;
        if (perGas === undefined || perGas === null) {
          return null;
        }
        /*
         * Arc'ın native gas'ı USDC'dir ve 18 ondalıklıdır. Transfer TUTARI
         * altı ondalıkla taşınır; ikisi burada da karıştırılmaz.
         */
        const fee = gas * perGas;
        return `${formatUnits(fee, ACTIVE_NETWORK_PROFILE.nativeGasDecimals)} ${ACTIVE_NETWORK_PROFILE.nativeGasSymbol}`;
      } catch {
        return null;
      }
    },

    async simulate(): Promise<void> {
      /*
       * Cüzdana DOKUNMAZ. Yetersiz bakiye gibi zincirin reddedeceği her şey
       * burada, hiçbir işlem yayınlanmadan ortaya çıkar; `send.ts` bu yüzden
       * buradaki hatayı güvenle "yeniden denenebilir" sayabilir.
       */
      await publicClient.simulateContract(call as never);
    },

    async submit(): Promise<string> {
      /* Bu çağrıdan SONRA işlem zincire düşmüş olabilir. */
      return (await walletClient.writeContract(call as never)) as string;
    },

    async waitForReceipt(txHash: string): Promise<ArcReceiptOutcome> {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
        timeout: RECEIPT_TIMEOUT_MS,
      });
      /*
       * Sonuç YALNIZCA zincirin `status` alanından okunur. Hash'in var olması
       * başarı DEĞİLDİR: revert eden işlemin de hash'i vardır.
       */
      return receipt.status === "success"
        ? { kind: "success", txHash }
        : { kind: "reverted", txHash };
    },
  });
}

export { ARC_TESTNET_CHAIN_ID };
