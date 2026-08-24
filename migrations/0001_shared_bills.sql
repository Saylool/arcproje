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
  -- Borç listesinin kanonik MERKLE KÖKÜ (alan ayrılmış, borç sayısına bağlı).
  -- Bir borçlu kendi satırını, diğer satırları görmeden bu köke karşı
  -- doğrulayabilir.
  debts_root          text        NOT NULL,
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
  CONSTRAINT shared_bills_debts_root_format
    CHECK (debts_root ~ '^0x[0-9a-f]{64}$'),
  -- Yalnızca Merkle tabanlı şema kabul edilir; toplu hash'li sürüm 1 değil.
  CONSTRAINT shared_bills_schema_version_supported
    CHECK (schema_version = 2),
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
  -- Satırın KANONİK Merkle indeksi (borçlu adresi artan sırada 0'dan başlar).
  -- Kanıt üretimi için saklanır; sıradan türetilebilir olsa da açıkça tutulur.
  leaf_index     smallint    NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- ---------------------------------------------------------------------
  -- ÖDEME DURUM MAKİNESİ (Part 3)
  --
  --   unpaid ──claim──> reserved ──onaylı makbuz──> paid   (SON)
  --     ^                  │
  --     │                  ├──kanıtlı yayın öncesi hata──> unpaid
  --     │                  ├──onaylı REVERT makbuzu──────> unpaid
  --     └──────────────────┘
  --                        └──belirsiz sonuç────────> review_required
  --
  --   review_required ──onaylı makbuz──> paid
  --   review_required ──OTOMATİK──/──> unpaid   (ASLA; elle mutabakat)
  --   paid ──/──> herhangi bir durum          (ASLA geri dönmez)
  --
  -- SINIR: bu sütun bir UYGULAMA kilididir, zincir üstü tek-kullanım
  -- garantisi DEĞİLDİR. Kullanıcı uygulamanın dışından ikinci bir ERC-20
  -- transferi göndermekte serbesttir; hiçbir satır bunu engelleyemez.
  -- ---------------------------------------------------------------------
  payment_status text        NOT NULL DEFAULT 'unpaid',
  -- Yalnızca SUNUCU tarafında doğrulanmış makbuzla yazılır.
  paid_tx_hash   text,
  paid_at        timestamptz,

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
  -- Bir borçlu hesap başına EN FAZLA BİR KEZ görünebilir. Bu çift aynı
  -- zamanda BİRİNCİL ANAHTARDIR: teklif ve deneme tabloları ona yabancı
  -- anahtarla bağlanır.
  CONSTRAINT shared_bill_debts_pkey PRIMARY KEY (bill_id, debtor_address),
  -- Borç kimliği de hesap başına benzersizdir.
  CONSTRAINT shared_bill_debts_unique_key
    UNIQUE (bill_id, debt_key),
  CONSTRAINT shared_bill_debts_leaf_index_range
    CHECK (leaf_index >= 0 AND leaf_index < 50),
  -- Kanonik indeks hesap başına benzersizdir: iki satır aynı yaprağı
  -- işaret edemez.
  CONSTRAINT shared_bill_debts_unique_leaf_index
    UNIQUE (bill_id, leaf_index),
  CONSTRAINT shared_bill_debts_payment_status_known
    CHECK (payment_status IN ('unpaid', 'reserved', 'paid', 'review_required')),
  CONSTRAINT shared_bill_debts_paid_tx_hash_format
    CHECK (paid_tx_hash IS NULL OR paid_tx_hash ~ '^0x[0-9a-f]{64}$'),
  -- 'paid' ancak DOĞRULANMIŞ bir işlem hash'i ve zamanıyla birlikte olur;
  -- diğer durumlar bu alanları TAŞIYAMAZ.
  CONSTRAINT shared_bill_debts_paid_requires_evidence
    CHECK (
      (payment_status = 'paid'
        AND paid_tx_hash IS NOT NULL AND paid_at IS NOT NULL)
      OR
      (payment_status <> 'paid'
        AND paid_tx_hash IS NULL AND paid_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS shared_bill_debts_bill_idx
  ON shared_bill_debts (bill_id);

-- ---------------------------------------------------------------------------
-- PART 2 — borçlu cüzdan kimlik doğrulaması
--
-- Bu tablolar YALNIZCA "bu adresi kontrol eden kişi kendi borcunu görebilsin"
-- sorusunu çözer. Ödeme denemesi, ödeme başarısı ve işlem kesinleştirme
-- tabloları BİLEREK eklenmemiştir; onlar Part 3'tedir.
--
-- Cüzdan imzası bir KİMLİK/KYC kanıtı DEĞİLDİR ve borcun gerçek dünyada
-- meşru olduğunu KANITLAMAZ; yalnızca adresin kontrolünü kanıtlar.
-- ---------------------------------------------------------------------------

-- Tüketilmiş kimlik doğrulama nonce'ları. Bir nonce YALNIZCA BİR KEZ
-- kullanılabilir; tekrar oynatma burada atomik olarak engellenir.
CREATE TABLE IF NOT EXISTS shared_bill_auth_nonces (
  bill_id        text        NOT NULL,
  nonce          text        NOT NULL,
  debtor_address text        NOT NULL,
  consumed_at    timestamptz NOT NULL DEFAULT now(),
  -- Nonce'un kendi son kullanma anı; süresi dolan satır temizlenebilir.
  expires_at     timestamptz NOT NULL,

  CONSTRAINT shared_bill_auth_nonces_pkey PRIMARY KEY (bill_id, nonce),
  CONSTRAINT shared_bill_auth_nonces_bill_fk
    FOREIGN KEY (bill_id) REFERENCES shared_bills (bill_id) ON DELETE CASCADE,
  CONSTRAINT shared_bill_auth_nonces_nonce_format
    CHECK (nonce ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT shared_bill_auth_nonces_debtor_format
    CHECK (debtor_address ~ '^0x[0-9a-fA-F]{40}$')
);

CREATE INDEX IF NOT EXISTS shared_bill_auth_nonces_expires_at_idx
  ON shared_bill_auth_nonces (expires_at);

-- Kısa ömürlü kimlik doğrulanmış oturumlar.
--
-- HAM OTURUM JETONU ASLA SAKLANMAZ: yalnızca kriptografik özeti tutulur.
-- Veritabanını okuyan biri geçerli bir çerez üretemez.
CREATE TABLE IF NOT EXISTS shared_bill_sessions (
  -- Ham jetonun SHA-256 özeti (0x + 64 hex). Birincil anahtar budur.
  session_hash   text        NOT NULL,
  bill_id        text        NOT NULL,
  debtor_address text        NOT NULL,
  chain_id       bigint      NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,

  CONSTRAINT shared_bill_sessions_pkey PRIMARY KEY (session_hash),
  CONSTRAINT shared_bill_sessions_bill_fk
    FOREIGN KEY (bill_id) REFERENCES shared_bills (bill_id) ON DELETE CASCADE,
  CONSTRAINT shared_bill_sessions_hash_format
    CHECK (session_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT shared_bill_sessions_debtor_format
    CHECK (debtor_address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT shared_bill_sessions_window_ordered
    CHECK (expires_at > created_at),
  -- Oturum ömrü üst sınırı ikinci savunma hattı olarak burada da uygulanır.
  CONSTRAINT shared_bill_sessions_lifetime_max_15_min
    CHECK (expires_at <= created_at + interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS shared_bill_sessions_expires_at_idx
  ON shared_bill_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- PART 3 — ÖDEME TEKLİFİ ve ÖDEME DENEMESİ
--
-- NE SAKLANIR: yalnızca ödemenin ekonomik kimliği — hesap, borçlu, alıcı, TAM
-- SAYI TRY tutarı, kur teklifinin kimliği ve KANONİK kuru, TAM SAYI mikro
-- USDC, zaman penceresi ve doğrulanmış işlem hash'i.
--
-- NE SAKLANMAZ: fiş görseli, ürün satırları, HAM oturum jetonu, HMAC kur
-- etiketi, API anahtarları, cüzdan içi veri ve hesapla ilgisiz katılımcılar.
-- Oturumdan yalnızca ÖZET (`session_hash`) taşınır; ham jeton ASLA yazılmaz.
--
-- SINIR: bu tablolar bir AKILLI SÖZLEŞME DEĞİLDİR. Uygulama düzeyinde
-- yinelenen denemeyi cihazlar arası engellerler; kullanıcının kendi cüzdanından
-- uygulamanın DIŞINDA ikinci bir ERC-20 transferi göndermesini ENGELLEYEMEZLER.
-- ---------------------------------------------------------------------------

-- Sunucunun bastığı YETKİLİ ödeme teklifi.
--
-- İstemci tutar, kur, alıcı veya borç bildirmez: hepsi saklanan hesaptan ve
-- sunucunun kur servisinden gelir. Teklif hazırlamak borcu REZERVE ETMEZ.
CREATE TABLE IF NOT EXISTS shared_bill_payment_offers (
  offer_id         text        NOT NULL,
  bill_id          text        NOT NULL,
  -- Teklifi alan, KİMLİĞİ DOĞRULANMIŞ borçlu.
  debtor_address   text        NOT NULL,
  -- İmzalı manifestten gelen alıcı; istemciden ASLA.
  recipient_address text       NOT NULL,
  -- TAM SAYI TRY minor unit; borç satırından birebir kopyalanır.
  try_minor        numeric(30, 0) NOT NULL,
  -- Kur teklifinin kimliği ve KANONİK rasyonel değeri (pay/payda).
  quote_id         text        NOT NULL,
  rate_numerator   numeric(30, 0) NOT NULL,
  rate_denominator numeric(30, 0) NOT NULL,
  quote_issued_at  timestamptz NOT NULL,
  quote_expires_at timestamptz NOT NULL,
  -- Borç ve kurdan TÜRETİLEN tam sayı mikro USDC.
  micro_usdc       numeric(30, 0) NOT NULL,
  issued_at        timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL,
  -- Teklif bir denemeye dönüştüğünde işaretlenir; İKİNCİ kez kullanılamaz.
  consumed_at      timestamptz,

  CONSTRAINT shared_bill_payment_offers_pkey PRIMARY KEY (offer_id),
  CONSTRAINT shared_bill_payment_offers_bill_fk
    FOREIGN KEY (bill_id) REFERENCES shared_bills (bill_id) ON DELETE CASCADE,
  -- Teklif, hesabın GERÇEK bir borç satırına bağlıdır.
  CONSTRAINT shared_bill_payment_offers_debt_fk
    FOREIGN KEY (bill_id, debtor_address)
    REFERENCES shared_bill_debts (bill_id, debtor_address) ON DELETE CASCADE,
  CONSTRAINT shared_bill_payment_offers_id_format
    CHECK (offer_id ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT shared_bill_payment_offers_quote_id_format
    CHECK (quote_id ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT shared_bill_payment_offers_debtor_format
    CHECK (debtor_address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT shared_bill_payment_offers_recipient_format
    CHECK (recipient_address ~ '^0x[0-9a-fA-F]{40}$'),
  -- Alıcı kendi kendine borçlu olamaz.
  CONSTRAINT shared_bill_payment_offers_not_self
    CHECK (lower(debtor_address) <> lower(recipient_address)),
  CONSTRAINT shared_bill_payment_offers_amounts_positive
    CHECK (try_minor > 0 AND micro_usdc > 0 AND rate_numerator > 0),
  CONSTRAINT shared_bill_payment_offers_amounts_integral
    CHECK (
      try_minor = trunc(try_minor)
      AND micro_usdc = trunc(micro_usdc)
      AND rate_numerator = trunc(rate_numerator)
    ),
  -- Payda KANONİK ondalıktır: 10^0 .. 10^6. Başka bir payda uygulamanın
  -- üretmediği bir kur demektir.
  CONSTRAINT shared_bill_payment_offers_rate_denominator_canonical
    CHECK (rate_denominator IN (1, 10, 100, 1000, 10000, 100000, 1000000)),
  CONSTRAINT shared_bill_payment_offers_window_ordered
    CHECK (expires_at > issued_at AND quote_expires_at > quote_issued_at),
  -- TEKLİF, DAYANDIĞI KURDAN UZUN YAŞAYAMAZ.
  CONSTRAINT shared_bill_payment_offers_within_quote
    CHECK (expires_at <= quote_expires_at),
  -- Kur teklifi ömrü üst sınırı (5 dk) ikinci savunma hattı olarak burada da.
  CONSTRAINT shared_bill_payment_offers_lifetime_max_5_min
    CHECK (expires_at <= issued_at + interval '5 minutes')
);

CREATE INDEX IF NOT EXISTS shared_bill_payment_offers_expires_at_idx
  ON shared_bill_payment_offers (expires_at);
CREATE INDEX IF NOT EXISTS shared_bill_payment_offers_debtor_idx
  ON shared_bill_payment_offers (bill_id, debtor_address);

-- Borcu REZERVE EDEN ödeme denemesi.
--
--   reserved ──istemci hash bildirdi──> submitted
--   reserved ──kanıtlı yayın öncesi hata──> released      (SON)
--   reserved ──belirsiz, hash yok────────> unknown        (SON)
--   reserved | submitted ──onaylı makbuz──> confirmed     (SON)
--   reserved | submitted ──revert makbuzu─> reverted      (SON)
--   reserved | submitted ──çözülemedi─────> unknown       (SON)
--
-- `confirmed`, `reverted`, `unknown` ve `released` SON durumlardır; hiçbiri
-- kendiliğinden başka bir duruma geçmez.
CREATE TABLE IF NOT EXISTS shared_bill_payment_attempts (
  attempt_id       text        NOT NULL,
  bill_id          text        NOT NULL,
  debtor_address   text        NOT NULL,
  recipient_address text       NOT NULL,
  offer_id         text        NOT NULL,
  quote_id         text        NOT NULL,
  rate_numerator   numeric(30, 0) NOT NULL,
  rate_denominator numeric(30, 0) NOT NULL,
  try_minor        numeric(30, 0) NOT NULL,
  micro_usdc       numeric(30, 0) NOT NULL,
  -- Denemeyi kuran oturumun ÖZETİ. Ham jeton ASLA saklanmaz.
  session_hash     text        NOT NULL,
  status           text        NOT NULL DEFAULT 'reserved',
  -- İstemcinin bildirdiği ya da makbuzdan doğrulanan işlem hash'i.
  tx_hash          text,
  reserved_at      timestamptz NOT NULL,
  -- Rezervasyonun kendi son kullanma anı (teklifin bitişi).
  expires_at       timestamptz NOT NULL,
  -- SUNUCU tarafında makbuz doğrulandığı an.
  confirmed_at     timestamptz,
  settled_at       timestamptz,

  CONSTRAINT shared_bill_payment_attempts_pkey PRIMARY KEY (attempt_id),
  CONSTRAINT shared_bill_payment_attempts_bill_fk
    FOREIGN KEY (bill_id) REFERENCES shared_bills (bill_id) ON DELETE CASCADE,
  CONSTRAINT shared_bill_payment_attempts_debt_fk
    FOREIGN KEY (bill_id, debtor_address)
    REFERENCES shared_bill_debts (bill_id, debtor_address) ON DELETE CASCADE,
  CONSTRAINT shared_bill_payment_attempts_offer_fk
    FOREIGN KEY (offer_id)
    REFERENCES shared_bill_payment_offers (offer_id) ON DELETE RESTRICT,
  CONSTRAINT shared_bill_payment_attempts_id_format
    CHECK (attempt_id ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT shared_bill_payment_attempts_quote_id_format
    CHECK (quote_id ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT shared_bill_payment_attempts_session_hash_format
    CHECK (session_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT shared_bill_payment_attempts_debtor_format
    CHECK (debtor_address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT shared_bill_payment_attempts_recipient_format
    CHECK (recipient_address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT shared_bill_payment_attempts_not_self
    CHECK (lower(debtor_address) <> lower(recipient_address)),
  CONSTRAINT shared_bill_payment_attempts_amounts_positive
    CHECK (try_minor > 0 AND micro_usdc > 0 AND rate_numerator > 0),
  CONSTRAINT shared_bill_payment_attempts_amounts_integral
    CHECK (
      try_minor = trunc(try_minor)
      AND micro_usdc = trunc(micro_usdc)
      AND rate_numerator = trunc(rate_numerator)
    ),
  CONSTRAINT shared_bill_payment_attempts_rate_denominator_canonical
    CHECK (rate_denominator IN (1, 10, 100, 1000, 10000, 100000, 1000000)),
  CONSTRAINT shared_bill_payment_attempts_status_known
    CHECK (status IN
      ('reserved', 'submitted', 'confirmed', 'reverted', 'unknown', 'released')),
  CONSTRAINT shared_bill_payment_attempts_tx_hash_format
    CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT shared_bill_payment_attempts_window_ordered
    CHECK (expires_at > reserved_at),
  -- ONAY, DOĞRULANMIŞ BİR HASH OLMADAN YAZILAMAZ.
  CONSTRAINT shared_bill_payment_attempts_confirmed_requires_hash
    CHECK (
      status <> 'confirmed'
      OR (tx_hash IS NOT NULL AND confirmed_at IS NOT NULL)
    ),
  -- Revert de zincire ulaşmış bir işlemdir: hash'i olmalıdır.
  CONSTRAINT shared_bill_payment_attempts_reverted_requires_hash
    CHECK (status <> 'reverted' OR tx_hash IS NOT NULL),
  -- SERBEST BIRAKILAN deneme hiçbir koşulda bir hash TAŞIYAMAZ: hash varsa
  -- bir şey zincire gitmiş olabilir ve rezervasyon açılamaz.
  CONSTRAINT shared_bill_payment_attempts_released_has_no_hash
    CHECK (status <> 'released' OR tx_hash IS NULL)
);

-- BİR BORÇLU İÇİN AYNI ANDA EN FAZLA BİR AKTİF DENEME.
--
-- Aktif = rezervasyonu HÂLÂ TUTAN durumlar. `unknown` de aktiftir: belirsiz
-- bir deneme kendiliğinden serbest bırakılmaz, yerine yenisi açılamaz.
-- Cihaz/oturum fark etmez; kısıt veritabanı düzeyindedir.
CREATE UNIQUE INDEX IF NOT EXISTS shared_bill_payment_attempts_unique_active
  ON shared_bill_payment_attempts (bill_id, debtor_address)
  WHERE status IN ('reserved', 'submitted', 'unknown');

-- BİR İŞLEM HASH'İ EN FAZLA BİR DENEMEYE AİT OLABİLİR (küresel).
-- Aynı hash ikinci bir borcu kapatmak için kullanılamaz.
CREATE UNIQUE INDEX IF NOT EXISTS shared_bill_payment_attempts_unique_tx_hash
  ON shared_bill_payment_attempts (tx_hash)
  WHERE tx_hash IS NOT NULL;

-- Bir teklif EN FAZLA BİR denemeye dönüşebilir.
CREATE UNIQUE INDEX IF NOT EXISTS shared_bill_payment_attempts_unique_offer
  ON shared_bill_payment_attempts (offer_id);

CREATE INDEX IF NOT EXISTS shared_bill_payment_attempts_debtor_idx
  ON shared_bill_payment_attempts (bill_id, debtor_address);
CREATE INDEX IF NOT EXISTS shared_bill_payment_attempts_expires_at_idx
  ON shared_bill_payment_attempts (expires_at);

COMMIT;
