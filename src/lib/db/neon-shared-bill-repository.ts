import { normalizeWalletAddress } from "@/lib/arc/address";
import { validateCanonicalLabel } from "@/lib/arc/labels";
import { MAX_LABEL_LENGTH } from "@/lib/arc/payment-request";
import {
  SHARED_BILL_SCHEMA_VERSION,
  validateSharedBillManifest,
} from "@/lib/arc/shared-bill";

import { readDatabaseUrl, type DatabaseEnv } from "./env";
import type {
  DeleteContactOutcome,
  ListSavedContactsOutcome,
  SaveContactOutcome,
  SavedContact,
  UpdateContactOutcome,
  CreatedBillSummary,
  CreateSharedBillOutcome,
  ListCreatedBillsOutcome,
  ListRecentDebtorsOutcome,
  RecentDebtorContact,
  ResolveAccessInput,
  ResolveAccessOutcome,
  SessionLookupOutcome,
  SharedBillAttribution,
  SharedBillRecord,
  SharedBillRepository,
  StoredSharedBill,
  StoredSharedBillDebt,
} from "./shared-bill-repository";
import {
  debtStatusAfterSettlement,
  type ClaimPaymentAttemptInput,
  type ClaimPaymentAttemptOutcome,
  type CreatePaymentOfferInput,
  type CreatePaymentOfferOutcome,
  type DebtPaymentStatus,
  type PaymentAttemptStatus,
  type ReadPaymentAttemptOutcome,
  type ReadPaymentOfferOutcome,
  type RecordSubmissionInput,
  type RecordSubmissionOutcome,
  type SettleAttemptInput,
  type SettleAttemptOutcome,
  type StoredPaymentAttempt,
  type StoredPaymentOffer,
} from "./shared-bill-payment-repository";

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
/** 0003 ile gelen sahiplik yabancı anahtarı. */
const OWNER_FOREIGN_KEY_CONSTRAINT = "shared_bills_created_by_app_user";

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
  debts_root, debt_count, issued_at, expires_at, recipient_signature, status,
  created_by_user_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8), to_timestamp($9), $10, 'open', $11)
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

/**
 * Nonce TÜKETİMİ ve OTURUM YARATMA — TEK DEYİM, TEK İŞLEM.
 *
 * Depo sözleşmesi ikisinin birlikte olmasını ya da hiçbirinin olmamasını
 * şart koşar. İki ayrı deyimde yürütülseydi, nonce tüketilip oturum
 * yazılamayan bir ara durum kalabilirdi; kullanıcı kilitlenirdi.
 *
 * Veri değiştiren CTE: nonce zaten tüketilmişse `ON CONFLICT DO NOTHING`
 * hiçbir satır döndürmez, dolayısıyla `SELECT ... FROM consumed` boş kalır ve
 * oturum satırı HİÇ yazılmaz. Eşzamanlı iki istekte Postgres'in benzersizlik
 * kısıtı yalnızca birinin kazanmasını garanti eder.
 */
const CONSUME_NONCE_AND_OPEN_SESSION = `
WITH consumed AS (
  INSERT INTO shared_bill_auth_nonces (bill_id, nonce, debtor_address, expires_at)
  VALUES ($1, $2, $3, to_timestamp($4))
  ON CONFLICT (bill_id, nonce) DO NOTHING
  RETURNING nonce
)
INSERT INTO shared_bill_sessions (
  session_hash, bill_id, debtor_address, chain_id, expires_at
)
SELECT $5, $1, $6, $7, to_timestamp($8) FROM consumed
RETURNING session_hash
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
       leaf_index, payment_status, paid_tx_hash,
       extract(epoch from paid_at)::bigint AS paid_at
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

/*
 * Oluşturan kişinin KENDİ hesap listesi.
 *
 * Süzme `WHERE b.created_by_user_id = $1` ile SORGUNUN İÇİNDE yapılır: rota
 * hiçbir zaman "hepsini çek, sonra filtrele" yapmaz. Kimlik istemciden değil,
 * sunucudaki oturumdan gelir.
 *
 * Borçlu adresi, etiket, borç anahtarı, taahhüt ve imza SEÇİLMEZ. Toplamlar
 * `numeric`ten `text`e çevrilir: para hiçbir adımda `number` olmaz.
 *
 * Sıralama SUNUCU zamanına göredir; `issued_at` istemci tarafından üretilir ve
 * sıraya esas alınmaz.
 */
const SELECT_BILLS_CREATED_BY = `
SELECT b.bill_id,
       extract(epoch from b.issued_at)::bigint  AS issued_at,
       extract(epoch from b.expires_at)::bigint AS expires_at,
       b.status,
       b.debt_count,
       coalesce(sum(d.try_minor), 0)::text AS total_try_minor,
       coalesce(sum(d.try_minor) FILTER (WHERE d.payment_status = 'paid'), 0)::text
         AS paid_try_minor,
       count(d.*) FILTER (WHERE d.payment_status = 'paid')::bigint AS paid_count
FROM shared_bills b
LEFT JOIN shared_bill_debts d ON d.bill_id = b.bill_id
WHERE b.created_by_user_id = $1
GROUP BY b.bill_id, b.issued_at, b.expires_at, b.status, b.debt_count, b.created_at
ORDER BY b.created_at DESC
LIMIT $2
`;

/*
 * REHBER: kişinin KENDİ hesaplarında geçmişte kullandığı borçlular.
 *
 * Yeni bir tablo YOKTUR. Bu bilgi zaten kendi hesaplarında duruyor; sorgu onu
 * yalnızca okur. Bu yüzden "rehber" ayrı bir gizlilik yüzeyi açmaz.
 *
 * `DISTINCT ON` adres başına TEK satır bırakır ve iç sıralama sayesinde
 * seçilen satır EN SON kullanımdır. Dış sorgu sonucu yeniden sıralar, çünkü
 * `DISTINCT ON` kendi sıralamasını dayatır.
 *
 * Süresi dolmuş veya kapanmış hesaplar da sayılır: kişi hâlâ aynı kişidir.
 */
const SELECT_RECENT_DEBTORS = `
SELECT address, label, last_used_at
FROM (
  SELECT DISTINCT ON (lower(d.debtor_address))
         d.debtor_address AS address,
         d.debtor_label   AS label,
         extract(epoch from b.created_at)::bigint AS last_used_at
  FROM shared_bills b
  JOIN shared_bill_debts d ON d.bill_id = b.bill_id
  WHERE b.created_by_user_id = $1
    AND b.created_at > to_timestamp($3)
  ORDER BY lower(d.debtor_address), b.created_at DESC
) recent
ORDER BY last_used_at DESC
LIMIT $2
`;

/*
 * KAYITLI KİŞİLER — kullanıcının kendi adres defteri.
 *
 * HER SORGU `user_id` İLE SINIRLIDIR. `contact_id` tahmin edilse bile
 * başkasının kaydına dokunulamaz; kısıt sorgunun içindedir.
 */
const SELECT_SAVED_CONTACTS = `
SELECT contact_id, label, address
FROM saved_contacts
WHERE user_id = $1
ORDER BY lower(label)
LIMIT $2
`;

/*
 * Ekleme, ÜST SINIRI da sorgunun içinde uygular: `WHERE` yalnızca sayım
 * sınırın altındaysa satır üretir. Ayrı bir "önce say, sonra ekle" adımı
 * eşzamanlı iki istekte sınırı aşabilirdi.
 */
const INSERT_SAVED_CONTACT = `
INSERT INTO saved_contacts (contact_id, user_id, label, address)
SELECT $1, $2, $3, $4
WHERE (SELECT count(*) FROM saved_contacts WHERE user_id = $2) < $5
RETURNING contact_id, label, address
`;

const UPDATE_SAVED_CONTACT = `
UPDATE saved_contacts
SET label = $3, address = $4, updated_at = now()
WHERE user_id = $1 AND contact_id = $2
RETURNING contact_id, label, address
`;

/*
 * `RETURNING` ZORUNLUDUR.
 *
 * Onsuz sürücü boş bir dizi döndürür ve silinen satır sayısı 0 sanılır. Tek
 * kişi silme bunu "bulunamadı" (404) diye yorumlayıp KULLANICIYA HATA
 * gösterirdi — satır gerçekte silinmiş olduğu hâlde. Bellek içi sahte depo
 * doğru sayıyı verdiği için testler bunu göremezdi; eşleşme testi artık
 * `RETURNING`i sorgunun kendisinde arıyor.
 */
const DELETE_SAVED_CONTACT = `
DELETE FROM saved_contacts
WHERE user_id = $1 AND contact_id = $2
RETURNING contact_id
`;

const DELETE_ALL_SAVED_CONTACTS = `
DELETE FROM saved_contacts
WHERE user_id = $1
RETURNING contact_id
`;

type SavedContactRow = {
  contact_id: unknown;
  label: unknown;
  address: unknown;
};

/** Satırı kayda çevirir; beklenen biçimde değilse `null`. */
function toSavedContact(row: SavedContactRow): SavedContact | null {
  const contactId = asText(row.contact_id);
  const rawAddress = asText(row.address);
  const address =
    rawAddress === null ? null : normalizeWalletAddress(rawAddress);
  const label = validateCanonicalLabel(row.label, MAX_LABEL_LENGTH);
  if (contactId === null || address === null || !label.ok) {
    return null;
  }
  return Object.freeze({ contactId, label: label.value, address });
}

/** Hangi benzersizlik indeksi ihlal edildi? */
function duplicateReason(
  error: unknown,
): "duplicateAddress" | "duplicateLabel" | null {
  if (readErrorCode(error) !== UNIQUE_VIOLATION) {
    return null;
  }
  const constraint = readConstraintName(error);
  if (constraint === "saved_contacts_one_address_per_user") {
    return "duplicateAddress";
  }
  if (constraint === "saved_contacts_one_label_per_user") {
    return "duplicateLabel";
  }
  return null;
}

type RecentDebtorRow = {
  address: unknown;
  label: unknown;
  last_used_at: unknown;
};

/**
 * Satırı öneriye çevirir; beklenen biçimde değilse `null`.
 *
 * Burada tek bir bozuk satır TÜM listeyi düşürmez — hesap listesindekinin
 * TERSİ. Sebep: eksik bir hesap "hesabım kayboldu" korkusu yaratır, eksik bir
 * ÖNERİ ise görünmez ve zararsızdır; kullanıcı adresi elle yazar.
 */
function toRecentDebtor(row: RecentDebtorRow): RecentDebtorContact | null {
  const rawAddress = asText(row.address);
  const address =
    rawAddress === null ? null : normalizeWalletAddress(rawAddress);
  const label = validateCanonicalLabel(row.label, MAX_LABEL_LENGTH);
  const lastUsedAt = Number(row.last_used_at);

  if (
    address === null ||
    !label.ok ||
    !Number.isSafeInteger(lastUsedAt) ||
    lastUsedAt <= 0
  ) {
    return null;
  }
  return Object.freeze({ address, label: label.value, lastUsedAt });
}

type CreatedBillRow = {
  bill_id: unknown;
  issued_at: unknown;
  expires_at: unknown;
  status: unknown;
  debt_count: unknown;
  total_try_minor: unknown;
  paid_try_minor: unknown;
  paid_count: unknown;
};

/** Kanonik negatif olmayan tam sayı metni; başta sıfır ve ondalık kabul edilmez. */
const CANONICAL_MINOR = /^(0|[1-9][0-9]{0,29})$/;

function asCanonicalMinor(value: unknown): string | null {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "bigint"
        ? value.toString()
        : null;
  return text !== null && CANONICAL_MINOR.test(text) ? text : null;
}

function asBoundedCount(value: unknown, max: number): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max
    ? parsed
    : null;
}

/**
 * Satırı özete çevirir. Herhangi bir alan beklenen biçimde DEĞİLSE `null`
 * döner ve çağıran tüm listeyi `unavailable` sayar: yanlış bir tutarı
 * göstermektense hiçbir şey göstermemek yeğdir.
 */
function toCreatedBillSummary(row: CreatedBillRow): CreatedBillSummary | null {
  const billId = asText(row.bill_id);
  const status = asText(row.status);
  const issuedAt = Number(row.issued_at);
  const expiresAt = Number(row.expires_at);
  const debtCount = asBoundedCount(row.debt_count, 50);
  const paidCount = asBoundedCount(row.paid_count, 50);
  const totalTryMinor = asCanonicalMinor(row.total_try_minor);
  const paidTryMinor = asCanonicalMinor(row.paid_try_minor);

  if (
    billId === null ||
    (status !== "open" && status !== "closed") ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    debtCount === null ||
    paidCount === null ||
    paidCount > debtCount ||
    totalTryMinor === null ||
    paidTryMinor === null
  ) {
    return null;
  }

  return Object.freeze({
    billId,
    issuedAt,
    expiresAt,
    status,
    debtCount,
    paidCount,
    totalTryMinor,
    paidTryMinor,
  });
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/*
 * ---------------------------------------------------------------------------
 * ÖDEME YAŞAM DÖNGÜSÜ — TEK DEYİMLİK KARŞILAŞTIR-VE-YAZ
 * ---------------------------------------------------------------------------
 *
 * Neon sürücüsünün `transaction()` API'si SABİT bir sorgu dizisi alır: bir
 * işlemin ORTASINDA dallanmak mümkün değildir. Bu yüzden her atomik geçiş
 * TEK bir deyimde, veri değiştiren CTE'lerle yazılır. Beklenen kaynak durum
 * sorgunun İÇİNDE aranır; eşleşmezse HİÇBİR satır dönmez ve hiçbir şey
 * değişmez. Son yazan kazanan (last-write-wins) güncelleme YOKTUR.
 *
 * Eşzamanlılık: READ COMMITTED altında ikinci `UPDATE`, birincinin kilidini
 * bekler ve YENİ satır sürümüne karşı `WHERE`'i yeniden değerlendirir; artık
 * `payment_status = 'unpaid'` tutmadığı için 0 satır günceller. Kısmi
 * benzersiz indeks (`..._unique_active`) ikinci savunma hattıdır.
 */

const ATTEMPT_COLUMNS = `
  a.attempt_id, a.bill_id, a.debtor_address, a.recipient_address, a.offer_id,
  a.quote_id, a.rate_numerator::text AS rate_numerator,
  a.rate_denominator::text AS rate_denominator,
  a.try_minor::text AS try_minor, a.micro_usdc::text AS micro_usdc,
  a.status, a.tx_hash,
  extract(epoch from a.reserved_at)::bigint  AS reserved_at,
  extract(epoch from a.expires_at)::bigint   AS expires_at,
  extract(epoch from a.confirmed_at)::bigint AS confirmed_at
`;

const OFFER_COLUMNS = `
  o.offer_id, o.bill_id, o.debtor_address, o.recipient_address,
  o.try_minor::text AS try_minor, o.quote_id,
  o.rate_numerator::text AS rate_numerator,
  o.rate_denominator::text AS rate_denominator,
  o.micro_usdc::text AS micro_usdc,
  extract(epoch from o.quote_issued_at)::bigint  AS quote_issued_at,
  extract(epoch from o.quote_expires_at)::bigint AS quote_expires_at,
  extract(epoch from o.issued_at)::bigint        AS issued_at,
  extract(epoch from o.expires_at)::bigint       AS expires_at,
  extract(epoch from o.consumed_at)::bigint      AS consumed_at
`;

/**
 * Teklifi YALNIZCA hesap açık/süresi geçerli ve borç `unpaid` iken yazar.
 *
 * Alıcı ve TRY tutarı DEPODAN okunur; parametre olarak gelen değerler yalnızca
 * doğrulama için karşılaştırılır. Borç REZERVE EDİLMEZ.
 */
const INSERT_OFFER = `
INSERT INTO shared_bill_payment_offers (
  offer_id, bill_id, debtor_address, recipient_address, try_minor,
  quote_id, rate_numerator, rate_denominator, quote_issued_at,
  quote_expires_at, micro_usdc, issued_at, expires_at
)
SELECT $1, d.bill_id, d.debtor_address, b.recipient_address, d.try_minor,
       $4, $5::numeric, $6::numeric, to_timestamp($7), to_timestamp($8),
       $9::numeric, to_timestamp($13), to_timestamp($11)
FROM shared_bill_debts d
JOIN shared_bills b ON b.bill_id = d.bill_id
WHERE d.bill_id = $2
  AND lower(d.debtor_address) = lower($3)
  AND d.payment_status = 'unpaid'
  AND b.status = 'open'
  -- $10 = SU AN (hesap tazeligi). Teklifin VERILIS ani ayri parametredir
  -- ($13): saglayici cagrisi surerken saat ilerledigi icin ikisi ayni
  -- olmayabilir ve issued_at, icindeki kurdan ONCE olamaz.
  AND b.expires_at > to_timestamp($10)
  -- Depodaki tutar, teklifin türetildiği tutarla BİREBİR aynı olmalı.
  AND d.try_minor = $12::numeric
RETURNING offer_id
`;

const SELECT_OFFER = `
SELECT ${OFFER_COLUMNS}
FROM shared_bill_payment_offers o
WHERE o.offer_id = $1
  AND o.bill_id = $2
  AND lower(o.debtor_address) = lower($3)
`;

/** Borcun ödeme durumu; teklif reddedildiğinde nedeni bildirmek için. */
const SELECT_DEBT_STATUS = `
SELECT payment_status
FROM shared_bill_debts
WHERE bill_id = $1 AND lower(debtor_address) = lower($2)
`;

/**
 * ATOMİK REZERVASYON.
 *
 * Sıra: kullanılabilir teklif → açık hesap → `unpaid` borcu `reserved` yap →
 * teklifi tüketilmiş işaretle → denemeyi yaz. Zincirin herhangi bir halkası
 * boş dönerse HİÇBİRİ olmaz.
 */
const CLAIM_ATTEMPT = `
WITH usable_offer AS (
  SELECT o.*
  FROM shared_bill_payment_offers o
  JOIN shared_bills b ON b.bill_id = o.bill_id
  WHERE o.offer_id = $1
    AND o.bill_id = $2
    AND lower(o.debtor_address) = lower($3)
    AND o.consumed_at IS NULL
    AND o.expires_at > to_timestamp($4)
    AND b.status = 'open'
    AND b.expires_at > to_timestamp($4)
),
reserved_debt AS (
  UPDATE shared_bill_debts d
  SET payment_status = 'reserved'
  FROM usable_offer o
  WHERE d.bill_id = o.bill_id
    AND lower(d.debtor_address) = lower(o.debtor_address)
    -- KARSILASTIR-VE-YAZ: yalnizca HALA odenmemis borc rezerve edilir.
    AND d.payment_status = 'unpaid'
    -- Tutar teklif basıldığından beri değişmemiş olmalı.
    AND d.try_minor = o.try_minor
  RETURNING d.bill_id, d.debtor_address
),
consumed_offer AS (
  UPDATE shared_bill_payment_offers o
  SET consumed_at = to_timestamp($4)
  FROM reserved_debt r
  WHERE o.offer_id = $1 AND o.consumed_at IS NULL
  RETURNING o.offer_id
)
INSERT INTO shared_bill_payment_attempts (
  attempt_id, bill_id, debtor_address, recipient_address, offer_id, quote_id,
  rate_numerator, rate_denominator, try_minor, micro_usdc, session_hash,
  status, reserved_at, expires_at
)
SELECT $5, o.bill_id, o.debtor_address, o.recipient_address, o.offer_id,
       o.quote_id, o.rate_numerator, o.rate_denominator, o.try_minor,
       o.micro_usdc, $6, 'reserved', to_timestamp($4), o.expires_at
FROM usable_offer o, reserved_debt r, consumed_offer c
RETURNING attempt_id
`;

const SELECT_ATTEMPT = `
SELECT ${ATTEMPT_COLUMNS}
FROM shared_bill_payment_attempts a
WHERE a.attempt_id = $1
  AND a.bill_id = $2
  AND lower(a.debtor_address) = lower($3)
`;

const SELECT_LATEST_ATTEMPT = `
SELECT ${ATTEMPT_COLUMNS}
FROM shared_bill_payment_attempts a
WHERE a.bill_id = $1 AND lower(a.debtor_address) = lower($2)
ORDER BY a.reserved_at DESC, a.attempt_id DESC
LIMIT 1
`;

/** `reserved` → `submitted`. Kaynak durum sorgunun İÇİNDE aranır. */
const RECORD_SUBMISSION = `
UPDATE shared_bill_payment_attempts a
SET status = 'submitted', tx_hash = $4
WHERE a.attempt_id = $1
  AND a.bill_id = $2
  AND lower(a.debtor_address) = lower($3)
  AND a.status = 'reserved'
RETURNING attempt_id
`;

/**
 * ATOMİK YERLEŞİM: deneme + borç (+ gerekirse hesap) TEK deyimde.
 *
 * `$4` hedef deneme durumu, `$5` hedef borç durumu, `$6` işlem hash'i,
 * `$7` an. İzin verilen kaynak durumlar `$8::text[]` ile gelir; listede
 * olmayan bir kaynaktan geçiş HİÇBİR satır döndürmez.
 *
 * Borç `paid` ise HİÇBİR yerleşim uygulanmaz: `paid` SON durumdur.
 */
const SETTLE_ATTEMPT = `
WITH target AS (
  UPDATE shared_bill_payment_attempts a
  SET status = $4,
      tx_hash = CASE WHEN $4 = 'released' THEN NULL
                     ELSE COALESCE($6::text, a.tx_hash) END,
      confirmed_at = CASE WHEN $4 = 'confirmed' THEN to_timestamp($7) END,
      settled_at = to_timestamp($7)
  FROM shared_bill_debts d
  WHERE a.attempt_id = $1
    AND a.bill_id = $2
    AND lower(a.debtor_address) = lower($3)
    AND a.status = ANY($8::text[])
    AND d.bill_id = a.bill_id
    AND lower(d.debtor_address) = lower(a.debtor_address)
    -- 'paid' borç hiçbir yerleşimle DEĞİŞTİRİLEMEZ.
    AND d.payment_status <> 'paid'
  RETURNING a.attempt_id, a.bill_id, a.debtor_address, a.tx_hash
),
settled_debt AS (
  UPDATE shared_bill_debts d
  SET payment_status = $5,
      paid_tx_hash = CASE WHEN $5 = 'paid' THEN t.tx_hash END,
      paid_at = CASE WHEN $5 = 'paid' THEN to_timestamp($7) END
  FROM target t
  WHERE d.bill_id = t.bill_id
    AND lower(d.debtor_address) = lower(t.debtor_address)
    AND d.payment_status <> 'paid'
  RETURNING d.bill_id, d.debtor_address
),
closed_bill AS (
  UPDATE shared_bills b
  SET status = 'closed'
  FROM settled_debt s
  WHERE b.bill_id = s.bill_id
    AND b.status = 'open'
    -- Hesap YALNIZCA bu yerleşim bir ONAY ise kapanabilir.
    AND $5::text = 'paid'
    -- Hesap YALNIZCA HER borç BAĞIMSIZ olarak onaylandıysa kapanır.
    --
    -- DIKKAT: PostgreSQL'de WITH alt deyimleri BIRBIRININ etkisini GOREMEZ;
    -- hepsi deyim oncesi anlik goruntuyu okur. Bu yuzden settled_debt CTE'sinin
    -- az once 'paid' yaptigi satir burada HALA eski durumda gorunur ve
    -- "odenmemis" sayilirdi. O satir ACIKCA haric tutulur; geri kalan TUM
    -- borclarin zaten 'paid' olmasi aranir.
    AND NOT EXISTS (
      SELECT 1 FROM shared_bill_debts d2
      WHERE d2.bill_id = b.bill_id
        AND d2.payment_status <> 'paid'
        AND lower(d2.debtor_address) <> lower(s.debtor_address)
    )
  RETURNING b.bill_id
)
SELECT t.attempt_id,
       (SELECT count(*) FROM closed_bill) AS closed_count
FROM target t
`;

/**
 * SINIRLI temizlik.
 *
 * YALNIZCA süresi dolmuş ve HİÇ KULLANILMAMIŞ teklifler ile KESİN olarak
 * serbest bırakılmış denemeler silinir. `confirmed`, `reverted` ve `unknown`
 * denemelerin kanıtı ASLA otomatik silinmez.
 */
const CLEANUP_RELEASED_ATTEMPTS = `
DELETE FROM shared_bill_payment_attempts
WHERE ctid IN (
  SELECT ctid FROM shared_bill_payment_attempts
  WHERE status = 'released' AND expires_at < to_timestamp($1)
  LIMIT $2
)
`;
const CLEANUP_UNUSED_OFFERS = `
DELETE FROM shared_bill_payment_offers
WHERE ctid IN (
  SELECT ctid FROM shared_bill_payment_offers
  WHERE consumed_at IS NULL AND expires_at < to_timestamp($1)
  LIMIT $2
)
`;

type AttemptRow = {
  attempt_id: unknown;
  bill_id: unknown;
  debtor_address: unknown;
  recipient_address: unknown;
  offer_id: unknown;
  quote_id: unknown;
  rate_numerator: unknown;
  rate_denominator: unknown;
  try_minor: unknown;
  micro_usdc: unknown;
  status: unknown;
  tx_hash: unknown;
  reserved_at: unknown;
  expires_at: unknown;
  confirmed_at: unknown;
};

type OfferRow = {
  offer_id: unknown;
  bill_id: unknown;
  debtor_address: unknown;
  recipient_address: unknown;
  try_minor: unknown;
  quote_id: unknown;
  rate_numerator: unknown;
  rate_denominator: unknown;
  micro_usdc: unknown;
  quote_issued_at: unknown;
  quote_expires_at: unknown;
  issued_at: unknown;
  expires_at: unknown;
  consumed_at: unknown;
};

function toStoredAttempt(row: AttemptRow | undefined): StoredPaymentAttempt | null {
  if (row === undefined) return null;
  const attemptId = asText(row.attempt_id);
  const billId = asText(row.bill_id);
  const debtor = asText(row.debtor_address);
  const recipient = asText(row.recipient_address);
  const offerId = asText(row.offer_id);
  const quoteId = asText(row.quote_id);
  const rateNumerator = asText(row.rate_numerator);
  const rateDenominator = asText(row.rate_denominator);
  const tryMinor = asText(row.try_minor);
  const microUsdc = asText(row.micro_usdc);
  const status = asAttemptStatus(row.status);
  const reservedAt = asSeconds(row.reserved_at);
  const expiresAt = asSeconds(row.expires_at);
  if (
    attemptId === null || billId === null || debtor === null ||
    recipient === null || offerId === null || quoteId === null ||
    rateNumerator === null || rateDenominator === null ||
    tryMinor === null || microUsdc === null || status === null ||
    reservedAt === null || expiresAt === null
  ) {
    return null;
  }
  return Object.freeze({
    attemptId, billId, debtor, recipient, offerId, quoteId,
    rateNumerator, rateDenominator, tryMinor, microUsdc, status,
    txHash: asText(row.tx_hash),
    reservedAt, expiresAt,
    confirmedAt: asSeconds(row.confirmed_at),
  });
}

function toStoredOffer(row: OfferRow | undefined): StoredPaymentOffer | null {
  if (row === undefined) return null;
  const offerId = asText(row.offer_id);
  const billId = asText(row.bill_id);
  const debtor = asText(row.debtor_address);
  const recipient = asText(row.recipient_address);
  const tryMinor = asText(row.try_minor);
  const quoteId = asText(row.quote_id);
  const rateNumerator = asText(row.rate_numerator);
  const rateDenominator = asText(row.rate_denominator);
  const microUsdc = asText(row.micro_usdc);
  const quoteIssuedAt = asSeconds(row.quote_issued_at);
  const quoteExpiresAt = asSeconds(row.quote_expires_at);
  const issuedAt = asSeconds(row.issued_at);
  const expiresAt = asSeconds(row.expires_at);
  if (
    offerId === null || billId === null || debtor === null ||
    recipient === null || tryMinor === null || quoteId === null ||
    rateNumerator === null || rateDenominator === null ||
    microUsdc === null || quoteIssuedAt === null ||
    quoteExpiresAt === null || issuedAt === null || expiresAt === null
  ) {
    return null;
  }
  return Object.freeze({
    offerId, billId, debtor, recipient, tryMinor, quoteId,
    rateNumerator, rateDenominator, quoteIssuedAt, quoteExpiresAt,
    microUsdc, issuedAt, expiresAt,
    consumedAt: asSeconds(row.consumed_at),
  });
}

/** Yerleşimin izin verdiği KAYNAK deneme durumları. */
const SETTLEMENT_SOURCES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    confirmed: ["reserved", "submitted"],
    reverted: ["reserved", "submitted"],
    unknown: ["reserved", "submitted"],
    // Serbest bırakma YALNIZCA `kit.send` çağrılmadan öncedir.
    released: ["reserved"],
  });

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
      attribution: SharedBillAttribution,
    ): Promise<CreateSharedBillOutcome> {
      const { manifest, debts, signature } = record;

      /*
       * Hesap ve TÜM borç satırları TEK bir Postgres işleminde yazılır.
       * Satırlardan biri kısıtı ihlal ederse işlem tümüyle geri alınır ve
       * kullanılabilir kısmi bir hesap kalmaz.
       *
       * Atıf PARAMETRE olarak alınır: yabancı anahtar reddederse aynı yazım
       * atıfsız yeniden denenebilsin.
       */
      const insert = (createdByUserId: string | null) =>
        sql.transaction((txn) => [
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
            /*
             * Atıf İMZALANMAZ ve manifestin parçası değildir; imzalanan
             * baytlar bu sütundan etkilenmez.
             */
            createdByUserId,
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

      try {
        await insert(attribution.createdByUserId);
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

        /*
         * ATIF UĞRUNA HESAP KAYBEDİLMEZ.
         *
         * Oturumun açılmasıyla yazım arasında kullanıcı satırı silinmişse
         * yabancı anahtar reddeder. Hesap o zaman ATIFSIZ yazılır: borçlunun
         * ödeyeceği hesabın hiç var olmaması, sahibinin bilinmemesinden çok
         * daha kötüdür ve doğrulamanın hiçbir adımı bu değere bağlı değildir.
         *
         * Yeniden deneme GÜVENLİDİR: ilk işlem tümüyle geri alınmıştır, geride
         * kısmi bir kayıt kalmaz. Atıf zaten `null` iken bu dal çalışmaz, bu
         * yüzden ikinciden fazla deneme İMKÂNSIZDIR.
         */
        if (
          code === FOREIGN_KEY_VIOLATION &&
          readConstraintName(error) === OWNER_FOREIGN_KEY_CONSTRAINT &&
          attribution.createdByUserId !== null
        ) {
          try {
            await insert(null);
            return { ok: true, created: true };
          } catch {
            return { ok: false, reason: "constraint" };
          }
        }

        if (code !== null && CONSTRAINT_CODES.has(code)) {
          return { ok: false, reason: "constraint" };
        }
        // Ağ, kimlik doğrulama veya bilinmeyen sürücü hatası. Ayrıntı sızmaz.
        return { ok: false, reason: "unavailable" };
      }
    },

    async listBillsCreatedBy(input: {
      createdByUserId: string;
      limit: number;
    }): Promise<ListCreatedBillsOutcome> {
      try {
        const rows = (await sql.query(SELECT_BILLS_CREATED_BY, [
          input.createdByUserId,
          input.limit,
        ])) as CreatedBillRow[];

        const bills: CreatedBillSummary[] = [];
        for (const row of rows) {
          const summary = toCreatedBillSummary(row);
          if (summary === null) {
            /*
             * Tek bir satır bile beklenen biçimde değilse liste KISMEN
             * gösterilmez. Eksik bir liste, kullanıcının "hesabım kaybolmuş"
             * diye yanlış sonuç çıkarmasına yol açardı.
             */
            return { ok: false, reason: "unavailable" };
          }
          bills.push(summary);
        }
        return { ok: true, bills: Object.freeze(bills) };
      } catch {
        // Sürücü ayrıntısı dışarı sızmaz.
        return { ok: false, reason: "unavailable" };
      }
    },

    async listSavedContacts(input: {
      userId: string;
      limit: number;
    }): Promise<ListSavedContactsOutcome> {
      try {
        const rows = (await sql.query(SELECT_SAVED_CONTACTS, [
          input.userId,
          input.limit,
        ])) as SavedContactRow[];
        const contacts: SavedContact[] = [];
        for (const row of rows) {
          const contact = toSavedContact(row);
          if (contact !== null) {
            contacts.push(contact);
          }
        }
        return { ok: true, contacts: Object.freeze(contacts) };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },

    async saveContact(input: {
      userId: string;
      contactId: string;
      label: string;
      address: string;
      limit: number;
    }): Promise<SaveContactOutcome> {
      try {
        const rows = (await sql.query(INSERT_SAVED_CONTACT, [
          input.contactId,
          input.userId,
          input.label,
          input.address,
          input.limit,
        ])) as SavedContactRow[];
        const row = rows[0];
        if (row === undefined) {
          // `WHERE` sınırı tutmadı: defter dolu.
          return { ok: false, reason: "limitReached" };
        }
        const contact = toSavedContact(row);
        return contact === null
          ? { ok: false, reason: "unavailable" }
          : { ok: true, contact };
      } catch (error) {
        const duplicate = duplicateReason(error);
        if (duplicate !== null) {
          return { ok: false, reason: duplicate };
        }
        return { ok: false, reason: "unavailable" };
      }
    },

    async updateContact(input: {
      userId: string;
      contactId: string;
      label: string;
      address: string;
    }): Promise<UpdateContactOutcome> {
      try {
        const rows = (await sql.query(UPDATE_SAVED_CONTACT, [
          input.userId,
          input.contactId,
          input.label,
          input.address,
        ])) as SavedContactRow[];
        const row = rows[0];
        if (row === undefined) {
          /*
           * Satır yok YA DA başkasına ait. İkisi AYNI cevabı verir: bir
           * kimliğin var olup olmadığı yanıttan öğrenilemez.
           */
          return { ok: false, reason: "notFound" };
        }
        const contact = toSavedContact(row);
        return contact === null
          ? { ok: false, reason: "unavailable" }
          : { ok: true, contact };
      } catch (error) {
        const duplicate = duplicateReason(error);
        if (duplicate !== null) {
          return { ok: false, reason: duplicate };
        }
        return { ok: false, reason: "unavailable" };
      }
    },

    async deleteContacts(input: {
      userId: string;
      contactId?: string;
    }): Promise<DeleteContactOutcome> {
      try {
        const result =
          input.contactId === undefined
            ? await sql.query(DELETE_ALL_SAVED_CONTACTS, [input.userId])
            : await sql.query(DELETE_SAVED_CONTACT, [
                input.userId,
                input.contactId,
              ]);
        const deleted = Array.isArray(result) ? result.length : 0;
        return { ok: true, deleted };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },

    async listRecentDebtorsFor(input: {
      createdByUserId: string;
      limit: number;
      notUsedBefore: number;
    }): Promise<ListRecentDebtorsOutcome> {
      try {
        const rows = (await sql.query(SELECT_RECENT_DEBTORS, [
          input.createdByUserId,
          input.limit,
          input.notUsedBefore,
        ])) as RecentDebtorRow[];

        const contacts: RecentDebtorContact[] = [];
        for (const row of rows) {
          const contact = toRecentDebtor(row);
          if (contact !== null) {
            contacts.push(contact);
          }
        }
        return { ok: true, contacts: Object.freeze(contacts) };
      } catch {
        // Sürücü ayrıntısı dışarı sızmaz.
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

        const bill = debt === undefined ? null : toStoredBill(billRow, debts);
        if (debt === undefined || bill === null) {
          /*
           * Bu adres bu hesapta yok. Nonce yine de tüketilir ki aynı meydan
           * okuma tekrar denenemesin; yanıt GENEL hatadır.
           */
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

        /*
         * Nonce tüketimi ve oturum yaratma TEK deyimdedir: ikisi birden olur
         * ya da hiçbiri olmaz. Boş sonuç, nonce'un zaten tüketildiği anlamına
         * gelir — tekrar oynatma.
         */
        const opened = (await sql.query(CONSUME_NONCE_AND_OPEN_SESSION, [
          input.billId,
          input.nonce,
          input.debtor,
          Math.floor(input.nonceExpiresAt / 1000),
          input.sessionHash,
          debt.debtor,
          input.chainId,
          Math.floor(input.sessionExpiresAt / 1000),
        ])) as { session_hash: unknown }[];
        if (opened.length === 0) {
          return { ok: false, reason: "replay" };
        }

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

    /*
     * -----------------------------------------------------------------------
     * ÖDEME YAŞAM DÖNGÜSÜ
     * -----------------------------------------------------------------------
     */

    async createPaymentOffer(
      input: CreatePaymentOfferInput,
    ): Promise<CreatePaymentOfferOutcome> {
      const { offer, nowMs } = input;
      try {
        const rows = (await sql.query(INSERT_OFFER, [
          offer.offerId,
          offer.billId,
          offer.debtor,
          offer.quoteId,
          offer.rateNumerator,
          offer.rateDenominator,
          offer.quoteIssuedAt,
          offer.quoteExpiresAt,
          offer.microUsdc,
          Math.floor(nowMs / 1000),
          offer.expiresAt,
          offer.tryMinor,
          // $13 = teklifin VERILIS ani; servis bunu kurun anindan once
          // olmayacak sekilde hesaplar.
          offer.issuedAt,
        ])) as { offer_id: unknown }[];

        if (rows.length === 0) {
          /*
           * Hiçbir satır yazılmadı. Nedeni ayırt etmek için borcun durumu
           * okunur: ödenmiş/rezerve/inceleme ise `notClaimable`, satır hiç
           * yoksa `notFound`.
           */
          const status = (await sql.query(SELECT_DEBT_STATUS, [
            offer.billId,
            offer.debtor,
          ])) as { payment_status: unknown }[];
          const debtStatus = asDebtPaymentStatus(status[0]?.payment_status);
          if (debtStatus === null) {
            return { ok: false, reason: "notFound" };
          }
          return debtStatus === "unpaid"
            ? // Borç ödenmemiş ama yine de yazılamadı: hesap kapalı/süresi
              // dolmuş ya da tutar eşleşmedi.
              { ok: false, reason: "notFound" }
            : { ok: false, reason: "notClaimable", debtStatus };
        }

        const stored = (await sql.query(SELECT_OFFER, [
          offer.offerId,
          offer.billId,
          offer.debtor,
        ])) as OfferRow[];
        const mapped = toStoredOffer(stored[0]);
        return mapped === null
          ? { ok: false, reason: "unavailable" }
          : { ok: true, offer: mapped };
      } catch (error) {
        const code = readErrorCode(error);
        return code !== null && CONSTRAINT_CODES.has(code)
          ? { ok: false, reason: "constraint" }
          : { ok: false, reason: "unavailable" };
      }
    },

    async readPaymentOffer(input: {
      offerId: string;
      billId: string;
      debtor: string;
    }): Promise<ReadPaymentOfferOutcome> {
      try {
        const rows = (await sql.query(SELECT_OFFER, [
          input.offerId,
          input.billId,
          input.debtor,
        ])) as OfferRow[];
        const offer = toStoredOffer(rows[0]);
        return offer === null
          ? { ok: false, reason: "notFound" }
          : { ok: true, offer };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },

    async claimPaymentAttempt(
      input: ClaimPaymentAttemptInput,
    ): Promise<ClaimPaymentAttemptOutcome> {
      try {
        const rows = (await sql.query(CLAIM_ATTEMPT, [
          input.offerId,
          input.billId,
          input.debtor,
          Math.floor(input.nowMs / 1000),
          input.attemptId,
          input.sessionHash,
        ])) as { attempt_id: unknown }[];

        if (rows.length === 0) {
          /*
           * Rezervasyon yapılamadı. Neden AYIRT EDİLİR ama hiçbir durumda
           * borç serbest kalmaz: okuma yalnızca kullanıcıya doğru mesajı
           * göstermek içindir.
           */
          const status = (await sql.query(SELECT_DEBT_STATUS, [
            input.billId,
            input.debtor,
          ])) as { payment_status: unknown }[];
          const debtStatus = asDebtPaymentStatus(status[0]?.payment_status);
          if (debtStatus === null) {
            return { ok: false, reason: "notFound" };
          }
          if (debtStatus === "reserved") {
            return { ok: false, reason: "alreadyActive" };
          }
          if (debtStatus !== "unpaid") {
            return { ok: false, reason: "notClaimable", debtStatus };
          }
          // Borç ödenmemiş: teklif yok, süresi dolmuş veya zaten kullanılmış.
          return { ok: false, reason: "offerUnusable" };
        }

        const stored = (await sql.query(SELECT_ATTEMPT, [
          input.attemptId,
          input.billId,
          input.debtor,
        ])) as AttemptRow[];
        const attempt = toStoredAttempt(stored[0]);
        return attempt === null
          ? { ok: false, reason: "unavailable" }
          : { ok: true, attempt };
      } catch (error) {
        /*
         * Kısmi benzersiz indeks (aktif deneme) ihlali: başka bir cihaz aynı
         * anda rezerve etti. FAIL-CLOSED: yeni deneme AÇILMAZ.
         */
        return readErrorCode(error) === UNIQUE_VIOLATION
          ? { ok: false, reason: "alreadyActive" }
          : { ok: false, reason: "unavailable" };
      }
    },

    async readPaymentAttempt(input: {
      attemptId: string;
      billId: string;
      debtor: string;
    }): Promise<ReadPaymentAttemptOutcome> {
      try {
        const rows = (await sql.query(SELECT_ATTEMPT, [
          input.attemptId,
          input.billId,
          input.debtor,
        ])) as AttemptRow[];
        const attempt = toStoredAttempt(rows[0]);
        return attempt === null
          ? { ok: false, reason: "notFound" }
          : { ok: true, attempt };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },

    async readLatestAttempt(input: {
      billId: string;
      debtor: string;
    }): Promise<ReadPaymentAttemptOutcome> {
      try {
        const rows = (await sql.query(SELECT_LATEST_ATTEMPT, [
          input.billId,
          input.debtor,
        ])) as AttemptRow[];
        const attempt = toStoredAttempt(rows[0]);
        return attempt === null
          ? { ok: false, reason: "notFound" }
          : { ok: true, attempt };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },

    async recordAttemptSubmission(
      input: RecordSubmissionInput,
    ): Promise<RecordSubmissionOutcome> {
      const txHash = input.txHash.toLowerCase();
      try {
        const rows = (await sql.query(RECORD_SUBMISSION, [
          input.attemptId,
          input.billId,
          input.debtor,
          txHash,
        ])) as { attempt_id: unknown }[];

        const stored = (await sql.query(SELECT_ATTEMPT, [
          input.attemptId,
          input.billId,
          input.debtor,
        ])) as AttemptRow[];
        const attempt = toStoredAttempt(stored[0]);
        if (attempt === null) {
          return { ok: false, reason: "notFound" };
        }
        if (rows.length > 0) {
          return { ok: true, attempt };
        }
        // Aynı hash'le tekrar bildirim GÜVENLİDİR (idempotent).
        if (
          attempt.status === "submitted" &&
          attempt.txHash?.toLowerCase() === txHash
        ) {
          return { ok: true, attempt };
        }
        return {
          ok: false,
          reason: "invalidTransition",
          status: attempt.status,
        };
      } catch (error) {
        return readErrorCode(error) === UNIQUE_VIOLATION
          ? { ok: false, reason: "hashInUse" }
          : { ok: false, reason: "unavailable" };
      }
    },

    async settleAttempt(
      input: SettleAttemptInput,
    ): Promise<SettleAttemptOutcome> {
      const debtStatus = debtStatusAfterSettlement(input.settlement);
      const hash =
        input.settlement === "released" ? null : input.txHash?.toLowerCase() ?? null;
      try {
        const rows = (await sql.query(SETTLE_ATTEMPT, [
          input.attemptId,
          input.billId,
          input.debtor,
          input.settlement,
          debtStatus,
          hash,
          Math.floor(input.nowMs / 1000),
          [...SETTLEMENT_SOURCES[input.settlement]],
        ])) as { attempt_id: unknown; closed_count: unknown }[];

        const stored = (await sql.query(SELECT_ATTEMPT, [
          input.attemptId,
          input.billId,
          input.debtor,
        ])) as AttemptRow[];
        const attempt = toStoredAttempt(stored[0]);
        if (attempt === null) {
          return { ok: false, reason: "notFound" };
        }

        if (rows.length === 0) {
          /*
           * IDEMPOTENS: deneme ZATEN istenen son durumdaysa ve hash
           * çelişmiyorsa bu güvenli bir tekrardır. Aksi hâlde geçiş
           * reddedilir; `paid` bir borç ASLA geri alınmaz.
           */
          const sameOutcome =
            attempt.status === input.settlement &&
            (hash === null || attempt.txHash?.toLowerCase() === hash);
          if (sameOutcome) {
            const billStatus = (await sql.query(SELECT_DEBT_STATUS, [
              input.billId,
              input.debtor,
            ])) as { payment_status: unknown }[];
            return {
              ok: true,
              attempt,
              debtStatus:
                asDebtPaymentStatus(billStatus[0]?.payment_status) ?? debtStatus,
              billClosed: false,
              alreadySettled: true,
            };
          }
          return {
            ok: false,
            reason: "invalidTransition",
            status: attempt.status,
          };
        }

        return {
          ok: true,
          attempt,
          debtStatus,
          billClosed: (asSeconds(rows[0]?.closed_count) ?? 0) > 0,
          alreadySettled: false,
        };
      } catch (error) {
        return readErrorCode(error) === UNIQUE_VIOLATION
          ? { ok: false, reason: "hashInUse" }
          : { ok: false, reason: "unavailable" };
      }
    },

    async cleanupExpiredPaymentRecords(input: {
      nowMs: number;
      limit: number;
    }): Promise<void> {
      const seconds = Math.floor(input.nowMs / 1000);
      const limit = Math.max(0, Math.min(Math.floor(input.limit), CLEANUP_LIMIT));
      // Fırsatçı ve SINIRLI; başarısız olursa yol sessizce sürer.
      await sql
        .query(CLEANUP_RELEASED_ATTEMPTS, [seconds, limit])
        .catch(() => undefined);
      await sql
        .query(CLEANUP_UNUSED_OFFERS, [seconds, limit])
        .catch(() => undefined);
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
  payment_status: unknown;
  paid_tx_hash: unknown;
  paid_at: unknown;
};

const DEBT_PAYMENT_STATUSES: readonly DebtPaymentStatus[] = [
  "unpaid",
  "reserved",
  "paid",
  "review_required",
];

function asDebtPaymentStatus(value: unknown): DebtPaymentStatus | null {
  return typeof value === "string" &&
    (DEBT_PAYMENT_STATUSES as readonly string[]).includes(value)
    ? (value as DebtPaymentStatus)
    : null;
}

const ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] = [
  "reserved",
  "submitted",
  "confirmed",
  "reverted",
  "unknown",
  "released",
];

function asAttemptStatus(value: unknown): PaymentAttemptStatus | null {
  return typeof value === "string" &&
    (ATTEMPT_STATUSES as readonly string[]).includes(value)
    ? (value as PaymentAttemptStatus)
    : null;
}

/** `bigint`/`numeric` sütunları KANONİK metne çevirir; float KULLANILMAZ. */
function asSeconds(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
    const parsed = BigInt(value);
    return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null;
  }
  return null;
}

function toStoredDebts(rows: readonly DebtRow[]): readonly StoredSharedBillDebt[] {
  const mapped: StoredSharedBillDebt[] = [];
  for (const row of rows) {
    const debtor = asText(row.debtor_address);
    const debtorLabel = asText(row.debtor_label);
    const debtKey = asText(row.debt_key);
    const tryMinor = asText(row.try_minor);
    const leafIndex = Number(row.leaf_index);
    const paymentStatus = asDebtPaymentStatus(row.payment_status);
    if (
      debtor === null ||
      debtorLabel === null ||
      debtKey === null ||
      tryMinor === null ||
      paymentStatus === null ||
      !Number.isSafeInteger(leafIndex)
    ) {
      // Tanınmayan bir ödeme durumu SESSİZCE `unpaid` sayılmaz; satır atılır.
      continue;
    }
    mapped.push(
      Object.freeze({
        debtor,
        debtorLabel,
        debtKey,
        tryMinor,
        leafIndex,
        paymentStatus,
        paidTxHash: asText(row.paid_tx_hash),
        paidAt: asSeconds(row.paid_at),
      }),
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
