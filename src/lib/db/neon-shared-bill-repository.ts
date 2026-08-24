import {
  SHARED_BILL_SCHEMA_VERSION,
  validateSharedBillManifest,
} from "@/lib/arc/shared-bill";

import { readDatabaseUrl, type DatabaseEnv } from "./env";
import type {
  CreateSharedBillOutcome,
  ResolveAccessInput,
  ResolveAccessOutcome,
  SessionLookupOutcome,
  SharedBillRecord,
  SharedBillRepository,
  StoredSharedBill,
  StoredSharedBillDebt,
} from "./shared-bill-repository";

/**
 * Neon Postgres deposu. YALNIZCA SUNUCU.
 *
 * Sürücü DİNAMİK import edilir: modül yalnızca gerçekten bir depo istendiğinde
 * yüklenir, böylece yanlışlıkla bir istemci bileşeninden import edilse bile
 * `@neondatabase/serverless` istemci paketine girmez.
 *
 * TÜM sorgular parametrelidir; hiçbir kullanıcı verisi SQL metnine
 * birleştirilmez. Bağlantı dizesi asla loglanmaz.
 *
 * Tablolar burada OLUŞTURULMAZ. Şema, gözden geçirilmiş SQL geçişiyle
 * (`migrations/0001_shared_bills.sql`) elle uygulanır; istek işleyicisi içinde
 * tembel tablo oluşturma yapılmaz.
 */

/** Postgres hata kodları. */
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";
const FOREIGN_KEY_VIOLATION = "23503";

const CONSTRAINT_CODES = new Set([
  UNIQUE_VIOLATION,
  CHECK_VIOLATION,
  NOT_NULL_VIOLATION,
  FOREIGN_KEY_VIOLATION,
]);

/** Hesap satırının birincil anahtar kısıtı; çakışma bundan tanınır. */
const BILL_PRIMARY_KEY_CONSTRAINT = "shared_bills_pkey";

function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function readConstraintName(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const name = (error as { constraint?: unknown }).constraint;
  return typeof name === "string" ? name : null;
}

const INSERT_BILL = `
INSERT INTO shared_bills (
  bill_id, schema_version, chain_id, recipient_address, recipient_label,
  debts_root, debt_count, issued_at, expires_at, recipient_signature, status
) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8), to_timestamp($9), $10, 'open')
`;

/**
 * Borç satırları TEK bir deyimle yazılır.
 *
 * `UNNEST` ile dizi parametreleri açılır: satır sayısı ne olursa olsun SQL
 * metni sabit kalır ve her değer parametre olarak gider.
 */
const INSERT_DEBTS = `
INSERT INTO shared_bill_debts (
  bill_id, debtor_address, debtor_label, debt_key, try_minor, leaf_index
)
SELECT $1, rows.debtor, rows.label, rows.key, rows.amount::numeric, rows.idx
FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[], $6::int[])
  AS rows(debtor, label, key, amount, idx)
`;

/**
 * Nonce'u ATOMİK tüketir.
 *
 * `ON CONFLICT DO NOTHING` + `RETURNING`: satır ilk kez eklenirse geri döner,
 * daha önce tüketilmişse HİÇBİR satır dönmez. Eşzamanlı iki istekte
 * Postgres'in benzersizlik kısıtı yalnızca birinin kazanmasını garanti eder.
 */
const CONSUME_NONCE = `
INSERT INTO shared_bill_auth_nonces (bill_id, nonce, debtor_address, expires_at)
VALUES ($1, $2, $3, to_timestamp($4))
ON CONFLICT (bill_id, nonce) DO NOTHING
RETURNING nonce
`;

const INSERT_SESSION = `
INSERT INTO shared_bill_sessions (
  session_hash, bill_id, debtor_address, chain_id, expires_at
) VALUES ($1, $2, $3, $4, to_timestamp($5))
`;

/** Hesap + kimliği doğrulanmış borçlunun satırı; süresi dolmuşsa DÖNMEZ. */
const SELECT_BILL_FOR_DEBTOR = `
SELECT b.bill_id, b.schema_version, b.chain_id, b.recipient_address,
       b.recipient_label, b.debts_root, b.debt_count,
       extract(epoch from b.issued_at)::bigint  AS issued_at,
       extract(epoch from b.expires_at)::bigint AS expires_at,
       b.recipient_signature, b.status
FROM shared_bills b
WHERE b.bill_id = $1
  AND b.status = 'open'
  AND b.expires_at > now()
`;

const SELECT_DEBTS = `
SELECT debtor_address, debtor_label, debt_key, try_minor::text AS try_minor,
       leaf_index
FROM shared_bill_debts
WHERE bill_id = $1
ORDER BY leaf_index ASC
`;

/** Oturum; süresi dolmuşsa DÖNMEZ (fiziksel silme beklenmez). */
const SELECT_SESSION = `
SELECT bill_id, debtor_address
FROM shared_bill_sessions
WHERE session_hash = $1
  AND expires_at > now()
`;

/**
 * FIRSATÇI temizlik: her çağrıda EN FAZLA sabit sayıda süresi dolmuş satır
 * silinir. Sınırsız silme yapan bir istek yolu YARATILMAZ.
 */
const CLEANUP_LIMIT = 50;
const CLEANUP_NONCES = `
DELETE FROM shared_bill_auth_nonces
WHERE ctid IN (
  SELECT ctid FROM shared_bill_auth_nonces WHERE expires_at < now() LIMIT ${CLEANUP_LIMIT}
)
`;
const CLEANUP_SESSIONS = `
DELETE FROM shared_bill_sessions
WHERE ctid IN (
  SELECT ctid FROM shared_bill_sessions WHERE expires_at < now() LIMIT ${CLEANUP_LIMIT}
)
`;

const SELECT_EXISTING = `
SELECT debts_root, recipient_address, recipient_signature, debt_count
FROM shared_bills
WHERE bill_id = $1
`;

type ExistingRow = {
  debts_root: unknown;
  recipient_address: unknown;
  recipient_signature: unknown;
  debt_count: unknown;
};

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Neon istemcisini kurar. `DATABASE_URL` yoksa `null` döner; çağıran bunu
 * kontrollü bir 503'e çevirir. Bellek içi bir yedeğe ASLA düşülmez.
 */
export async function createNeonSharedBillRepository(
  env: DatabaseEnv = process.env,
): Promise<SharedBillRepository | null> {
  const url = readDatabaseUrl(env);
  if (!url.ok) {
    return null;
  }

  let sql: Awaited<
    ReturnType<typeof import("@neondatabase/serverless").neon>
  >;
  try {
    const { neon } = await import("@neondatabase/serverless");
    sql = neon(url.url);
  } catch {
    // Sürücü yüklenemedi veya bağlantı dizesi kabul edilmedi. Ayrıntı sızmaz.
    return null;
  }

  return Object.freeze({
    async createSharedBill(
      record: SharedBillRecord,
    ): Promise<CreateSharedBillOutcome> {
      const { manifest, debts, signature } = record;

      try {
        /*
         * Hesap ve TÜM borç satırları TEK bir Postgres işleminde yazılır.
         * Satırlardan biri kısıtı ihlal ederse işlem tümüyle geri alınır ve
         * kullanılabilir kısmi bir hesap kalmaz.
         */
        await sql.transaction((txn) => [
          txn.query(INSERT_BILL, [
            manifest.billId,
            SHARED_BILL_SCHEMA_VERSION,
            manifest.chainId,
            manifest.recipient,
            manifest.recipientLabel,
            manifest.debtsRoot,
            manifest.debtCount,
            manifest.issuedAt,
            manifest.expiresAt,
            signature,
          ]),
          txn.query(INSERT_DEBTS, [
            manifest.billId,
            debts.map((debt) => debt.debtor),
            debts.map((debt) => debt.debtorLabel),
            debts.map((debt) => debt.debtKey),
            debts.map((debt) => debt.tryMinor),
            // KANONİK indeks: satırlar zaten kanonik sırada gelir.
            debts.map((_, index) => index),
          ]),
        ]);
        return { ok: true, created: true };
      } catch (error) {
        const code = readErrorCode(error);

        /*
         * Aynı hesap kimliği zaten var. TEKRAR yalnızca depodaki taahhüt VE
         * alıcı imzası birebir eşleşirse güvenli sayılır; aksi hâlde üzerine
         * yazılmaz ve çakışma bildirilir.
         */
        if (
          code === UNIQUE_VIOLATION &&
          readConstraintName(error) === BILL_PRIMARY_KEY_CONSTRAINT
        ) {
          try {
            const rows = (await sql.query(SELECT_EXISTING, [
              manifest.billId,
            ])) as ExistingRow[];
            const existing = rows[0];
            if (existing === undefined) {
              return { ok: false, reason: "idConflict" };
            }
            const sameCommitment =
              asText(existing.debts_root)?.toLowerCase() ===
              manifest.debtsRoot.toLowerCase();
            const sameSignature =
              asText(existing.recipient_signature)?.toLowerCase() ===
              signature.toLowerCase();
            const sameRecipient =
              asText(existing.recipient_address)?.toLowerCase() ===
              manifest.recipient.toLowerCase();
            const sameCount = Number(existing.debt_count) === manifest.debtCount;

            return sameCommitment && sameSignature && sameRecipient && sameCount
              ? { ok: true, created: false }
              : { ok: false, reason: "idConflict" };
          } catch {
            return { ok: false, reason: "unavailable" };
          }
        }

        if (code !== null && CONSTRAINT_CODES.has(code)) {
          return { ok: false, reason: "constraint" };
        }
        // Ağ, kimlik doğrulama veya bilinmeyen sürücü hatası. Ayrıntı sızmaz.
        return { ok: false, reason: "unavailable" };
      }
    },

    async resolveAccess(
      input: ResolveAccessInput,
    ): Promise<ResolveAccessOutcome> {
      try {
        /*
         * Nonce tüketimi VE oturum yaratma TEK bir Postgres işlemindedir.
         * Nonce daha önce tüketilmişse `ON CONFLICT DO NOTHING` hiçbir satır
         * döndürmez; o zaman işlem bilerek bir hata ile geri alınır ve oturum
         * YARATILMAZ.
         */
        const billRows = (await sql.query(SELECT_BILL_FOR_DEBTOR, [
          input.billId,
        ])) as BillRow[];
        const billRow = billRows[0];
        if (billRow === undefined) {
          // Hesabı yine de nonce'u tüketerek koruruz: tekrar denenemesin.
          await sql
            .query(CONSUME_NONCE, [
              input.billId,
              input.nonce,
              input.debtor,
              Math.floor(input.nonceExpiresAt / 1000),
            ])
            .catch(() => undefined);
          return { ok: false, reason: "notFound" };
        }

        const debtRows = (await sql.query(SELECT_DEBTS, [
          input.billId,
        ])) as DebtRow[];
        const debts = toStoredDebts(debtRows);
        const debt = debts.find(
          (row) => row.debtor.toLowerCase() === input.debtor.toLowerCase(),
        );

        const consumed = (await sql.transaction((txn) => [
          txn.query(CONSUME_NONCE, [
            input.billId,
            input.nonce,
            input.debtor,
            Math.floor(input.nonceExpiresAt / 1000),
          ]),
        ])) as unknown[][];
        const nonceAccepted = Array.isArray(consumed[0]) && consumed[0].length > 0;
        if (!nonceAccepted) {
          return { ok: false, reason: "replay" };
        }

        if (debt === undefined) {
          // Bu adres bu hesapta yok — GENEL hata; nonce yine de tüketildi.
          return { ok: false, reason: "notFound" };
        }

        const bill = toStoredBill(billRow, debts);
        if (bill === null) {
          return { ok: false, reason: "notFound" };
        }

        await sql.query(INSERT_SESSION, [
          input.sessionHash,
          input.billId,
          debt.debtor,
          input.chainId,
          Math.floor(input.sessionExpiresAt / 1000),
        ]);

        // Fırsatçı, SINIRLI temizlik. Başarısız olursa yol sessizce sürer.
        void sql.query(CLEANUP_NONCES, []).catch(() => undefined);
        void sql.query(CLEANUP_SESSIONS, []).catch(() => undefined);

        return { ok: true, bill, debt };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },

    async readSession(input: {
      sessionHash: string;
      nowMs: number;
    }): Promise<SessionLookupOutcome> {
      try {
        const sessionRows = (await sql.query(SELECT_SESSION, [
          input.sessionHash,
        ])) as { bill_id: unknown; debtor_address: unknown }[];
        const session = sessionRows[0];
        const billId = asText(session?.bill_id);
        const debtor = asText(session?.debtor_address);
        if (billId === null || debtor === null) {
          return { ok: false, reason: "notFound" };
        }

        const billRows = (await sql.query(SELECT_BILL_FOR_DEBTOR, [
          billId,
        ])) as BillRow[];
        const billRow = billRows[0];
        if (billRow === undefined) {
          return { ok: false, reason: "notFound" };
        }

        const debtRows = (await sql.query(SELECT_DEBTS, [billId])) as DebtRow[];
        const debts = toStoredDebts(debtRows);
        const bill = toStoredBill(billRow, debts);
        if (bill === null) {
          return { ok: false, reason: "notFound" };
        }
        const debt = debts.find(
          (row) => row.debtor.toLowerCase() === debtor.toLowerCase(),
        );
        if (debt === undefined) {
          return { ok: false, reason: "notFound" };
        }
        return { ok: true, bill, debtor: debt.debtor, debt };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
  });
}

type BillRow = {
  bill_id: unknown;
  schema_version: unknown;
  chain_id: unknown;
  recipient_address: unknown;
  recipient_label: unknown;
  debts_root: unknown;
  debt_count: unknown;
  issued_at: unknown;
  expires_at: unknown;
  recipient_signature: unknown;
  status: unknown;
};

type DebtRow = {
  debtor_address: unknown;
  debtor_label: unknown;
  debt_key: unknown;
  try_minor: unknown;
  leaf_index: unknown;
};

function toStoredDebts(rows: readonly DebtRow[]): readonly StoredSharedBillDebt[] {
  const mapped: StoredSharedBillDebt[] = [];
  for (const row of rows) {
    const debtor = asText(row.debtor_address);
    const debtorLabel = asText(row.debtor_label);
    const debtKey = asText(row.debt_key);
    const tryMinor = asText(row.try_minor);
    const leafIndex = Number(row.leaf_index);
    if (
      debtor === null ||
      debtorLabel === null ||
      debtKey === null ||
      tryMinor === null ||
      !Number.isSafeInteger(leafIndex)
    ) {
      continue;
    }
    mapped.push(
      Object.freeze({ debtor, debtorLabel, debtKey, tryMinor, leafIndex }),
    );
  }
  return Object.freeze(mapped);
}

/**
 * Depodan okunan satırı KANONİK manifeste çevirir.
 *
 * Veritabanından gelen veri de KATI doğrulamadan geçer: depoya güvenilir ama
 * doğrulama atlanmaz. Doğrulamadan geçmeyen bir hesap kullanılamaz sayılır.
 */
function toStoredBill(
  row: BillRow,
  debts: readonly StoredSharedBillDebt[],
): StoredSharedBill | null {
  const signature = asText(row.recipient_signature);
  const status = asText(row.status);
  if (signature === null || (status !== "open" && status !== "closed")) {
    return null;
  }
  const candidate = {
    schemaVersion: Number(row.schema_version),
    billId: asText(row.bill_id) ?? "",
    chainId: Number(row.chain_id),
    recipient: asText(row.recipient_address) ?? "",
    recipientLabel: asText(row.recipient_label) ?? "",
    debtsRoot: asText(row.debts_root) ?? "",
    debtCount: Number(row.debt_count),
    issuedAt: Number(row.issued_at),
    expiresAt: Number(row.expires_at),
  };
  /*
   * Zaman penceresi geçerliliği çağıran tarafından ayrıca ölçülür; burada
   * yapısal doğrulama için hesabın kendi veriliş anı kullanılır.
   */
  const validated = validateSharedBillManifest(
    candidate,
    candidate.issuedAt * 1000,
  );
  if (!validated.ok) {
    return null;
  }
  return Object.freeze({
    manifest: validated.manifest,
    signature,
    status,
    debts,
  });
}
