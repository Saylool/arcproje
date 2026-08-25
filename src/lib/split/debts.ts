import { checkTotals, sumItemsMinor } from "../receipt/money";
import { translate, type TranslationKey } from "../i18n/dictionary";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";
import {
  ReceiptSchema,
  type AdjustmentKind,
  type Receipt,
} from "../receipt/schema";
import {
  MIN_PARTICIPANTS,
  findParticipantNameIssues,
  type AssignmentState,
} from "./participants";

/**
 * Yuvarlama yöntemi kimliği.
 *
 * Kuruş artığı üç yerde doğar ve üçü de deterministik, kayıpsız dağıtılır:
 *
 * 1. Ürün bölüşümü — bir ürün n kişiye bölündüğünde artan kuruşlar, ürünün
 *    fişteki sırasına göre kaydırılan bir başlangıçtan itibaren verilir
 *    (offset = ürün index'i % n). Böylece aynı kişi her üründe avantajlı olmaz.
 *
 * 2. Ayrı uygulanan vergi ve servis — kişilerin ürün payları ağırlık alınarak
 *    en büyük kalan yöntemiyle dağıtılır. Kalanlar eşit olduğunda sıralama
 *    kalem türüne göre kaydırılır (vergi 0, servis 1), böylece eşitlik hep
 *    aynı kişinin lehine bozulmaz.
 *
 * 3. Ayrı uygulanan indirim — ürün payı yerine kişinin **indirim öncesi
 *    bakiyesi** (ürün payı + vergi + servis) ağırlık alınır. İndirim toplam
 *    bakiyeyi aşamayacağı için hiçbir kişinin payı yuvarlama yüzünden eksiye
 *    düşemez; dağıtım yine tam olarak indirim tutarına eşittir.
 *
 * Artık dağıtımı her zaman en fazla (kişi sayısı - 1) adım sürer; tutar ne
 * kadar büyük olursa olsun birer kuruş ilerleyen bir döngü kullanılmaz.
 */
export const ROUNDING_METHOD = "largest-remainder-with-item-rotation";

export const ROUNDING_DESCRIPTION = translate(
  DEFAULT_LOCALE,
  "debts.roundingDescription",
);

export type ParticipantShare = {
  participantId: string;
  itemSubtotalMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  discountMinor: number;
  totalMinor: number;
};

export type Debt = {
  fromParticipantId: string;
  toParticipantId: string;
  amountMinor: number;
};

export type InvalidAssignmentDetail =
  | "notEnoughParticipants"
  | "invalidParticipantName"
  | "unknownPayer"
  | "missingAssignment"
  | "duplicateAssignment"
  | "duplicateParticipantInAssignment"
  | "unknownParticipant"
  | "unknownItem"
  | "unassignedItem"
  | "duplicateParticipantId";

export type InvalidReceiptDetail = "schema" | "duplicateItemId";

/**
 * HESAPLAMA HATASININ KARARLI KODU.
 *
 * `status` bazı durumlarda tek başına yetmez: örneğin `zeroAllocationWeight`
 * iki ayrı nedenden doğar ve iki ayrı cümleyle anlatılır. Kod, gösterilecek
 * metni TEK BAŞINA belirler ve doğrudan sözlük yoluna karşılık gelir; bu
 * sayede arayüz metni dilden bağımsız olarak seçebilir.
 *
 * Kod MAKİNE OKUNURDUR ve çevrilmez.
 */
export type DebtFailureCode =
  | `assignments.${InvalidAssignmentDetail}`
  | `receipt.${InvalidReceiptDetail}`
  | "unsafeAmount"
  | "indeterminateTotals"
  | "mismatchedTotals"
  | "allocationMismatch"
  | "zeroChargeWeight"
  | "zeroDiscountWeight"
  | "discountExceedsBalance"
  | "negativeParticipantShare";

/**
 * Kodun Türkçe karşılığı. `message` alanı GERİYE DÖNÜK UYUMLULUK içindir ve
 * her zaman varsayılan dildedir; arayüz metni `code` üzerinden ve etkin dilde
 * seçer (bkz. `describeDebtFailure`).
 */
function messageFor(code: DebtFailureCode): string {
  return translate(DEFAULT_LOCALE, `errors.${code}` as TranslationKey, {
    min: MIN_PARTICIPANTS,
  });
}

/** Etkin dildeki karşılık. Hesaplama sonucunu DEĞİŞTİRMEZ. */
export function describeDebtFailure(
  failure: DebtCalculationFailure,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return translate(locale, `errors.${failure.code}` as TranslationKey, {
    min: MIN_PARTICIPANTS,
  });
}

export type DebtCalculationSuccess = {
  status: "success";
  receiptTotalMinor: number;
  /** Kişi paylarının toplamı. Her zaman receiptTotalMinor'a eşittir. */
  allocatedTotalMinor: number;
  payerId: string;
  participantShares: ParticipantShare[];
  debts: Debt[];
  rounding: { method: typeof ROUNDING_METHOD; description: string };
};

export type DebtCalculationFailure =
  | {
      status: "invalidReceipt";
      detail: InvalidReceiptDetail;
      code: DebtFailureCode;
      message: string;
    }
  | {
      status: "invalidAssignments";
      detail: InvalidAssignmentDetail;
      code: DebtFailureCode;
      message: string;
    }
  | {
      status: "indeterminateTotals";
      uncertainAdjustments: AdjustmentKind[];
      code: DebtFailureCode;
      message: string;
    }
  | {
      status: "mismatchedTotals";
      expectedTotalMinor: number;
      statedTotalMinor: number;
      differenceMinor: number;
      code: DebtFailureCode;
      message: string;
    }
  | { status: "zeroAllocationWeight"; code: DebtFailureCode; message: string }
  | {
      status: "unsafeAmount";
      /** Güvenli tam sayı aralığını aşan alan veya ara toplam. */
      field: string;
      code: DebtFailureCode;
      message: string;
    }
  | {
      status: "discountExceedsBalance";
      discountMinor: number;
      availableMinor: number;
      code: DebtFailureCode;
      message: string;
    }
  | {
      status: "negativeParticipantShare";
      participantId: string;
      code: DebtFailureCode;
      message: string;
    };

export type DebtCalculationResult =
  | DebtCalculationSuccess
  | DebtCalculationFailure;

function invalid(detail: InvalidAssignmentDetail): DebtCalculationFailure {
  const code = `assignments.${detail}` as const;
  return {
    status: "invalidAssignments",
    detail,
    code,
    message: messageFor(code),
  };
}

function invalidReceipt(detail: InvalidReceiptDetail): DebtCalculationFailure {
  const code = `receipt.${detail}` as const;
  return {
    status: "invalidReceipt",
    detail,
    code,
    message: messageFor(code),
  };
}

function unsafe(field: string): DebtCalculationFailure {
  return {
    status: "unsafeAmount",
    field,
    code: "unsafeAmount",
    message: messageFor("unsafeAmount"),
  };
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Yalnızca güvenli tam sayı olduğu doğrulanmış değerler BigInt'e çevrilir. */
function isSafeMinorUnit(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function toSafeNumber(value: bigint): number | null {
  return value >= -MAX_SAFE && value <= MAX_SAFE ? Number(value) : null;
}

function sumBig(values: readonly number[]): bigint {
  let total = BigInt(0);
  for (const value of values) {
    total += BigInt(value);
  }
  return total;
}

/**
 * Bir ürünün tutarını eşit böler ve bölünemeyen kuruşları `rotationOffset`
 * konumundan başlayarak dağıtır. Dönen dizinin toplamı daima `totalMinor`'dır.
 */
export function splitItemMinor(
  totalMinor: number,
  participantCount: number,
  rotationOffset: number,
): number[] {
  const base = Math.floor(totalMinor / participantCount);
  const remainder = totalMinor - base * participantCount;
  const shares = new Array<number>(participantCount).fill(base);

  const start =
    ((rotationOffset % participantCount) + participantCount) % participantCount;
  for (let step = 0; step < remainder; step += 1) {
    shares[(start + step) % participantCount] += 1;
  }
  return shares;
}

/**
 * Bir tutarı ağırlıklara göre orantılı dağıtır (en büyük kalan yöntemi).
 * Çarpım güvenli tam sayı aralığını aşabileceği için içeride BigInt kullanılır.
 * Ağırlık toplamı 0 iken tutar 0 değilse dağıtım uydurulmaz: `null` döner.
 *
 * `tieBreakOffset`, kalanlar eşit olduğunda önceliğin hangi kişiden başlayarak
 * verileceğini kaydırır. Böylece art arda yapılan dağıtımlarda (vergi, servis,
 * indirim) hep aynı kişi kayırılmaz.
 *
 * Artan birim sayısı daima kişi sayısından küçüktür; dağıtım tutarın
 * büyüklüğünden bağımsız olarak en fazla (kişi sayısı - 1) adım sürer.
 */
export function allocateProportionally(
  amountMinor: number,
  weights: readonly number[],
  tieBreakOffset = 0,
): number[] | null {
  const count = weights.length;
  if (amountMinor === 0) {
    return new Array<number>(count).fill(0);
  }
  if (count === 0) {
    return null;
  }

  const totalWeight = sumBig(weights);
  if (totalWeight === BigInt(0)) {
    return null;
  }

  const amount = BigInt(amountMinor);
  const shares: number[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let distributed = 0;

  for (let index = 0; index < count; index += 1) {
    const numerator = amount * BigInt(weights[index]);
    // Pay <= amount olduğu için bölüm daima güvenli tam sayı aralığındadır.
    const quotient = Number(numerator / totalWeight);
    shares.push(quotient);
    distributed += quotient;
    remainders.push({ index, remainder: numerator % totalWeight });
  }

  const rank = (index: number) => (index - tieBreakOffset + count * count) % count;

  remainders.sort((a, b) => {
    if (a.remainder === b.remainder) {
      return rank(a.index) - rank(b.index);
    }
    return a.remainder > b.remainder ? -1 : 1;
  });

  let leftover = amountMinor - distributed;
  for (let i = 0; leftover > 0 && i < remainders.length; i += 1) {
    shares[remainders[i].index] += 1;
    leftover -= 1;
  }

  return shares;
}

export function calculateDebts(
  receipt: Receipt,
  state: AssignmentState,
): DebtCalculationResult {
  // --- Doğrulama: geçersiz veriyi sessizce düzeltip hesaplamıyoruz ---
  if (!ReceiptSchema.safeParse(receipt).success) {
    return invalidReceipt("schema");
  }

  // Map/Set kimlikleri sessizce birleştirmesin diye çakışmalar açıkça reddedilir.
  if (new Set(receipt.items.map((item) => item.id)).size !== receipt.items.length) {
    return invalidReceipt("duplicateItemId");
  }

  // Şema zaten güvenli tam sayı istiyor; yine de BigInt'e çevirmeden önce
  // her alan açıkça doğrulanır.
  const receiptAmounts: { field: string; value: number }[] = [
    { field: "taxMinor", value: receipt.taxMinor },
    { field: "serviceChargeMinor", value: receipt.serviceChargeMinor },
    { field: "discountMinor", value: receipt.discountMinor },
    { field: "totalMinor", value: receipt.totalMinor },
    ...receipt.items.map((item) => ({
      field: `items.${item.id}.totalMinor`,
      value: item.totalMinor,
    })),
  ];
  const unsafeField = receiptAmounts.find(
    (entry) => !isSafeMinorUnit(entry.value),
  );
  if (unsafeField !== undefined) {
    return unsafe(unsafeField.field);
  }

  const { participants, payerId } = state;

  if (participants.length < MIN_PARTICIPANTS) {
    return invalid("notEnoughParticipants");
  }
  if (
    new Set(participants.map((participant) => participant.id)).size !==
    participants.length
  ) {
    return invalid("duplicateParticipantId");
  }
  if (findParticipantNameIssues(participants).length > 0) {
    return invalid("invalidParticipantName");
  }

  const participantIndex = new Map(
    participants.map((participant, index) => [participant.id, index]),
  );
  if (!participantIndex.has(payerId)) {
    return invalid("unknownPayer");
  }

  const itemIds = new Set(receipt.items.map((item) => item.id));
  const assignmentByItem = new Map<string, string[]>();

  for (const assignment of state.assignments) {
    if (!itemIds.has(assignment.itemId)) {
      return invalid("unknownItem");
    }
    if (assignmentByItem.has(assignment.itemId)) {
      return invalid("duplicateAssignment");
    }
    if (
      new Set(assignment.participantIds).size !== assignment.participantIds.length
    ) {
      return invalid("duplicateParticipantInAssignment");
    }
    for (const id of assignment.participantIds) {
      if (!participantIndex.has(id)) {
        return invalid("unknownParticipant");
      }
    }
    if (assignment.participantIds.length === 0) {
      return invalid("unassignedItem");
    }
    assignmentByItem.set(assignment.itemId, assignment.participantIds);
  }

  for (const item of receipt.items) {
    if (!assignmentByItem.has(item.id)) {
      return invalid("missingAssignment");
    }
  }

  // --- Ara toplamların güvenli aralıkta kaldığı doğrulanır ---
  const itemsSubtotalBig = sumBig(receipt.items.map((item) => item.totalMinor));
  if (toSafeNumber(itemsSubtotalBig) === null) {
    return unsafe("itemsSubtotal");
  }

  // --- Düzeltmeler netleşmeden hesaplama yapılmaz ---
  const totals = checkTotals(receipt);
  if (totals.status === "indeterminate") {
    return {
      status: "indeterminateTotals",
      uncertainAdjustments: totals.uncertainAdjustments,
      code: "indeterminateTotals",
      message: messageFor("indeterminateTotals"),
    };
  }
  if (totals.status === "mismatch") {
    return {
      status: "mismatchedTotals",
      expectedTotalMinor: totals.expectedTotalMinor,
      statedTotalMinor: totals.statedTotalMinor,
      differenceMinor: totals.differenceMinor,
      code: "mismatchedTotals",
      message: messageFor("mismatchedTotals"),
    };
  }

  // --- 1) Ürün payları ---
  const itemSubtotalsBig = new Array<bigint>(participants.length).fill(BigInt(0));

  receipt.items.forEach((item, itemIndex) => {
    const assignedIds = assignmentByItem.get(item.id) ?? [];
    // Kanonik sıra: kullanıcının tıklama sırası değil, kişi listesi sırası.
    const orderedIndexes = participants
      .map((participant, index) => ({ id: participant.id, index }))
      .filter((entry) => assignedIds.includes(entry.id))
      .map((entry) => entry.index);

    const shares = splitItemMinor(
      item.totalMinor,
      orderedIndexes.length,
      itemIndex,
    );
    orderedIndexes.forEach((participantPosition, shareIndex) => {
      itemSubtotalsBig[participantPosition] += BigInt(shares[shareIndex]);
    });
  });

  const itemSubtotals: number[] = [];
  for (const value of itemSubtotalsBig) {
    const safeValue = toSafeNumber(value);
    if (safeValue === null) {
      return unsafe("participantItemSubtotal");
    }
    itemSubtotals.push(safeValue);
  }

  // --- 2) Ayrı uygulanan vergi ve servis, ürün payı ağırlığıyla ---
  const separateTax =
    receipt.taxTreatment === "separate" ? receipt.taxMinor : 0;
  const separateService =
    receipt.serviceChargeTreatment === "separate"
      ? receipt.serviceChargeMinor
      : 0;
  const separateDiscount =
    receipt.discountTreatment === "separate" ? receipt.discountMinor : 0;

  const preDiscountTotalBig =
    itemsSubtotalBig + BigInt(separateTax) + BigInt(separateService);
  const preDiscountTotal = toSafeNumber(preDiscountTotalBig);
  if (preDiscountTotal === null) {
    return unsafe("preDiscountTotal");
  }

  // Eşitlik bozumu kalemden kaleme kaydırılır: vergi 0, servis 1, indirim 2.
  const taxShares = allocateProportionally(separateTax, itemSubtotals, 0);
  const serviceShares = allocateProportionally(separateService, itemSubtotals, 1);

  if (taxShares === null || serviceShares === null) {
    return {
      status: "zeroAllocationWeight",
      code: "zeroChargeWeight",
      message: messageFor("zeroChargeWeight"),
    };
  }

  // --- 3) İndirim, kişinin indirim öncesi bakiyesi oranında düşülür ---
  // Ağırlık olarak ürün payı yerine bakiye kullanıldığı için hiçbir kişinin
  // indirimi kendi bakiyesini aşamaz; pay yuvarlama yüzünden eksiye düşmez.
  const balances = itemSubtotals.map(
    (subtotal, index) => subtotal + taxShares[index] + serviceShares[index],
  );
  const availableMinor = toSafeNumber(sumBig(balances));
  if (availableMinor === null) {
    return unsafe("availableBalance");
  }

  if (separateDiscount > availableMinor) {
    return {
      status: "discountExceedsBalance",
      discountMinor: separateDiscount,
      availableMinor,
      code: "discountExceedsBalance",
      message: messageFor("discountExceedsBalance"),
    };
  }

  const discountShares = allocateProportionally(separateDiscount, balances, 2);
  if (discountShares === null) {
    return {
      status: "zeroAllocationWeight",
      code: "zeroDiscountWeight",
      message: messageFor("zeroDiscountWeight"),
    };
  }

  // --- 4) Nihai paylar ---
  const participantShares: ParticipantShare[] = [];
  for (const [index, participant] of participants.entries()) {
    const totalBig =
      BigInt(itemSubtotals[index]) +
      BigInt(taxShares[index]) +
      BigInt(serviceShares[index]) -
      BigInt(discountShares[index]);
    const totalMinor = toSafeNumber(totalBig);
    if (totalMinor === null) {
      return unsafe("participantTotal");
    }
    participantShares.push({
      participantId: participant.id,
      itemSubtotalMinor: itemSubtotals[index],
      taxMinor: taxShares[index],
      serviceChargeMinor: serviceShares[index],
      discountMinor: discountShares[index],
      totalMinor,
    });
  }

  // Savunma amaçlı değişmez: bakiye tabanlı indirim sayesinde erişilmemeli.
  const negative = participantShares.find((share) => share.totalMinor < 0);
  if (negative !== undefined) {
    return {
      status: "negativeParticipantShare",
      participantId: negative.participantId,
      code: "negativeParticipantShare",
      message: messageFor("negativeParticipantShare"),
    };
  }

  const allocatedTotalMinor = toSafeNumber(
    sumBig(participantShares.map((share) => share.totalMinor)),
  );
  if (allocatedTotalMinor === null) {
    return unsafe("allocatedTotal");
  }

  // Güvenlik ağı: checkTotals "match" dediği için normalde tutar.
  if (allocatedTotalMinor !== receipt.totalMinor) {
    return {
      status: "mismatchedTotals",
      expectedTotalMinor: allocatedTotalMinor,
      statedTotalMinor: receipt.totalMinor,
      differenceMinor: allocatedTotalMinor - receipt.totalMinor,
      code: "allocationMismatch",
      message: messageFor("allocationMismatch"),
    };
  }

  // --- 5) Borçlar: herkes ödeyene kendi payı kadar borçlu ---
  const debts: Debt[] = participantShares
    .filter(
      (share) => share.participantId !== payerId && share.totalMinor > 0,
    )
    .map((share) => ({
      fromParticipantId: share.participantId,
      toParticipantId: payerId,
      amountMinor: share.totalMinor,
    }));

  if (toSafeNumber(sumBig(debts.map((debt) => debt.amountMinor))) === null) {
    return unsafe("debtTotal");
  }

  return {
    status: "success",
    receiptTotalMinor: receipt.totalMinor,
    allocatedTotalMinor,
    payerId,
    participantShares,
    debts,
    rounding: { method: ROUNDING_METHOD, description: ROUNDING_DESCRIPTION },
  };
}

/** Ürün paylarının toplamı; testler ve UI doğrulaması için. */
export function sumParticipantItemShares(
  shares: readonly ParticipantShare[],
): number {
  return shares.reduce((sum, share) => sum + share.itemSubtotalMinor, 0);
}

export function sumDebts(debts: readonly Debt[]): number {
  return debts.reduce((sum, debt) => sum + debt.amountMinor, 0);
}

/** Fişteki ürün toplamı; doğrulama karşılaştırmaları için yeniden dışa açılır. */
export function receiptItemsSubtotalMinor(receipt: Receipt): number {
  return sumItemsMinor(receipt.items);
}
