import { describe, expect, it } from "vitest";

import { ACTIVE_NETWORK_PROFILE } from "./profile";
import {
  MAX_SHARED_BILL_DEBTS,
  SHARED_BILL_MAX_LIFETIME_MS,
  SHARED_BILL_SCHEMA_VERSION,
  buildSharedBillPath,
  buildSharedBillUrl,
  canonicalizeSharedBillDebts,
  computeSharedBillRoot,
  createSharedBill,
  createSharedBillId,
  describeSharedBillProblem,
  computeSharedBillLeaves,
  validateSharedBillManifest,
  validateSharedBillSubmission,
  type SharedBillDebt,
} from "./shared-bill";

/**
 * Paylasilan grup hesabi sozlesmesi.
 *
 * Bu testler imzanin KAPSADIGI her seyi korur: alici, borc listesi taahhudu,
 * borc sayisi, zincir, hesap kimligi ve zaman penceresi. Ayrica borc
 * taahhudunun kanonik, belirlenimci ve alan ayrilmis oldugunu kanitlar.
 *
 * Gorunmez saldiri karakterleri kaynakta KOD NOKTASINDAN uretilir; boylece
 * dosyanin kendisi hicbir bidi/sifir genislikli karakter icermez.
 */

const CHAIN = ACTIVE_NETWORK_PROFILE.chainId;
const NOW = 1_700_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);
const BILL_ID = `0x${"7a".repeat(32)}`;

const RECIPIENT = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const DEBTOR_A = "0x0000000000000000000000000000000000000aBc";
const DEBTOR_B = "0x00000000000000000000000000000000000000De";
const DEBTOR_C = "0x0000000000000000000000000000000000000F01";

/** U+202E RIGHT-TO-LEFT OVERRIDE. */
const RTL_OVERRIDE = String.fromCharCode(0x202e);
/** U+200B ZERO WIDTH SPACE. */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
/** U+2066 LEFT-TO-RIGHT ISOLATE. */
const ISOLATE = String.fromCharCode(0x2066);
/** "A" + U+0301 COMBINING ACUTE ACCENT: NFD bicimi. */
const DECOMPOSED_A = `A${String.fromCharCode(0x0301)}`;
/** U+0663 ARABIC-INDIC DIGIT THREE. */
const ARABIC_THREE = String.fromCharCode(0x0663);

function rawDebts() {
  return [
    { debtor: DEBTOR_A, debtorLabel: "Ada", debtKey: "a->p", tryMinor: "12345" },
    { debtor: DEBTOR_B, debtorLabel: "Bora", debtKey: "b->p", tryMinor: "6789" },
    { debtor: DEBTOR_C, debtorLabel: "Ceren", debtKey: "c->p", tryMinor: "1" },
  ];
}

function canonicalDebts(): readonly SharedBillDebt[] {
  const result = canonicalizeSharedBillDebts(rawDebts(), RECIPIENT);
  if (!result.ok) throw new Error(`kanoniklestirilemedi: ${result.problem}`);
  return result.debts;
}

function manifestOf(over: Record<string, unknown> = {}) {
  const debts = canonicalDebts();
  return {
    schemaVersion: SHARED_BILL_SCHEMA_VERSION,
    billId: BILL_ID,
    chainId: CHAIN,
    recipient: RECIPIENT,
    recipientLabel: "Poyraz",
    debtsRoot: computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts }),
    debtCount: debts.length,
    issuedAt: NOW_SECONDS,
    expiresAt: NOW_SECONDS + 3600,
    ...over,
  };
}

function submissionOf(over: Record<string, unknown> = {}) {
  return {
    manifest: manifestOf(),
    debts: rawDebts(),
    signature: `0x${"11".repeat(65)}`,
    ...over,
  };
}

describe("hesap kimligi", () => {
  it("0x + 64 hex ve kriptografik rastgeledir", () => {
    const first = createSharedBillId();
    const second = createSharedBillId();
    expect(first).toMatch(/^0x[0-9a-f]{64}$/);
    // 256 bit: iki uretimin cakismasi pratikte imkansizdir.
    expect(first).not.toBe(second);
  });

  it("paylasim yolu sirali bir kimlik ICERMEZ", () => {
    expect(buildSharedBillPath(BILL_ID)).toBe(`/pay/${BILL_ID}`);
    expect(buildSharedBillUrl("https://ornek.test/", BILL_ID)).toBe(
      `https://ornek.test/pay/${BILL_ID}`,
    );
    // Yol borc listesi, adres, etiket veya imza tasimaz.
    const path = buildSharedBillPath(BILL_ID);
    expect(path).not.toContain(DEBTOR_A);
    expect(path).not.toContain("Ada");
  });
});

describe("kanonik borc listesi", () => {
  it("borclu adresine gore ARTAN siraya dizilir", () => {
    const debts = canonicalDebts();
    const addresses = debts.map((debt) => debt.debtor.toLowerCase());
    expect([...addresses].sort()).toEqual(addresses);
  });

  it("girdi sirasi DEGISSE de ayni manifest uretilir", () => {
    const forward = canonicalizeSharedBillDebts(rawDebts(), RECIPIENT);
    const reversed = canonicalizeSharedBillDebts(
      [...rawDebts()].reverse(),
      RECIPIENT,
    );
    const shuffled = canonicalizeSharedBillDebts(
      [rawDebts()[1], rawDebts()[2], rawDebts()[0]],
      RECIPIENT,
    );
    expect(forward.ok && reversed.ok && shuffled.ok).toBe(true);
    if (!forward.ok || !reversed.ok || !shuffled.ok) return;
    expect(reversed.debts).toEqual(forward.debts);
    expect(shuffled.debts).toEqual(forward.debts);

    const hash = (debts: readonly SharedBillDebt[]) =>
      computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts });
    expect(hash(reversed.debts)).toBe(hash(forward.debts));
    expect(hash(shuffled.debts)).toBe(hash(forward.debts));
  });

  it("adresler checksum'li bicime normallestirilir", () => {
    const result = canonicalizeSharedBillDebts(
      [{ ...rawDebts()[0], debtor: DEBTOR_A.toLowerCase() }],
      RECIPIENT.toLowerCase(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debts[0].debtor).toBe(DEBTOR_A);
  });

  it("AYNI borclu iki kez kullanilamaz", () => {
    const result = canonicalizeSharedBillDebts(
      [rawDebts()[0], { ...rawDebts()[1], debtor: DEBTOR_A }],
      RECIPIENT,
    );
    expect(result).toEqual({ ok: false, problem: "duplicateDebtor" });
  });

  it("buyuk/kucuk harf farki yinelenmeyi gizleyemez", () => {
    const result = canonicalizeSharedBillDebts(
      [rawDebts()[0], { ...rawDebts()[1], debtor: DEBTOR_A.toLowerCase() }],
      RECIPIENT,
    );
    expect(result).toEqual({ ok: false, problem: "duplicateDebtor" });
  });

  it("AYNI borc kimligi iki kez kullanilamaz", () => {
    const result = canonicalizeSharedBillDebts(
      [rawDebts()[0], { ...rawDebts()[1], debtKey: "a->p" }],
      RECIPIENT,
    );
    expect(result).toEqual({ ok: false, problem: "duplicateDebtKey" });
  });

  it("alici kendi kendine borclu olamaz", () => {
    const result = canonicalizeSharedBillDebts(
      [{ ...rawDebts()[0], debtor: RECIPIENT }],
      RECIPIENT,
    );
    expect(result).toEqual({ ok: false, problem: "selfTransfer" });
  });

  it("gecersiz borclu adresi reddedilir", () => {
    for (const bad of ["", "0x123", "degil", DEBTOR_A.slice(0, -1)]) {
      expect(
        canonicalizeSharedBillDebts([{ ...rawDebts()[0], debtor: bad }], RECIPIENT),
        bad,
      ).toEqual({ ok: false, problem: "invalidDebtor" });
    }
  });

  it("bos liste ve fazla satir reddedilir", () => {
    expect(canonicalizeSharedBillDebts([], RECIPIENT)).toEqual({
      ok: false,
      problem: "noDebts",
    });
    const many = Array.from({ length: MAX_SHARED_BILL_DEBTS + 1 }, (_, i) => ({
      debtor: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      debtorLabel: `K${i}`,
      debtKey: `k${i}->p`,
      tryMinor: "100",
    }));
    expect(canonicalizeSharedBillDebts(many, RECIPIENT)).toEqual({
      ok: false,
      problem: "tooManyDebts",
    });
  });

  it("beklenmeyen ve eksik alanlar reddedilir", () => {
    expect(
      canonicalizeSharedBillDebts(
        [{ ...rawDebts()[0], fazladan: 1 }],
        RECIPIENT,
      ),
    ).toEqual({ ok: false, problem: "unexpectedField" });

    const { tryMinor: _omitted, ...missing } = rawDebts()[0];
    void _omitted;
    expect(canonicalizeSharedBillDebts([missing], RECIPIENT)).toEqual({
      ok: false,
      problem: "missingField",
    });
  });

  it("dizi olmayan girdi reddedilir", () => {
    for (const bad of [null, {}, "abc", 5]) {
      expect(canonicalizeSharedBillDebts(bad, RECIPIENT), String(bad)).toEqual({
        ok: false,
        problem: "notAnObject",
      });
    }
  });
});

describe("Unicode sahteciligi ve etiketler", () => {
  it("kontrol/bidi/sifir genislikli karakterli etiketler reddedilir", () => {
    for (const label of [
      `Ad${RTL_OVERRIDE}a`,
      `Ad${ZERO_WIDTH_SPACE}a`,
      `A${ISOLATE}d`,
      "Ad\ta",
    ]) {
      expect(
        canonicalizeSharedBillDebts(
          [{ ...rawDebts()[0], debtorLabel: label }],
          RECIPIENT,
        ),
        JSON.stringify(label),
      ).toEqual({ ok: false, problem: "invalidLabel" });
    }
  });

  it("NFC olmayan etiket reddedilir (imzalanan baytlar degismesin)", () => {
    const decomposed = `${DECOMPOSED_A}da`;
    expect(decomposed).not.toBe(decomposed.normalize("NFC"));
    expect(
      canonicalizeSharedBillDebts(
        [{ ...rawDebts()[0], debtorLabel: decomposed }],
        RECIPIENT,
      ),
    ).toEqual({ ok: false, problem: "invalidLabel" });
  });

  it("bos, yalnizca bosluk ve cevresi bosluklu etiket reddedilir", () => {
    for (const label of ["", "   ", " Ada", "Ada "]) {
      expect(
        canonicalizeSharedBillDebts(
          [{ ...rawDebts()[0], debtorLabel: label }],
          RECIPIENT,
        ),
        JSON.stringify(label),
      ).toEqual({ ok: false, problem: "invalidLabel" });
    }
  });

  it("bozuk borc kimligi reddedilir", () => {
    expect(
      canonicalizeSharedBillDebts(
        [{ ...rawDebts()[0], debtKey: `a${ZERO_WIDTH_SPACE}->p` }],
        RECIPIENT,
      ),
    ).toEqual({ ok: false, problem: "invalidDebtKey" });
  });
});

describe("tutarlar TAM SAYI minor unit kalir", () => {
  it("sifir, negatif, ondalik ve ustel gosterim reddedilir", () => {
    for (const bad of [
      "0",
      "-1",
      "1.5",
      "1e3",
      " 12",
      "12 ",
      ARABIC_THREE,
      "0x10",
      "",
    ]) {
      expect(
        canonicalizeSharedBillDebts(
          [{ ...rawDebts()[0], tryMinor: bad }],
          RECIPIENT,
        ),
        JSON.stringify(bad),
      ).toEqual({ ok: false, problem: "invalidAmount" });
    }
  });

  it("guvenli tam sayi sinirini asan tutar reddedilir", () => {
    const tooBig = (BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1)).toString();
    expect(
      canonicalizeSharedBillDebts(
        [{ ...rawDebts()[0], tryMinor: tooBig }],
        RECIPIENT,
      ),
    ).toEqual({ ok: false, problem: "invalidAmount" });
  });

  it("kabul edilen tutarlar metin olarak BIREBIR korunur", () => {
    const debts = canonicalDebts();
    const byKey = Object.fromEntries(debts.map((d) => [d.debtKey, d.tryMinor]));
    expect(byKey).toEqual({ "a->p": "12345", "b->p": "6789", "c->p": "1" });
    // Kayan nokta yok: BigInt ile tam toplama.
    const total = debts.reduce((sum, d) => sum + BigInt(d.tryMinor), BigInt(0));
    expect(total).toBe(BigInt(12345 + 6789 + 1));
  });
});

describe("borc taahhudu kanonik ve alan ayrilmistir", () => {
  it("belirlenimcidir", () => {
    const debts = canonicalDebts();
    const a = computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts });
    const b = computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts });
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("JSON.stringify ciktisina BAGLI DEGILDIR", () => {
    const debts = canonicalDebts();
    const hash = computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts });
    // Ayni alanlar, farkli anahtar sirasiyla kurulmus satirlar.
    const reordered = debts.map((debt) =>
      Object.freeze({
        tryMinor: debt.tryMinor,
        debtKey: debt.debtKey,
        debtorLabel: debt.debtorLabel,
        debtor: debt.debtor,
      }),
    );
    expect(
      computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts: reordered }),
    ).toBe(hash);
  });

  it("her alan taahhudu DEGISTIRIR", () => {
    const debts = canonicalDebts();
    const base = computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts });
    const mutations: readonly Partial<SharedBillDebt>[] = [
      { debtor: DEBTOR_C },
      { debtorLabel: "Adax" },
      { debtKey: "a->q" },
      { tryMinor: "12346" },
    ];
    for (const mutation of mutations) {
      const mutated = [{ ...debts[0], ...mutation }, ...debts.slice(1)];
      expect(
        computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts: mutated }),
        JSON.stringify(mutation),
      ).not.toBe(base);
    }
  });

  it("zincire ve hesap kimligine BAGLIDIR", () => {
    const debts = canonicalDebts();
    const base = computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts });
    expect(
      computeSharedBillRoot({ chainId: CHAIN + 1, billId: BILL_ID, debts }),
    ).not.toBe(base);
    expect(
      computeSharedBillRoot({
        chainId: CHAIN,
        billId: `0x${"5b".repeat(32)}`,
        debts,
      }),
    ).not.toBe(base);
  });

  it("satir SAYISINA baglidir: satir cikarmak taahhudu bozar", () => {
    const debts = canonicalDebts();
    const base = computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts });
    expect(
      computeSharedBillRoot({
        chainId: CHAIN,
        billId: BILL_ID,
        debts: debts.slice(0, 2),
      }),
    ).not.toBe(base);
  });

  it("satir yapragi da alan ayrilmistir", () => {
    const leaves = computeSharedBillLeaves(
      { chainId: CHAIN, billId: BILL_ID },
      canonicalDebts(),
    );
    for (const leaf of leaves) {
      expect(leaf).toMatch(/^0x[0-9a-f]{64}$/);
    }
    expect(new Set(leaves).size).toBe(leaves.length);
  });

  it("etiket siniri kaydirma saldirisina kapalidir", () => {
    // "Ada"+"x" ile "Ada"/"x" ayrimi ozette korunur (uzunluk kacisi yok).
    const context = { chainId: CHAIN, billId: BILL_ID };
    const left = computeSharedBillLeaves(context, [
      { debtor: DEBTOR_A, debtorLabel: "Ada", debtKey: "xa->p", tryMinor: "1" },
    ])[0];
    const right = computeSharedBillLeaves(context, [
      { debtor: DEBTOR_A, debtorLabel: "Adax", debtKey: "a->p", tryMinor: "1" },
    ])[0];
    expect(left).not.toBe(right);
  });
});

describe("manifest dogrulamasi", () => {
  it("durust manifest kabul edilir", () => {
    const result = validateSharedBillManifest(manifestOf(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.schemaVersion).toBe(SHARED_BILL_SCHEMA_VERSION);
    expect(result.manifest.chainId).toBe(CHAIN);
    expect(result.manifest.debtCount).toBe(3);
  });

  it("beklenmeyen ve eksik alan reddedilir", () => {
    expect(
      validateSharedBillManifest({ ...manifestOf(), fazladan: 1 }, NOW),
    ).toEqual({ ok: false, problem: "unexpectedField" });

    const { debtCount: _omitted, ...missing } = manifestOf();
    void _omitted;
    expect(validateSharedBillManifest(missing, NOW)).toEqual({
      ok: false,
      problem: "missingField",
    });
  });

  it("yalnizca Arc Testnet kabul edilir", () => {
    for (const chainId of [1, 11155111, CHAIN + 1, 0]) {
      expect(
        validateSharedBillManifest(manifestOf({ chainId }), NOW),
        String(chainId),
      ).toEqual({ ok: false, problem: "invalidChainId" });
    }
  });

  it("sema surumu katidir", () => {
    for (const version of [0, 3, "2", null]) {
      expect(
        validateSharedBillManifest(manifestOf({ schemaVersion: version }), NOW),
        String(version),
      ).toEqual({ ok: false, problem: "unsupportedSchemaVersion" });
    }
  });

  it("ESKI toplu hash semasi (surum 1) FAIL-CLOSED reddedilir", () => {
    /*
     * Surum 1 taahhudu bir borclunun kendi satirini, digerlerini gormeden
     * dogrulamasina izin vermiyordu. Sessizce kabul edilmez.
     */
    expect(
      validateSharedBillManifest(manifestOf({ schemaVersion: 1 }), NOW),
    ).toEqual({ ok: false, problem: "legacyAggregateSchema" });
  });

  it("bozuk hesap kimligi ve taahhut bicimi reddedilir", () => {
    expect(validateSharedBillManifest(manifestOf({ billId: "0xkisa" }), NOW)).toEqual(
      { ok: false, problem: "invalidBillId" },
    );
    expect(
      validateSharedBillManifest(manifestOf({ debtsRoot: "0xkisa" }), NOW),
    ).toEqual({ ok: false, problem: "commitmentMismatch" });
  });

  it("zaman penceresi katidir", () => {
    expect(
      validateSharedBillManifest(
        manifestOf({ issuedAt: NOW_SECONDS + 3600, expiresAt: NOW_SECONDS + 60 }),
        NOW,
      ),
    ).toEqual({ ok: false, problem: "invalidTimestamps" });

    expect(
      validateSharedBillManifest(
        manifestOf({ issuedAt: NOW_SECONDS - 7200, expiresAt: NOW_SECONDS - 1 }),
        NOW,
      ),
    ).toEqual({ ok: false, problem: "expired" });

    expect(
      validateSharedBillManifest(
        manifestOf({
          issuedAt: NOW_SECONDS + 3600,
          expiresAt: NOW_SECONDS + 7200,
        }),
        NOW,
      ),
    ).toEqual({ ok: false, problem: "notYetValid" });
  });

  it("omur YEDI GUNU asamaz", () => {
    const maxSeconds = SHARED_BILL_MAX_LIFETIME_MS / 1000;
    expect(
      validateSharedBillManifest(
        manifestOf({ expiresAt: NOW_SECONDS + maxSeconds }),
        NOW,
      ).ok,
    ).toBe(true);
    expect(
      validateSharedBillManifest(
        manifestOf({ expiresAt: NOW_SECONDS + maxSeconds + 1 }),
        NOW,
      ),
    ).toEqual({ ok: false, problem: "lifetimeTooLong" });
  });

  it("borc sayisi pozitif ve sinirlidir", () => {
    for (const count of [0, -1, 1.5, "3", null]) {
      expect(
        validateSharedBillManifest(manifestOf({ debtCount: count }), NOW),
        String(count),
      ).toEqual({ ok: false, problem: "debtCountMismatch" });
    }
    expect(
      validateSharedBillManifest(
        manifestOf({ debtCount: MAX_SHARED_BILL_DEBTS + 1 }),
        NOW,
      ),
    ).toEqual({ ok: false, problem: "tooManyDebts" });
  });

  it("gecersiz alici ve etiket reddedilir", () => {
    expect(
      validateSharedBillManifest(manifestOf({ recipient: "0x1" }), NOW),
    ).toEqual({ ok: false, problem: "invalidRecipient" });
    expect(
      validateSharedBillManifest(
        manifestOf({ recipientLabel: `P${RTL_OVERRIDE}oyraz` }),
        NOW,
      ),
    ).toEqual({ ok: false, problem: "invalidLabel" });
  });
});

describe("zarf dogrulamasi ve taahhudun yeniden hesaplanmasi", () => {
  it("durust zarf kabul edilir ve kanoniklestirilir", () => {
    const result = validateSharedBillSubmission(submissionOf(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bill.debts).toHaveLength(3);
    expect(result.bill.manifest.debtCount).toBe(3);
  });

  it("sira degisse bile ayni taahhude varir", () => {
    const result = validateSharedBillSubmission(
      submissionOf({ debts: [...rawDebts()].reverse() }),
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("BILDIRILEN taahhude guvenilmez: satir degisirse reddedilir", () => {
    const tampered = rawDebts();
    tampered[0].tryMinor = "999999";
    expect(
      validateSharedBillSubmission(submissionOf({ debts: tampered }), NOW),
    ).toEqual({ ok: false, problem: "commitmentMismatch" });
  });

  it("borc sayisi manifest ile uyusmalidir", () => {
    expect(
      validateSharedBillSubmission(
        submissionOf({ debts: rawDebts().slice(0, 2) }),
        NOW,
      ),
    ).toEqual({ ok: false, problem: "debtCountMismatch" });
  });

  it("imza bicimi katidir", () => {
    for (const bad of ["", "0x12", `0x${"11".repeat(64)}`, 42, null]) {
      expect(
        validateSharedBillSubmission(submissionOf({ signature: bad }), NOW),
        String(bad),
      ).toEqual({ ok: false, problem: "invalidSignatureFormat" });
    }
  });

  it("zarf alanlari katidir", () => {
    expect(
      validateSharedBillSubmission({ ...submissionOf(), fazladan: 1 }, NOW),
    ).toEqual({ ok: false, problem: "unexpectedField" });

    const { debts: _omitted, ...missing } = submissionOf();
    void _omitted;
    expect(validateSharedBillSubmission(missing, NOW)).toEqual({
      ok: false,
      problem: "missingField",
    });

    for (const bad of [null, [], "abc", 7]) {
      expect(validateSharedBillSubmission(bad, NOW), String(bad)).toEqual({
        ok: false,
        problem: "notAnObject",
      });
    }
  });
});

describe("hesap uretimi", () => {
  it("uretilen hesap kendi dogrulayicisindan gecer", () => {
    const created = createSharedBill({
      recipient: RECIPIENT,
      recipientLabel: "Poyraz",
      debts: rawDebts(),
      nowMs: NOW,
      billId: BILL_ID,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(
      validateSharedBillSubmission(
        {
          manifest: created.manifest,
          debts: created.debts,
          signature: `0x${"11".repeat(65)}`,
        },
        NOW,
      ).ok,
    ).toBe(true);
  });

  it("varsayilan omur yedi gunu asmaz", () => {
    const created = createSharedBill({
      recipient: RECIPIENT,
      recipientLabel: "Poyraz",
      debts: rawDebts(),
      nowMs: NOW,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const lifetime =
      (created.manifest.expiresAt - created.manifest.issuedAt) * 1000;
    expect(lifetime).toBeLessThanOrEqual(SHARED_BILL_MAX_LIFETIME_MS);
  });

  it("izin verilenden uzun omur istenirse uretilmez", () => {
    expect(
      createSharedBill({
        recipient: RECIPIENT,
        recipientLabel: "Poyraz",
        debts: rawDebts(),
        nowMs: NOW,
        lifetimeMs: SHARED_BILL_MAX_LIFETIME_MS + 1000,
      }),
    ).toEqual({ ok: false, problem: "lifetimeTooLong" });
  });

  it("uretim sirasinda da yinelenen borclu reddedilir", () => {
    expect(
      createSharedBill({
        recipient: RECIPIENT,
        recipientLabel: "Poyraz",
        debts: [rawDebts()[0], { ...rawDebts()[1], debtor: DEBTOR_A }],
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, problem: "duplicateDebtor" });
  });

  it("uretim sirasinda alici borclu olamaz", () => {
    expect(
      createSharedBill({
        recipient: RECIPIENT,
        recipientLabel: "Poyraz",
        debts: [{ ...rawDebts()[0], debtor: RECIPIENT }],
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, problem: "selfTransfer" });
  });

  it("manifest KUR alani tasimaz", () => {
    const created = createSharedBill({
      recipient: RECIPIENT,
      recipientLabel: "Poyraz",
      debts: rawDebts(),
      nowMs: NOW,
      billId: BILL_ID,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const keys = Object.keys(created.manifest);
    for (const forbidden of [
      "rateNumerator",
      "rateDenominator",
      "microUsdc",
      "quoteId",
      "quoteTag",
      "quoteExpiresAt",
    ]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });
});

describe("kullaniciya gosterilen mesajlar", () => {
  it("her problem icin bir aciklama vardir", () => {
    for (const problem of [
      "commitmentMismatch",
      "duplicateDebtor",
      "expired",
      "selfTransfer",
      "tooManyDebts",
    ] as const) {
      const message = describeSharedBillProblem(problem);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("undefined");
    }
  });
});
