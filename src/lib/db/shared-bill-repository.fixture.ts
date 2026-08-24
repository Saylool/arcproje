import type {
  CreateSharedBillOutcome,
  SharedBillRecord,
  SharedBillRepository,
} from "./shared-bill-repository";

/**
 * YALNIZCA TEST İÇİN bellek içi paylaşılan hesap deposu.
 *
 * Üretim yollarına ASLA bağlanmaz: rota deposunu yalnızca
 * `createNeonSharedBillRepository` üzerinden alır ve `DATABASE_URL` yoksa
 * kontrollü 503 döner. Bu sahte depo bellekte tuttuğu için hiçbir kalıcılık
 * ya da tekrar oynatma garantisi vermez.
 *
 * Gerçek deponun sözleşmesini taklit eder: atomiklik (kısmi yazma bırakmaz),
 * hesap kimliği benzersizliği, hesap içi borçlu ve borç kimliği benzersizliği
 * ve idempotent tekrar kararı.
 */

export type FakeStoredBill = {
  billId: string;
  recipient: string;
  debtsHash: string;
  signature: string;
  debtCount: number;
  expiresAt: number;
  debts: readonly { debtor: string; debtKey: string; tryMinor: string }[];
};

export type FakeRepositoryControls = {
  /** Her çağrıda `unavailable` döndürür (veritabanı erişilemez). */
  failWithUnavailable?: boolean;
  /** Her çağrıda `constraint` döndürür (veritabanı kısıtı reddetti). */
  failWithConstraint?: boolean;
  /** Yazma sırasında fırlatır; atomiklik testinde geri alma kanıtlanır. */
  throwDuringWrite?: boolean;
};

export type FakeSharedBillRepository = SharedBillRepository & {
  readonly bills: ReadonlyMap<string, FakeStoredBill>;
  readonly calls: number;
  controls: FakeRepositoryControls;
};

export function createFakeSharedBillRepository(
  controls: FakeRepositoryControls = {},
): FakeSharedBillRepository {
  const bills = new Map<string, FakeStoredBill>();
  let calls = 0;

  const repository = {
    controls,
    bills,
    get calls() {
      return calls;
    },
    async createSharedBill(
      record: SharedBillRecord,
    ): Promise<CreateSharedBillOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      if (repository.controls.failWithConstraint === true) {
        return { ok: false, reason: "constraint" };
      }

      const { manifest, debts, signature } = record;
      const existing = bills.get(manifest.billId.toLowerCase());
      if (existing !== undefined) {
        /*
         * Tekrar YALNIZCA taahhüt, alıcı, imza ve borç sayısı birebir
         * eşleşirse güvenli sayılır. Aksi hâlde üzerine yazılmaz.
         */
        const identical =
          existing.debtsHash.toLowerCase() === manifest.debtsHash.toLowerCase() &&
          existing.signature.toLowerCase() === signature.toLowerCase() &&
          existing.recipient.toLowerCase() === manifest.recipient.toLowerCase() &&
          existing.debtCount === manifest.debtCount;
        return identical
          ? { ok: true, created: false }
          : { ok: false, reason: "idConflict" };
      }

      // Kısıtlar ikinci savunma hattıdır; TypeScript doğrulamasına güvenilmez.
      const seenDebtors = new Set<string>();
      const seenKeys = new Set<string>();
      for (const debt of debts) {
        const debtor = debt.debtor.toLowerCase();
        if (seenDebtors.has(debtor) || seenKeys.has(debt.debtKey)) {
          return { ok: false, reason: "constraint" };
        }
        if (BigInt(debt.tryMinor) <= BigInt(0)) {
          return { ok: false, reason: "constraint" };
        }
        seenDebtors.add(debtor);
        seenKeys.add(debt.debtKey);
      }
      if (debts.length !== manifest.debtCount) {
        return { ok: false, reason: "constraint" };
      }

      if (repository.controls.throwDuringWrite === true) {
        // Atomiklik: hiçbir şey yazılmadan geri alınır.
        return { ok: false, reason: "unavailable" };
      }

      bills.set(manifest.billId.toLowerCase(), {
        billId: manifest.billId,
        recipient: manifest.recipient,
        debtsHash: manifest.debtsHash,
        signature,
        debtCount: manifest.debtCount,
        expiresAt: manifest.expiresAt,
        debts: debts.map((debt) => ({
          debtor: debt.debtor,
          debtKey: debt.debtKey,
          tryMinor: debt.tryMinor,
        })),
      });
      return { ok: true, created: true };
    },
  };

  return repository as FakeSharedBillRepository;
}
