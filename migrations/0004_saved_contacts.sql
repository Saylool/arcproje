-- ---------------------------------------------------------------------------
-- 0004 — Kayıtlı kişiler (kullanıcının kendi adres defteri)
--
-- Bu geçiş yalnızca gözden geçirilip daha sonra ELLE uygulanır. Uygulama
-- istekleri şemayı tembel biçimde oluşturmaz.
--
-- >>> SIRA ÖNEMLİDİR: BU GEÇİŞ, KODDAN ÖNCE UYGULANMALIDIR. <<<
--
-- Kayıtlı kişileri okuyan ve yazan uçlar bu tabloya atıf yapar. Kod geçişten
-- ÖNCE dağıtılırsa rehber uçları hata verir. (Ödeme ve hesap oluşturma akışı
-- ETKİLENMEZ: bu tablo yalnızca bir giriş kolaylığıdır.)
--
-- BU TABLO YENİ BİR GİZLİLİK YÜZEYİDİR — bilerek.
--
-- 0003 ile gelen sahiplik atfı var olan veriyi okumaktan ibaretti. Burası ise
-- amacı doğrudan "kişi adı → cüzdan adresi" olan KALICI bir kayıttır.
-- Karşılığında kullanıcıya silme hakkı borçluyuz: uygulama tek tek silmeyi ve
-- tümünü silmeyi sunar.
--
-- ON DELETE CASCADE — 0003'ün TERSİ, ve bu bilinçlidir. Orada hesap silinemez
-- çünkü borçlunun hâlâ ödemesi gerekir; başkasının işi ona bağlıdır. Burada
-- ise kayıt YALNIZCA kullanıcının kendi kolaylığıdır: kullanıcı giderse
-- adres defteri de gitmelidir.
--
-- ETİKET KULLANICI BAŞINA BENZERSİZDİR. "Ahmet yaz, adresi gelsin" ancak tek
-- bir Ahmet varsa güvenlidir; belirsizlik burada yanlış adres demektir.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS saved_contacts (
  contact_id uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  -- Kullanıcının verdiği ad. İmzalanan içeriğe GİRMEZ; yalnızca hatırlatmadır.
  label      text        NOT NULL,
  -- Checksum'lı adres, uygulama sınırında normalleştirilmiş olarak gelir.
  address    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT saved_contacts_pkey PRIMARY KEY (contact_id),
  CONSTRAINT saved_contacts_user
    FOREIGN KEY (user_id) REFERENCES app_users (user_id) ON DELETE CASCADE,
  CONSTRAINT saved_contacts_address_format
    CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT saved_contacts_label_bounded
    CHECK (char_length(label) BETWEEN 1 AND 40),
  CONSTRAINT saved_contacts_label_trimmed
    CHECK (label = btrim(label)),
  CONSTRAINT saved_contacts_updated_after_created
    CHECK (updated_at >= created_at)
);

-- Benzersizlik İFADE üzerinedir, bu yüzden tablo kısıtı değil indeks olur.
-- Aynı adres iki kez kaydedilemez; aynı ad iki kişiye verilemez.
CREATE UNIQUE INDEX IF NOT EXISTS saved_contacts_one_address_per_user
  ON saved_contacts (user_id, lower(address));

CREATE UNIQUE INDEX IF NOT EXISTS saved_contacts_one_label_per_user
  ON saved_contacts (user_id, lower(label));

-- Listeleme: kişinin kendi defteri, ada göre sıralı.
CREATE INDEX IF NOT EXISTS saved_contacts_by_user
  ON saved_contacts (user_id, label);

COMMIT;
