import { afterEach, describe, expect, it, vi } from "vitest";

import { translate } from "../i18n/dictionary";
import { DEFAULT_LOCALE } from "../i18n/locale";
import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_RPC_URL } from "./network";
import {
  ARC_CAIP_CHAIN,
  REQUESTED_METHODS,
  approvedChainIds,
  buildOptionalNamespaces,
  buildWalletDeepLink,
  createSessionAdapter,
  normalizeError,
  normalizeProjectId,
  pickDefaultChainId,
  providerError,
  sessionWalletInfo,
  type WalletConnectProvider,
  type WalletConnectSession,
} from "./walletconnect";

/**
 * İKİNCİ KAYNAĞIN SÖZLEŞMESİ.
 *
 * Gerçek WalletConnect kütüphanesi burada hiç yüklenmez: dışarıya bakan tek
 * nokta enjekte edilebilir bir fabrikadır, geri kalan her şey saf ya da
 * sahte bir provider ile sınanır. Böylece ağ, röle ve QR taraması olmadan
 * oturum mantığının tamamı ölçülebilir.
 */

const ADDRESS = "0x1111111111111111111111111111111111111111";
const ARC_ACCOUNT = `eip155:${ARC_TESTNET_CHAIN_ID}:${ADDRESS}`;
const MAINNET_ACCOUNT = `eip155:1:${ADDRESS}`;
const VALID_URI = `wc:${"a".repeat(64)}@2?relay-protocol=irn&symKey=${"b".repeat(64)}`;

type Listener = (...args: unknown[]) => void;

function session(
  accounts: readonly string[],
  methods: readonly string[] = [...REQUESTED_METHODS],
): WalletConnectSession {
  return {
    namespaces: { eip155: { accounts: [...accounts], methods: [...methods] } },
    peer: { metadata: { name: "Test Cüzdanı" } },
  };
}

/** Yalnızca cüzdan adını değiştiren oturum; `metadata` hiç olmayabilir. */
function sessionNamed(metadata: Record<string, unknown> | undefined) {
  return {
    namespaces: { eip155: { accounts: [ARC_ACCOUNT], methods: [] } },
    peer: metadata === undefined ? {} : { metadata },
  } as WalletConnectSession;
}

function fakeProvider(options: { emitUri?: boolean } = {}) {
  const listeners = new Map<string, Listener[]>();
  let settle: {
    resolve: (value: WalletConnectSession | undefined) => void;
    reject: (error: unknown) => void;
  } | null = null;

  let markConnectCalled: () => void = () => undefined;
  const connectCalled = new Promise<void>((resolve) => {
    markConnectCalled = resolve;
  });

  const state = {
    connectParams: null as unknown,
    defaultChain: null as string | null,
    disconnects: 0,
    requests: [] as { method: string }[],
    result: "sonuç" as unknown,
    error: null as unknown,
  };

  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of [...(listeners.get(event) ?? [])]) {
      listener(...args);
    }
  };

  const provider: WalletConnectProvider = {
    async connect(params) {
      state.connectParams = params;
      markConnectCalled();
      if (options.emitUri !== false) {
        emit("display_uri", VALID_URI);
      }
      return new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
    async disconnect() {
      state.disconnects += 1;
    },
    async request(args) {
      state.requests.push({ method: args.method });
      if (state.error !== null) {
        throw state.error;
      }
      return state.result;
    },
    setDefaultChain(chain) {
      state.defaultChain = chain;
    },
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    removeListener(event, listener) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((l) => l !== listener),
      );
    },
  };

  return {
    provider,
    state,
    emit,
    connectCalled,
    countOf: (event: string) => (listeners.get(event) ?? []).length,
    approve: (value: WalletConnectSession | undefined) => settle?.resolve(value),
    reject: (error: unknown) => settle?.reject(error),
  };
}

describe("projectId", () => {
  it("boş ya da yalnızca boşluk TANIMSIZ sayılır", () => {
    expect(normalizeProjectId("")).toBeNull();
    expect(normalizeProjectId("   ")).toBeNull();
    expect(normalizeProjectId("\n\t")).toBeNull();
  });

  it("çevresindeki boşluk kırpılır", () => {
    expect(normalizeProjectId("  abc123  ")).toBe("abc123");
  });
});

describe("istenen oturum kapsamı", () => {
  const namespaces = buildOptionalNamespaces();

  it("Arc YALNIZCA isteğe bağlı istenir", () => {
    expect(Object.keys(namespaces)).toEqual(["eip155"]);
    expect(namespaces.eip155.chains).toEqual([ARC_CAIP_CHAIN]);
    expect(ARC_CAIP_CHAIN).toBe(`eip155:${ARC_TESTNET_CHAIN_ID}`);
  });

  it("rpcMap İKİ anahtarla da Arc RPC'sini gösterir", () => {
    // Kütüphane önce tam CAIP kimliğiyle, bulamazsa zincir numarasıyla okur.
    expect(namespaces.eip155.rpcMap[ARC_CAIP_CHAIN]).toBe(ARC_TESTNET_RPC_URL);
    expect(namespaces.eip155.rpcMap[String(ARC_TESTNET_CHAIN_ID)]).toBe(
      ARC_TESTNET_RPC_URL,
    );
  });

  it("yalnızca uygulamanın GERÇEKTEN çağırdığı yöntemler istenir", () => {
    expect([...namespaces.eip155.methods].sort()).toEqual([
      "eth_sendTransaction",
      "eth_signTypedData_v4",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ]);
    expect(namespaces.eip155.events).toEqual([
      "accountsChanged",
      "chainChanged",
    ]);
  });

  it("başka bir ağ İSTENMEZ", () => {
    expect(JSON.stringify(namespaces)).not.toContain("eip155:1\"");
    expect(namespaces.eip155.chains).toHaveLength(1);
  });
});

describe("onaylanan zincirler", () => {
  it("hesaplardan çıkarılır ve tekilleşir", () => {
    expect(
      approvedChainIds(session([ARC_ACCOUNT, MAINNET_ACCOUNT, ARC_ACCOUNT])),
    ).toEqual([ARC_TESTNET_CHAIN_ID, 1]);
  });

  it("bozuk hesap satırları ELENİR", () => {
    expect(
      approvedChainIds(
        session([
          "solana:mainnet:abc",
          "eip155:onaltılık:0x1",
          "eip155:",
          ARC_ACCOUNT,
        ]),
      ),
    ).toEqual([ARC_TESTNET_CHAIN_ID]);
  });

  it("oturum yoksa boş liste", () => {
    expect(approvedChainIds(undefined)).toEqual([]);
    expect(approvedChainIds({})).toEqual([]);
  });
});

describe("varsayılan zincir seçimi", () => {
  it("Arc onaylandıysa Arc seçilir", () => {
    expect(pickDefaultChainId(session([MAINNET_ACCOUNT, ARC_ACCOUNT]))).toBe(
      ARC_TESTNET_CHAIN_ID,
    );
  });

  it("Arc onaylanmadıysa onaylanan ilk zincire düşülür", () => {
    // Arc'ı zorlamak hesap listesini boşaltır: kullanıcı bağlanamamış görünür.
    expect(pickDefaultChainId(session([MAINNET_ACCOUNT]))).toBe(1);
  });

  it("hiç hesap yoksa null", () => {
    expect(pickDefaultChainId(session([]))).toBeNull();
  });
});

describe("oturumdan cüzdan bilgisi", () => {
  it("ayrılmış uuid ile ve cüzdanın kendi adıyla üretilir", () => {
    const info = sessionWalletInfo(session([ARC_ACCOUNT]));
    expect(info.uuid).toBe("walletconnect:eip155");
    expect(info.name).toBe("Test Cüzdanı");
    expect(info.rdns).toBe("");
  });

  it("ad yoksa ya da boşsa sözlükteki yedek ad kullanılır", () => {
    const fallback = translate(DEFAULT_LOCALE, "wallet.fallbackName");
    expect(sessionWalletInfo(sessionNamed(undefined)).name).toBe(fallback);
    expect(sessionWalletInfo(sessionNamed({})).name).toBe(fallback);
    expect(sessionWalletInfo(sessionNamed({ name: "   " })).name).toBe(fallback);
    expect(sessionWalletInfo(sessionNamed({ name: 42 })).name).toBe(fallback);
  });

  it("UZAK ikon hiçbir koşulda taşınmaz", () => {
    // `safeIcon` ile aynı sınır: yalnızca gömülü ikon olurdu, uzak adres asla.
    const withIcons = {
      ...session([ARC_ACCOUNT]),
      peer: {
        metadata: { name: "Cüzdan", icons: ["https://cuzdan.example/i.png"] },
      },
    } as WalletConnectSession;
    expect(sessionWalletInfo(withIcons).icon).toBeNull();
    expect(JSON.stringify(sessionWalletInfo(withIcons))).not.toContain("http");
  });
});

describe("hata çevirisi", () => {
  it("kullanıcı reddi kodları 4001'e çevrilir", () => {
    for (const code of [5000, 5001, 5002, 5003]) {
      expect(normalizeError(providerError(code, "x"))).toMatchObject({
        code: 4001,
      });
    }
  });

  it("desteklenmeyen zincir 4902'ye çevrilir: ağ EKLEME denemesi tetiklensin", () => {
    expect(normalizeError(providerError(5100, "x"))).toMatchObject({
      code: 4902,
    });
  });

  it("zaten EIP-1193 olan kodlara DOKUNULMAZ", () => {
    const rejected = providerError(4001, "x");
    expect(normalizeError(rejected)).toBe(rejected);
    const unsupported = providerError(4902, "x");
    expect(normalizeError(unsupported)).toBe(unsupported);
  });

  it("ilgisiz kodlar ve kodsuz hatalar aynen geçer", () => {
    const other = providerError(6000, "x");
    expect(normalizeError(other)).toBe(other);
    const plain = new Error("kopuk");
    expect(normalizeError(plain)).toBe(plain);
    expect(normalizeError("dize")).toBe("dize");
  });
});

describe("derin bağlantı", () => {
  it("geçerli eşleşme URI'si kabul edilir", () => {
    expect(buildWalletDeepLink(VALID_URI)).toBe(VALID_URI);
  });

  it("WalletConnect olmayan HİÇBİR adres kabul edilmez", () => {
    for (const bad of [
      "https://kotu.example/",
      "javascript:alert(1)",
      "wc:kısa@2?x=1",
      "WC-benzeri",
      "",
      `wc:${"a".repeat(64)}@2`,
    ]) {
      expect(buildWalletDeepLink(bad), bad).toBeNull();
    }
  });
});

describe("oturum adaptörü", () => {
  it("istekleri olduğu gibi iletir", async () => {
    const fake = fakeProvider();
    const adapter = createSessionAdapter(fake.provider, session([ARC_ACCOUNT]));
    await expect(
      adapter.request({ method: "eth_signTypedData_v4", params: [] }),
    ).resolves.toBe("sonuç");
    expect(fake.state.requests).toEqual([{ method: "eth_signTypedData_v4" }]);
  });

  it("ONAYLANMAYAN ağ çağrısı HTTP RPC'ye gitmeden 4902 ile kesilir", async () => {
    const fake = fakeProvider();
    const adapter = createSessionAdapter(
      fake.provider,
      session([MAINNET_ACCOUNT], []),
    );
    await expect(
      adapter.request({ method: "wallet_switchEthereumChain", params: [] }),
    ).rejects.toMatchObject({ code: 4902 });
    await expect(
      adapter.request({ method: "wallet_addEthereumChain", params: [] }),
    ).rejects.toMatchObject({ code: 4902 });
    // Kütüphaneye hiç ulaşmaz.
    expect(fake.state.requests).toEqual([]);
  });

  it("yöntem onaylandıysa ağ çağrısı iletilir", async () => {
    const fake = fakeProvider();
    const adapter = createSessionAdapter(
      fake.provider,
      session([MAINNET_ACCOUNT], ["wallet_switchEthereumChain"]),
    );
    await adapter.request({ method: "wallet_switchEthereumChain", params: [] });
    expect(fake.state.requests).toEqual([
      { method: "wallet_switchEthereumChain" },
    ]);
  });

  it("Arc zaten onaylıysa ağ çağrısı iletilir", async () => {
    const fake = fakeProvider();
    const adapter = createSessionAdapter(fake.provider, session([ARC_ACCOUNT], []));
    await adapter.request({ method: "wallet_switchEthereumChain", params: [] });
    expect(fake.state.requests).toHaveLength(1);
  });

  it("istek hataları EIP-1193 koduna çevrilerek fırlatılır", async () => {
    const fake = fakeProvider();
    fake.state.error = providerError(5000, "kullanıcı reddetti");
    const adapter = createSessionAdapter(fake.provider, session([ARC_ACCOUNT]));
    await expect(
      adapter.request({ method: "eth_sendTransaction" }),
    ).rejects.toMatchObject({ code: 4001 });
  });

  it("oturum kopunca `accountsChanged` BOŞ listeyle yayılır", async () => {
    const fake = fakeProvider();
    const adapter = createSessionAdapter(fake.provider, session([ARC_ACCOUNT]));
    const seen: unknown[][] = [];
    const listener = (...args: unknown[]) => seen.push(args);

    adapter.on?.("accountsChanged", listener);
    fake.emit("disconnect", { code: 6000 });
    fake.emit("session_delete", {});

    expect(seen).toEqual([[[]], [[]]]);
  });

  it("abonelik kaldırılınca kopuş köprüsü de kaldırılır", () => {
    const fake = fakeProvider();
    const adapter = createSessionAdapter(fake.provider, session([ARC_ACCOUNT]));
    const listener = () => undefined;

    adapter.on?.("accountsChanged", listener);
    expect(fake.countOf("disconnect")).toBe(1);
    expect(fake.countOf("session_delete")).toBe(1);

    adapter.removeListener?.("accountsChanged", listener);
    expect(fake.countOf("accountsChanged")).toBe(0);
    expect(fake.countOf("disconnect")).toBe(0);
    expect(fake.countOf("session_delete")).toBe(0);
  });

  it("`chainChanged` için köprü KURULMAZ", () => {
    const fake = fakeProvider();
    const adapter = createSessionAdapter(fake.provider, session([ARC_ACCOUNT]));
    adapter.on?.("chainChanged", () => undefined);
    expect(fake.countOf("chainChanged")).toBe(1);
    expect(fake.countOf("disconnect")).toBe(0);
  });
});

/* --------------------------------------------------------------------- */
/* Bağlanma akışı — modül düzeyindeki projectId yeniden yüklenerek ölçülür */
/* --------------------------------------------------------------------- */

const savedProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

afterEach(() => {
  if (savedProjectId === undefined) {
    delete process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  } else {
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = savedProjectId;
  }
});

async function freshModules(projectId: string | undefined) {
  vi.resetModules();
  if (projectId === undefined) {
    delete process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  } else {
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = projectId;
  }
  const wc = await import("./walletconnect");
  const wallet = await import("./wallet");
  return { wc, wallet };
}

describe("bağlanma akışı", () => {
  it("projectId yoksa WalletConnect HİÇ sunulmaz", async () => {
    const { wc } = await freshModules(undefined);
    expect(wc.isWalletConnectConfigured()).toBe(false);
    await expect(wc.beginWalletConnect()).resolves.toEqual({
      ok: false,
      code: "noProvider",
    });
  });

  it("projectId varsa sunulur ve eşleşme URI'si HEMEN döner", async () => {
    const { wc } = await freshModules("proje-1");
    const fake = fakeProvider();
    expect(wc.isWalletConnectConfigured()).toBe(true);

    const started = await wc.beginWalletConnect({
      createProvider: async () => fake.provider,
    });

    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // Onay beklenmeden QR basılabilir.
    expect(started.value.uri).toBe(VALID_URI);
    expect(wc.buildWalletDeepLink(started.value.uri)).toBe(VALID_URI);
  });

  it("onay gelince adaptör KAYIT DEFTERİNE yazılır ve uuid ile çözülür", async () => {
    const { wc, wallet } = await freshModules("proje-1");
    const fake = fakeProvider();
    const started = await wc.beginWalletConnect({
      createProvider: async () => fake.provider,
    });
    if (!started.ok) throw new Error("başlamalıydı");

    fake.approve(session([ARC_ACCOUNT]));
    await expect(started.value.approved).resolves.toEqual({
      ok: true,
      value: {
        uuid: wallet.WALLETCONNECT_UUID,
        name: "Test Cüzdanı",
        rdns: "",
        icon: null,
      },
    });

    fake.state.result = "0x4cef52";
    await expect(wallet.getChainId(wallet.WALLETCONNECT_UUID)).resolves.toEqual({
      ok: true,
      value: ARC_TESTNET_CHAIN_ID,
    });
  });

  it("Arc onaylandıysa varsayılan zincir Arc yapılır", async () => {
    const { wc } = await freshModules("proje-1");
    const fake = fakeProvider();
    const started = await wc.beginWalletConnect({
      createProvider: async () => fake.provider,
    });
    if (!started.ok) throw new Error("başlamalıydı");

    fake.approve(session([MAINNET_ACCOUNT, ARC_ACCOUNT]));
    await started.value.approved;
    expect(fake.state.defaultChain).toBe(ARC_CAIP_CHAIN);
  });

  it("Arc onaylanmadıysa onaylanan zincire düşülür: bağlantı yine kurulur", async () => {
    const { wc } = await freshModules("proje-1");
    const fake = fakeProvider();
    const started = await wc.beginWalletConnect({
      createProvider: async () => fake.provider,
    });
    if (!started.ok) throw new Error("başlamalıydı");

    fake.approve(session([MAINNET_ACCOUNT]));
    await expect(started.value.approved).resolves.toMatchObject({ ok: true });
    expect(fake.state.defaultChain).toBe("eip155:1");
  });

  it("hiç hesap onaylanmazsa hesap yok sayılır", async () => {
    const { wc } = await freshModules("proje-1");
    const fake = fakeProvider();
    const started = await wc.beginWalletConnect({
      createProvider: async () => fake.provider,
    });
    if (!started.ok) throw new Error("başlamalıydı");

    fake.approve(session([]));
    await expect(started.value.approved).resolves.toEqual({
      ok: false,
      code: "noAccount",
    });
  });

  it("cüzdan reddederse RET olarak raporlanır", async () => {
    const { wc } = await freshModules("proje-1");
    const fake = fakeProvider();
    const started = await wc.beginWalletConnect({
      createProvider: async () => fake.provider,
    });
    if (!started.ok) throw new Error("başlamalıydı");

    fake.reject(providerError(5000, "kullanıcı reddetti"));
    await expect(started.value.approved).resolves.toEqual({
      ok: false,
      code: "rejected",
    });
  });

  it("oturum kopunca kayıt SİLİNİR", async () => {
    const { wc, wallet } = await freshModules("proje-1");
    const fake = fakeProvider();
    const started = await wc.beginWalletConnect({
      createProvider: async () => fake.provider,
    });
    if (!started.ok) throw new Error("başlamalıydı");

    fake.approve(session([ARC_ACCOUNT]));
    await started.value.approved;
    fake.emit("session_delete", {});

    await expect(
      wallet.withProvider(wallet.WALLETCONNECT_UUID, async () => "ulaştı"),
    ).resolves.toEqual({ ok: false, code: "noProvider" });
  });

  it("bağlantı kesilince hem oturum hem kayıt düşer", async () => {
    const { wc, wallet } = await freshModules("proje-1");
    const fake = fakeProvider();
    const started = await wc.beginWalletConnect({
      createProvider: async () => fake.provider,
    });
    if (!started.ok) throw new Error("başlamalıydı");

    fake.approve(session([ARC_ACCOUNT]));
    await started.value.approved;
    await wc.disconnectWalletConnect();

    expect(fake.state.disconnects).toBe(1);
    await expect(
      wallet.withProvider(wallet.WALLETCONNECT_UUID, async () => "ulaştı"),
    ).resolves.toEqual({ ok: false, code: "noProvider" });
  });

  it("vazgeçilirse bekleyen girişim kapatılır", async () => {
    const { wc } = await freshModules("proje-1");
    const fake = fakeProvider();
    const started = await wc.beginWalletConnect({
      createProvider: async () => fake.provider,
    });
    if (!started.ok) throw new Error("başlamalıydı");

    await started.value.cancel();
    expect(fake.state.disconnects).toBe(1);
  });

  it("provider hiç kurulamazsa istek başarısız sayılır", async () => {
    const { wc } = await freshModules("proje-1");
    await expect(
      wc.beginWalletConnect({
        createProvider: async () => {
          throw new Error("röleye ulaşılamadı");
        },
      }),
    ).resolves.toEqual({ ok: false, code: "requestFailed" });
  });

  it("URI gelmeden bağlantı düşerse SONSUZA KADAR beklenmez", async () => {
    const { wc } = await freshModules("proje-1");
    const fake = fakeProvider({ emitUri: false });
    const pending = wc.beginWalletConnect({
      createProvider: async () => fake.provider,
    });
    await fake.connectCalled;
    fake.reject(new Error("röle kapandı"));
    await expect(pending).resolves.toEqual({
      ok: false,
      code: "requestFailed",
    });
  });
});
