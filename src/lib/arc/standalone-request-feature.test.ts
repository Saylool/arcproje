import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACTIVE_NETWORK_PROFILE } from "./profile";
import {
  STANDALONE_REQUEST_FLOW_ENABLED,
  standaloneRequestFlowEnabled,
} from "./standalone-request-feature";

/**
 * TEK-LINK AKISI YALNIZCA TEST AGINDA.
 *
 * Tekrar oynatma engeli yereldir; gercek parada bu akis kapali kalmalidir.
 * Ana ag profili henuz yok — kapinin onun icin KAPANDIGI, sahte bir profille
 * simdiden kanitlanir ki profil eklendiginde kimse bunu hatirlamak zorunda
 * kalmasin.
 */

describe("kapi", () => {
  it("bugunku profil test agidir ve akis ACIKTIR", () => {
    expect(ACTIVE_NETWORK_PROFILE.isTestnet).toBe(true);
    expect(standaloneRequestFlowEnabled(ACTIVE_NETWORK_PROFILE)).toBe(true);
    expect(STANDALONE_REQUEST_FLOW_ENABLED).toBe(true);
  });

  it("test agi olmayan bir profilde akis KAPANIR", () => {
    expect(standaloneRequestFlowEnabled({ isTestnet: false })).toBe(false);
  });

  it("belirsiz bir profil ACMAZ: yalnizca acik `true` acar", () => {
    expect(
      standaloneRequestFlowEnabled({ isTestnet: undefined as unknown as boolean }),
    ).toBe(false);
  });
});

describe("kapi GERCEKTEN bagli", () => {
  it("odeme sayfasi odeyiciyi kapinin arkasinda kurar", () => {
    const page = readFileSync("src/app/pay/page.tsx", "utf8");
    expect(page).toContain("STANDALONE_REQUEST_FLOW_ENABLED");
    expect(page.indexOf("STANDALONE_REQUEST_FLOW_ENABLED")).toBeLessThan(
      page.indexOf("<PaymentRequestPayer"),
    );
    /* Kapali durumda sozlukten gelen bir aciklama basilir; sessiz bos sayfa degil. */
    expect(page).toContain("payer.closedOnMainnet");
  });

  it("olusturma ekrani tek-link olusturucuyu kapinin arkasinda kurar", () => {
    const flow = readFileSync("src/components/ReceiptFlow.tsx", "utf8");
    expect(flow).toContain("STANDALONE_REQUEST_FLOW_ENABLED");
    expect(flow.indexOf("STANDALONE_REQUEST_FLOW_ENABLED")).toBeLessThan(
      flow.indexOf("<PaymentRequestCreator"),
    );
  });
});
