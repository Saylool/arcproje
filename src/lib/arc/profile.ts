/**
 * Merkezî ödeme ağı profili.
 *
 * Ağ bilgisi tek bir yerde tanımlanır; ödeme talebi, imzalama ve gönderim
 * mantığı doğrudan sabitlere değil bu profile bakar. Böylece ileride başka bir
 * ağ profili (ör. Ethereum Sepolia) ayrı ve gözden geçirilmiş bir değişiklikle
 * eklenebilir; talep/imza mantığının yeniden yazılması gerekmez.
 *
 * Bu görevde YALNIZCA Arc Testnet etkindir. Başka bir profil tanımlı değildir
 * ve hiçbir UI ya da çalışma zamanı yolu farklı bir ağ seçemez.
 *
 * Kaynak: https://docs.arc.io/arc/references/connect-to-arc
 *         https://docs.arc.io/app-kit/references/supported-blockchains
 */
export type PaymentNetworkKey = "arc-testnet";

export type PaymentNetworkProfile = Readonly<{
  key: PaymentNetworkKey;
  displayName: string;
  /** App Kit zincir kimliği. */
  appKitChain: "Arc_Testnet";
  chainId: number;
  /**
   * BİRİNCİL RPC. Cüzdana bildirilen ve tarayıcının gördüğü tek adres budur.
   *
   * Yedekler bilerek buraya karışmaz: `wallet_addEthereumChain` ile cüzdana
   * verilen liste büyüdüğünde tarayıcı o adreslere de bağlanabilir, ve o an
   * CSP ile gizlilik bildiriminin kapsamı sessizce genişlerdi.
   */
  rpcUrl: string;
  /**
   * YEDEK RPC'ler — YALNIZCA SUNUCU.
   *
   * Arc'ın resmî dokümanında birincilin yanında üçüncü taraf sağlayıcılar da
   * listelenir. Hepsi aynı zinciri (chainId 5042002) sunar ve makbuz
   * doğrulaması bunu her çağrıda ayrıca kontrol eder.
   *
   * Sıra ÖNEMLİDİR: birincil önce denenir, listedekiler sırayla devreye girer.
   *
   * Kaynak: https://docs.arc.io/arc/references/connect-to-arc
   */
  fallbackRpcUrls: readonly string[];
  explorerUrl: string;
  /** Explorer bağlantısı doğrulanırken kabul edilen alan adı soneki. */
  explorerHostSuffix: string;
  faucetUrl: string;
  docsUrl: string;
  /** Transfer edilen token. */
  tokenSymbol: "USDC";
  /** ERC-20 arayüzü ondalığı — transfer tutarında bu kullanılır. */
  tokenDecimals: 6;
  tokenErc20Address: string;
  /** Native gas gösterimi. Transfer tutarında ASLA kullanılmaz. */
  nativeGasSymbol: "USDC";
  nativeGasDecimals: 18;
  isTestnet: true;
}>;

export const ARC_TESTNET_PROFILE: PaymentNetworkProfile = Object.freeze({
  key: "arc-testnet",
  displayName: "Arc Testnet",
  appKitChain: "Arc_Testnet",
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.io",
  /* Resmî dokümanda birincilin yanında listelenen sağlayıcılar. */
  fallbackRpcUrls: Object.freeze([
    "https://rpc.blockdaemon.testnet.arc.io",
    "https://rpc.drpc.testnet.arc.io",
    "https://rpc.quicknode.testnet.arc.io",
  ]),
  explorerUrl: "https://testnet.arcscan.app",
  explorerHostSuffix: "arcscan.app",
  faucetUrl: "https://faucet.circle.com",
  docsUrl: "https://docs.arc.io/arc/references/connect-to-arc",
  tokenSymbol: "USDC",
  tokenDecimals: 6,
  tokenErc20Address: "0x3600000000000000000000000000000000000000",
  nativeGasSymbol: "USDC",
  nativeGasDecimals: 18,
  isTestnet: true,
});

/** Etkin profiller. Bu görevde tek profil vardır. */
export const ENABLED_NETWORK_PROFILES: readonly PaymentNetworkProfile[] =
  Object.freeze([ARC_TESTNET_PROFILE]);

/** Uygulamanın kullandığı aktif profil. */
export const ACTIVE_NETWORK_PROFILE: PaymentNetworkProfile = ARC_TESTNET_PROFILE;

export function isEnabledNetworkKey(value: unknown): value is PaymentNetworkKey {
  return ENABLED_NETWORK_PROFILES.some((profile) => profile.key === value);
}
