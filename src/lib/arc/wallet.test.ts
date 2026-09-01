import { afterEach, describe, expect, it, vi } from "vitest";

import { translate } from "../i18n/dictionary";
import {
  ARC_TESTNET_CHAIN_ID_HEX,
  buildAddArcTestnetParams,
} from "./network";
import { DEFAULT_LOCALE } from "../i18n/locale";
import type { WalletInfo } from "./wallet";

/**
 * EIP-6963 KEŞFİNİN SÖZLEŞMESİ.
 *
 * Bu dosya tarayıcı cüzdanı keşfinin BUGÜNKÜ davranışını olduğu gibi kilitler
 * ve WalletConnect ikinci bir kaynak olarak eklenmeden ÖNCE yazılmıştır.
 * Masaüstü davranışının değişmediğini kanıtlayan tek yer burasıdır: buradaki
 * bir kırmızı, ikinci kaynağın birinciyi bozduğu anlamına gelir.
 *
 * Depoda jsdom yoktur (vitest `node` ortamında koşar), bu yüzden `window`
 * Node'un kendi `EventTarget`'i üzerine kurulan en küçük vekille taklit
 * edilir. Bağımlılık eklemeden gerçek olay akışı elde edilir.
 */

class FakeWindow extends EventTarget {
  /** `discoverWallets` yalnızca bu ikisini kullanır. */
  setTimeout(handler: () => void, ms: number): unknown {
    return globalThis.setTimeout(handler, ms);
  }
}

type WalletModule = typeof import("./wallet");

function installWindow(): FakeWindow {
  const win = new FakeWindow();
  (globalThis as { window?: unknown }).window = win;
  return win;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.useRealTimers();
});

/**
 * Modül düzeyindeki provider kayıt defteri testler arasında YAŞAR. Her test
 * kendi temiz defterini alsın diye modül yeniden yüklenir.
 */
async function freshWallet(): Promise<WalletModule> {
  vi.resetModules();
  return import("./wallet");
}

/** İzi sürülebilir, geçerli bir EIP-1193 provider'ı. */
function fakeProvider(marker: string) {
  return { request: async () => marker };
}

function walletDetail(
  info: Record<string, unknown>,
  provider: unknown = fakeProvider("varsayılan"),
): unknown {
  return { info, provider };
}

function announceOn(win: FakeWindow, detail: unknown): void {
  win.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
}

/** Gerçek cüzdanlar gibi: istek olayını duyup kendini duyurur. */
function respondWith(win: FakeWindow, details: readonly unknown[]): void {
  win.addEventListener("eip6963:requestProvider", () => {
    for (const detail of details) {
      announceOn(win, detail);
    }
  });
}

async function discover(
  details: readonly unknown[],
): Promise<{ wallets: WalletInfo[]; mod: WalletModule; win: FakeWindow }> {
  const win = installWindow();
  const mod = await freshWallet();
  respondWith(win, details);
  return { wallets: await mod.discoverWallets(5), mod, win };
}

const ALPHA = {
  uuid: "11111111-1111-4111-8111-111111111111",
  name: "Alpha",
  icon: "data:image/svg+xml;base64,QUFB",
  rdns: "com.alpha",
};
const BETA = {
  uuid: "22222222-2222-4222-8222-222222222222",
  name: "Beta",
  icon: "data:image/png;base64,QkJC",
  rdns: "com.beta",
};

describe("keşif SUNUCUDA hiçbir şey yapmaz", () => {
  it("`window` yokken boş liste döner", async () => {
    expect((globalThis as { window?: unknown }).window).toBeUndefined();
    const mod = await freshWallet();
    await expect(mod.discoverWallets(5)).resolves.toEqual([]);
  });
});

describe("duyurulan cüzdanlar", () => {
  it("istek olayı YAYINLANIR: cüzdanlar kendiliğinden konuşmaz", async () => {
    const win = installWindow();
    const mod = await freshWallet();
    let requests = 0;
    win.addEventListener("eip6963:requestProvider", () => {
      requests += 1;
    });
    await mod.discoverWallets(5);
    expect(requests).toBe(1);
  });

  it("tek cüzdanın alanları BİREBİR taşınır", async () => {
    const { wallets } = await discover([walletDetail(ALPHA)]);
    expect(wallets).toEqual([
      {
        uuid: ALPHA.uuid,
        name: "Alpha",
        rdns: "com.alpha",
        icon: "data:image/svg+xml;base64,QUFB",
      },
    ]);
  });

  it("duyuru SIRASI korunur", async () => {
    const { wallets } = await discover([
      walletDetail(BETA),
      walletDetail(ALPHA),
    ]);
    expect(wallets.map((w) => w.uuid)).toEqual([BETA.uuid, ALPHA.uuid]);
  });

  it("aynı uuid TEKİLLEŞİR: son duyuru kazanır, sıra ilk yerinde kalır", async () => {
    const { wallets, mod } = await discover([
      walletDetail(ALPHA, fakeProvider("eski")),
      walletDetail(BETA),
      walletDetail({ ...ALPHA, name: "Alpha v2" }, fakeProvider("yeni")),
    ]);
    expect(wallets.map((w) => w.uuid)).toEqual([ALPHA.uuid, BETA.uuid]);
    expect(wallets[0].name).toBe("Alpha v2");
    // Kayıt defterinde de son provider durur.
    await expect(
      mod.withProvider(ALPHA.uuid, (p) => p.request({ method: "eth_chainId" })),
    ).resolves.toEqual({ ok: true, value: "yeni" });
  });

  it("provider KAYIT DEFTERİNE yazılır ve modül içinden ulaşılır", async () => {
    const { mod } = await discover([
      walletDetail(ALPHA, fakeProvider("alpha-provider")),
    ]);
    await expect(
      mod.withProvider(ALPHA.uuid, (p) => p.request({ method: "eth_chainId" })),
    ).resolves.toEqual({ ok: true, value: "alpha-provider" });
  });
});

describe("bozuk duyurular ELENİR", () => {
  const bozuk: readonly [string, unknown][] = [
    ["detail yok", undefined],
    ["detail null", null],
    ["info yok", { provider: fakeProvider("x") }],
    ["uuid string değil", walletDetail({ ...ALPHA, uuid: 42 })],
    ["uuid yok", walletDetail({ name: "Adsız", icon: null, rdns: "com.x" })],
    ["provider yok", { info: ALPHA }],
    ["provider null", { info: ALPHA, provider: null }],
    ["request fonksiyon değil", { info: ALPHA, provider: { request: "hayır" } }],
  ];

  for (const [label, detail] of bozuk) {
    it(`${label} → cüzdan sayılmaz`, async () => {
      const { wallets, mod } = await discover([detail]);
      expect(wallets).toEqual([]);
      // Kayıt defterine de sızmaz.
      await expect(
        mod.withProvider(ALPHA.uuid, async () => "ulaştı"),
      ).resolves.toEqual({ ok: false, code: "noProvider" });
    });
  }

  it("bozuk bir duyuru SAĞLAM olanı düşürmez", async () => {
    const { wallets } = await discover([
      walletDetail({ ...ALPHA, uuid: 42 }),
      walletDetail(BETA),
    ]);
    expect(wallets.map((w) => w.uuid)).toEqual([BETA.uuid]);
  });
});

describe("eksik alanlar SESSİZCE düşer", () => {
  it("ad string değilse sözlükteki yedek ad kullanılır", async () => {
    const { wallets } = await discover([
      walletDetail({ ...ALPHA, name: undefined }),
    ]);
    expect(wallets[0].name).toBe(translate(DEFAULT_LOCALE, "wallet.fallbackName"));
    expect(wallets[0].name).toBe("Cüzdan");
  });

  it("rdns string değilse boş dizeye düşer", async () => {
    const { wallets } = await discover([
      walletDetail({ ...ALPHA, rdns: { evil: true } }),
    ]);
    expect(wallets[0].rdns).toBe("");
  });
});

describe("ikon YALNIZCA gömülü olabilir", () => {
  const ikonlar: readonly [string, unknown, string | null][] = [
    ["data:image/svg+xml", "data:image/svg+xml;base64,QUFB", "data:image/svg+xml;base64,QUFB"],
    ["data:image/png", "data:image/png;base64,QkJC", "data:image/png;base64,QkJC"],
    ["uzak https adresi", "https://cuzdan.example/icon.png", null],
    ["uzak http adresi", "http://cuzdan.example/icon.png", null],
    ["data ama resim değil", "data:text/html,<script>alert(1)</script>", null],
    ["büyük harfli şema", "DATA:IMAGE/PNG;base64,QkJC", null],
    ["başında boşluk", " data:image/png;base64,QkJC", null],
    ["string değil", { toString: () => "data:image/png;base64,QkJC" }, null],
    ["yok", undefined, null],
  ];

  for (const [label, icon, expected] of ikonlar) {
    it(`${label} → ${expected === null ? "null" : "korunur"}`, async () => {
      const { wallets } = await discover([walletDetail({ ...ALPHA, icon })]);
      expect(wallets[0].icon).toBe(expected);
    });
  }
});

describe("provider DIŞARI sızmaz", () => {
  it("dönen nesnede yalnızca serileştirilebilir dört alan vardır", async () => {
    const provider = fakeProvider("gizli");
    const { wallets } = await discover([walletDetail(ALPHA, provider)]);
    expect(Object.keys(wallets[0]).sort()).toEqual([
      "icon",
      "name",
      "rdns",
      "uuid",
    ]);
    expect(Object.values(wallets[0])).not.toContain(provider);
    expect(JSON.stringify(wallets[0])).not.toContain("request");
  });
});

describe("süre", () => {
  it("varsayılan bekleme 350 ms'dir", async () => {
    vi.useFakeTimers();
    const win = installWindow();
    const mod = await freshWallet();
    respondWith(win, [walletDetail(ALPHA)]);

    let settled = false;
    const pending = mod.discoverWallets().then((value) => {
      settled = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(349);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect((await pending).map((w) => w.uuid)).toEqual([ALPHA.uuid]);
  });

  it("süre dolduktan SONRA gelen duyuru ne listeye ne kayda girer", async () => {
    const win = installWindow();
    const mod = await freshWallet();
    const wallets = await mod.discoverWallets(5);
    expect(wallets).toEqual([]);

    // Dinleyici kaldırıldığı için bu duyuru hiçbir yere ulaşmaz.
    announceOn(win, walletDetail(ALPHA, fakeProvider("geç kalan")));

    await expect(
      mod.withProvider(ALPHA.uuid, async () => "ulaştı"),
    ).resolves.toEqual({ ok: false, code: "noProvider" });
  });
});

/**
 * İKİNCİ KAYNAĞIN SINIRI.
 *
 * WalletConnect aynı kayıt defterine yazar. Buradaki testler o yuvanın
 * duyurulan bir provider tarafından ELE GEÇİRİLEMEYECEĞİNİ ve kaydın dört
 * çağrı yerinin hepsinde yalnızca uuid ile çözüldüğünü sabitler.
 */
describe("ayrılmış WalletConnect kaydı", () => {
  const UUIDV4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it("ayrılmış uuid UUIDv4 DEĞİLDİR: gerçek bir cüzdanla çakışamaz", async () => {
    const mod = await freshWallet();
    expect(mod.WALLETCONNECT_UUID).not.toMatch(UUIDV4);
    expect(ALPHA.uuid).toMatch(UUIDV4);
  });

  it("duyurulan bir provider ayrılmış yuvayı ELE GEÇİREMEZ", async () => {
    const win = installWindow();
    const mod = await freshWallet();
    mod.registerWalletConnectProvider(fakeProvider("gerçek oturum"));

    respondWith(win, [
      walletDetail(
        { ...ALPHA, uuid: mod.WALLETCONNECT_UUID, name: "Sahte WalletConnect" },
        fakeProvider("saldırgan"),
      ),
    ]);
    const wallets = await mod.discoverWallets(5);

    // Ne listeye girer...
    expect(wallets).toEqual([]);
    // ...ne de kurulu oturumu ezer.
    await expect(
      mod.withProvider(mod.WALLETCONNECT_UUID, (p) =>
        p.request({ method: "eth_chainId" }),
      ),
    ).resolves.toEqual({ ok: true, value: "gerçek oturum" });
  });

  it("ayrılmış uuid'li duyuru SAĞLAM cüzdanları düşürmez", async () => {
    const win = installWindow();
    const mod = await freshWallet();
    respondWith(win, [
      walletDetail({ ...ALPHA, uuid: mod.WALLETCONNECT_UUID }),
      walletDetail(BETA),
    ]);
    expect((await mod.discoverWallets(5)).map((w) => w.uuid)).toEqual([
      BETA.uuid,
    ]);
  });

  it("kaydedilen provider'a çağrı yerleri yalnızca uuid ile ulaşır", async () => {
    const mod = await freshWallet();
    mod.registerWalletConnectProvider({
      request: async ({ method }) =>
        method === "eth_requestAccounts"
          ? ["0x1111111111111111111111111111111111111111"]
          : "0x4cef52",
    });

    await expect(mod.requestAccounts(mod.WALLETCONNECT_UUID)).resolves.toEqual({
      ok: true,
      value: ["0x1111111111111111111111111111111111111111"],
    });
    await expect(mod.getChainId(mod.WALLETCONNECT_UUID)).resolves.toEqual({
      ok: true,
      value: 5042002,
    });
  });

  it("oturum kapanınca kayıt SİLİNİR", async () => {
    const mod = await freshWallet();
    mod.registerWalletConnectProvider(fakeProvider("oturum"));
    mod.forgetWalletConnectProvider();

    await expect(
      mod.withProvider(mod.WALLETCONNECT_UUID, async () => "ulaştı"),
    ).resolves.toEqual({ ok: false, code: "noProvider" });
  });
});

/* --------------------------------------------------------------------- */
/* AĞ DEĞİŞTİRME                                                           */
/* --------------------------------------------------------------------- */

/**
 * `switchToArcTestnet`'in sözleşmesi.
 *
 * Mobil cüzdanların ağ değiştirmeye verdiği yanıt düzensiz olduğu için bu
 * fonksiyon Faz 2'de değişecek. Değişmeyecek olan her şey ÖNCE burada
 * kilitleniyor: hangi zincire geçilmek istendiği, ekleme denemesinin YALNIZCA
 * tanınmayan zincirde yapılması, eklenen ağın resmî yapılandırması ve hata
 * kodlarının eşlenmesi.
 *
 * Provider kayıt defterine WalletConnect dikişiyle konuyor; `switchToArcTestnet`
 * provider'ın oraya nasıl geldiğine bakmaz, bu yüzden EIP-6963 duyurusunu
 * taklit etmeye gerek yok.
 */
type Behaviour = {
  onSwitch?: () => unknown;
  onAdd?: () => unknown;
  onChainId?: () => unknown;
};

function recordingProvider(behaviour: Behaviour = {}) {
  const calls: { method: string; params?: unknown }[] = [];
  const provider = {
    request: async ({ method, params }: { method: string; params?: unknown }) => {
      calls.push({ method, params });
      if (method === "wallet_switchEthereumChain") {
        return behaviour.onSwitch?.() ?? null;
      }
      if (method === "wallet_addEthereumChain") {
        return behaviour.onAdd?.() ?? null;
      }
      if (method === "eth_chainId") {
        return behaviour.onChainId?.() ?? "0x4cef52";
      }
      return null;
    },
  };
  return {
    provider,
    calls,
    methods: () => calls.map((c) => c.method),
    paramsOf: (method: string) =>
      calls.find((c) => c.method === method)?.params,
  };
}

function providerError(code: number): Error & { code: number } {
  return Object.assign(new Error("test"), { code });
}

async function withSwitchProvider(behaviour: Behaviour = {}) {
  const mod = await freshWallet();
  const rec = recordingProvider(behaviour);
  mod.registerWalletConnectProvider(rec.provider);
  return { mod, rec, uuid: mod.WALLETCONNECT_UUID };
}

describe("Arc Testnet'e geçiş", () => {
  it("provider yoksa hiçbir istek yapılmaz", async () => {
    const mod = await freshWallet();
    await expect(mod.switchToArcTestnet("yok")).resolves.toEqual({
      ok: false,
      code: "noProvider",
    });
  });

  it("geçiş DOĞRU zincir kimliğiyle istenir", async () => {
    const { mod, rec, uuid } = await withSwitchProvider();
    await mod.switchToArcTestnet(uuid);

    // Hex sabiti elle yazılsaydı yanlış ağa geçilebilirdi; ikisi de sabitlenir.
    expect(rec.paramsOf("wallet_switchEthereumChain")).toEqual([
      { chainId: "0x4cef52" },
    ]);
    expect(ARC_TESTNET_CHAIN_ID_HEX).toBe("0x4cef52");
  });

  it("geçiş kabul edilirse ağ EKLEME hiç denenmez", async () => {
    const { mod, rec, uuid } = await withSwitchProvider();
    await expect(mod.switchToArcTestnet(uuid)).resolves.toMatchObject({
      ok: true,
    });
    expect(rec.methods()).not.toContain("wallet_addEthereumChain");
  });

  it("kullanıcı reddederse ekleme denenmez", async () => {
    const { mod, rec, uuid } = await withSwitchProvider({
      onSwitch: () => {
        throw providerError(4001);
      },
    });
    await expect(mod.switchToArcTestnet(uuid)).resolves.toEqual({
      ok: false,
      code: "rejected",
    });
    // Reddedilen bir isteğin ardından ağ eklemeye çalışmak kullanıcıyı zorlardı.
    expect(rec.methods()).not.toContain("wallet_addEthereumChain");
  });

  it("beklenmedik hata requestFailed olur ve ekleme denenmez", async () => {
    const { mod, rec, uuid } = await withSwitchProvider({
      onSwitch: () => {
        throw new Error("kopuk");
      },
    });
    await expect(mod.switchToArcTestnet(uuid)).resolves.toEqual({
      ok: false,
      code: "requestFailed",
    });
    expect(rec.methods()).not.toContain("wallet_addEthereumChain");
  });

  it("TANINMAYAN zincirde (4902) ağ eklenir ve yeniden geçilir", async () => {
    let attempts = 0;
    const { mod, rec, uuid } = await withSwitchProvider({
      onSwitch: () => {
        attempts += 1;
        if (attempts === 1) {
          throw providerError(4902);
        }
        return null;
      },
    });

    await expect(mod.switchToArcTestnet(uuid)).resolves.toMatchObject({
      ok: true,
    });
    expect(rec.methods().filter((m) => m.startsWith("wallet_"))).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ]);
  });

  it("eklenen ağın parametreleri RESMÎ yapılandırmadır", async () => {
    let attempts = 0;
    const { mod, rec, uuid } = await withSwitchProvider({
      onSwitch: () => {
        attempts += 1;
        if (attempts === 1) throw providerError(4902);
        return null;
      },
    });
    await mod.switchToArcTestnet(uuid);

    expect(rec.paramsOf("wallet_addEthereumChain")).toEqual([
      buildAddArcTestnetParams(),
    ]);
    // Gas gösterimi 18 ondalıktır; transfer tutarının 6 ondalığıyla karışmaz.
    expect(buildAddArcTestnetParams().nativeCurrency.decimals).toBe(18);
    expect(buildAddArcTestnetParams().chainId).toBe("0x4cef52");
  });

  it("ağ ekleme reddedilirse ret olarak taşınır", async () => {
    const { mod, uuid } = await withSwitchProvider({
      onSwitch: () => {
        throw providerError(4902);
      },
      onAdd: () => {
        throw providerError(4001);
      },
    });
    await expect(mod.switchToArcTestnet(uuid)).resolves.toEqual({
      ok: false,
      code: "rejected",
    });
  });

  it("ekleme sonrası ikinci geçiş düşerse hata YUTULMAZ", async () => {
    let attempts = 0;
    const { mod, uuid } = await withSwitchProvider({
      onSwitch: () => {
        attempts += 1;
        if (attempts === 1) throw providerError(4902);
        throw providerError(4001);
      },
    });
    await expect(mod.switchToArcTestnet(uuid)).resolves.toEqual({
      ok: false,
      code: "rejected",
    });
  });
});

/**
 * SESSİZ BAŞARISIZLIK.
 *
 * Faz 2'nin bütün konusu bu: cüzdan "tamam" deyip ağı değiştirmiyor. Eskiden
 * bu durum başarı sayılıyordu, kullanıcı hiçbir mesaj görmeden aynı düğmeye
 * basıp duruyordu. Artık ayrı bir kodla raporlanır.
 */
describe("cüzdan kabul edip ağı DEĞİŞTİRMEZSE", () => {
  it("başarı sayılmaz, ayrı bir kodla bildirilir", async () => {
    const { mod, rec, uuid } = await withSwitchProvider({
      // İstek çözülüyor ama zincir olduğu yerde kalıyor.
      onChainId: () => "0x1",
    });

    await expect(mod.switchToArcTestnet(uuid)).resolves.toEqual({
      ok: false,
      code: "switchIgnored",
    });
    // Cüzdan hata atmadığı için ağ EKLEME yolu tetiklenmez.
    expect(rec.methods()).not.toContain("wallet_addEthereumChain");
  });

  it("ağ eklendikten SONRA da yakalanır", async () => {
    let attempts = 0;
    const { mod, rec, uuid } = await withSwitchProvider({
      onSwitch: () => {
        attempts += 1;
        if (attempts === 1) throw providerError(4902);
        return null;
      },
      onChainId: () => "0x1",
    });

    await expect(mod.switchToArcTestnet(uuid)).resolves.toEqual({
      ok: false,
      code: "switchIgnored",
    });
    expect(rec.methods()).toContain("wallet_addEthereumChain");
  });

  it("zincir OKUNAMAZSA geçildi denmez", async () => {
    // Doğrulanamayan bir geçiş, başarısı varsayılan bir geçişten iyidir.
    const { mod, uuid } = await withSwitchProvider({
      onChainId: () => {
        throw new Error("kopuk");
      },
    });
    await expect(mod.switchToArcTestnet(uuid)).resolves.toEqual({
      ok: false,
      code: "requestFailed",
    });
  });

  it("zincir ANLAMSIZ dönerse de geçildi denmez", async () => {
    const { mod, uuid } = await withSwitchProvider({
      onChainId: () => "0x4cef52junk",
    });
    await expect(mod.switchToArcTestnet(uuid)).resolves.toEqual({
      ok: false,
      code: "requestFailed",
    });
  });

  it("zincir ondalık dizeyle dönse bile doğru okunur", async () => {
    const { mod, uuid } = await withSwitchProvider({
      onChainId: () => "5042002",
    });
    await expect(mod.switchToArcTestnet(uuid)).resolves.toEqual({
      ok: true,
      value: true,
    });
  });

  it("doğrulama zinciri HER ZAMAN yeniden okur", async () => {
    const { mod, rec, uuid } = await withSwitchProvider();
    await mod.switchToArcTestnet(uuid);
    expect(rec.methods()).toContain("eth_chainId");
  });
});
