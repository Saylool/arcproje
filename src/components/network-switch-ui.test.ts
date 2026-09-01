import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_EXPLORER_URL,
  ARC_TESTNET_RPC_URL,
} from "@/lib/arc/network";

/**
 * AĞ DEĞİŞTİRME ARAYÜZÜNÜN SÖZLEŞMESİ.
 *
 * Depoda bileşen testi altyapısı yok, bu yüzden DOM davranışı kaynak düzeyinde
 * kilitlenir — `ui-contract.test.ts` ile aynı desen.
 */

const read = (path: string) => readFileSync(path, "utf8");

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

const panel = withoutComments(read("src/components/ArcNetworkParameters.tsx"));

describe("dört bileşen AYNI yorumu kullanır", () => {
  it("hepsi ortak eşlemeyi çağırır", () => {
    for (const file of WALLET_COMPONENTS) {
      const source = withoutComments(read(file));
      expect(source, file).toContain(
        "messageKey(switchFailureMessage(switched.code))",
      );
      expect(source, file).toContain(
        "setManualNetwork(needsManualNetwork(switched.code))",
      );
    }
  });

  it("hiçbiri kendi başına mesaj SEÇMEZ", () => {
    // Ayrışma tam olarak buradan başlamıştı: her bileşen kendi ternary'sini
    // yazıyordu ve ikisi diğer ikisinden farklı şey söylüyordu.
    for (const file of WALLET_COMPONENTS) {
      const source = withoutComments(read(file));
      expect(source, file).not.toContain('"wallet.switchRejected"');
      expect(source, file).not.toContain('"wallet.switchFailed"');
      expect(source, file).not.toContain('"wallet.switchIgnored"');
      expect(source, file).not.toContain('"wallet.switchUnsupported"');
    }
  });

  it("telefonda YANLIŞ olan eski tavsiye hiçbir yerde kalmadı", () => {
    // "Cüzdanından Arc Testnet'i seç" — ağ listede yokken seçilemez.
    for (const file of [...WALLET_COMPONENTS, "src/lib/i18n/tr.ts", "src/lib/i18n/en.ts"]) {
      expect(read(file), file).not.toContain("switchFailedPickManually");
    }
  });
});

describe("parametre paneli", () => {
  it("yalnızca ağın elle eklenmesi gerektiğinde çizilir", () => {
    for (const file of WALLET_COMPONENTS) {
      const source = withoutComments(read(file));
      expect(source, file).toMatch(
        /\{manualNetwork && <ArcNetworkParameters \/>\}/,
      );
    }
  });

  it("her denemeden ÖNCE sıfırlanır: eski panel ekranda kalmaz", () => {
    for (const file of WALLET_COMPONENTS) {
      const source = withoutComments(read(file));
      expect(source, file).toContain(
        `setManualNetwork(false);
    const switched = await switchToArcTestnet(selectedWalletUuid);`,
      );
    }
  });
});

describe("gösterilen değerler", () => {
  it("ağ profilinden okunur, ELLE yazılmaz", () => {
    // Elle yazılmış bir RPC ya da zincir kimliği kullanıcıyı yanlış ağa
    // bağlardı; profildeki değer değişirse panel sessizce eskimemeli.
    expect(panel).toContain("ACTIVE_NETWORK_PROFILE.displayName");
    expect(panel).toContain("ARC_TESTNET_CHAIN_ID");
    expect(panel).toContain("ARC_TESTNET_RPC_URL");
    expect(panel).toContain("ARC_TESTNET_EXPLORER_URL");

    expect(panel).not.toContain(ARC_TESTNET_RPC_URL);
    expect(panel).not.toContain(ARC_TESTNET_EXPLORER_URL);
    expect(panel).not.toContain(String(ARC_TESTNET_CHAIN_ID));
  });

  it("gas sembolü kullanılır: cüzdan ağ eklerken onu sorar", () => {
    expect(panel).toContain("ACTIVE_NETWORK_PROFILE.nativeGasSymbol");
  });

  it("etiketler sözlükten gelir, değerler çevrilmez", () => {
    expect(panel).toContain('"wallet.networkName"');
    expect(panel).toContain('"wallet.rpcUrl"');
    // Değer doğrudan basılır; `t(value)` olsaydı veri metne dönerdi.
    expect(panel).toContain("<dd className=\"break-all font-mono text-warn-ink\">{value}</dd>");
  });

  it("panoya kopyalama başarısız olursa SESSİZCE yutulmaz", () => {
    expect(panel).toContain("setCopied(false)");
  });
});
