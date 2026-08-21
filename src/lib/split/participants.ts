import { ReceiptSchema, type Receipt } from "../receipt/schema";

/** Devam edebilmek için gereken en az kişi sayısı. */
export const MIN_PARTICIPANTS = 2;

/** Akış her zaman kullanıcının kendisiyle başlar. */
export const DEFAULT_PARTICIPANT_NAME = "Sen";

export type Participant = {
  id: string;
  name: string;
};

export type ItemAssignment = {
  /** Receipt item ID'si. Ürün adına veya index'e asla bağlanmaz. */
  itemId: string;
  /** Tekil participant ID'leri. Birden fazlaysa ürün bu kişiler arasında paylaşılır. */
  participantIds: string[];
};

export type AssignmentState = {
  participants: Participant[];
  /** Fişi ödeyen kişinin ID'si. Kişi kalmadıysa boş string. */
  payerId: string;
  assignments: ItemAssignment[];
};

/**
 * Kişi ID'si üretir. Array index'i kimlik olarak kullanılmaz; isim değişse bile
 * atamalar bozulmaz.
 */
export function createParticipantId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createInitialAssignmentState(): AssignmentState {
  const you: Participant = {
    id: createParticipantId(),
    name: DEFAULT_PARTICIPANT_NAME,
  };
  return { participants: [you], payerId: you.id, assignments: [] };
}

/**
 * Karşılaştırma anahtarı. Uygulama Türkçe olduğu için Türkçe küçük harf
 * kuralları kullanılır ("İ" -> "i", "I" -> "ı").
 */
function toNameKey(name: string): string {
  return name.trim().toLocaleLowerCase("tr");
}

export type ParticipantNameError = "empty" | "duplicate";

const NAME_ERROR_MESSAGES: Record<ParticipantNameError, string> = {
  empty: "İsim boş olamaz.",
  duplicate: "Bu isim zaten listede var.",
};

export function describeParticipantNameError(
  error: ParticipantNameError,
): string {
  return NAME_ERROR_MESSAGES[error];
}

export function validateParticipantName(
  name: string,
  participants: readonly Participant[],
  excludeId?: string,
): ParticipantNameError | null {
  if (name.trim() === "") {
    return "empty";
  }
  const key = toNameKey(name);
  const clashes = participants.some(
    (participant) =>
      participant.id !== excludeId && toNameKey(participant.name) === key,
  );
  return clashes ? "duplicate" : null;
}

export type ParticipantMutation =
  | { ok: true; state: AssignmentState }
  | { ok: false; error: ParticipantNameError };

export function addParticipant(
  state: AssignmentState,
  name: string,
): ParticipantMutation {
  const error = validateParticipantName(name, state.participants);
  if (error !== null) {
    return { ok: false, error };
  }

  const participant: Participant = {
    id: createParticipantId(),
    name: name.trim(),
  };

  return {
    ok: true,
    state: {
      ...state,
      participants: [...state.participants, participant],
      // Hiç kişi kalmamışken eklenen ilk kişi ödeyen olur.
      payerId: state.payerId === "" ? participant.id : state.payerId,
    },
  };
}

export function renameParticipant(
  state: AssignmentState,
  id: string,
  name: string,
): ParticipantMutation {
  const error = validateParticipantName(name, state.participants, id);
  if (error !== null) {
    return { ok: false, error };
  }

  return {
    ok: true,
    state: {
      ...state,
      participants: state.participants.map((participant) =>
        participant.id === id
          ? { ...participant, name: name.trim() }
          : participant,
      ),
    },
  };
}

/**
 * İsmi doğrulamadan yazar. Kullanıcı yazarken alanın kilitlenmemesi için
 * gerekir; geçerlilik ayrıca `findParticipantNameIssues` ile raporlanır ve
 * `checkAssignmentsComplete` tamamlamayı engeller.
 */
export function setParticipantName(
  state: AssignmentState,
  id: string,
  name: string,
): AssignmentState {
  return {
    ...state,
    participants: state.participants.map((participant) =>
      participant.id === id ? { ...participant, name } : participant,
    ),
  };
}

/**
 * Kişiyi siler, o kişinin bütün ürün atamalarını temizler ve silinen kişi
 * ödeyense kalan ilk kişiyi güvenli şekilde ödeyen yapar.
 */
export function removeParticipant(
  state: AssignmentState,
  id: string,
): AssignmentState {
  const participants = state.participants.filter(
    (participant) => participant.id !== id,
  );

  const assignments = state.assignments
    .map((assignment) => ({
      itemId: assignment.itemId,
      participantIds: assignment.participantIds.filter(
        (participantId) => participantId !== id,
      ),
    }))
    .filter((assignment) => assignment.participantIds.length > 0);

  const payerId =
    state.payerId === id ? (participants[0]?.id ?? "") : state.payerId;

  return { participants, payerId, assignments };
}

export function setPayer(state: AssignmentState, payerId: string): AssignmentState {
  const exists = state.participants.some(
    (participant) => participant.id === payerId,
  );
  return exists ? { ...state, payerId } : state;
}

export function getAssignedParticipantIds(
  state: AssignmentState,
  itemId: string,
): string[] {
  return (
    state.assignments.find((assignment) => assignment.itemId === itemId)
      ?.participantIds ?? []
  );
}

/** Bir ürünü kişiye atar veya atamayı kaldırır. Aynı ID iki kez eklenmez. */
export function toggleItemParticipant(
  state: AssignmentState,
  itemId: string,
  participantId: string,
): AssignmentState {
  const participantExists = state.participants.some(
    (participant) => participant.id === participantId,
  );
  if (!participantExists) {
    return state;
  }

  const existing = state.assignments.find(
    (assignment) => assignment.itemId === itemId,
  );

  if (existing === undefined) {
    return {
      ...state,
      assignments: [...state.assignments, { itemId, participantIds: [participantId] }],
    };
  }

  const participantIds = existing.participantIds.includes(participantId)
    ? existing.participantIds.filter((id) => id !== participantId)
    : [...existing.participantIds, participantId];

  const assignments =
    participantIds.length === 0
      ? state.assignments.filter((assignment) => assignment.itemId !== itemId)
      : state.assignments.map((assignment) =>
          assignment.itemId === itemId
            ? { itemId, participantIds }
            : assignment,
        );

  return { ...state, assignments };
}

/**
 * Atamaları mevcut ürün ve kişi ID'lerine göre güvenli hâle getirir:
 * artık bulunmayan item/participant ID'lerini atar, tekrarları tekilleştirir,
 * boş kalan atamaları kaldırır ve geçersiz kalan ödeyeni düzeltir.
 */
export function normalizeAssignments(
  state: AssignmentState,
  itemIds: readonly string[],
): AssignmentState {
  const validItemIds = new Set(itemIds);
  const validParticipantIds = new Set(
    state.participants.map((participant) => participant.id),
  );

  // Aynı itemId birden fazla kayıtta geçerse birleştirilir.
  const merged = new Map<string, string[]>();
  for (const assignment of state.assignments) {
    if (!validItemIds.has(assignment.itemId)) {
      continue;
    }
    merged.set(assignment.itemId, [
      ...(merged.get(assignment.itemId) ?? []),
      ...assignment.participantIds,
    ]);
  }

  const assignments = [...merged.entries()]
    .map(([itemId, participantIds]) => ({
      itemId,
      participantIds: [...new Set(participantIds)].filter((participantId) =>
        validParticipantIds.has(participantId),
      ),
    }))
    .filter((assignment) => assignment.participantIds.length > 0);

  const payerId = validParticipantIds.has(state.payerId)
    ? state.payerId
    : (state.participants[0]?.id ?? "");

  return { participants: state.participants, payerId, assignments };
}

export type AssignmentSummary = {
  payerName: string | null;
  participantCount: number;
  assignedItemCount: number;
  /** Birden fazla kişiye atanmış, yani paylaşılacak ürün sayısı. */
  sharedItemCount: number;
  unassignedItemIds: string[];
};

export function summarizeAssignments(
  state: AssignmentState,
  items: readonly { id: string }[],
): AssignmentSummary {
  const byItem = new Map(
    state.assignments.map((assignment) => [
      assignment.itemId,
      assignment.participantIds,
    ]),
  );

  let assignedItemCount = 0;
  let sharedItemCount = 0;
  const unassignedItemIds: string[] = [];

  for (const item of items) {
    const participantIds = byItem.get(item.id) ?? [];
    if (participantIds.length === 0) {
      unassignedItemIds.push(item.id);
      continue;
    }
    assignedItemCount += 1;
    if (participantIds.length > 1) {
      sharedItemCount += 1;
    }
  }

  const payerName =
    state.participants.find((participant) => participant.id === state.payerId)
      ?.name ?? null;

  return {
    payerName,
    participantCount: state.participants.length,
    assignedItemCount,
    sharedItemCount,
    unassignedItemIds,
  };
}

export function findParticipantNameIssues(
  participants: readonly Participant[],
): { id: string; error: ParticipantNameError }[] {
  const issues: { id: string; error: ParticipantNameError }[] = [];
  for (const participant of participants) {
    const others = participants.filter((other) => other.id !== participant.id);
    const error = validateParticipantName(participant.name, others);
    if (error !== null) {
      issues.push({ id: participant.id, error });
    }
  }
  return issues;
}

export type BlockedResult<TReason extends string> =
  | { ok: true }
  | { ok: false; reason: TReason; message: string };

export type ReceiptSplitBlockReason =
  | "invalidReceipt"
  | "noItems"
  | "emptyItemName";

/** Fiş verisi kişi atamaya geçmeye uygun mu? */
export function checkReceiptReadyForSplit(
  receipt: Receipt,
): BlockedResult<ReceiptSplitBlockReason> {
  if (!ReceiptSchema.safeParse(receipt).success) {
    return {
      ok: false,
      reason: "invalidReceipt",
      message:
        "Fiş verisi geçerli değil. Tutarları kontrol edip tekrar dene.",
    };
  }

  if (receipt.items.length === 0) {
    return {
      ok: false,
      reason: "noItems",
      message:
        "Fişte hiç ürün yok. Kişilere dağıtmadan önce en az bir ürün ekle.",
    };
  }

  if (receipt.items.some((item) => item.name.trim() === "")) {
    return {
      ok: false,
      reason: "emptyItemName",
      message:
        "Bazı ürünlerin adı boş. Devam etmeden önce her ürüne bir ad ver.",
    };
  }

  return { ok: true };
}

export type AssignmentBlockReason =
  | "notEnoughParticipants"
  | "invalidParticipantName"
  | "unassignedItems";

/** Atamalar tamamlanmış mı, özet ekranına geçilebilir mi? */
export function checkAssignmentsComplete(
  state: AssignmentState,
  items: readonly { id: string }[],
): BlockedResult<AssignmentBlockReason> {
  if (state.participants.length < MIN_PARTICIPANTS) {
    return {
      ok: false,
      reason: "notEnoughParticipants",
      message: `Devam etmek için en az ${MIN_PARTICIPANTS} kişi gerekiyor.`,
    };
  }

  if (findParticipantNameIssues(state.participants).length > 0) {
    return {
      ok: false,
      reason: "invalidParticipantName",
      message: "Kişi isimleri boş olamaz ve birbirinin aynısı olamaz.",
    };
  }

  const { unassignedItemIds } = summarizeAssignments(state, items);
  if (unassignedItemIds.length > 0) {
    return {
      ok: false,
      reason: "unassignedItems",
      message: `${unassignedItemIds.length} ürün henüz kimseye atanmadı. Her ürünü en az bir kişiye ata.`,
    };
  }

  return { ok: true };
}
