import { translate } from "../i18n/dictionary";
import { DEFAULT_LOCALE } from "../i18n/locale";
import type { Locale } from "../i18n/locale";
import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_RPC_URL } from "./network";
import {
  WALLETCONNECT_UUID,
  forgetWalletConnectProvider,
  registerWalletConnectProvider,
  type Eip1193Provider,
  type WalletInfo,
  type WalletResult,
} from "./wallet";

/**
 * İKİNCİ CÜZDAN KAYNAĞI — WalletConnect v2.
 *
 * EIP-6963 yalnızca eklenti enjekte eden tarayıcılarda çalışır; Android
 * Chrome hiçbir provider enjekte etmez. Bu modül aynı kayıt defterine ikinci
 * bir provider koyar, böylece `requestAccounts`, `getChainId`,
 * `switchToArcTestnet`, `subscribeToWallet` ve `withProvider` — dolayısıyla
 * `send.ts` — tek satır bile değişmeden mobil cüzdanlarla da çalışır.
 *
 * Gerçek kütüphane YALNIZCA `defaultProviderFactory` içinden, dinamik
 * import'la yüklenir. Geri kalan her şey saf ya da enjekte edilen bir sahte
 * provider ile sınanabilir.
 */

/** CAIP-2 zincir kimliği. */
export const ARC_CAIP_CHAIN = `eip155:${ARC_TESTNET_CHAIN_ID}`;

/**
 * Oturumdan İSTENEN yöntemler.
 *
 * Uygulamanın gerçekten çağırdıklarıyla sınırlıdır. Onaylanmayan bir yöntem
 * kütüphane tarafından cüzdana değil HTTP RPC'ye yönlendirilir; bu yüzden
 * listeyi gereksiz genişletmek sessiz ve yanıltıcı hatalar üretir.
 */
export const REQUESTED_METHODS: readonly string[] = [
  "eth_sendTransaction",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
];

export const REQUESTED_EVENTS: readonly string[] = [
  "accountsChanged",
  "chainChanged",
];

/**
 * Next.js `NEXT_PUBLIC_` değişkenlerini DERLEME ANINDA yerine koyar; bu yüzden
 * ifade düz yazılır ve dinamik olarak okunmaz.
 *
 * Bu bir SUNUCU SIRRI DEĞİLDİR: WalletConnect projectId'si tanımı gereği
 * istemci paketinde bulunur ve tek başına hiçbir şeye yetki vermez.
 *
 * DEĞİŞKENİ EKLEMEK YETMEZ, YENİDEN DERLEMEK GEREKİR. Değer buraya derleme
 * anında gömüldüğü için, dağıtım ortamına sonradan eklenen bir değişken ancak
 * yeni bir derlemeyle pakete girer. Üstelik derleme ÖNBELLEĞİ bu dosyanın eski
 * hâlini geri getirebilir: dosya değişmediyse Next onu yeniden derlemeyebilir
 * ve içinde `process.env...` ifadesi ham hâliyle kalır. Şüphelenince ölç —
 * derleme sonrası istemci paketinde değişkenin ADI kalmamalıdır:
 *
 *     grep -rl "env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID" .next/static
 *
 * Çıktı boş değilse yerine koyma olmamıştır; önbelleksiz yeniden derle.
 */
const CONFIGURED_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

/** Boş ya da yalnızca boşluktan oluşan değer TANIMSIZ sayılır. */
export function normalizeProjectId(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** projectId yoksa WalletConnect hiç sunulmaz; yarım bir akış gösterilmez. */
export function isWalletConnectConfigured(): boolean {
  return normalizeProjectId(CONFIGURED_PROJECT_ID) !== null;
}

/* ------------------------------------------------------------------ */
/* Kütüphane sınırı                                                    */
/* ------------------------------------------------------------------ */

type Listener = (...args: unknown[]) => void;

export type WalletConnectNamespace = {
  chains: string[];
  methods: string[];
  events: string[];
  rpcMap: Record<string, string>;
};

export type WalletConnectSession = {
  namespaces?: Record<string, { accounts?: string[]; methods?: string[] }>;
  peer?: { metadata?: { name?: unknown } };
};

/** Kütüphaneden kullanılan YÜZEYİN tamamı. Testler bunu taklit eder. */
export type WalletConnectProvider = {
  connect(params: {
    optionalNamespaces: Record<string, WalletConnectNamespace>;
  }): Promise<WalletConnectSession | undefined>;
  disconnect(): Promise<void>;
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  setDefaultChain(chain: string): void;
  on(event: string, listener: Listener): void;
  removeListener(event: string, listener: Listener): void;
  session?: WalletConnectSession;
};

export type WalletConnectFactory = (projectId: string) => Promise<WalletConnectProvider>;

/**
 * İstenen oturum kapsamı.
 *
 * Arc Testnet ZORUNLU değil İSTEĞE BAĞLI namespace olarak istenir: zorunlu
 * istenseydi zinciri tanımayan mobil cüzdanların çoğu oturumu tümden
 * reddederdi. Tanımayan cüzdan kendi zincirleriyle onaylar, kullanıcı da
 * mevcut "ağa geç" düğmesini görür.
 *
 * `rpcMap` İKİ anahtarla yazılır çünkü kütüphane iki ayrı yoldan okur: önce
 * tam CAIP kimliğiyle, bulamazsa yalnızca zincir numarasıyla. Eksik kalırsa
 * okuma çağrıları Arc'ı tanımayan genel bir RPC'ye gider.
 */
export function buildOptionalNamespaces(): Record<string, WalletConnectNamespace> {
  return {
    eip155: {
      chains: [ARC_CAIP_CHAIN],
      methods: [...REQUESTED_METHODS],
      events: [...REQUESTED_EVENTS],
      rpcMap: {
        [ARC_CAIP_CHAIN]: ARC_TESTNET_RPC_URL,
        [String(ARC_TESTNET_CHAIN_ID)]: ARC_TESTNET_RPC_URL,
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Oturum okuması — hepsi saf                                          */
/* ------------------------------------------------------------------ */

/** `eip155:5042002:0xabc…` biçimindeki hesaplardan onaylanan zincirler. */
export function approvedChainIds(session: WalletConnectSession | undefined): number[] {
  const accounts = session?.namespaces?.eip155?.accounts ?? [];
  const seen = new Set<number>();
  for (const account of accounts) {
    if (typeof account !== "string") {
      continue;
    }
    const [namespace, reference] = account.split(":");
    if (namespace !== "eip155" || !/^[0-9]+$/.test(reference ?? "")) {
      continue;
    }
    const chainId = Number(reference);
    if (Number.isSafeInteger(chainId)) {
      seen.add(chainId);
    }
  }
  return [...seen];
}

/**
 * Varsayılan zincir. Arc onaylandıysa Arc, aksi hâlde onaylanan ilk zincir.
 *
 * Arc onaylanmadığı hâlde varsayılanı yine de Arc yapmak hesap listesini
 * BOŞALTIRDI (kütüphane hesapları varsayılan zincire göre süzer) ve kullanıcı
 * bağlanamamış gibi görünürdü.
 */
export function pickDefaultChainId(
  session: WalletConnectSession | undefined,
): number | null {
  const chains = approvedChainIds(session);
  if (chains.includes(ARC_TESTNET_CHAIN_ID)) {
    return ARC_TESTNET_CHAIN_ID;
  }
  return chains[0] ?? null;
}

export function approvedMethods(session: WalletConnectSession | undefined): string[] {
  const methods = session?.namespaces?.eip155?.methods ?? [];
  return methods.filter((method): method is string => typeof method === "string");
}

/** Cüzdanın kendi adı. Uzak ikon ÇEKİLMEZ: `safeIcon` kuralıyla aynı sınır. */
export function sessionWalletInfo(
  session: WalletConnectSession | undefined,
  locale: Locale = DEFAULT_LOCALE,
): WalletInfo {
  const name = session?.peer?.metadata?.name;
  return {
    uuid: WALLETCONNECT_UUID,
    name:
      typeof name === "string" && name.trim() !== ""
        ? name
        : translate(locale, "wallet.fallbackName"),
    rdns: "",
    icon: null,
  };
}

/* ------------------------------------------------------------------ */
/* Hata çevirisi                                                       */
/* ------------------------------------------------------------------ */

/** WalletConnect'in kullanıcı reddi kodları (5000–5003). */
const WC_USER_REJECTED = new Set([5000, 5001, 5002, 5003]);
/** WalletConnect'in "zincir desteklenmiyor" kodu. */
const WC_UNSUPPORTED_CHAINS = 5100;

function numericCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code: unknown };
    if (typeof code === "number") {
      return code;
    }
  }
  return null;
}

export function providerError(code: number, message: string): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

/**
 * Kütüphane hatasını EIP-1193 koduna çevirir.
 *
 * `wallet.ts` yalnızca 4001 ve 4902'yi tanır ve DEĞİŞTİRİLMEZ; çeviriyi bu
 * adaptör yapar. Böylece mobil bir ret masaüstündeki retle aynı mesajı verir
 * ve tanınmayan zincir yine `wallet_addEthereumChain` denemesini tetikler.
 */
export function normalizeError(error: unknown): unknown {
  const code = numericCode(error);
  if (code === null) {
    return error;
  }
  if (WC_USER_REJECTED.has(code)) {
    return providerError(4001, "İstek cüzdanda reddedildi.");
  }
  if (code === WC_UNSUPPORTED_CHAINS) {
    return providerError(4902, "Zincir oturumda onaylanmadı.");
  }
  return error;
}

/* ------------------------------------------------------------------ */
/* EIP-1193 adaptörü                                                   */
/* ------------------------------------------------------------------ */

const CHAIN_METHODS = new Set([
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
]);

/**
 * Oturumu `Eip1193Provider` gibi gösterir.
 *
 * İki iş yapar. Birincisi: onaylanmamış bir `wallet_*` çağrısını 4902 ile
 * keser. Kesilmezse kütüphane onu cüzdana değil HTTP RPC'ye yollar ve
 * "method not found" gibi anlamsız bir hata döner. İkincisi: oturum
 * kapandığında `accountsChanged([])` yayar; `subscribeToWallet` böylece
 * bağlantı kopuşunu hesap kaybı olarak görür ve değişmesi gerekmez.
 */
export function createSessionAdapter(
  provider: WalletConnectProvider,
  session: WalletConnectSession | undefined,
): Eip1193Provider {
  const methods = approvedMethods(session);
  const chains = approvedChainIds(session);
  const bridges = new Map<Listener, Listener>();

  return {
    async request(args) {
      if (
        CHAIN_METHODS.has(args.method) &&
        !methods.includes(args.method) &&
        !chains.includes(ARC_TESTNET_CHAIN_ID)
      ) {
        throw providerError(
          4902,
          "Cüzdan bu oturumda ağ değiştirmeyi onaylamadı.",
        );
      }
      try {
        return await provider.request(args);
      } catch (error) {
        throw normalizeError(error);
      }
    },

    on(event, listener) {
      provider.on(event, listener);
      if (event !== "accountsChanged") {
        return;
      }
      const bridge: Listener = () => listener([]);
      bridges.set(listener, bridge);
      provider.on("disconnect", bridge);
      provider.on("session_delete", bridge);
    },

    removeListener(event, listener) {
      provider.removeListener(event, listener);
      const bridge = bridges.get(listener);
      if (bridge === undefined) {
        return;
      }
      provider.removeListener("disconnect", bridge);
      provider.removeListener("session_delete", bridge);
      bridges.delete(listener);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Derin bağlantı                                                      */
/* ------------------------------------------------------------------ */

/**
 * Aynı telefonda cüzdan uygulamasını açan bağlantı.
 *
 * URI kütüphaneden gelse de `location.href`'e konmadan önce BİÇİMİ
 * doğrulanır: yalnızca WalletConnect eşleşme URI'si kabul edilir, böylece bu
 * yol hiçbir koşulda rastgele bir adrese gitmeye dönüşemez.
 */
export function buildWalletDeepLink(uri: string): string | null {
  return /^wc:[0-9a-f]{64}@[0-9]+\?/i.test(uri) ? uri : null;
}

/* ------------------------------------------------------------------ */
/* Bağlanma akışı                                                      */
/* ------------------------------------------------------------------ */

export type WalletConnectHandle = {
  /** QR olarak basılan ve derin bağlantıda kullanılan eşleşme URI'si. */
  readonly uri: string;
  /** Cüzdan oturumu onaylayınca çözülür. */
  readonly approved: Promise<WalletResult<WalletInfo>>;
  /** Kullanıcı vazgeçerse bekleyen girişimi kapatır. */
  cancel: () => Promise<void>;
};

let activeProvider: WalletConnectProvider | null = null;

/**
 * Kurulmuş bir oturumu UYGULAMAYA BAĞLAR.
 *
 * İki yol buraya çıkar: cüzdan yeni bir oturumu onayladığında ve sayfa
 * yeniden yüklenip SAKLI oturum geri yüklendiğinde. Tek yerde durması,
 * geri yüklenen bir oturumun yeni onaylanmış olandan farklı davranmasını
 * imkânsız kılar.
 */
function adoptSession(
  provider: WalletConnectProvider,
  session: WalletConnectSession | undefined,
  locale: Locale,
): WalletResult<WalletInfo> {
  const defaultChain = pickDefaultChainId(session);
  if (defaultChain === null) {
    return { ok: false, code: "noAccount" };
  }
  provider.setDefaultChain(`eip155:${defaultChain}`);

  registerWalletConnectProvider(createSessionAdapter(provider, session));
  activeProvider = provider;
  // Oturum kopunca uuid hiçbir provider'a çözülmemeli.
  provider.on("disconnect", forgetWalletConnectProvider);
  provider.on("session_delete", forgetWalletConnectProvider);

  return { ok: true, value: sessionWalletInfo(session, locale) };
}

/**
 * SAKLI oturumu geri yükler — karekod göstermeden, cüzdana gitmeden.
 *
 * WalletConnect oturumları kalıcıdır: bir kez onaylandıktan sonra kütüphane
 * onu saklar ve sonraki açılışlarda geri getirir. Bunu kullanmazsak kullanıcı
 * uygulamayı her açtığında yeniden bağlanmak zorunda kalır ve gereksiz bir kez
 * daha cüzdana gidip gelir.
 *
 * Geri yüklenecek bir şey yoksa `null` döner — bu bir HATA DEĞİLDİR, sadece
 * "önceki oturum yok" demektir; çağıran taraf normal bağlanma akışını sunar.
 */
export async function restoreWalletConnect(deps?: {
  createProvider?: WalletConnectFactory;
  locale?: Locale;
}): Promise<WalletResult<WalletInfo> | null> {
  const projectId = normalizeProjectId(CONFIGURED_PROJECT_ID);
  if (projectId === null) {
    return null;
  }

  let provider: WalletConnectProvider;
  try {
    provider = await (deps?.createProvider ?? defaultProviderFactory)(projectId);
  } catch {
    return null;
  }

  /*
   * Tek denetim iki durumu birden kapsar: hiç saklı oturum olmaması ve
   * hesabı kalmamış bir oturum olması. İkincisi kullanıcının cüzdan tarafında
   * bağlantıyı kesmesiyle olur; bağlıymış gibi göstermek onu ilk imzada
   * anlaşılmaz bir hataya götürürdü.
   */
  const session = provider.session;
  if (pickDefaultChainId(session) === null) {
    return null;
  }

  return adoptSession(provider, session, deps?.locale ?? DEFAULT_LOCALE);
}

/** Gerçek kütüphane YALNIZCA burada yüklenir. */
const defaultProviderFactory: WalletConnectFactory = async (projectId) => {
  const { UniversalProvider } = await import("@walletconnect/universal-provider");
  const provider = await UniversalProvider.init({
    projectId,
    metadata: {
      name: translate(DEFAULT_LOCALE, "app.name"),
      description: translate(DEFAULT_LOCALE, "app.tagline"),
      url: window.location.origin,
      icons: [],
    },
  });
  return provider as unknown as WalletConnectProvider;
};

/**
 * Oturum açmaya başlar ve QR basılabilsin diye URI'yi HEMEN döndürür; onay
 * ayrı bir söz olarak beklenir.
 */
export async function beginWalletConnect(deps?: {
  createProvider?: WalletConnectFactory;
  locale?: Locale;
}): Promise<WalletResult<WalletConnectHandle>> {
  const projectId = normalizeProjectId(CONFIGURED_PROJECT_ID);
  if (projectId === null) {
    return { ok: false, code: "noProvider" };
  }

  const locale = deps?.locale ?? DEFAULT_LOCALE;
  let provider: WalletConnectProvider;
  try {
    provider = await (deps?.createProvider ?? defaultProviderFactory)(projectId);
  } catch {
    return { ok: false, code: "requestFailed" };
  }

  let announceUri: (uri: string) => void = () => undefined;
  const firstUri = new Promise<string>((resolve) => {
    announceUri = resolve;
  });
  const onDisplayUri = (...args: unknown[]) => {
    if (typeof args[0] === "string") {
      announceUri(args[0]);
    }
  };
  provider.on("display_uri", onDisplayUri);

  const approved: Promise<WalletResult<WalletInfo>> = provider
    .connect({ optionalNamespaces: buildOptionalNamespaces() })
    .then((session) => {
      provider.removeListener("display_uri", onDisplayUri);
      return adoptSession(provider, session ?? provider.session, locale);
    })
    .catch((error: unknown) => {
      provider.removeListener("display_uri", onDisplayUri);
      const code = numericCode(normalizeError(error));
      return {
        ok: false as const,
        code: code === 4001 ? ("rejected" as const) : ("requestFailed" as const),
      };
    });

  // Bağlantı URI'den önce düşerse sonsuza kadar beklenmez.
  const uri = await Promise.race([
    firstUri,
    approved.then(() => null),
  ]);
  if (uri === null) {
    return { ok: false, code: "requestFailed" };
  }

  return {
    ok: true,
    value: {
      uri,
      approved,
      cancel: async () => {
        provider.removeListener("display_uri", onDisplayUri);
        try {
          await provider.disconnect();
        } catch {
          // Henüz oturum yoksa kapatacak bir şey de yoktur.
        }
      },
    },
  };
}

/** Kullanıcı bağlantıyı kesince hem oturum hem kayıt düşer. */
export async function disconnectWalletConnect(): Promise<void> {
  const provider = activeProvider;
  activeProvider = null;
  forgetWalletConnectProvider();
  if (provider === null) {
    return;
  }
  try {
    await provider.disconnect();
  } catch {
    // Oturum zaten kapalıysa yapılacak bir şey yok.
  }
}
