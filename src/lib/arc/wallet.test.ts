import { afterEach, describe, expect, it, vi } from "vitest";

import { translate } from "../i18n/dictionary";
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
