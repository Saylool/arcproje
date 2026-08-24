-- ---------------------------------------------------------------------------
-- 0001 — Paylaşılan grup hesabı (shared bill) şeması
--
-- Neon Postgres üzerinde ELLE uygulanır:
--   psql "$DATABASE_URL" -f migrations/0001_shared_bills.sql
--
-- Tablolar istek işleyicisi içinde TEMBEL OLUŞTURULMAZ. Şema gözden geçirilmiş
-- bu dosyayla uygulanır.
--
-- NE SAKLANIR: yalnızca ödeme için gereken asgari veri — genel hesap kimliği,
-- ağ, alıcı adresi ve etiketi, borç listesinin kriptografik taahhüdü, borç
-- sayısı, zaman penceresi, alıcı imzası ve borç satırları.
--
-- NE SAKLANMAZ: fiş görseli, ürün satırları, vergi/servis/indirim verisi,
-- OpenAI çıktısı, API anahtarları, kur teklifi, HMAC etiketi ve hesapla
-- ilgisiz katılımcılar.
--
-- KUR BİLEREK SAKLANMAZ: alıcı yalnızca TRY minor unit borçları imzalar; USDC
-- tutarı borçlu ödediği anda alınan TAZE, sunucu kimliklendirmeli bir teklifle
-- türetilir (Part 2).
--
-- SINIR: bir veritabanı satırı, zincir üstünde yinelenen transferleri
-- ENGELLEMEZ ve kriptografik bir tek-kullanım garantisi DEĞİLDİR.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS shared_bills (
  -- Genel (public) hesap kimliği: 0x + 64 hex = 256 bit rastgelelik.
  -- Sıralı veritabanı kimliği URL'de ASLA kullanılmaz.
  bill_id             text        NOT NULL,
  schema_version      smallint    NOT NULL,
  chain_id            bigint      NOT NULL,
  -- Checksum'lı adres, uygulama sınırında normalleştirilmiş olarak gelir.
  recipient_address   text        NOT NULL,
  recipient_label     text        NOT NULL,
  -- Borç listesinin kanonik, alan ayrılmış kriptografik taahhüdü.
  debts_hash          text        NOT NULL,
  debt_count          smallint    NOT NULL,
  issued_at           timestamptz NOT NULL,
  expires_at          timestamptz NOT NULL,
  -- Alıcının EIP-712 imzası (0x + 130 hex).
  recipient_signature text        NOT NULL,
  -- 'open' yalnızca "hâlâ paylaşılabilir" demektir; ödeme yapıldığını
  -- İDDİA ETMEZ. Ödeme kesinleştirme Part 2'dedir.
  status              text        NOT NULL DEFAULT 'open',
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shared_bills_pkey PRIMARY KEY (bill_id),
  CONSTRAINT shared_bills_bill_id_format
    CHECK (bill_id ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT shared_bills_debts_hash_format
    CHECK (debts_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT shared_bills_signature_format
    CHECK (recipient_signature ~ '^0x[0-9a-fA-F]{130}$'),
  CONSTRAINT shared_bills_recipient_format
    CHECK (recipient_address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT shared_bills_debt_count_positive
    CHECK (debt_count > 0 AND debt_count <= 50),
  CONSTRAINT shared_bills_window_ordered
    CHECK (expires_at > issued_at),
  -- Ömür üst sınırı ikinci savunma hattı olarak burada da uygulanır.
  CONSTRAINT shared_bills_lifetime_max_7_days
    CHECK (expires_at <= issued_at + interval '7 days'),
  CONSTRAINT shared_bills_status_known
    CHECK (status IN ('open', 'closed')),
  CONSTRAINT shared_bills_label_bounded
    CHECK (char_length(recipient_label) BETWEEN 1 AND 40)
);

-- Süresi dolmuş hesapların fiziksel temizliği Part 2'ye ertelenmiştir;
-- sorgular her hâlükârda `expires_at` filtresi uygular.
CREATE INDEX IF NOT EXISTS shared_bills_expires_at_idx
  ON shared_bills (expires_at);

CREATE TABLE IF NOT EXISTS shared_bill_debts (
  bill_id        text        NOT NULL,
  debtor_address text        NOT NULL,
  debtor_label   text        NOT NULL,
  -- Borcun kararlı kimliği ("<borçlu>-><alacaklı>").
  debt_key       text        NOT NULL,
  -- TRY minor unit. TAM SAYI: kayan nokta ASLA kullanılmaz.
  try_minor      numeric(30, 0) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shared_bill_debts_bill_fk
    FOREIGN KEY (bill_id) REFERENCES shared_bills (bill_id) ON DELETE CASCADE,
  CONSTRAINT shared_bill_debts_amount_positive
    CHECK (try_minor > 0),
  CONSTRAINT shared_bill_debts_amount_integral
    CHECK (try_minor = trunc(try_minor)),
  CONSTRAINT shared_bill_debts_debtor_format
    CHECK (debtor_address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT shared_bill_debts_label_bounded
    CHECK (char_length(debtor_label) BETWEEN 1 AND 40),
  CONSTRAINT shared_bill_debts_key_bounded
    CHECK (char_length(debt_key) BETWEEN 1 AND 120),
  -- Bir borçlu hesap başına EN FAZLA BİR KEZ görünebilir.
  CONSTRAINT shared_bill_debts_unique_debtor
    UNIQUE (bill_id, debtor_address),
  -- Borç kimliği de hesap başına benzersizdir.
  CONSTRAINT shared_bill_debts_unique_key
    UNIQUE (bill_id, debt_key)
);

CREATE INDEX IF NOT EXISTS shared_bill_debts_bill_idx
  ON shared_bill_debts (bill_id);

COMMIT;
