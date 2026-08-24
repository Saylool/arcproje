import { SHARED_BILL_SCHEMA_VERSION } from "@/lib/arc/shared-bill";

import { readDatabaseUrl, type DatabaseEnv } from "./env";
import type {
  CreateSharedBillOutcome,
  SharedBillRecord,
  SharedBillRepository,
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
  debts_hash, debt_count, issued_at, expires_at, recipient_signature, status
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
  bill_id, debtor_address, debtor_label, debt_key, try_minor
)
SELECT $1, rows.debtor, rows.label, rows.key, rows.amount::numeric
FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[])
  AS rows(debtor, label, key, amount)
`;

const SELECT_EXISTING = `
SELECT debts_hash, recipient_address, recipient_signature, debt_count
FROM shared_bills
WHERE bill_id = $1
`;

type ExistingRow = {
  debts_hash: unknown;
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
            manifest.debtsHash,
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
              asText(existing.debts_hash)?.toLowerCase() ===
              manifest.debtsHash.toLowerCase();
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
  });
}
