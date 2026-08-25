import { translate } from "../i18n/dictionary";
import { DEFAULT_LOCALE } from "../i18n/locale";
import {
  ARC_TESTNET_CHAIN_ID_HEX,
  buildAddArcTestnetParams,
  parseChainId,
} from "./network";

/**
 * Tarayıcı cüzdanı katmanı (EIP-6963 + EIP-1193).
 *
 * Provider nesneleri bilinçli olarak modül düzeyinde bir kayıt defterinde
 * tutulur ve React state'ine hiç girmez. Dışarıya yalnızca serileştirilebilir
 * meta veri (uuid, ad, rdns, ikon) verilir. Provider veya cüzdan meta verisi
 * hiçbir zaman loglanmaz.
 */

type RequestArgs = { method: string; params?: unknown[] | object };

export type Eip1193Provider = {
  request(args: RequestArgs): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};

/** React'e verilebilecek, hassas olmayan cüzdan bilgisi. */
export type WalletInfo = {
  uuid: string;
  name: string;
  rdns: string;
  /** Yalnızca data:image/... ile başlayan ikonlar saklanır. */
  icon: string | null;
};

type Eip6963ProviderDetail = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
};

const providerRegistry = new Map<string, Eip1193Provider>();

function safeIcon(icon: unknown): string | null {
  return typeof icon === "string" && icon.startsWith("data:image/") ? icon : null;
}

/**
 * Duyurulan EIP-6963 cüzdanlarını keşfeder. İlk provider sessizce seçilmez;
 * çağıran taraf birden fazla cüzdan varsa kullanıcıya seçtirir.
 */
export function discoverWallets(timeoutMs = 350): Promise<WalletInfo[]> {
  if (typeof window === "undefined") {
    return Promise.resolve([]);
  }

  return new Promise((resolve) => {
    const found = new Map<string, WalletInfo>();

    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (
        detail === undefined ||
        detail === null ||
        typeof detail.info?.uuid !== "string" ||
        typeof detail.provider?.request !== "function"
      ) {
        return;
      }
      providerRegistry.set(detail.info.uuid, detail.provider);
      found.set(detail.info.uuid, {
        uuid: detail.info.uuid,
        name:
          typeof detail.info.name === "string"
            ? detail.info.name
            : translate(DEFAULT_LOCALE, "wallet.fallbackName"),
        rdns: typeof detail.info.rdns === "string" ? detail.info.rdns : "",
        icon: safeIcon(detail.info.icon),
      });
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    window.setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

/** Yalnızca bu modül içinden kullanılır; provider dışarı sızdırılmaz. */
function getProvider(uuid: string): Eip1193Provider | null {
  return providerRegistry.get(uuid) ?? null;
}

export type WalletErrorCode =
  | "noProvider"
  | "rejected"
  | "noAccount"
  | "unsupportedChain"
  | "requestFailed";

export type WalletResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: WalletErrorCode };

function errorCodeOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code: unknown };
    if (typeof code === "number") {
      return code;
    }
  }
  return null;
}

function toWalletError(error: unknown): WalletErrorCode {
  const code = errorCodeOf(error);
  if (code === 4001) {
    return "rejected";
  }
  if (code === 4902) {
    return "unsupportedChain";
  }
  return "requestFailed";
}

/**
 * Cüzdan çağrıları sıraya alınır: bağlantı, ağ ekleme/değiştirme ve imzalama
 * aynı anda çalışmaz. Aksi hâlde çoğu cüzdan istekleri reddeder.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function requestAccounts(uuid: string): Promise<WalletResult<string[]>> {
  return enqueue(async () => {
    const provider = getProvider(uuid);
    if (provider === null) {
      return { ok: false as const, code: "noProvider" as const };
    }
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || accounts.length === 0) {
        return { ok: false as const, code: "noAccount" as const };
      }
      return { ok: true as const, value: accounts.filter((a): a is string => typeof a === "string") };
    } catch (error) {
      return { ok: false as const, code: toWalletError(error) };
    }
  });
}

export function getChainId(uuid: string): Promise<WalletResult<number>> {
  return enqueue(async () => {
    const provider = getProvider(uuid);
    if (provider === null) {
      return { ok: false as const, code: "noProvider" as const };
    }
    try {
      const chainId = parseChainId(await provider.request({ method: "eth_chainId" }));
      if (chainId === null) {
        return { ok: false as const, code: "requestFailed" as const };
      }
      return { ok: true as const, value: chainId };
    } catch (error) {
      return { ok: false as const, code: toWalletError(error) };
    }
  });
}

/**
 * Arc Testnet'e geçer. Cüzdan ağı tanımıyorsa (4902) resmî yapılandırmayla
 * ekleyip yeniden dener.
 */
export function switchToArcTestnet(uuid: string): Promise<WalletResult<true>> {
  return enqueue(async () => {
    const provider = getProvider(uuid);
    if (provider === null) {
      return { ok: false as const, code: "noProvider" as const };
    }

    const switchRequest = () =>
      provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARC_TESTNET_CHAIN_ID_HEX }],
      });

    try {
      await switchRequest();
      return { ok: true as const, value: true as const };
    } catch (error) {
      if (toWalletError(error) !== "unsupportedChain") {
        return { ok: false as const, code: toWalletError(error) };
      }
    }

    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [buildAddArcTestnetParams()],
      });
      await switchRequest();
      return { ok: true as const, value: true as const };
    } catch (error) {
      return { ok: false as const, code: toWalletError(error) };
    }
  });
}

/** Hesap ve ağ değişikliklerini dinler. Dönen fonksiyon aboneliği kaldırır. */
export function subscribeToWallet(
  uuid: string,
  handlers: {
    onAccountsChanged: (accounts: string[]) => void;
    onChainChanged: (chainId: number | null) => void;
  },
): () => void {
  const provider = getProvider(uuid);
  if (provider?.on === undefined || provider.removeListener === undefined) {
    return () => undefined;
  }

  const accountsListener = (...args: unknown[]) => {
    const accounts = Array.isArray(args[0]) ? args[0] : [];
    handlers.onAccountsChanged(
      accounts.filter((a): a is string => typeof a === "string"),
    );
  };
  const chainListener = (...args: unknown[]) => {
    handlers.onChainChanged(parseChainId(args[0]));
  };

  provider.on("accountsChanged", accountsListener);
  provider.on("chainChanged", chainListener);

  return () => {
    provider.removeListener?.("accountsChanged", accountsListener);
    provider.removeListener?.("chainChanged", chainListener);
  };
}

/** App Kit adaptörü kurulurken provider'a yalnızca bu modül üzerinden erişilir. */
export function withProvider<T>(
  uuid: string,
  run: (provider: Eip1193Provider) => Promise<T>,
): Promise<WalletResult<T>> {
  return enqueue(async () => {
    const provider = getProvider(uuid);
    if (provider === null) {
      return { ok: false as const, code: "noProvider" as const };
    }
    try {
      return { ok: true as const, value: await run(provider) };
    } catch (error) {
      return { ok: false as const, code: toWalletError(error) };
    }
  });
}
