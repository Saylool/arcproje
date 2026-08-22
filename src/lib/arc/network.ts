/**
 * Arc Testnet ağ sabitleri.
 *
 * Değerler resmî dokümandan doğrulanmıştır:
 * https://docs.arc.io/arc/references/connect-to-arc
 * https://docs.arc.io/arc/references/contract-addresses
 *
 * DİKKAT: Arc'ta USDC iki farklı ondalıkla görünür.
 * - Native gas token: 18 ondalık (yalnızca gas için)
 * - USDC ERC-20 arayüzü: 6 ondalık (transfer ve bakiye için)
 * Bu iki gösterim asla birbirine karıştırılmaz.
 */
import { ACTIVE_NETWORK_PROFILE } from "./profile";

export const ARC_TESTNET_CHAIN_ID = ACTIVE_NETWORK_PROFILE.chainId;
/**
 * Cüzdan RPC'leri chainId'yi hex bekler. Elle yazılmış bir hex sabiti yanlış
 * ağın eklenmesine yol açabileceği için ondalık kimlikten türetilir.
 */
export const ARC_TESTNET_CHAIN_ID_HEX = `0x${ARC_TESTNET_CHAIN_ID.toString(16)}`;
export const ARC_TESTNET_RPC_URL = ACTIVE_NETWORK_PROFILE.rpcUrl;
export const ARC_TESTNET_EXPLORER_URL = ACTIVE_NETWORK_PROFILE.explorerUrl;
export const ARC_TESTNET_FAUCET_URL = ACTIVE_NETWORK_PROFILE.faucetUrl;
export const ARC_TESTNET_DOCS_URL = ACTIVE_NETWORK_PROFILE.docsUrl;

/** App Kit'in zincir kimliği (kurulu chains.d.ts ile doğrulandı). */
export const ARC_TESTNET_APP_KIT_CHAIN = ACTIVE_NETWORK_PROFILE.appKitChain;

/** USDC ERC-20 arayüzü — transfer ve bakiye bu adres ve ondalıkla okunur. */
export const ARC_USDC_ERC20_ADDRESS = ACTIVE_NETWORK_PROFILE.tokenErc20Address;
export const ARC_USDC_ERC20_DECIMALS = ACTIVE_NETWORK_PROFILE.tokenDecimals;

/** Native gas token ondalığı. Transfer tutarında ASLA kullanılmaz. */
export const ARC_NATIVE_GAS_DECIMALS = ACTIVE_NETWORK_PROFILE.nativeGasDecimals;

const EXPLORER_HOST_SUFFIX = ACTIVE_NETWORK_PROFILE.explorerHostSuffix;

/**
 * `wallet_addEthereumChain` parametreleri. Native para birimi 18 ondalıktır;
 * bu yalnızca cüzdanın gas gösterimi içindir.
 */
export function buildAddArcTestnetParams(): {
  chainId: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
} {
  return {
    chainId: ARC_TESTNET_CHAIN_ID_HEX,
    chainName: ACTIVE_NETWORK_PROFILE.displayName,
    nativeCurrency: {
      name: ACTIVE_NETWORK_PROFILE.nativeGasSymbol,
      symbol: ACTIVE_NETWORK_PROFILE.nativeGasSymbol,
      decimals: ARC_NATIVE_GAS_DECIMALS,
    },
    rpcUrls: [ARC_TESTNET_RPC_URL],
    blockExplorerUrls: [ARC_TESTNET_EXPLORER_URL],
  };
}

/** SDK'dan dönen explorer bağlantısı yalnızca HTTPS ArcScan ise kabul edilir. */
export function isValidArcExplorerUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return host === EXPLORER_HOST_SUFFIX || host.endsWith(`.${EXPLORER_HOST_SUFFIX}`);
}

/**
 * Zincir kimliğini KATI biçimde ayrıştırır.
 *
 * `Number.parseInt` öneki okuyup kalan çöpü sessizce yok saydığı için
 * kullanılmaz: "0x4cef52junk" gibi bir değer geçerli sayılırsa kullanıcı
 * yanlış ağda olduğu hâlde doğru ağdaymış gibi görünür. Burada tüm dizenin
 * tek bir biçime tam olarak uyması aranır ve BigInt ile çevrilir.
 */
export function parseChainId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "bigint") {
    return value >= BigInt(0) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : null;
  }
  if (typeof value !== "string") {
    return null;
  }

  const raw = value.trim();
  const isHex = /^0[xX][0-9a-fA-F]+$/.test(raw);
  const isDecimal = /^[0-9]+$/.test(raw);
  if (!isHex && !isDecimal) {
    return null;
  }

  let parsed: bigint;
  try {
    parsed = BigInt(raw);
  } catch {
    return null;
  }

  if (parsed < BigInt(0) || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(parsed);
}

export function isArcTestnet(chainId: number | null): boolean {
  return chainId === ARC_TESTNET_CHAIN_ID;
}

/** İşlem hash'i tam olarak 32 bayt olmalıdır: 0x + 64 hex karakter. */
export function isValidTransactionHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

/**
 * Explorer bağlantısı bağımlılıktan gelen değerle değil, doğrulanmış hash ile
 * yerelde kurulur. Böylece SDK'nın döndürdüğü rastgele bir URL kullanıcıya
 * gösterilemez.
 */
export function buildArcExplorerTxUrl(txHash: string): string | null {
  if (!isValidTransactionHash(txHash)) {
    return null;
  }
  return `${ARC_TESTNET_EXPLORER_URL}/tx/${txHash.trim()}`;
}
