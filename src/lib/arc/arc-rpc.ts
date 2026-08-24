import { ARC_TESTNET_RPC_URL } from "./network";
import { ACTIVE_NETWORK_PROFILE } from "./profile";

import type { ArcRpcClient } from "./arc-receipt";

/**
 * ARC TESTNET RPC İSTEMCİSİ — YALNIZCA SUNUCU.
 *
 * `viem` DİNAMİK import edilir: modül yalnızca gerçekten bir makbuz
 * sorulduğunda yüklenir. Uç nokta, ağ profilindeki RESMÎ Arc Testnet
 * RPC'sidir; başka hiçbir zincir yapılandırılamaz ve istemciden gelen bir
 * URL ASLA kullanılmaz.
 *
 * TESTLER BURAYA GİRMEZ: doğrulayıcı `ArcRpcClient` sınırını enjekte edilmiş
 * bir sahteyle alır, bu yüzden otomatik çalışmada hiçbir ağ isteği yapılmaz.
 */

/** RPC çağrılarının üst sınırı; asılı bir istek isteği kilitlemesin. */
export const ARC_RPC_TIMEOUT_MS = 8000;

export function createArcTestnetRpcClient(): ArcRpcClient {
  /** İstemci ilk kullanımda kurulur ve sonra yeniden kullanılır. */
  let client: Promise<{
    getChainId(): Promise<number>;
    getTransactionReceipt(args: { hash: `0x${string}` }): Promise<unknown>;
    getBlockNumber(): Promise<bigint>;
  }> | null = null;

  async function connect() {
    if (client === null) {
      client = (async () => {
        const { createPublicClient, defineChain, http } = await import("viem");
        const arcTestnet = defineChain({
          id: ACTIVE_NETWORK_PROFILE.chainId,
          name: ACTIVE_NETWORK_PROFILE.displayName,
          nativeCurrency: {
            name: ACTIVE_NETWORK_PROFILE.nativeGasSymbol,
            symbol: ACTIVE_NETWORK_PROFILE.nativeGasSymbol,
            decimals: ACTIVE_NETWORK_PROFILE.nativeGasDecimals,
          },
          rpcUrls: { default: { http: [ARC_TESTNET_RPC_URL] } },
          testnet: true,
        });
        return createPublicClient({
          chain: arcTestnet,
          transport: http(ARC_TESTNET_RPC_URL, { timeout: ARC_RPC_TIMEOUT_MS }),
        });
      })();
    }
    return client;
  }

  return Object.freeze({
    async getChainId(): Promise<number> {
      return (await connect()).getChainId();
    },
    async getTransactionReceipt(txHash: string): Promise<unknown> {
      const rpc = await connect();
      try {
        return await rpc.getTransactionReceipt({ hash: txHash as `0x${string}` });
      } catch (error) {
        /*
         * viem, makbuz henüz yokken `TransactionReceiptNotFoundError`
         * fırlatır. Bu bir ARIZA DEĞİL, "henüz beklemede" demektir; `null`a
         * çevrilir. Diğer her hata yukarı taşınır ve `unavailable` olur.
         */
        const name =
          typeof error === "object" && error !== null
            ? (error as { name?: unknown }).name
            : undefined;
        if (name === "TransactionReceiptNotFoundError") {
          return null;
        }
        throw error;
      }
    },
    async getBlockNumber(): Promise<bigint> {
      return (await connect()).getBlockNumber();
    },
  });
}
