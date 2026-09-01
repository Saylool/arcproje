import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * WALLETCONNECT'İN ARAYÜZ SÖZLEŞMESİ.
 *
 * Depoda bileşen testi altyapısı yoktur (vitest `node` ortamında koşar), bu
 * yüzden DOM davranışı kaynak düzeyinde kilitlenir — `ui-contract.test.ts`
 * ile aynı desen. Buradaki testler ikinci kaynağın masaüstü yolunu
 * bozmadığını ve gerçek kütüphanenin tek bir yerden yüklendiğini sabitler.
 */

const read = (path: string) => readFileSync(path, "utf8");

/** Yorumlar SÖZLEŞME DEĞİLDİR: bir kuralı anlatan yorum onu ihlal etmez. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
}

const WALLET_COMPONENTS = [
  "src/components/PaymentRequestCreator.tsx",
  "src/components/PaymentRequestPayer.tsx",
  "src/components/SharedBillCreator.tsx",
  "src/components/SharedBillDebtorView.tsx",
] as const;

const panel = withoutComments(read("src/components/WalletConnectPanel.tsx"));

describe("EIP-6963 keşfi arayüzde DEĞİŞMEDİ", () => {
  it("keşif sonucu doğrudan listeye yazılır: WalletConnect araya girmez", () => {
    for (const file of WALLET_COMPONENTS) {
      const source = withoutComments(read(file));
      expect(source, file).toContain(`const found = await discoverWallets();
    setWallets(found);
    setWalletsScanned(true);`);
    }
  });

  it("cüzdan listesi hâlâ YALNIZCA keşfedilenlerden çizilir", () => {
    for (const file of WALLET_COMPONENTS) {
      const source = withoutComments(read(file));
      // Panel, listeyi çizen `wallets.map` ifadesinin İÇİNDE değildir.
      expect(source, file).toMatch(/wallets\.map\(/);
      expect(source, file).not.toMatch(
        /wallets\.map\([\s\S]{0,400}WalletConnectPanel/,
      );
    }
  });

  it("panel açılır listenin YANINDADIR ve yalnızca bağlanmadan önce görünür", () => {
    for (const file of WALLET_COMPONENTS) {
      const source = withoutComments(read(file));
      expect(source, file).toMatch(
        /\{account === null && \(\s*<WalletConnectPanel onConnected=\{adoptWalletConnect\} \/>/,
      );
    }
  });
});

describe("onaylanan oturum mevcut bağlanma akışına bağlanır", () => {
  it("her bileşen oturumu listeye ekler, seçer ve AYNI akışı sürdürür", () => {
    for (const file of WALLET_COMPONENTS) {
      const source = withoutComments(read(file));
      expect(source, file).toContain(
        "const adoptWalletConnect = async (info: WalletInfo) => {",
      );
      expect(source, file).toContain("setSelectedWalletUuid(info.uuid);");
      expect(source, file).toContain("await connectWith(info.uuid);");
    }
  });

  it("düğmeyle bağlanma da AYNI ortak akışı çağırır: iki yol ayrışmaz", () => {
    for (const file of WALLET_COMPONENTS) {
      const source = withoutComments(read(file));
      expect(source, file).toContain("await connectWith(selectedWalletUuid);");
    }
  });
});

describe("panelin sınırları", () => {
  it("projectId yoksa panel HİÇ çizilmez", () => {
    expect(panel).toMatch(/if \(!isWalletConnectConfigured\(\)\) \{\s*return null;/);
  });

  it("karekod YERELDE üretilir; uzak görüntü çekilmez", () => {
    expect(panel).toContain('import { renderSVG } from "uqr";');
    expect(panel).not.toMatch(/<img/);
    expect(panel).not.toMatch(/https?:\/\//);
  });

  it("derin bağlantı DOĞRULANMADAN href'e konmaz", () => {
    expect(panel).toContain("buildWalletDeepLink(stage.handle.uri)");
    // Ham URI hiçbir bağlantıya doğrudan verilmez.
    expect(panel).not.toMatch(/href=\{[^}]*\.uri\}/);
    expect(panel).toContain("href={deepLink}");
  });

  it("vazgeçilen girişimin geç gelen sonucu ekrana YAZILMAZ", () => {
    expect(panel).toContain("if (activeHandle.current !== started.value) {");
  });
});

describe("kütüphane sınırı", () => {
  const sources = [
    ...WALLET_COMPONENTS,
    "src/components/WalletConnectPanel.tsx",
    "src/lib/arc/wallet.ts",
    "src/lib/arc/walletconnect.ts",
    "src/lib/arc/send.ts",
  ] as const;

  it("gerçek kütüphane TEK yerden ve DİNAMİK olarak yüklenir", () => {
    const importers = sources.filter((file) =>
      read(file).includes("@walletconnect/"),
    );
    expect(importers).toEqual(["src/lib/arc/walletconnect.ts"]);
    expect(read("src/lib/arc/walletconnect.ts")).toContain(
      'await import("@walletconnect/universal-provider")',
    );
  });

  it("hiçbir bileşen provider nesnesine dokunmaz: yalnızca uuid taşınır", () => {
    for (const file of [...WALLET_COMPONENTS, "src/components/WalletConnectPanel.tsx"]) {
      const source = withoutComments(read(file));
      expect(source, file).not.toContain("registerWalletConnectProvider");
      expect(source, file).not.toContain("createSessionAdapter");
    }
  });

  it("GÖNDERİM sınırı WalletConnect'ten habersizdir", () => {
    // İkinci kaynağın tüm anlamı bu: `send.ts` tek satır bile değişmez.
    const send = read("src/lib/arc/send.ts");
    expect(send.toLowerCase()).not.toContain("walletconnect");
    expect(send).toContain("withProvider(walletUuid,");
  });
});
