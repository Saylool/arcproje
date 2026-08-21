import { describe, expect, it } from "vitest";

import { sumItemsMinor } from "../receipt/money";
import type { AdjustmentTreatment, Receipt } from "../receipt/schema";
import {
  ROUNDING_METHOD,
  allocateProportionally,
  calculateDebts,
  splitItemMinor,
  sumDebts,
  sumParticipantItemShares,
  type DebtCalculationResult,
  type DebtCalculationSuccess,
} from "./debts";
import type { AssignmentState } from "./participants";

type ItemSpec = { id: string; totalMinor: number };

function receiptOf(spec: {
  items: ItemSpec[];
  tax?: number;
  taxTreatment?: AdjustmentTreatment;
  service?: number;
  serviceTreatment?: AdjustmentTreatment;
  discount?: number;
  discountTreatment?: AdjustmentTreatment;
  totalMinor?: number;
}): Receipt {
  const taxTreatment = spec.taxTreatment ?? "included_in_items";
  const serviceTreatment = spec.serviceTreatment ?? "included_in_items";
  const discountTreatment = spec.discountTreatment ?? "included_in_items";
  const tax = spec.tax ?? 0;
  const service = spec.service ?? 0;
  const discount = spec.discount ?? 0;

  const itemsSubtotal = spec.items.reduce(
    (sum, item) => sum + item.totalMinor,
    0,
  );
  const expected =
    itemsSubtotal +
    (taxTreatment === "separate" ? tax : 0) +
    (serviceTreatment === "separate" ? service : 0) -
    (discountTreatment === "separate" ? discount : 0);

  return {
    merchantName: "Test",
    currency: "TRY",
    items: spec.items.map((item) => ({
      id: item.id,
      name: `Ürün ${item.id}`,
      totalMinor: item.totalMinor,
    })),
    taxMinor: tax,
    taxTreatment,
    serviceChargeMinor: service,
    serviceChargeTreatment: serviceTreatment,
    discountMinor: discount,
    discountTreatment: discountTreatment,
    totalMinor: spec.totalMinor ?? expected,
    warnings: [],
  };
}

function stateOf(
  participantIds: string[],
  payerId: string,
  assignments: Record<string, string[]>,
): AssignmentState {
  return {
    participants: participantIds.map((id) => ({ id, name: id.toUpperCase() })),
    payerId,
    assignments: Object.entries(assignments).map(([itemId, participantIds]) => ({
      itemId,
      participantIds,
    })),
  };
}

function expectSuccess(result: DebtCalculationResult): DebtCalculationSuccess {
  expect(result.status).toBe("success");
  if (result.status !== "success") {
    throw new Error(`beklenmeyen sonuç: ${result.status}`);
  }
  return result;
}

function shareOf(result: DebtCalculationSuccess, id: string) {
  const share = result.participantShares.find((s) => s.participantId === id);
  if (share === undefined) {
    throw new Error(`pay bulunamadı: ${id}`);
  }
  return share;
}

// ---------------------------------------------------------------- yardımcılar

describe("splitItemMinor", () => {
  it("tam bölünen tutarı eşit paylaştırır", () => {
    expect(splitItemMinor(900, 3, 0)).toEqual([300, 300, 300]);
  });

  it("bir kuruşluk artığı offset'ten başlayarak verir", () => {
    expect(splitItemMinor(100, 3, 0)).toEqual([34, 33, 33]);
    expect(splitItemMinor(100, 3, 1)).toEqual([33, 34, 33]);
    expect(splitItemMinor(100, 3, 2)).toEqual([33, 33, 34]);
  });

  it("iki kuruşluk artığı ardışık kişilere dağıtır", () => {
    expect(splitItemMinor(101, 3, 0)).toEqual([34, 34, 33]);
    expect(splitItemMinor(101, 3, 2)).toEqual([34, 33, 34]);
  });

  it("dağıtılan payların toplamı daima tutara eşittir", () => {
    for (let total = 0; total <= 200; total += 1) {
      for (let n = 1; n <= 5; n += 1) {
        for (let offset = 0; offset < 7; offset += 1) {
          const shares = splitItemMinor(total, n, offset);
          expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
        }
      }
    }
  });
});

describe("allocateProportionally", () => {
  it("sıfır tutarı sıfır dağıtır", () => {
    expect(allocateProportionally(0, [3, 7])).toEqual([0, 0]);
  });

  it("ağırlık toplamı sıfırken sıfır olmayan tutar için null döner", () => {
    expect(allocateProportionally(100, [0, 0])).toBeNull();
  });

  it("orantılı dağıtır ve toplamı korur", () => {
    const shares = allocateProportionally(1000, [1, 3]);
    expect(shares).toEqual([250, 750]);
  });

  it("eşit kalanlarda kişi sırasına göre eşitliği bozar", () => {
    // 1 kuruş, iki eşit ağırlık: ilk kişi alır.
    expect(allocateProportionally(1, [100, 100])).toEqual([1, 0]);
    expect(allocateProportionally(3, [100, 100])).toEqual([2, 1]);
  });

  it("en büyük kalan yöntemiyle dağıtır", () => {
    // 10 * [1,1,4] / 6 -> 1.66, 1.66, 6.66 -> tabanlar 1,1,6, kalan 2
    const shares = allocateProportionally(10, [1, 1, 4]);
    expect(shares?.reduce((a, b) => a + b, 0)).toBe(10);
    expect(shares).toEqual([2, 2, 6]);
  });

  it("MAX_SAFE_INTEGER'a yakın değerlerde taşmaz", () => {
    const half = 4_503_599_627_370_000;
    const shares = allocateProportionally(990, [half, half]);
    // Number aritmetiğiyle 990 * half hassasiyet kaybederdi; BigInt tam sonuç verir.
    expect(shares).toEqual([495, 495]);
    expect(shares?.reduce((a, b) => a + b, 0)).toBe(990);
  });
});

// ------------------------------------------------------------- ürün bölüşümü

describe("calculateDebts — ürün bölüşümü", () => {
  it("tek kişiye atanmış ürünün tamamını o kişiye verir", () => {
    const receipt = receiptOf({ items: [{ id: "i1", totalMinor: 5000 }] });
    const state = stateOf(["a", "b"], "a", { i1: ["a"] });
    const result = expectSuccess(calculateDebts(receipt, state));

    expect(shareOf(result, "a").itemSubtotalMinor).toBe(5000);
    expect(shareOf(result, "b").itemSubtotalMinor).toBe(0);
  });

  it("iki kişi arasında tam bölünen ürünü eşit paylaştırır", () => {
    const receipt = receiptOf({ items: [{ id: "i1", totalMinor: 5000 }] });
    const state = stateOf(["a", "b"], "a", { i1: ["a", "b"] });
    const result = expectSuccess(calculateDebts(receipt, state));

    expect(shareOf(result, "a").itemSubtotalMinor).toBe(2500);
    expect(shareOf(result, "b").itemSubtotalMinor).toBe(2500);
  });

  it("üç kişi arasında tam bölünen ürünü eşit paylaştırır", () => {
    const receipt = receiptOf({ items: [{ id: "i1", totalMinor: 900 }] });
    const state = stateOf(["a", "b", "c"], "a", { i1: ["a", "b", "c"] });
    const result = expectSuccess(calculateDebts(receipt, state));

    for (const id of ["a", "b", "c"]) {
      expect(shareOf(result, id).itemSubtotalMinor).toBe(300);
    }
  });

  it("bir kuruşluk artığı kaybetmez", () => {
    const receipt = receiptOf({ items: [{ id: "i1", totalMinor: 100 }] });
    const state = stateOf(["a", "b", "c"], "a", { i1: ["a", "b", "c"] });
    const result = expectSuccess(calculateDebts(receipt, state));

    expect(sumParticipantItemShares(result.participantShares)).toBe(100);
    expect(
      result.participantShares.map((s) => s.itemSubtotalMinor).sort((x, y) => y - x),
    ).toEqual([34, 33, 33]);
  });

  it("iki kuruşluk artığı kaybetmez", () => {
    const receipt = receiptOf({ items: [{ id: "i1", totalMinor: 101 }] });
    const state = stateOf(["a", "b", "c"], "a", { i1: ["a", "b", "c"] });
    const result = expectSuccess(calculateDebts(receipt, state));

    expect(sumParticipantItemShares(result.participantShares)).toBe(101);
    expect(
      result.participantShares.map((s) => s.itemSubtotalMinor).sort((x, y) => y - x),
    ).toEqual([34, 34, 33]);
  });

  it("artığı ürün sırasına göre dönüşümlü dağıtır", () => {
    // Üç ürün, üçü de 100 ve üç kişiye paylaşık: artık sırayla dolaşır.
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: 100 },
        { id: "i2", totalMinor: 100 },
        { id: "i3", totalMinor: 100 },
      ],
    });
    const state = stateOf(["a", "b", "c"], "a", {
      i1: ["a", "b", "c"],
      i2: ["a", "b", "c"],
      i3: ["a", "b", "c"],
    });
    const result = expectSuccess(calculateDebts(receipt, state));

    // Her kişi tam olarak bir kez fazladan kuruş alır -> hepsi eşit.
    for (const id of ["a", "b", "c"]) {
      expect(shareOf(result, id).itemSubtotalMinor).toBe(100);
    }
    expect(sumParticipantItemShares(result.participantShares)).toBe(300);
  });

  it("dağıtılan ürün paylarının toplamı ürün ara toplamına eşittir", () => {
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: 1333 },
        { id: "i2", totalMinor: 777 },
        { id: "i3", totalMinor: 1 },
      ],
    });
    const state = stateOf(["a", "b", "c"], "b", {
      i1: ["a", "b", "c"],
      i2: ["a", "b"],
      i3: ["c"],
    });
    const result = expectSuccess(calculateDebts(receipt, state));

    expect(sumParticipantItemShares(result.participantShares)).toBe(
      sumItemsMinor(receipt.items),
    );
  });
});

// ------------------------------------------------------------- düzeltmeler

describe("calculateDebts — vergi / servis / indirim", () => {
  it("ürün fiyatlarına dahil vergiyi ikinci kez uygulamaz", () => {
    const receipt = receiptOf({
      items: [{ id: "i1", totalMinor: 10000 }],
      tax: 1800,
      taxTreatment: "included_in_items",
    });
    const state = stateOf(["a", "b"], "a", { i1: ["a", "b"] });
    const result = expectSuccess(calculateDebts(receipt, state));

    expect(result.receiptTotalMinor).toBe(10000);
    for (const id of ["a", "b"]) {
      expect(shareOf(result, id).taxMinor).toBe(0);
      expect(shareOf(result, id).totalMinor).toBe(5000);
    }
    expect(result.allocatedTotalMinor).toBe(10000);
  });

  it("ayrı uygulanan vergiyi ürün payı oranında dağıtır", () => {
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: 3000 },
        { id: "i2", totalMinor: 1000 },
      ],
      tax: 400,
      taxTreatment: "separate",
    });
    const state = stateOf(["a", "b"], "a", { i1: ["a"], i2: ["b"] });
    const result = expectSuccess(calculateDebts(receipt, state));

    expect(shareOf(result, "a").taxMinor).toBe(300);
    expect(shareOf(result, "b").taxMinor).toBe(100);
    expect(result.allocatedTotalMinor).toBe(4400);
  });

  it("ayrı uygulanan servis ücretini dağıtır", () => {
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: 3000 },
        { id: "i2", totalMinor: 1000 },
      ],
      service: 400,
      serviceTreatment: "separate",
    });
    const state = stateOf(["a", "b"], "a", { i1: ["a"], i2: ["b"] });
    const result = expectSuccess(calculateDebts(receipt, state));

    expect(shareOf(result, "a").serviceChargeMinor).toBe(300);
    expect(shareOf(result, "b").serviceChargeMinor).toBe(100);
  });

  it("ayrı uygulanan indirimi düşer", () => {
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: 3000 },
        { id: "i2", totalMinor: 1000 },
      ],
      discount: 400,
      discountTreatment: "separate",
    });
    const state = stateOf(["a", "b"], "a", { i1: ["a"], i2: ["b"] });
    const result = expectSuccess(calculateDebts(receipt, state));

    expect(shareOf(result, "a").discountMinor).toBe(300);
    expect(shareOf(result, "a").totalMinor).toBe(2700);
    expect(shareOf(result, "b").discountMinor).toBe(100);
    expect(shareOf(result, "b").totalMinor).toBe(900);
    expect(result.allocatedTotalMinor).toBe(3600);
  });

  it("dahil KDV ile ayrı servis ücretini aynı fişte doğru işler", () => {
    // Gerçek kalibrasyon senaryosu: KDV fiyatlara dahil, servis ayrı eklenmiş.
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: 12550 },
        { id: "i2", totalMinor: 32000 },
        { id: "i3", totalMinor: 4550 },
      ],
      tax: 4464,
      taxTreatment: "included_in_items",
      service: 4910,
      serviceTreatment: "separate",
    });
    const state = stateOf(["a", "b"], "a", {
      i1: ["a"],
      i2: ["a", "b"],
      i3: ["b"],
    });
    const result = expectSuccess(calculateDebts(receipt, state));

    expect(result.receiptTotalMinor).toBe(54010);
    expect(result.allocatedTotalMinor).toBe(54010);
    for (const share of result.participantShares) {
      expect(share.taxMinor).toBe(0);
    }
    const serviceTotal = result.participantShares.reduce(
      (sum, s) => sum + s.serviceChargeMinor,
      0,
    );
    expect(serviceTotal).toBe(4910);
  });

  it("orantılı dağıtımda eşit kalanları kişi sırasına göre çözer", () => {
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: 100 },
        { id: "i2", totalMinor: 100 },
      ],
      tax: 1,
      taxTreatment: "separate",
    });
    const state = stateOf(["a", "b"], "a", { i1: ["a"], i2: ["b"] });
    const result = expectSuccess(calculateDebts(receipt, state));

    expect(shareOf(result, "a").taxMinor).toBe(1);
    expect(shareOf(result, "b").taxMinor).toBe(0);
  });
});

// --------------------------------------------------------------- doğrulama

describe("calculateDebts — doğrulama", () => {
  const items = [{ id: "i1", totalMinor: 1000 }];

  it("geçersiz fişi reddeder", () => {
    const receipt = { ...receiptOf({ items }), totalMinor: -1 } as Receipt;
    const state = stateOf(["a", "b"], "a", { i1: ["a"] });
    expect(calculateDebts(receipt, state).status).toBe("invalidReceipt");
  });

  it("tek kişiyle hesaplamaz", () => {
    const state = stateOf(["a"], "a", { i1: ["a"] });
    const result = calculateDebts(receiptOf({ items }), state);
    expect(result).toMatchObject({
      status: "invalidAssignments",
      detail: "notEnoughParticipants",
    });
  });

  it("geçersiz kişi ismini reddeder", () => {
    const state = stateOf(["a", "b"], "a", { i1: ["a"] });
    state.participants[1].name = "  ";
    const result = calculateDebts(receiptOf({ items }), state);
    expect(result).toMatchObject({
      status: "invalidAssignments",
      detail: "invalidParticipantName",
    });
  });

  it("bilinmeyen ödeyeni reddeder", () => {
    const state = stateOf(["a", "b"], "yok", { i1: ["a"] });
    const result = calculateDebts(receiptOf({ items }), state);
    expect(result).toMatchObject({
      status: "invalidAssignments",
      detail: "unknownPayer",
    });
  });

  it("eksik atama kaydını reddeder", () => {
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: 1000 },
        { id: "i2", totalMinor: 500 },
      ],
    });
    const state = stateOf(["a", "b"], "a", { i1: ["a"] });
    const result = calculateDebts(receipt, state);
    expect(result).toMatchObject({
      status: "invalidAssignments",
      detail: "missingAssignment",
    });
  });

  it("aynı ürün için ikinci atama kaydını reddeder", () => {
    const state: AssignmentState = {
      participants: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      payerId: "a",
      assignments: [
        { itemId: "i1", participantIds: ["a"] },
        { itemId: "i1", participantIds: ["b"] },
      ],
    };
    const result = calculateDebts(receiptOf({ items }), state);
    expect(result).toMatchObject({
      status: "invalidAssignments",
      detail: "duplicateAssignment",
    });
  });

  it("bir üründe tekrarlanan kişi ID'sini reddeder", () => {
    const state = stateOf(["a", "b"], "a", { i1: ["a", "a"] });
    const result = calculateDebts(receiptOf({ items }), state);
    expect(result).toMatchObject({
      status: "invalidAssignments",
      detail: "duplicateParticipantInAssignment",
    });
  });

  it("bilinmeyen kişi ID'sini reddeder", () => {
    const state = stateOf(["a", "b"], "a", { i1: ["a", "yok"] });
    const result = calculateDebts(receiptOf({ items }), state);
    expect(result).toMatchObject({
      status: "invalidAssignments",
      detail: "unknownParticipant",
    });
  });

  it("bilinmeyen ürün ID'sini reddeder", () => {
    const state = stateOf(["a", "b"], "a", { i1: ["a"], hayalet: ["b"] });
    const result = calculateDebts(receiptOf({ items }), state);
    expect(result).toMatchObject({
      status: "invalidAssignments",
      detail: "unknownItem",
    });
  });

  it("kimseye atanmamış ürünü reddeder", () => {
    const state = stateOf(["a", "b"], "a", { i1: [] });
    const result = calculateDebts(receiptOf({ items }), state);
    expect(result).toMatchObject({
      status: "invalidAssignments",
      detail: "unassignedItem",
    });
  });

  it("belirsiz toplamda hesaplamayı durdurur", () => {
    const receipt = receiptOf({
      items,
      tax: 180,
      taxTreatment: "unknown",
      totalMinor: 1000,
    });
    const state = stateOf(["a", "b"], "a", { i1: ["a"] });
    const result = calculateDebts(receipt, state);
    expect(result.status).toBe("indeterminateTotals");
    if (result.status === "indeterminateTotals") {
      expect(result.uncertainAdjustments).toEqual(["tax"]);
    }
  });

  it("uyuşmayan toplamda hesaplamayı durdurur", () => {
    const receipt = receiptOf({ items, totalMinor: 999 });
    const state = stateOf(["a", "b"], "a", { i1: ["a"] });
    const result = calculateDebts(receipt, state);
    expect(result.status).toBe("mismatchedTotals");
    if (result.status === "mismatchedTotals") {
      expect(result.differenceMinor).toBe(1);
    }
  });

  it("ürün toplamı sıfırken ayrı ücret varsa dağıtım uydurmaz", () => {
    const receipt = receiptOf({
      items: [{ id: "i1", totalMinor: 0 }],
      service: 500,
      serviceTreatment: "separate",
    });
    const state = stateOf(["a", "b"], "a", { i1: ["a", "b"] });
    expect(calculateDebts(receipt, state).status).toBe("zeroAllocationWeight");
  });

  it("çift ürün kimliğini reddeder", () => {
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: 1000 },
        { id: "i1", totalMinor: 500 },
      ],
    });
    const state = stateOf(["a", "b"], "a", { i1: ["a"] });
    const result = calculateDebts(receipt, state);
    expect(result).toMatchObject({
      status: "invalidReceipt",
      detail: "duplicateItemId",
    });
  });

  it("çift kişi kimliğini reddeder", () => {
    const state: AssignmentState = {
      participants: [
        { id: "a", name: "A" },
        { id: "a", name: "B" },
      ],
      payerId: "a",
      assignments: [{ itemId: "i1", participantIds: ["a"] }],
    };
    const result = calculateDebts(receiptOf({ items }), state);
    expect(result).toMatchObject({
      status: "invalidAssignments",
      detail: "duplicateParticipantId",
    });
  });

  it("tek başına güvenli olmayan tutarı reddeder", () => {
    // Şema ilk savunma hattı: .int() güvenli tam sayı aralığını uygular.
    const receipt = {
      ...receiptOf({ items }),
      totalMinor: Number.MAX_SAFE_INTEGER + 2,
    } as Receipt;
    const state = stateOf(["a", "b"], "a", { i1: ["a"] });
    const result = calculateDebts(receipt, state);
    expect(result.status).toBe("invalidReceipt");
  });

  it("tek tek güvenli ama toplamı güvenli aralığı aşan tutarları reddeder", () => {
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: Number.MAX_SAFE_INTEGER },
        { id: "i2", totalMinor: Number.MAX_SAFE_INTEGER },
      ],
      totalMinor: 1000,
    });
    const state = stateOf(["a", "b"], "a", { i1: ["a"], i2: ["b"] });
    const result = calculateDebts(receipt, state);
    expect(result).toMatchObject({
      status: "unsafeAmount",
      field: "itemsSubtotal",
    });
  });
});

// ------------------------------------------- yuvarlama regresyonu / değişmezler

describe("calculateDebts — yuvarlama regresyonu", () => {
  it("vergi 1 + servis 1 - indirim 4 durumunda pay eksiye düşmez", () => {
    // Önceki sürümde bağımsız eşitlik bozumu yüzünden bir kişinin payı -1
    // oluyordu. İndirim artık bakiye oranında düşüldüğü için bu olamaz.
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: 1 },
        { id: "i2", totalMinor: 1 },
      ],
      tax: 1,
      taxTreatment: "separate",
      service: 1,
      serviceTreatment: "separate",
      discount: 4,
      discountTreatment: "separate",
    });
    const state = stateOf(["a", "b"], "a", { i1: ["a"], i2: ["b"] });
    const result = expectSuccess(calculateDebts(receipt, state));

    expect(receipt.totalMinor).toBe(0);
    expect(result.allocatedTotalMinor).toBe(0);
    for (const share of result.participantShares) {
      expect(share.totalMinor).toBeGreaterThanOrEqual(0);
    }
    expect(result.debts).toEqual([]);
  });

  it("eşit kalanlarda önceliği kalemden kaleme kaydırır", () => {
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: 100 },
        { id: "i2", totalMinor: 100 },
      ],
      tax: 1,
      taxTreatment: "separate",
      service: 1,
      serviceTreatment: "separate",
    });
    const state = stateOf(["a", "b"], "a", { i1: ["a"], i2: ["b"] });
    const result = expectSuccess(calculateDebts(receipt, state));

    // Vergi ilk kişiye, servis ikinci kişiye gider.
    expect(shareOf(result, "a").taxMinor).toBe(1);
    expect(shareOf(result, "b").taxMinor).toBe(0);
    expect(shareOf(result, "a").serviceChargeMinor).toBe(0);
    expect(shareOf(result, "b").serviceChargeMinor).toBe(1);
  });

  it("aynı girdi için her zaman aynı sonucu üretir", () => {
    const receipt = receiptOf({
      items: [
        { id: "i1", totalMinor: 333 },
        { id: "i2", totalMinor: 667 },
      ],
      tax: 7,
      taxTreatment: "separate",
      service: 5,
      serviceTreatment: "separate",
      discount: 3,
      discountTreatment: "separate",
    });
    const state = stateOf(["a", "b", "c"], "b", {
      i1: ["a", "b"],
      i2: ["b", "c"],
    });
    const first = JSON.stringify(calculateDebts(receipt, state));
    for (let i = 0; i < 5; i += 1) {
      expect(JSON.stringify(calculateDebts(receipt, state))).toBe(first);
    }
  });

  it("küçük değer uzayında hiçbir değişmez bozulmaz", () => {
    const LIMIT = 6;
    let successCount = 0;
    let blockedCount = 0;

    for (let w0 = 0; w0 <= LIMIT; w0 += 1) {
      for (let w1 = 0; w1 <= LIMIT; w1 += 1) {
        for (let tax = 0; tax <= LIMIT; tax += 1) {
          for (let service = 0; service <= LIMIT; service += 1) {
            for (let discount = 0; discount <= LIMIT; discount += 1) {
              const expected = w0 + w1 + tax + service - discount;
              // Negatif genel toplam şema tarafından zaten reddedilir.
              if (expected < 0) {
                continue;
              }

              const receipt = receiptOf({
                items: [
                  { id: "i1", totalMinor: w0 },
                  { id: "i2", totalMinor: w1 },
                ],
                tax,
                taxTreatment: "separate",
                service,
                serviceTreatment: "separate",
                discount,
                discountTreatment: "separate",
              });
              const state = stateOf(["a", "b"], "a", {
                i1: ["a"],
                i2: ["b"],
              });
              const result = calculateDebts(receipt, state);

              if (result.status !== "success") {
                // Tek meşru engel: ağırlık sıfırken dağıtılacak tutar olması.
                expect(result.status).toBe("zeroAllocationWeight");
                expect(w0 + w1).toBe(0);
                blockedCount += 1;
                continue;
              }
              successCount += 1;

              const shares = result.participantShares;
              // Hiçbir kuruş kaybolmaz.
              expect(shares.reduce((sum, s) => sum + s.totalMinor, 0)).toBe(
                receipt.totalMinor,
              );
              expect(result.allocatedTotalMinor).toBe(receipt.totalMinor);
              // Kalem dağıtımları kaynak tutarlarına eşittir.
              expect(shares.reduce((sum, s) => sum + s.itemSubtotalMinor, 0)).toBe(
                w0 + w1,
              );
              expect(shares.reduce((sum, s) => sum + s.taxMinor, 0)).toBe(tax);
              expect(
                shares.reduce((sum, s) => sum + s.serviceChargeMinor, 0),
              ).toBe(service);
              expect(shares.reduce((sum, s) => sum + s.discountMinor, 0)).toBe(
                discount,
              );
              // Hiçbir pay eksiye düşmez.
              for (const share of shares) {
                expect(share.totalMinor).toBeGreaterThanOrEqual(0);
              }
              // Borç değişmezi korunur.
              const payerTotal = shareOf(result, result.payerId).totalMinor;
              expect(sumDebts(result.debts)).toBe(
                receipt.totalMinor - payerTotal,
              );
              expect(
                result.debts.some((d) => d.fromParticipantId === result.payerId),
              ).toBe(false);
              expect(result.debts.every((d) => d.amountMinor > 0)).toBe(true);
            }
          }
        }
      }
    }

    expect(successCount).toBeGreaterThan(1000);
    expect(blockedCount).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------------- borç kuralları

describe("calculateDebts — borçlar ve değişmezler", () => {
  const receipt = receiptOf({
    items: [
      { id: "i1", totalMinor: 12550 },
      { id: "i2", totalMinor: 32000 },
      { id: "i3", totalMinor: 4550 },
      { id: "i4", totalMinor: 18000 },
    ],
    tax: 4464,
    taxTreatment: "included_in_items",
    service: 4910,
    serviceTreatment: "separate",
  });
  const state = stateOf(["a", "b", "c"], "a", {
    i1: ["a"],
    i2: ["a", "b"],
    i3: ["b", "c"],
    i4: ["c"],
  });

  it("kişi paylarının toplamı fiş genel toplamına tam eşittir", () => {
    const result = expectSuccess(calculateDebts(receipt, state));
    expect(result.allocatedTotalMinor).toBe(result.receiptTotalMinor);
    expect(
      result.participantShares.reduce((sum, s) => sum + s.totalMinor, 0),
    ).toBe(receipt.totalMinor);
  });

  it("ödeyen için borç üretmez", () => {
    const result = expectSuccess(calculateDebts(receipt, state));
    expect(result.debts.some((d) => d.fromParticipantId === "a")).toBe(false);
    expect(result.debts.every((d) => d.toParticipantId === "a")).toBe(true);
  });

  it("borç toplamı genel toplam eksi ödeyenin payına eşittir", () => {
    const result = expectSuccess(calculateDebts(receipt, state));
    const payerShare = shareOf(result, result.payerId).totalMinor;
    expect(sumDebts(result.debts)).toBe(receipt.totalMinor - payerShare);
  });

  it("ödeyen değişince borç yönü değişir", () => {
    const asB = expectSuccess(calculateDebts(receipt, { ...state, payerId: "b" }));
    expect(asB.debts.every((d) => d.toParticipantId === "b")).toBe(true);
    expect(asB.debts.map((d) => d.fromParticipantId).sort()).toEqual(["a", "c"]);
  });

  it("sıfır tutarlı borç kaydı üretmez", () => {
    // c hiçbir ürüne atanmamış olamaz; payı sıfır olan bir kişi için borç yok.
    const soloReceipt = receiptOf({ items: [{ id: "i1", totalMinor: 1000 }] });
    const soloState = stateOf(["a", "b"], "a", { i1: ["a"] });
    const result = expectSuccess(calculateDebts(soloReceipt, soloState));

    expect(shareOf(result, "b").totalMinor).toBe(0);
    expect(result.debts).toEqual([]);
    expect(sumDebts(result.debts)).toBe(
      soloReceipt.totalMinor - shareOf(result, "a").totalMinor,
    );
  });

  it("yuvarlama yöntemini sonuçta bildirir", () => {
    const result = expectSuccess(calculateDebts(receipt, state));
    expect(result.rounding.method).toBe(ROUNDING_METHOD);
    expect(result.rounding.description.length).toBeGreaterThan(0);
  });

  it("büyük ama geçerli tutarlarda taşmadan hesaplar", () => {
    const half = 4_503_599_627_370_000;
    const bigReceipt = receiptOf({
      items: [{ id: "i1", totalMinor: half * 2 }],
      tax: 990,
      taxTreatment: "separate",
    });
    const bigState = stateOf(["a", "b"], "a", { i1: ["a", "b"] });
    const result = expectSuccess(calculateDebts(bigReceipt, bigState));

    expect(result.receiptTotalMinor).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(shareOf(result, "a").itemSubtotalMinor).toBe(half);
    expect(shareOf(result, "a").taxMinor).toBe(495);
    expect(shareOf(result, "b").taxMinor).toBe(495);
    expect(result.allocatedTotalMinor).toBe(result.receiptTotalMinor);
  });
});
