import { describe, expect, it } from "vitest";

import { ACTIVE_NETWORK_PROFILE } from "./profile";
import {
  MAX_SHARED_BILL_PROOF_LENGTH,
  combineSharedBillNodes,
  computeSharedBillLeaf,
  computeSharedBillProofRoot,
  computeSharedBillTreeRoot,
  expectedSharedBillProofLength,
  generateSharedBillProof,
  verifySharedBillProof,
} from "./shared-bill-merkle";
import {
  MAX_SHARED_BILL_DEBTS,
  SHARED_BILL_SCHEMA_VERSION,
  canonicalizeSharedBillDebts,
  computeSharedBillLeaves,
  computeSharedBillRoot,
  createSharedBill,
  proveSharedBillDebt,
  verifySharedBillDebtInclusion,
  type SharedBillDebt,
} from "./shared-bill";

/**
 * Merkle taahhudu: GIZLILIK KORUYAN icerme kaniti.
 *
 * Bir borclu kendi satirini, diger satirlari GORMEDEN imzalanan koke karsi
 * dogrulayabilmelidir. Bu testler hem dogru kanitlarin gectigini hem de her
 * bozulmanin fail-closed reddedildigini kanitlar.
 */

const CHAIN = ACTIVE_NETWORK_PROFILE.chainId;
const NOW = 1_700_000_000_000;
const BILL_ID = `0x${"7a".repeat(32)}`;
const OTHER_BILL_ID = `0x${"5b".repeat(32)}`;
const RECIPIENT = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

function addressFor(index: number): string {
  return `0x${(index + 1).toString(16).padStart(40, "0")}`;
}

function debtsOf(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    debtor: addressFor(index),
    debtorLabel: `K${index}`,
    debtKey: `k${index}->p`,
    tryMinor: String(100 + index),
  }));
}

function canonical(count: number): readonly SharedBillDebt[] {
  const result = canonicalizeSharedBillDebts(debtsOf(count), RECIPIENT);
  if (!result.ok) throw new Error(`kanoniklestirilemedi: ${result.problem}`);
  return result.debts;
}

function manifestFor(count: number, billId = BILL_ID) {
  const created = createSharedBill({
    recipient: RECIPIENT,
    recipientLabel: "Poyraz",
    debts: debtsOf(count),
    nowMs: NOW,
    billId,
  });
  if (!created.ok) throw new Error(`hesap uretilemedi: ${created.problem}`);
  return created;
}

describe("agac kuruluşu", () => {
  it("tek yaprakta kok yapragin kendisidir", () => {
    const leaves = computeSharedBillLeaves(
      { chainId: CHAIN, billId: BILL_ID },
      canonical(1),
    );
    expect(computeSharedBillTreeRoot(leaves)).toBe(leaves[0]);
  });

  it("bos listede kok YOKTUR", () => {
    expect(computeSharedBillTreeRoot([])).toBeNull();
  });

  it("ic dugum KONUMSALDIR: sol/sag degisirse kok degisir", () => {
    const a = `0x${"11".repeat(32)}`;
    const b = `0x${"22".repeat(32)}`;
    expect(combineSharedBillNodes(a, b)).not.toBe(combineSharedBillNodes(b, a));
  });

  it("yaprak, ic dugum ve kok etiketleri AYRIDIR", () => {
    const leaves = computeSharedBillLeaves(
      { chainId: CHAIN, billId: BILL_ID },
      canonical(2),
    );
    const treeRoot = computeSharedBillTreeRoot(leaves);
    // Bir yaprak asla gecerli bir ic dugum ozeti olarak yorumlanamaz.
    expect(treeRoot).not.toBe(leaves[0]);
    expect(treeRoot).not.toBe(leaves[1]);
  });

  it("TEK SAYIDA dugumde son dugum TASINIR (kopyalanmaz)", () => {
    // 3 yaprak: (0,1) eslesir, 2 tasinir. Ust seviye: [h01, l2].
    const leaves = computeSharedBillLeaves(
      { chainId: CHAIN, billId: BILL_ID },
      canonical(3),
    );
    const expected = combineSharedBillNodes(
      combineSharedBillNodes(leaves[0], leaves[1]),
      leaves[2],
    );
    expect(computeSharedBillTreeRoot(leaves)).toBe(expected);
    // Kopyalama olsaydi son dugum kendisiyle eslesirdi; oyle DEGIL.
    expect(computeSharedBillTreeRoot(leaves)).not.toBe(
      combineSharedBillNodes(
        combineSharedBillNodes(leaves[0], leaves[1]),
        combineSharedBillNodes(leaves[2], leaves[2]),
      ),
    );
  });
});

describe("her konum icin icerme kaniti", () => {
  it("1..MAX arasi her borc sayisinda HER indeks dogrulanir", () => {
    for (const count of [1, 2, 3, 4, 5, 7, 8, 9, 16, 17, MAX_SHARED_BILL_DEBTS]) {
      const created = manifestFor(count);
      for (let index = 0; index < count; index += 1) {
        const proof = proveSharedBillDebt({
          chainId: CHAIN,
          billId: BILL_ID,
          debts: created.debts,
          leafIndex: index,
        });
        expect(proof, `${count}/${index}`).not.toBeNull();
        if (proof === null) continue;
        expect(
          verifySharedBillDebtInclusion({
            manifest: created.manifest,
            debt: created.debts[index],
            proof,
          }),
          `${count}/${index}`,
        ).toEqual({ ok: true });
      }
    }
  });

  it("kanit uzunlugu indeks ve sayidan TURETILIR", () => {
    for (const count of [1, 2, 3, 5, 8, 13]) {
      const created = manifestFor(count);
      for (let index = 0; index < count; index += 1) {
        const proof = proveSharedBillDebt({
          chainId: CHAIN,
          billId: BILL_ID,
          debts: created.debts,
          leafIndex: index,
        });
        expect(proof?.siblings.length, `${count}/${index}`).toBe(
          expectedSharedBillProofLength(index, count),
        );
      }
    }
    expect(expectedSharedBillProofLength(0, 1)).toBe(0);
  });

  it("gecersiz indeks icin uzunluk hesaplanmaz", () => {
    expect(expectedSharedBillProofLength(-1, 4)).toBeNull();
    expect(expectedSharedBillProofLength(4, 4)).toBeNull();
    expect(expectedSharedBillProofLength(1.5, 4)).toBeNull();
    expect(expectedSharedBillProofLength(0, 0)).toBeNull();
  });

  it("kanit HICBIR kardes SATIRI tasimaz, yalnizca ozet", () => {
    const created = manifestFor(4);
    const proof = proveSharedBillDebt({
      chainId: CHAIN,
      billId: BILL_ID,
      debts: created.debts,
      leafIndex: 0,
    });
    expect(proof).not.toBeNull();
    if (proof === null) return;
    const serialized = JSON.stringify(proof);
    // Baska hicbir satirin adresi, etiketi, borc kimligi veya tutari yok.
    for (const other of created.debts.slice(1)) {
      expect(serialized).not.toContain(other.debtor);
      expect(serialized).not.toContain(other.debtorLabel);
      expect(serialized).not.toContain(other.debtKey);
      expect(serialized).not.toContain(other.tryMinor);
    }
    for (const sibling of proof.siblings) {
      expect(sibling).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});

describe("bozuk kanitlar REDDEDILIR", () => {
  const created = manifestFor(5);
  const index = 1;
  const debt = created.debts[index];
  const goodProof = proveSharedBillDebt({
    chainId: CHAIN,
    billId: BILL_ID,
    debts: created.debts,
    leafIndex: index,
  });

  it("hazir kanit gecerlidir (kontrol)", () => {
    expect(goodProof).not.toBeNull();
    if (goodProof === null) return;
    expect(
      verifySharedBillDebtInclusion({ manifest: created.manifest, debt, proof: goodProof }),
    ).toEqual({ ok: true });
  });

  it("KISALTILMIS kanit reddedilir", () => {
    if (goodProof === null) return;
    expect(
      verifySharedBillDebtInclusion({
        manifest: created.manifest,
        debt,
        proof: { leafIndex: index, siblings: goodProof.siblings.slice(0, -1) },
      }),
    ).toEqual({ ok: false, problem: "invalidProof" });
  });

  it("UZATILMIS kanit reddedilir", () => {
    if (goodProof === null) return;
    expect(
      verifySharedBillDebtInclusion({
        manifest: created.manifest,
        debt,
        proof: {
          leafIndex: index,
          siblings: [...goodProof.siblings, `0x${"aa".repeat(32)}`],
        },
      }),
    ).toEqual({ ok: false, problem: "invalidProof" });
  });

  it("ASIRI UZUN kanit tavanda durur", () => {
    const siblings = Array.from(
      { length: MAX_SHARED_BILL_PROOF_LENGTH + 1 },
      () => `0x${"aa".repeat(32)}`,
    );
    expect(
      verifySharedBillDebtInclusion({
        manifest: created.manifest,
        debt,
        proof: { leafIndex: index, siblings },
      }),
    ).toEqual({ ok: false, problem: "invalidProof" });
  });

  it("SIRASI DEGISTIRILMIS kardesler reddedilir", () => {
    if (goodProof === null || goodProof.siblings.length < 2) return;
    const swapped = [...goodProof.siblings];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(
      verifySharedBillDebtInclusion({
        manifest: created.manifest,
        debt,
        proof: { leafIndex: index, siblings: swapped },
      }),
    ).toEqual({ ok: false, problem: "invalidProof" });
  });

  it("BOZUK kardes bicimi reddedilir", () => {
    if (goodProof === null) return;
    for (const bad of ["0xkisa", "", `0x${"aa".repeat(31)}`, "degil"]) {
      const siblings = [...goodProof.siblings];
      siblings[0] = bad;
      expect(
        verifySharedBillDebtInclusion({
          manifest: created.manifest,
          debt,
          proof: { leafIndex: index, siblings },
        }),
        bad,
      ).toEqual({ ok: false, problem: "invalidProof" });
    }
  });

  it("GECERSIZ indeks reddedilir", () => {
    if (goodProof === null) return;
    for (const badIndex of [-1, created.manifest.debtCount, 1.5, Number.NaN]) {
      expect(
        verifySharedBillDebtInclusion({
          manifest: created.manifest,
          debt,
          proof: { leafIndex: badIndex, siblings: goodProof.siblings },
        }),
        String(badIndex),
      ).toEqual({ ok: false, problem: "invalidProof" });
    }
  });

  it("BASKA bir indeksin kaniti kabul edilmez", () => {
    const other = proveSharedBillDebt({
      chainId: CHAIN,
      billId: BILL_ID,
      debts: created.debts,
      leafIndex: 3,
    });
    if (other === null) return;
    expect(
      verifySharedBillDebtInclusion({ manifest: created.manifest, debt, proof: other }),
    ).toEqual({ ok: false, problem: "invalidProof" });
  });

  it("BASKA bir hesabin kaniti kabul edilmez", () => {
    const foreign = manifestFor(5, OTHER_BILL_ID);
    const foreignProof = proveSharedBillDebt({
      chainId: CHAIN,
      billId: OTHER_BILL_ID,
      debts: foreign.debts,
      leafIndex: index,
    });
    if (foreignProof === null) return;
    expect(
      verifySharedBillDebtInclusion({
        manifest: created.manifest,
        debt,
        proof: foreignProof,
      }),
    ).toEqual({ ok: false, problem: "invalidProof" });
  });

  it("BASKA bir zincirin yapragi kabul edilmez", () => {
    if (goodProof === null) return;
    const foreignLeaf = computeSharedBillLeaf({
      schemaVersion: SHARED_BILL_SCHEMA_VERSION,
      chainId: CHAIN + 1,
      billId: BILL_ID,
      debtor: debt.debtor,
      debtorLabel: debt.debtorLabel,
      debtKey: debt.debtKey,
      tryMinor: debt.tryMinor,
    });
    const rebuilt = computeSharedBillProofRoot({
      leaf: foreignLeaf,
      proof: goodProof,
      debtCount: created.manifest.debtCount,
    });
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    // Yapisal olarak gecerli ama KOK tutmaz.
    expect(
      verifySharedBillProof({
        leaf: foreignLeaf,
        proof: goodProof,
        debtCount: created.manifest.debtCount,
        expectedTreeRoot: computeSharedBillTreeRoot(
          computeSharedBillLeaves({ chainId: CHAIN, billId: BILL_ID }, created.debts),
        ) as string,
      }),
    ).toEqual({ ok: false, problem: "rootMismatch" });
  });
});

describe("HER taahhut edilen alanin mutasyonu kaniti bozar", () => {
  it("adres, etiket, borc kimligi ve tutar", () => {
    const created = manifestFor(4);
    const index = 2;
    const proof = proveSharedBillDebt({
      chainId: CHAIN,
      billId: BILL_ID,
      debts: created.debts,
      leafIndex: index,
    });
    if (proof === null) return;

    const mutations: readonly Partial<SharedBillDebt>[] = [
      { debtor: addressFor(99) },
      { debtorLabel: "BaskaAd" },
      { debtKey: "x->p" },
      { tryMinor: "999999" },
    ];
    for (const mutation of mutations) {
      expect(
        verifySharedBillDebtInclusion({
          manifest: created.manifest,
          debt: { ...created.debts[index], ...mutation },
          proof,
        }),
        JSON.stringify(mutation),
      ).toEqual({ ok: false, problem: "invalidProof" });
    }
  });

  it("manifestin borc SAYISI degisirse kanit bozulur", () => {
    const created = manifestFor(4);
    const proof = proveSharedBillDebt({
      chainId: CHAIN,
      billId: BILL_ID,
      debts: created.debts,
      leafIndex: 0,
    });
    if (proof === null) return;
    expect(
      verifySharedBillDebtInclusion({
        manifest: { ...created.manifest, debtCount: 3 },
        debt: created.debts[0],
        proof,
      }),
    ).toEqual({ ok: false, problem: "invalidProof" });
  });

  it("imzalanan KOK degisirse kanit bozulur", () => {
    const created = manifestFor(4);
    const proof = proveSharedBillDebt({
      chainId: CHAIN,
      billId: BILL_ID,
      debts: created.debts,
      leafIndex: 0,
    });
    if (proof === null) return;
    expect(
      verifySharedBillDebtInclusion({
        manifest: { ...created.manifest, debtsRoot: `0x${"cd".repeat(32)}` },
        debt: created.debts[0],
        proof,
      }),
    ).toEqual({ ok: false, problem: "invalidProof" });
  });
});

describe("kanonik kok girdi sirasindan BAGIMSIZDIR", () => {
  it("ters ve karisik sira ayni koku verir", () => {
    const forward = debtsOf(6);
    const reversed = [...forward].reverse();
    const shuffled = [forward[3], forward[0], forward[5], forward[1], forward[4], forward[2]];

    const rootOf = (rows: typeof forward) => {
      const canonicalized = canonicalizeSharedBillDebts(rows, RECIPIENT);
      if (!canonicalized.ok) throw new Error(canonicalized.problem);
      return computeSharedBillRoot({
        chainId: CHAIN,
        billId: BILL_ID,
        debts: canonicalized.debts,
      });
    };

    expect(rootOf(reversed)).toBe(rootOf(forward));
    expect(rootOf(shuffled)).toBe(rootOf(forward));
  });

  it("kok zincire, hesap kimligine ve sayiya baglidir", () => {
    const debts = canonical(4);
    const base = computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts });
    expect(
      computeSharedBillRoot({ chainId: CHAIN, billId: OTHER_BILL_ID, debts }),
    ).not.toBe(base);
    expect(
      computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts: debts.slice(0, 3) }),
    ).not.toBe(base);
  });

  it("bos listede kok uretilmez", () => {
    expect(() =>
      computeSharedBillRoot({ chainId: CHAIN, billId: BILL_ID, debts: [] }),
    ).toThrow();
  });
});

describe("dogrudan kanit dogrulayici", () => {
  it("yapisal hatalar ayri ayri bildirilir", () => {
    const leaf = `0x${"11".repeat(32)}`;
    expect(
      computeSharedBillProofRoot({ leaf: "0xkisa", proof: { leafIndex: 0, siblings: [] }, debtCount: 1 }),
    ).toEqual({ ok: false, problem: "invalidLeaf" });
    expect(
      computeSharedBillProofRoot({ leaf, proof: { leafIndex: 0, siblings: [] }, debtCount: 0 }),
    ).toEqual({ ok: false, problem: "invalidCount" });
    expect(
      computeSharedBillProofRoot({ leaf, proof: { leafIndex: 5, siblings: [] }, debtCount: 2 }),
    ).toEqual({ ok: false, problem: "invalidIndex" });
    expect(
      computeSharedBillProofRoot({ leaf, proof: { leafIndex: 0, siblings: ["kotu"] }, debtCount: 2 }),
    ).toEqual({ ok: false, problem: "malformedSibling" });
    expect(
      computeSharedBillProofRoot({ leaf, proof: { leafIndex: 0, siblings: [] }, debtCount: 2 }),
    ).toEqual({ ok: false, problem: "wrongProofLength" });
  });

  it("generateSharedBillProof gecersiz indekste null doner", () => {
    const leaves = computeSharedBillLeaves(
      { chainId: CHAIN, billId: BILL_ID },
      canonical(3),
    );
    expect(generateSharedBillProof(leaves, -1)).toBeNull();
    expect(generateSharedBillProof(leaves, 3)).toBeNull();
    expect(generateSharedBillProof(leaves, 1.5)).toBeNull();
  });
});
