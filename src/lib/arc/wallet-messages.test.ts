import { describe, expect, it } from "vitest";

import { translate } from "../i18n/dictionary";
import { LOCALES } from "../i18n/locale";
import { needsManualNetwork, switchFailureMessage } from "./wallet-messages";
import type { WalletErrorCode } from "./wallet";

/**
 * AĞ DEĞİŞTİRME MESAJLARININ SÖZLEŞMESİ.
 *
 * Dört bileşen bu eşlemeyi ayrı ayrı yazdığı için birbirinden ayrılmıştı.
 * Artık tek yerde ve burada ölçülüyor.
 */

const ALL_CODES = [
  "noProvider",
  "rejected",
  "noAccount",
  "unsupportedChain",
  "switchIgnored",
  "requestFailed",
] as const;

/**
 * `WalletErrorCode`'a yeni bir kod eklenip buraya yazılmazsa bu satır
 * DERLENMEZ; eşlemenin bir kodu sessizce atlaması imkânsız olur.
 */
const exhaustive: (typeof ALL_CODES)[number] extends WalletErrorCode
  ? WalletErrorCode extends (typeof ALL_CODES)[number]
    ? true
    : never
  : never = true;

describe("hata kodu → mesaj", () => {
  it("kod listesi eksiksizdir", () => {
    expect(exhaustive).toBe(true);
  });

  it("her kod GERÇEK bir sözlük anahtarına gider", () => {
    for (const code of ALL_CODES) {
      const key = switchFailureMessage(code);
      for (const locale of LOCALES) {
        // `translate` bulamadığı anahtarı olduğu gibi döndürür.
        expect(translate(locale, key), `${code}/${locale}`).not.toBe(key);
        expect(translate(locale, key), `${code}/${locale}`).not.toBe("");
      }
    }
  });

  it("ret, sessiz yutma ve tanınmayan ağ AYRI cümleler alır", () => {
    expect(switchFailureMessage("rejected")).toBe("wallet.switchRejected");
    expect(switchFailureMessage("switchIgnored")).toBe("wallet.switchIgnored");
    expect(switchFailureMessage("unsupportedChain")).toBe(
      "wallet.switchUnsupported",
    );

    const distinct = new Set(
      (["rejected", "switchIgnored", "unsupportedChain"] as const).map((c) =>
        translate("tr", switchFailureMessage(c)),
      ),
    );
    expect(distinct.size).toBe(3);
  });

  it("geri kalanı genel hataya düşer", () => {
    for (const code of ["noProvider", "noAccount", "requestFailed"] as const) {
      expect(switchFailureMessage(code), code).toBe("wallet.switchFailed");
    }
  });
});

describe("ağın elle eklenmesi gerektiği durumlar", () => {
  it("YALNIZCA ağ yoksa ya da istek sessizce yutulduysa", () => {
    expect(needsManualNetwork("unsupportedChain")).toBe(true);
    expect(needsManualNetwork("switchIgnored")).toBe(true);
  });

  it("REDDEDİLEN istekte gösterilmez: orada yeniden denemek anlamlıdır", () => {
    expect(needsManualNetwork("rejected")).toBe(false);
  });

  it("geri kalan kodlarda gösterilmez", () => {
    for (const code of ["noProvider", "noAccount", "requestFailed"] as const) {
      expect(needsManualNetwork(code), code).toBe(false);
    }
  });
});
