import type { SharedBillManifest } from "@/lib/arc/shared-bill";

import type {
  CreateSharedBillOutcome,
  ResolveAccessInput,
  ResolveAccessOutcome,
  SessionLookupOutcome,
  SharedBillRecord,
  SharedBillRepository,
  SharedBillStatus,
  StoredSharedBill,
  StoredSharedBillDebt,
} from "./shared-bill-repository";

/**
 * YALNIZCA TEST İÇİN bellek içi paylaşılan hesap deposu.
 *
 * Üretim yollarına ASLA bağlanmaz: rotalar depoyu yalnızca
 * `createNeonSharedBillRepository` üzerinden alır ve `DATABASE_URL` yoksa
 * kontrollü 503 döner. Bu sahte depo bellekte tuttuğu için hiçbir kalıcılık
 * ya da tekrar oynatma garantisi vermez.
 *
 * Gerçek deponun sözleşmesini taklit eder: atomiklik, hesap kimliği
 * benzersizliği, hesap içi borçlu/borç kimliği benzersizliği, idempotent
 * tekrar kararı, TEK KULLANIMLIK nonce ve süresi dolmuş kayıtların
 * kullanılamaz sayılması.
 */

export type FakeStoredBill = {
  billId: string;
  manifest: SharedBillManifest;
  signature: string;
  status: SharedBillStatus;
  debts: readonly StoredSharedBillDebt[];
};

export type FakeSession = {
  sessionHash: string;
  billId: string;
  debtor: string;
  chainId: number;
  expiresAtMs: number;
};

export type FakeRepositoryControls = {
  /** Her çağrıda `unavailable` döndürür (veritabanı erişilemez). */
  failWithUnavailable?: boolean;
  /** Her çağrıda `constraint` döndürür (veritabanı kısıtı reddetti). */
  failWithConstraint?: boolean;
  /** Yazma sırasında geri alır; atomiklik testinde kullanılır. */
  throwDuringWrite?: boolean;
};

export type FakeSharedBillRepository = SharedBillRepository & {
  readonly bills: ReadonlyMap<string, FakeStoredBill>;
  readonly sessions: ReadonlyMap<string, FakeSession>;
  readonly consumedNonces: ReadonlySet<string>;
  readonly calls: number;
  controls: FakeRepositoryControls;
};

function nonceKey(billId: string, nonce: string): string {
  return `${billId.toLowerCase()}|${nonce.toLowerCase()}`;
}

export function createFakeSharedBillRepository(
  controls: FakeRepositoryControls = {},
): FakeSharedBillRepository {
  const bills = new Map<string, FakeStoredBill>();
  const sessions = new Map<string, FakeSession>();
  const consumedNonces = new Set<string>();
  let calls = 0;

  function toStored(bill: FakeStoredBill): StoredSharedBill {
    return Object.freeze({
      manifest: bill.manifest,
      signature: bill.signature,
      status: bill.status,
      debts: bill.debts,
    });
  }

  /** Hesap KULLANILABİLİR mi? Süresi dolmuş veya kapalı hesap kullanılamaz. */
  function usable(bill: FakeStoredBill, nowMs: number): boolean {
    return (
      bill.status === "open" && bill.manifest.expiresAt * 1000 > nowMs
    );
  }

  const repository = {
    controls,
    bills,
    sessions,
    consumedNonces,
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
          existing.manifest.debtsRoot.toLowerCase() ===
            manifest.debtsRoot.toLowerCase() &&
          existing.signature.toLowerCase() === signature.toLowerCase() &&
          existing.manifest.recipient.toLowerCase() ===
            manifest.recipient.toLowerCase() &&
          existing.manifest.debtCount === manifest.debtCount;
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
        manifest,
        signature,
        status: "open",
        // KANONİK indeks: satırlar zaten kanonik sırada gelir.
        debts: Object.freeze(
          debts.map((debt, leafIndex) =>
            Object.freeze({
              debtor: debt.debtor,
              debtorLabel: debt.debtorLabel,
              debtKey: debt.debtKey,
              tryMinor: debt.tryMinor,
              leafIndex,
            }),
          ),
        ),
      });
      return { ok: true, created: true };
    },

    async resolveAccess(
      input: ResolveAccessInput,
    ): Promise<ResolveAccessOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }

      /*
       * NONCE TÜKETİMİ ÖNCE ve ATOMİK. JavaScript tek iş parçacıklı olduğu
       * için bu blokta `await` YOKTUR: aynı nonce ile eşzamanlı iki çağrıdan
       * yalnızca biri buradan geçer.
       */
      const key = nonceKey(input.billId, input.nonce);
      if (consumedNonces.has(key)) {
        return { ok: false, reason: "replay" };
      }
      consumedNonces.add(key);

      const bill = bills.get(input.billId.toLowerCase());
      if (bill === undefined || !usable(bill, input.nowMs)) {
        // GENEL hata: hesap yok / kapalı / süresi dolmuş ayırt edilemez.
        return { ok: false, reason: "notFound" };
      }

      const debt = bill.debts.find(
        (row) => row.debtor.toLowerCase() === input.debtor.toLowerCase(),
      );
      if (debt === undefined) {
        // Bu adres bu hesapta yok — AYNI genel hata döner.
        return { ok: false, reason: "notFound" };
      }

      if (repository.controls.throwDuringWrite === true) {
        return { ok: false, reason: "unavailable" };
      }

      // Oturum, nonce tüketimiyle AYNI mantıksal işlemde yaratılır.
      sessions.set(input.sessionHash, {
        sessionHash: input.sessionHash,
        billId: bill.billId,
        debtor: debt.debtor,
        chainId: input.chainId,
        expiresAtMs: input.sessionExpiresAt,
      });

      return { ok: true, bill: toStored(bill), debt };
    },

    async readSession(input: {
      sessionHash: string;
      nowMs: number;
    }): Promise<SessionLookupOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }

      const session = sessions.get(input.sessionHash);
      if (session === undefined || session.expiresAtMs <= input.nowMs) {
        return { ok: false, reason: "notFound" };
      }
      const bill = bills.get(session.billId.toLowerCase());
      if (bill === undefined || !usable(bill, input.nowMs)) {
        return { ok: false, reason: "notFound" };
      }
      const debt = bill.debts.find(
        (row) => row.debtor.toLowerCase() === session.debtor.toLowerCase(),
      );
      if (debt === undefined) {
        return { ok: false, reason: "notFound" };
      }
      return { ok: true, bill: toStored(bill), debtor: session.debtor, debt };
    },
  };

  return repository as FakeSharedBillRepository;
}
