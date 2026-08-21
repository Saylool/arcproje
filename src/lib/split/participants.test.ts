import { describe, expect, it } from "vitest";

import type { Receipt } from "../receipt/schema";
import {
  DEFAULT_PARTICIPANT_NAME,
  MIN_PARTICIPANTS,
  addParticipant,
  checkAssignmentsComplete,
  checkReceiptReadyForSplit,
  createInitialAssignmentState,
  findParticipantNameIssues,
  getAssignedParticipantIds,
  normalizeAssignments,
  removeParticipant,
  renameParticipant,
  setParticipantName,
  setPayer,
  summarizeAssignments,
  toggleItemParticipant,
  validateParticipantName,
  type AssignmentState,
} from "./participants";

const ITEMS = [{ id: "i1" }, { id: "i2" }, { id: "i3" }];

function buildState(overrides: Partial<AssignmentState> = {}): AssignmentState {
  return {
    participants: [
      { id: "p1", name: "Sen" },
      { id: "p2", name: "Ayşe" },
      { id: "p3", name: "Mehmet" },
    ],
    payerId: "p1",
    assignments: [
      { itemId: "i1", participantIds: ["p1"] },
      { itemId: "i2", participantIds: ["p2", "p3"] },
      { itemId: "i3", participantIds: ["p1", "p2", "p3"] },
    ],
    ...overrides,
  };
}

function buildReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    merchantName: "Test",
    currency: "TRY",
    items: [
      { id: "i1", name: "Çay", totalMinor: 2500 },
      { id: "i2", name: "Kek", totalMinor: 7500 },
    ],
    taxMinor: 0,
    taxTreatment: "included_in_items",
    serviceChargeMinor: 0,
    serviceChargeTreatment: "included_in_items",
    discountMinor: 0,
    discountTreatment: "included_in_items",
    totalMinor: 10000,
    warnings: [],
    ...overrides,
  };
}

describe("createInitialAssignmentState", () => {
  it("varsayılan olarak tek kişiyle başlar ve o kişi ödeyendir", () => {
    const state = createInitialAssignmentState();
    expect(state.participants).toHaveLength(1);
    expect(state.participants[0].name).toBe(DEFAULT_PARTICIPANT_NAME);
    expect(state.payerId).toBe(state.participants[0].id);
    expect(state.assignments).toEqual([]);
  });

  it("her çağrıda benzersiz ID üretir", () => {
    const ids = new Set(
      Array.from({ length: 100 }, () => createInitialAssignmentState().participants[0].id),
    );
    expect(ids.size).toBe(100);
  });
});

describe("validateParticipantName", () => {
  const participants = [{ id: "p1", name: "Ayşe" }];

  it("boş ve yalnızca boşluktan oluşan ismi reddeder", () => {
    expect(validateParticipantName("", participants)).toBe("empty");
    expect(validateParticipantName("   ", participants)).toBe("empty");
    expect(validateParticipantName("\t\n", participants)).toBe("empty");
  });

  it("büyük/küçük harf farkı dışında aynı ismi reddeder", () => {
    expect(validateParticipantName("Ayşe", participants)).toBe("duplicate");
    expect(validateParticipantName("ayşe", participants)).toBe("duplicate");
    expect(validateParticipantName("AYŞE", participants)).toBe("duplicate");
  });

  it("baş ve sondaki boşlukları yok sayarak karşılaştırır", () => {
    expect(validateParticipantName("  Ayşe  ", participants)).toBe("duplicate");
  });

  it("farklı ismi kabul eder", () => {
    expect(validateParticipantName("Mehmet", participants)).toBeNull();
  });

  it("yeniden adlandırmada kişinin kendi ismini çakışma saymaz", () => {
    expect(validateParticipantName("Ayşe", participants, "p1")).toBeNull();
  });
});

describe("addParticipant", () => {
  it("geçerli ismi trim ederek ekler", () => {
    const result = addParticipant(buildState(), "  Zeynep  ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.participants).toHaveLength(4);
      expect(result.state.participants[3].name).toBe("Zeynep");
    }
  });

  it("boş ve tekrar isimleri reddeder", () => {
    expect(addParticipant(buildState(), "  ")).toEqual({ ok: false, error: "empty" });
    expect(addParticipant(buildState(), "ayşe")).toEqual({
      ok: false,
      error: "duplicate",
    });
  });

  it("hiç kişi yokken eklenen ilk kişiyi ödeyen yapar", () => {
    const empty: AssignmentState = { participants: [], payerId: "", assignments: [] };
    const result = addParticipant(empty, "Sen");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.payerId).toBe(result.state.participants[0].id);
    }
  });
});

describe("renameParticipant", () => {
  it("ismi trim ederek günceller ve ID'yi korur", () => {
    const result = renameParticipant(buildState(), "p2", "  Zeynep ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const renamed = result.state.participants.find((p) => p.id === "p2");
      expect(renamed?.name).toBe("Zeynep");
      expect(result.state.assignments).toEqual(buildState().assignments);
    }
  });

  it("boş ve başkasına ait ismi reddeder", () => {
    expect(renameParticipant(buildState(), "p2", "")).toEqual({
      ok: false,
      error: "empty",
    });
    expect(renameParticipant(buildState(), "p2", "Mehmet")).toEqual({
      ok: false,
      error: "duplicate",
    });
  });
});

describe("setParticipantName", () => {
  it("doğrulamadan yazar ve ID ile atamaları korur", () => {
    const next = setParticipantName(buildState(), "p2", "  ");
    expect(next.participants.find((p) => p.id === "p2")?.name).toBe("  ");
    expect(next.assignments).toEqual(buildState().assignments);
  });

  it("geçersiz isim yazıldığında sorun raporlanabilir kalır", () => {
    const next = setParticipantName(buildState(), "p2", "Mehmet");
    const issues = findParticipantNameIssues(next.participants);
    expect(issues.some((issue) => issue.error === "duplicate")).toBe(true);
    expect(checkAssignmentsComplete(next, ITEMS).ok).toBe(false);
  });
});

describe("removeParticipant", () => {
  it("kişinin bütün ürün atamalarını temizler", () => {
    const next = removeParticipant(buildState(), "p2");
    expect(next.participants.map((p) => p.id)).toEqual(["p1", "p3"]);
    const allIds = next.assignments.flatMap((a) => a.participantIds);
    expect(allIds).not.toContain("p2");
  });

  it("atamasız kalan ürünün kaydını tamamen kaldırır", () => {
    const next = removeParticipant(buildState(), "p1");
    // i1 yalnızca p1'e atanmıştı.
    expect(next.assignments.some((a) => a.itemId === "i1")).toBe(false);
    expect(getAssignedParticipantIds(next, "i1")).toEqual([]);
  });

  it("paylaşılan üründe diğer kişileri korur", () => {
    const next = removeParticipant(buildState(), "p3");
    expect(getAssignedParticipantIds(next, "i2")).toEqual(["p2"]);
    expect(getAssignedParticipantIds(next, "i3")).toEqual(["p1", "p2"]);
  });

  it("ödeyen silindiğinde kalan ilk kişiye devreder", () => {
    const next = removeParticipant(buildState(), "p1");
    expect(next.payerId).toBe("p2");
  });

  it("ödeyen olmayan biri silinince ödeyeni değiştirmez", () => {
    const next = removeParticipant(buildState(), "p3");
    expect(next.payerId).toBe("p1");
  });

  it("son kişi de silinirse ödeyen boşa düşer", () => {
    const single: AssignmentState = {
      participants: [{ id: "p1", name: "Sen" }],
      payerId: "p1",
      assignments: [{ itemId: "i1", participantIds: ["p1"] }],
    };
    const next = removeParticipant(single, "p1");
    expect(next.participants).toEqual([]);
    expect(next.payerId).toBe("");
    expect(next.assignments).toEqual([]);
  });
});

describe("setPayer", () => {
  it("yalnızca mevcut kişiyi ödeyen yapar", () => {
    expect(setPayer(buildState(), "p3").payerId).toBe("p3");
    expect(setPayer(buildState(), "yok").payerId).toBe("p1");
  });
});

describe("toggleItemParticipant", () => {
  it("atanmamış ürüne kişi ekler", () => {
    const state = buildState({ assignments: [] });
    const next = toggleItemParticipant(state, "i1", "p2");
    expect(getAssignedParticipantIds(next, "i1")).toEqual(["p2"]);
  });

  it("aynı kişiyi ikinci kez eklemez, kaldırır", () => {
    const next = toggleItemParticipant(buildState(), "i1", "p1");
    expect(getAssignedParticipantIds(next, "i1")).toEqual([]);
  });

  it("bir ürünü birden fazla kişiye atayabilir", () => {
    const state = buildState({ assignments: [] });
    const next = toggleItemParticipant(
      toggleItemParticipant(state, "i1", "p1"),
      "i1",
      "p2",
    );
    expect(getAssignedParticipantIds(next, "i1")).toEqual(["p1", "p2"]);
  });

  it("aynı participant ID'nin tekrarlanmasına izin vermez", () => {
    let state = buildState({ assignments: [] });
    for (let i = 0; i < 5; i += 1) {
      state = toggleItemParticipant(state, "i1", "p1");
      state = toggleItemParticipant(state, "i1", "p1");
    }
    state = toggleItemParticipant(state, "i1", "p1");
    expect(getAssignedParticipantIds(state, "i1")).toEqual(["p1"]);
  });

  it("bilinmeyen kişiyi atamaz", () => {
    const next = toggleItemParticipant(buildState(), "i1", "yok");
    expect(next).toEqual(buildState());
  });
});

describe("normalizeAssignments", () => {
  it("artık bulunmayan item ID'lerini temizler", () => {
    const state = buildState();
    const next = normalizeAssignments(state, ["i1", "i2"]);
    expect(next.assignments.map((a) => a.itemId)).toEqual(["i1", "i2"]);
  });

  it("artık bulunmayan participant ID'lerini temizler", () => {
    const state = buildState({
      participants: [{ id: "p1", name: "Sen" }],
      payerId: "p1",
    });
    const next = normalizeAssignments(state, ["i1", "i2", "i3"]);
    expect(getAssignedParticipantIds(next, "i1")).toEqual(["p1"]);
    // i2 yalnızca silinmiş kişilere atanmıştı -> kayıt tamamen düşer.
    expect(next.assignments.some((a) => a.itemId === "i2")).toBe(false);
    expect(getAssignedParticipantIds(next, "i3")).toEqual(["p1"]);
  });

  it("tekrarlanan participant ID'lerini tekilleştirir", () => {
    const state = buildState({
      assignments: [{ itemId: "i1", participantIds: ["p1", "p1", "p2", "p1"] }],
    });
    const next = normalizeAssignments(state, ["i1"]);
    expect(getAssignedParticipantIds(next, "i1")).toEqual(["p1", "p2"]);
  });

  it("aynı ürün için birden fazla kaydı birleştirir", () => {
    const state = buildState({
      assignments: [
        { itemId: "i1", participantIds: ["p1"] },
        { itemId: "i1", participantIds: ["p2", "p1"] },
      ],
    });
    const next = normalizeAssignments(state, ["i1"]);
    expect(next.assignments).toHaveLength(1);
    expect(getAssignedParticipantIds(next, "i1")).toEqual(["p1", "p2"]);
  });

  it("geçersiz kalan ödeyeni ilk kişiye düşürür", () => {
    const state = buildState({ payerId: "silinmis" });
    expect(normalizeAssignments(state, ["i1"]).payerId).toBe("p1");
  });

  it("receipt ürün ID'lerini olduğu gibi korur", () => {
    const receipt = buildReceipt();
    const state: AssignmentState = {
      participants: [{ id: "p1", name: "Sen" }],
      payerId: "p1",
      assignments: [
        { itemId: "i1", participantIds: ["p1"] },
        { itemId: "i2", participantIds: ["p1"] },
      ],
    };
    const next = normalizeAssignments(
      state,
      receipt.items.map((item) => item.id),
    );
    expect(next.assignments.map((a) => a.itemId)).toEqual(
      receipt.items.map((item) => item.id),
    );
  });

  it("kişileri ve isimlerini değiştirmez", () => {
    const state = buildState();
    expect(normalizeAssignments(state, ["i1"]).participants).toEqual(
      state.participants,
    );
  });
});

describe("summarizeAssignments", () => {
  it("ödeyen adını ve kişi sayısını verir", () => {
    const summary = summarizeAssignments(buildState(), ITEMS);
    expect(summary.payerName).toBe("Sen");
    expect(summary.participantCount).toBe(3);
  });

  it("atanmış ve paylaşılan ürün sayısını doğru hesaplar", () => {
    const summary = summarizeAssignments(buildState(), ITEMS);
    expect(summary.assignedItemCount).toBe(3);
    // i2 (2 kişi) ve i3 (3 kişi) paylaşılıyor; i1 tek kişide.
    expect(summary.sharedItemCount).toBe(2);
    expect(summary.unassignedItemIds).toEqual([]);
  });

  it("atanmamış ürünleri listeler", () => {
    const state = buildState({
      assignments: [{ itemId: "i1", participantIds: ["p1"] }],
    });
    const summary = summarizeAssignments(state, ITEMS);
    expect(summary.assignedItemCount).toBe(1);
    expect(summary.sharedItemCount).toBe(0);
    expect(summary.unassignedItemIds).toEqual(["i2", "i3"]);
  });

  it("ödeyen yoksa null döner", () => {
    const summary = summarizeAssignments(
      { participants: [], payerId: "", assignments: [] },
      ITEMS,
    );
    expect(summary.payerName).toBeNull();
  });
});

describe("findParticipantNameIssues", () => {
  it("temiz listede sorun bulmaz", () => {
    expect(findParticipantNameIssues(buildState().participants)).toEqual([]);
  });

  it("boş ve tekrar isimleri bildirir", () => {
    const issues = findParticipantNameIssues([
      { id: "p1", name: "Sen" },
      { id: "p2", name: "  " },
      { id: "p3", name: "sen" },
    ]);
    expect(issues).toContainEqual({ id: "p2", error: "empty" });
    expect(issues.some((issue) => issue.error === "duplicate")).toBe(true);
  });
});

describe("checkReceiptReadyForSplit", () => {
  it("geçerli fişi kabul eder", () => {
    expect(checkReceiptReadyForSplit(buildReceipt())).toEqual({ ok: true });
  });

  it("ürünsüz fişi reddeder", () => {
    const result = checkReceiptReadyForSplit(buildReceipt({ items: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("noItems");
    }
  });

  it("adı boş ürün varsa reddeder", () => {
    const result = checkReceiptReadyForSplit(
      buildReceipt({
        items: [
          { id: "i1", name: "Çay", totalMinor: 2500 },
          { id: "i2", name: "   ", totalMinor: 7500 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("emptyItemName");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("sözleşmeye uymayan fişi reddeder", () => {
    const result = checkReceiptReadyForSplit(
      buildReceipt({ totalMinor: -1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalidReceipt");
    }
  });
});

describe("checkAssignmentsComplete", () => {
  it("her ürün atanmışsa tamam der", () => {
    expect(checkAssignmentsComplete(buildState(), ITEMS)).toEqual({ ok: true });
  });

  it("tek kişiyle devam ettirmez", () => {
    const state = buildState({
      participants: [{ id: "p1", name: "Sen" }],
      payerId: "p1",
      assignments: ITEMS.map((item) => ({
        itemId: item.id,
        participantIds: ["p1"],
      })),
    });
    const result = checkAssignmentsComplete(state, ITEMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("notEnoughParticipants");
      expect(result.message).toContain(String(MIN_PARTICIPANTS));
    }
  });

  it("geçersiz isim varsa devam ettirmez", () => {
    const state = buildState({
      participants: [
        { id: "p1", name: "Sen" },
        { id: "p2", name: "" },
        { id: "p3", name: "Mehmet" },
      ],
    });
    const result = checkAssignmentsComplete(state, ITEMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalidParticipantName");
    }
  });

  it("atanmamış ürün varsa devam ettirmez", () => {
    const state = buildState({
      assignments: [{ itemId: "i1", participantIds: ["p1"] }],
    });
    const result = checkAssignmentsComplete(state, ITEMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unassignedItems");
      expect(result.message).toContain("2");
    }
  });
});
