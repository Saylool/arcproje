import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { SHARED_BILL_FLOW_ENABLED } from "./shared-bill-feature";
import {
  describeSharedBillDraftProblem,
  sharedBillDraftKey,
  validateSharedBillDraft,
  type SharedBillDraftRow,
} from "./shared-bill-draft";
import { createSharedBillOnServer } from "./shared-bill-client";

/**
 * Olusturucu arayuzunun saf kurallari, API istemcisi ve Part 1 kapisi.
 *
 * Depoda bilesen testi altyapisi yok; bu yuzden arayuzun davranisi hem saf
 * mantik uzerinden hem de kaynak duzeyinde dogrulanir.
 */

const RECIPIENT = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const DEBTOR_A = "0x0000000000000000000000000000000000000aBc";
const DEBTOR_B = "0x00000000000000000000000000000000000000De";

function rowsOf(over: Partial<SharedBillDraftRow>[] = []): SharedBillDraftRow[] {
  const base: SharedBillDraftRow[] = [
    {
      participantId: "a",
      name: "Ada",
      debtKey: "a->p",
      amountMinor: 12345,
      address: DEBTOR_A,
    },
    {
      participantId: "b",
      name: "Bora",
      debtKey: "b->p",
      amountMinor: 6789,
      address: DEBTOR_B,
    },
  ];
  return base.map((row, index) => ({ ...row, ...(over[index] ?? {}) }));
}

describe("taslak dogrulamasi", () => {
  it("eksiksiz taslak kabul edilir ve kanonik satirlar uretir", () => {
    const result = validateSharedBillDraft({
      recipient: RECIPIENT,
      rows: rowsOf(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debts).toHaveLength(2);
    expect(result.debts[0]).toEqual({
      debtor: DEBTOR_A,
      debtorLabel: "Ada",
      debtKey: "a->p",
      tryMinor: "12345",
    });
  });

  it("cuzdan baglanmadan taslak gecerli olmaz", () => {
    expect(
      validateSharedBillDraft({ recipient: null, rows: rowsOf() }),
    ).toMatchObject({ ok: false, problem: "invalidRecipient" });
  });

  it("EKSIK adres sorunlu satiri isaretler", () => {
    const result = validateSharedBillDraft({
      recipient: RECIPIENT,
      rows: rowsOf([{}, { address: "   " }]),
    });
    expect(result).toEqual({
      ok: false,
      problem: "missingAddress",
      participantId: "b",
    });
  });

  it("gecersiz adres reddedilir", () => {
    const result = validateSharedBillDraft({
      recipient: RECIPIENT,
      rows: rowsOf([{ address: "0xkisa" }]),
    });
    expect(result).toMatchObject({ ok: false, problem: "invalidAddress" });
  });

  it("AYNI adres iki kisiye verilemez (buyuk/kucuk harf dahil)", () => {
    for (const duplicate of [DEBTOR_A, DEBTOR_A.toLowerCase()]) {
      const result = validateSharedBillDraft({
        recipient: RECIPIENT,
        rows: rowsOf([{}, { address: duplicate }]),
      });
      expect(result, duplicate).toEqual({
        ok: false,
        problem: "duplicateAddress",
        participantId: "b",
      });
    }
  });

  it("borclu adresi ALICI ile ayni olamaz", () => {
    const result = validateSharedBillDraft({
      recipient: RECIPIENT,
      rows: rowsOf([{ address: RECIPIENT.toLowerCase() }]),
    });
    expect(result).toEqual({
      ok: false,
      problem: "recipientIsDebtor",
      participantId: "a",
    });
  });

  it("pozitif olmayan veya tam sayi olmayan tutar reddedilir", () => {
    for (const amount of [0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      const result = validateSharedBillDraft({
        recipient: RECIPIENT,
        rows: rowsOf([{ amountMinor: amount }]),
      });
      expect(result, String(amount)).toMatchObject({
        ok: false,
        problem: "invalidAmount",
      });
    }
  });

  it("bos liste reddedilir", () => {
    expect(
      validateSharedBillDraft({ recipient: RECIPIENT, rows: [] }),
    ).toMatchObject({ ok: false, problem: "noDebts" });
  });

  it("her sorun icin bir aciklama vardir", () => {
    for (const problem of [
      "noDebts",
      "tooManyDebts",
      "invalidRecipient",
      "missingAddress",
      "invalidAddress",
      "duplicateAddress",
      "recipientIsDebtor",
      "invalidAmount",
    ] as const) {
      expect(describeSharedBillDraftProblem(problem).length).toBeGreaterThan(0);
    }
  });
});

describe("baglanti bayatlik anahtari", () => {
  it("ayni girdi ayni anahtari verir", () => {
    const input = { recipient: RECIPIENT, rows: rowsOf() };
    expect(sharedBillDraftKey(input)).toBe(sharedBillDraftKey(input));
  });

  it("satir SIRASI anahtari degistirmez", () => {
    const forward = sharedBillDraftKey({ recipient: RECIPIENT, rows: rowsOf() });
    const reversed = sharedBillDraftKey({
      recipient: RECIPIENT,
      rows: [...rowsOf()].reverse(),
    });
    expect(reversed).toBe(forward);
  });

  it("HER kaynak girdi anahtari degistirir", () => {
    const base = sharedBillDraftKey({ recipient: RECIPIENT, rows: rowsOf() });
    const variants = [
      { recipient: DEBTOR_B, rows: rowsOf() },
      { recipient: RECIPIENT, rows: rowsOf([{ address: DEBTOR_B }]) },
      { recipient: RECIPIENT, rows: rowsOf([{ amountMinor: 1 }]) },
      { recipient: RECIPIENT, rows: rowsOf([{ name: "Adax" }]) },
      { recipient: RECIPIENT, rows: rowsOf([{ debtKey: "a->q" }]) },
    ];
    for (const [index, variant] of variants.entries()) {
      expect(sharedBillDraftKey(variant), String(index)).not.toBe(base);
    }
  });
});

describe("API istemcisi yaniti KATI dogrular", () => {
  const body = { manifest: {}, debts: [], signature: `0x${"11".repeat(65)}` };

  function jsonResponse(payload: unknown, status = 201) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("gecerli yanit kabul edilir ve yol KIMLIKTEN yeniden kurulur", async () => {
    const billId = `0x${"ab".repeat(32)}`;
    const fetchImpl = vi.fn(async () =>
      // Sunucu yanlis bir yol dondurse bile kullanilan yol kimlikten kurulur.
      jsonResponse({ billId, path: "/kotu/yol", expiresAt: 1_700_000_000 }),
    );
    const result = await createSharedBillOnServer(body, fetchImpl as never);
    expect(result).toEqual({
      ok: true,
      billId,
      path: `/pay/${billId}`,
      expiresAt: 1_700_000_000,
    });
  });

  it("bozuk kimlik bicimi reddedilir", async () => {
    for (const billId of ["0xkisa", "", 42, `0x${"AB".repeat(32)}`]) {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ billId, path: "/pay/x", expiresAt: 1_700_000_000 }),
      );
      const result = await createSharedBillOnServer(body, fetchImpl as never);
      expect(result.ok, String(billId)).toBe(false);
    }
  });

  it("bozuk bitis ani reddedilir", async () => {
    for (const expiresAt of [0, -1, 1.5, "1700000000", null]) {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({
          billId: `0x${"ab".repeat(32)}`,
          path: "/pay/x",
          expiresAt,
        }),
      );
      expect(
        (await createSharedBillOnServer(body, fetchImpl as never)).ok,
        String(expiresAt),
      ).toBe(false);
    }
  });

  it("sunucu hatasinin mesaji kullaniciya tasinir", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { code: "SERVICE_NOT_CONFIGURED", message: "Yapilandirilmamis." } },
        503,
      ),
    );
    expect(await createSharedBillOnServer(body, fetchImpl as never)).toEqual({
      ok: false,
      message: "Yapilandirilmamis.",
    });
  });

  it("ag hatasi ve bozuk JSON genel mesaja duser", async () => {
    const throwing = vi.fn(async () => {
      throw new Error("ag");
    });
    expect((await createSharedBillOnServer(body, throwing as never)).ok).toBe(
      false,
    );

    const badJson = vi.fn(
      async () => new Response("{", { status: 201, headers: { "content-type": "application/json" } }),
    );
    expect((await createSharedBillOnServer(body, badJson as never)).ok).toBe(
      false,
    );
  });
});

describe("ortak hesap kapisi", () => {
  const creator = readFileSync("src/components/SharedBillCreator.tsx", "utf8");
  const flow = readFileSync("src/components/ReceiptFlow.tsx", "utf8");

  it("paylasilan hesap akisi ACIKTIR", () => {
    expect(SHARED_BILL_FLOW_ENABLED).toBe(true);
  });

  it("akis bayrakla korunur ve eski olusturucu calismaya devam eder", () => {
    expect(flow).toContain("SHARED_BILL_FLOW_ENABLED");
    expect(flow).toContain("<SharedBillCreator");
    // Eski, borclu basina ayri baglanti ureten akis KALDIRILMADI.
    expect(flow).toContain("<PaymentRequestCreator");
  });

  it("olusturucu TEK imza ve TEK baglanti sozu verir", () => {
    expect(creator).toContain("signSharedBillManifest");
    expect(creator).toContain("createSharedBillOnServer");
    expect(creator).toContain("Butun borclular ayni baglantiyi alir");
  });

  it("imzanin para cekemeyecegi acikca yazilir", () => {
    expect(creator).toContain("talep olusturur");
    expect(creator).toContain("para cekemez");
  });

  it("girdi degisince baglanti gecersiz sayilir", () => {
    expect(creator).toContain("sharedBillDraftKey");
    expect(creator).toContain("linkIsStale");
  });

  it("kopyalama ve paylasma eylemleri vardir", () => {
    expect(creator).toContain("navigator.clipboard.writeText");
    expect(creator).toContain("navigator.share");
    expect(creator).toContain("renderSVG");
  });

  it("borc listesi URL'ye KONULMAZ", () => {
    // Baglanti yalnizca sunucudan donen kimlikten kurulur.
    expect(creator).toContain("${window.location.origin}${created.path}");
    expect(creator).not.toContain("encodeSignedRequest");
    expect(creator).not.toContain("buildShareUrl");
  });

  it("sunucu yapilandirmasi arayuzde OKUNMAZ", () => {
    for (const secret of [
      "DATABASE_URL",
      "RATE_QUOTE_SECRET",
      "OPENAI_API_KEY",
      "COINGECKO_DEMO_API_KEY",
      "process.env",
    ]) {
      expect(creator, secret).not.toContain(secret);
    }
  });
});
