import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { translate, type TranslationKey } from "../i18n/dictionary";
import { ACTIVE_NETWORK_PROFILE } from "./profile";
import {
  buildSharedBillTypedData,
  createSharedBill,
  proveSharedBillDebt,
} from "./shared-bill";
import {
  describeViewProblem,
  fetchAuthenticatedDebt,
  requestAccessChallenge,
  submitAccessResolution,
  verifyAuthenticatedView,
} from "./shared-bill-access-client";

/**
 * METİN ARTIK BİLEŞENDE DEĞİL SÖZLÜKTEDİR.
 *
 * Sözleşme iki parçada doğrulanır: bileşen doğru ANAHTARI kullanıyor mu ve
 * sözlük o anahtar altında beklenen TÜRKÇE cümleyi taşıyor mu. İngilizce
 * karşılığın boş olmadığı da kontrol edilir.
 */
function expectShows(
  source: string,
  key: TranslationKey,
  expectedTurkish: string,
): void {
  expect(source, key).toContain(key);
  expect(translate("tr", key), key).toContain(expectedTurkish);
  expect(translate("en", key), key).not.toBe("");
}
import {
  SHARED_BILL_SESSION_COOKIE,
} from "@/lib/db/shared-bill-access-service";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
} from "@/lib/http/shared-bill-route-helpers";

/**
 * Borclu tarafinin SUNUCUYA GUVENMEYEN dogrulamasi, cerez politikasi ve
 * arayuz sozlesmesi.
 *
 * Depoda bilesen testi altyapisi yok; arayuzun yapmadiklari kaynak duzeyinde
 * dogrulanir (CoinGecko, tahmin, App Kit, depolama, islem yok).
 */

const CHAIN = ACTIVE_NETWORK_PROFILE.chainId;
const NOW = 1_700_000_000_000;
const BILL_ID = `0x${"7a".repeat(32)}`;

async function seed() {
  const recipient = privateKeyToAccount(generatePrivateKey());
  const debtors = [
    privateKeyToAccount(generatePrivateKey()),
    privateKeyToAccount(generatePrivateKey()),
    privateKeyToAccount(generatePrivateKey()),
  ];
  const created = createSharedBill({
    recipient: recipient.address,
    recipientLabel: "Poyraz",
    debts: debtors.map((wallet, index) => ({
      debtor: wallet.address,
      debtorLabel: `Kisi${index}`,
      debtKey: `k${index}->p`,
      tryMinor: String(1000 + index),
    })),
    nowMs: NOW,
    billId: BILL_ID,
  });
  if (!created.ok) throw new Error(created.problem);

  const typed = buildSharedBillTypedData(created.manifest);
  const signature = await recipient.signTypedData({
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
  });

  // Kanonik siradaki ilk satirin sahibi.
  const debt = created.debts[0];
  const owner = debtors.find(
    (wallet) => wallet.address.toLowerCase() === debt.debtor.toLowerCase(),
  );
  if (owner === undefined) throw new Error("sahip bulunamadi");
  const proof = proveSharedBillDebt({
    chainId: CHAIN,
    billId: BILL_ID,
    debts: created.debts,
    leafIndex: 0,
  });
  if (proof === null) throw new Error("kanit uretilemedi");

  return {
    manifest: created.manifest,
    debts: created.debts,
    signature,
    debt,
    owner,
    proof,
    payload: {
      manifest: created.manifest,
      recipientSignature: signature,
      recipient: {
        address: created.manifest.recipient,
        label: created.manifest.recipientLabel,
      },
      debt,
      proof,
      billExpiresAt: created.manifest.expiresAt,
      status: "open",
    },
  };
}

describe("istemci BAGIMSIZ dogrulama", () => {
  it("durust yanit kabul edilir", async () => {
    const seeded = await seed();
    const result = await verifyAuthenticatedView({
      payload: seeded.payload,
      connectedAddress: seeded.owner.address,
      connectedChainId: CHAIN,
      billId: BILL_ID,
      nowMs: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.debt.tryMinor).toBe(seeded.debt.tryMinor);
    expect(result.view.recipient.address).toBe(seeded.manifest.recipient);
  });

  it("ALICI IMZASI bozuksa borc GOSTERILMEZ", async () => {
    const seeded = await seed();
    const attacker = privateKeyToAccount(generatePrivateKey());
    const typed = buildSharedBillTypedData(seeded.manifest);
    const foreign = await attacker.signTypedData({
      domain: typed.domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
    });

    const result = await verifyAuthenticatedView({
      payload: { ...seeded.payload, recipientSignature: foreign },
      connectedAddress: seeded.owner.address,
      connectedChainId: CHAIN,
      billId: BILL_ID,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, problem: "invalidRecipientSignature" });
  });

  it("MERKLE KANITI bozuksa borc GOSTERILMEZ", async () => {
    const seeded = await seed();
    for (const proof of [
      { leafIndex: 0, siblings: [] },
      { leafIndex: 1, siblings: seeded.proof.siblings },
      { leafIndex: 0, siblings: [...seeded.proof.siblings].reverse() },
      { leafIndex: 0, siblings: [`0x${"aa".repeat(32)}`, `0x${"bb".repeat(32)}`] },
    ]) {
      const result = await verifyAuthenticatedView({
        payload: { ...seeded.payload, proof },
        connectedAddress: seeded.owner.address,
        connectedChainId: CHAIN,
        billId: BILL_ID,
        nowMs: NOW,
      });
      expect(result.ok, JSON.stringify(proof.leafIndex)).toBe(false);
    }
  });

  it("SATIR kurcalanirsa kanit tutmaz", async () => {
    const seeded = await seed();
    for (const mutation of [
      { tryMinor: "999999" },
      { debtorLabel: "Baska" },
      { debtKey: "x->p" },
    ]) {
      const result = await verifyAuthenticatedView({
        payload: { ...seeded.payload, debt: { ...seeded.debt, ...mutation } },
        connectedAddress: seeded.owner.address,
        connectedChainId: CHAIN,
        billId: BILL_ID,
        nowMs: NOW,
      });
      expect(result, JSON.stringify(mutation)).toEqual({
        ok: false,
        problem: "invalidProof",
      });
    }
  });

  it("BASKA cuzdanin satiri gosterilmez", async () => {
    const seeded = await seed();
    const stranger = privateKeyToAccount(generatePrivateKey());
    const result = await verifyAuthenticatedView({
      payload: seeded.payload,
      connectedAddress: stranger.address,
      connectedChainId: CHAIN,
      billId: BILL_ID,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, problem: "walletMismatch" });
  });

  it("YANLIS ZINCIRDE hicbir sey gosterilmez", async () => {
    const seeded = await seed();
    for (const chainId of [1, 11155111, null, CHAIN + 1]) {
      const result = await verifyAuthenticatedView({
        payload: seeded.payload,
        connectedAddress: seeded.owner.address,
        connectedChainId: chainId,
        billId: BILL_ID,
        nowMs: NOW,
      });
      expect(result, String(chainId)).toEqual({ ok: false, problem: "wrongChain" });
    }
  });

  it("SURESI DOLMUS manifest gosterilmez", async () => {
    const seeded = await seed();
    const result = await verifyAuthenticatedView({
      payload: seeded.payload,
      connectedAddress: seeded.owner.address,
      connectedChainId: CHAIN,
      billId: BILL_ID,
      nowMs: (seeded.manifest.expiresAt + 60) * 1000,
    });
    expect(result).toEqual({ ok: false, problem: "invalidManifest" });
  });

  it("BASKA hesabin manifesti gosterilmez", async () => {
    const seeded = await seed();
    const result = await verifyAuthenticatedView({
      payload: seeded.payload,
      connectedAddress: seeded.owner.address,
      connectedChainId: CHAIN,
      billId: `0x${"5b".repeat(32)}`,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, problem: "invalidManifest" });
  });

  it("KAPALI hesap gosterilmez", async () => {
    const seeded = await seed();
    const result = await verifyAuthenticatedView({
      payload: { ...seeded.payload, status: "closed" },
      connectedAddress: seeded.owner.address,
      connectedChainId: CHAIN,
      billId: BILL_ID,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, problem: "notOpen" });
  });

  it("bozuk yanit sekilleri reddedilir", async () => {
    const seeded = await seed();
    for (const payload of [
      null,
      "abc",
      {},
      { ...seeded.payload, recipientSignature: "0xkisa" },
      { ...seeded.payload, proof: { leafIndex: -1, siblings: [] } },
      { ...seeded.payload, proof: { leafIndex: 0, siblings: ["kotu"] } },
      { ...seeded.payload, billExpiresAt: "yakinda" },
    ]) {
      const result = await verifyAuthenticatedView({
        payload,
        connectedAddress: seeded.owner.address,
        connectedChainId: CHAIN,
        billId: BILL_ID,
        nowMs: NOW,
      });
      expect(result.ok, JSON.stringify(payload)?.slice(0, 40)).toBe(false);
    }
  });

  it("her sorun icin bir aciklama vardir", () => {
    for (const problem of [
      "malformedResponse",
      "invalidManifest",
      "invalidRecipientSignature",
      "invalidProof",
      "walletMismatch",
      "wrongChain",
      "notOpen",
    ] as const) {
      expect(describeViewProblem(problem).length).toBeGreaterThan(0);
    }
  });
});

describe("API istemcisi yanitlari KATI dogrular", () => {
  function jsonResponse(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("meydan okuma yaniti bicimi katidir", async () => {
    const good = vi.fn(async () =>
      jsonResponse({ challenge: { a: 1 }, tag: `0x${"11".repeat(32)}` }),
    );
    expect(
      (await requestAccessChallenge(BILL_ID, "0xabc", good as never)).ok,
    ).toBe(true);

    for (const bad of [
      { challenge: { a: 1 }, tag: "0xkisa" },
      { challenge: null, tag: `0x${"11".repeat(32)}` },
      { tag: `0x${"11".repeat(32)}` },
      "abc",
    ]) {
      const fetchImpl = vi.fn(async () => jsonResponse(bad));
      expect(
        (await requestAccessChallenge(BILL_ID, "0xabc", fetchImpl as never)).ok,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("sunucunun KARARLI KODU tasinir; metni arayuz kendi secer", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: "NOT_AVAILABLE", message: "Bulunamadi." } }, 404),
    );
    expect(
      await requestAccessChallenge(BILL_ID, "0xabc", fetchImpl as never),
    ).toEqual({ ok: false, message: "Bulunamadi.", code: "NOT_AVAILABLE" });
  });

  it("ag hatasi genel mesaja duser", async () => {
    const throwing = vi.fn(async () => {
      throw new Error("ag");
    });
    expect((await requestAccessChallenge(BILL_ID, "0xabc", throwing as never)).ok).toBe(false);
    expect(
      (
        await submitAccessResolution(
          BILL_ID,
          { challenge: {}, tag: "0x", signature: "0x" },
          throwing as never,
        )
      ).ok,
    ).toBe(false);
    expect((await fetchAuthenticatedDebt(BILL_ID, throwing as never)).ok).toBe(false);
  });

  it("cozumleme ve /me AYNI KOKEN cerezini kullanir", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      return jsonResponse({ authenticated: true });
    });
    await submitAccessResolution(
      BILL_ID,
      { challenge: {}, tag: "0x", signature: "0x" },
      fetchImpl as never,
    );
    await fetchAuthenticatedDebt(BILL_ID, fetchImpl as never);
    for (const init of calls) {
      expect(init.credentials).toBe("same-origin");
      expect(init.cache).toBe("no-store");
    }
  });
});

describe("oturum cerezi politikasi", () => {
  it("HttpOnly ve SameSite=Strict her zaman vardir", () => {
    const cookie = buildSessionCookie("jeton", 900, false);
    expect(cookie).toContain(`${SHARED_BILL_SESSION_COOKIE}=jeton`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=900");
  });

  it("URETIMDE Secure zorunlu, gelistirmede degil", () => {
    expect(buildSessionCookie("jeton", 900, true)).toContain("Secure");
    expect(buildSessionCookie("jeton", 900, false)).not.toContain("Secure");
  });

  it("temizleme cerezi jetonu bosaltir ve suresini sifirlar", () => {
    const cleared = buildClearedSessionCookie(true);
    expect(cleared).toContain(`${SHARED_BILL_SESSION_COOKIE}=;`);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
  });
});

describe("borclu arayuzu sozlesmesi", () => {
  const view = readFileSync("src/components/SharedBillDebtorView.tsx", "utf8");
  const page = readFileSync("src/app/pay/[billId]/page.tsx", "utf8");

  it("gorunumun KENDISI hicbir odeme cagrisi YAPMAZ", () => {
    /*
     * Part 3'te odeme ACILDI ama bu bilesen hala yalnizca DOGRULAMA yapar:
     * kur cekme, tahmin, App Kit ve gonderim AYRI panelde yasar ve panel
     * ancak dogrulama gectikten SONRA takilir.
     */
    for (const forbidden of [
      "fetchQuoteFromServer",
      "verifyQuoteWithServer",
      "estimateArcSend",
      "sendArcUsdc",
      "app-kit",
      "convertTryMinorToMicroUsdc",
    ]) {
      expect(view.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it("odeme paneli YALNIZCA dogrulanmis gorunumun ICINDE takilir", () => {
    // Panel, `stage.status === "ready"` blogunun icindedir.
    const readyBlock = view.slice(view.indexOf('stage.status === "ready"'));
    expect(readyBlock).toContain("<SharedBillPaymentPanel");
    // Panel referansi baska hicbir yerde gecmez (import disinda).
    const mounts = view.split("<SharedBillPaymentPanel").length - 1;
    expect(mounts).toBe(1);
  });

  it("hesap/ag/borc degisince panel SOKULUR (key ile)", () => {
    const mount = view.slice(view.indexOf("<SharedBillPaymentPanel"));
    expect(mount).toContain("key={");
    expect(mount).toContain("account.toLowerCase()");
    expect(mount).toContain("chainId");
    expect(mount).toContain("debtKey");
    expect(mount).toContain("tryMinor");
  });

  it("tutar gosteriminde `number` daraltmasi yapilmaz", () => {
    expect(view).not.toContain("Number(stage.view.debt.tryMinor)");
    expect(view).toContain("formatMinorUnitsAsTry");
  });

  it("kimlik dogrulama materyali TARAYICI DEPOSUNA yazilmaz", () => {
    for (const forbidden of ["localStorage", "sessionStorage", "document.cookie"]) {
      expect(view, forbidden).not.toContain(forbidden);
    }
  });

  it("imzanin transfer yetkisi VERMEDIGI acikca yazilir", () => {
    expectShows(view, "sharedPay.noticeNotATransaction", "işlem değildir");
    expectShows(
      view,
      "sharedPay.noticeSuffix",
      "hiçbir transfer yetkisi vermez",
    );
    expect(translate("tr", "sharedPay.noticeSuffix")).toContain(
      "Kimlik doğrulaması değil",
    );
  });

  it("herkesin AYNI baglantiyi aldigi soylenir", () => {
    expectShows(view, "sharedPay.introEveryone", "herkese aynı");
  });

  it("hesap veya ag degisince cozulmus borc TEMIZLENIR", () => {
    expect(view).toContain("resetResolved");
    expect(view).toContain("onAccountsChanged");
    expect(view).toContain("onChainChanged");
  });

  it("dogrulama duserse borc GOSTERILMEZ", () => {
    expect(view).toContain("verifyAuthenticatedView");
    // Dogrulama duserse gosterilen metin `errors.view.*` sozlugunden gelir.
    expect(view).toContain("errors.view.");
  });

  it("sayfa SUNUCUDA hesap verisi okumaz ve varligi sizdirmaz", () => {
    expect(page).not.toContain("createNeonSharedBillRepository");
    expect(page).not.toContain("readSession");
    expect(page).toContain("SharedBillDebtorView");
  });

  it("Arc Testnet uyarisi ve tam alici adresi gosterilir", () => {
    expectShows(
      view,
      "sharedPay.networkNoteStrong",
      "gerçek parasal değeri yoktur",
    );
    expect(view).toContain("stage.view.recipient.address");
    expectShows(view, "common.copyAddress", "Adresi kopyala");
  });
});
