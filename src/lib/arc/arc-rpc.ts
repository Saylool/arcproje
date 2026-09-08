import { ARC_TESTNET_RPC_URL, ARC_TESTNET_RPC_URLS } from "./network";
import { ACTIVE_NETWORK_PROFILE } from "./profile";

import type { ArcRpcClient } from "./arc-receipt";

/**
 * ARC TESTNET RPC İSTEMCİSİ — YALNIZCA SUNUCU.
 *
 * `viem` DİNAMİK import edilir: modül yalnızca gerçekten bir makbuz
 * sorulduğunda yüklenir. Uç noktalar ağ profilindeki RESMÎ Arc Testnet
 * adresleridir; başka hiçbir zincir yapılandırılamaz ve istemciden gelen bir
 * URL ASLA kullanılmaz.
 *
 * YEDEKLİ. Önceki hâlinde TEK bir genel adres vardı: o adres yavaşladığında
 * ya da hız sınırına takıldığında makbuz doğrulanamıyor ve ödeme
 * kesinleştirilemiyordu. Genel testnet RPC'leri bunu düzenli olarak yapar.
 * Artık resmî listedeki adresler SIRAYLA denenir; biri cevap vermezse
 * sonraki devreye girer.
 *
 * YEDEK GÜVENLİĞİ GEVŞETMEZ. Hangi adresten gelirse gelsin makbuz aynı
 * kontrollerden geçer ve `arc-receipt.ts` her çağrıda chainId'yi yeniden
 * doğrular: yanlış zincire bağlı bir yedek, sonucu kabul ettiremez.
 *
 * TESTLER BURAYA GİRMEZ: doğrulayıcı `ArcRpcClient` sınırını enjekte edilmiş
 * bir sahteyle alır, bu yüzden otomatik çalışmada hiçbir ağ isteği yapılmaz.
 */

/**
 * BİR MANTIKSAL RPC ÇAĞRISININ TOPLAM ÜST SINIRI. DEĞİŞMEDİ.
 *
 * Bu sayının sabit kalması bilinçlidir. `finalize` üç ardışık çağrı yapar
 * (chainId, makbuz, blok yüksekliği) ve rotanın süre tavanı bu bütçeye göre
 * ayarlıdır. Yedekler "her uç için 8 saniye" olsaydı en kötü durum dörde
 * katlanır ve tavanı aşardı.
 */
export const ARC_RPC_TIMEOUT_MS = 8000;

/**
 * Toplam bütçenin uç başına düşen payı.
 *
 * TAKAS AÇIKÇA ŞUDUR: tek uçta 8 saniye beklemek yerine, her uçta daha kısa
 * bekleyip SIRADAKİNE geçilir. Yavaş ama çalışan bir birincil için bu erken
 * bir devretme demektir — ve sağlıklı bir yedeğe geçmek, ölü bir uçta sekiz
 * saniye beklemekten iyidir.
 */
export const ARC_RPC_PER_ENDPOINT_TIMEOUT_MS = Math.floor(
  ARC_RPC_TIMEOUT_MS / ARC_TESTNET_RPC_URLS.length,
);

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
        const { createPublicClient, defineChain, fallback, http } = await import(
          "viem"
        );
        const arcTestnet = defineChain({
          id: ACTIVE_NETWORK_PROFILE.chainId,
          name: ACTIVE_NETWORK_PROFILE.displayName,
          nativeCurrency: {
            name: ACTIVE_NETWORK_PROFILE.nativeGasSymbol,
            symbol: ACTIVE_NETWORK_PROFILE.nativeGasSymbol,
            decimals: ACTIVE_NETWORK_PROFILE.nativeGasDecimals,
          },
          /*
           * Zincir tanımındaki liste yalnızca birincili taşır. Yedekler
           * transport katmanındadır; zincir tanımına konsaydı viem'in
           * varsayılan seçimi sıraya karışabilirdi.
           */
          rpcUrls: { default: { http: [ARC_TESTNET_RPC_URL] } },
          testnet: true,
        });
        return createPublicClient({
          chain: arcTestnet,
          /*
           * `retryCount: 0` HER İKİ katmanda da: yeniden deneme burada
           * SIRADAKİ UCA GEÇMEKTİR. Aynı ölü uca üç kez daha sormak, toplam
           * bütçeyi yer ve yedeğe hiç sıra gelmezdi.
           *
           * `rank: false` — sıra SABİTTİR. Ölçüme dayalı sıralama, gecikme
           * ölçmek için fazladan istek atar ve sırayı öngörülemez kılar;
           * burada aranan şey belirlenimci bir devretme.
           */
          transport: fallback(
            ARC_TESTNET_RPC_URLS.map((url) =>
              http(url, {
                timeout: ARC_RPC_PER_ENDPOINT_TIMEOUT_MS,
                retryCount: 0,
              }),
            ),
            { rank: false, retryCount: 0 },
          ),
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
