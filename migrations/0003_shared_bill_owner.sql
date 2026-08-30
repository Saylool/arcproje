-- ---------------------------------------------------------------------------
-- 0003 — Hesabı oluşturan uygulama kullanıcısı (sahiplik atfı)
--
-- Bu geçiş yalnızca gözden geçirilip daha sonra ELLE uygulanır. Uygulama
-- istekleri şemayı tembel biçimde oluşturmaz.
--
-- >>> SIRA ÖNEMLİDİR: BU GEÇİŞ, KODDAN ÖNCE UYGULANMALIDIR. <<<
--
-- Hesap yazan `INSERT` artık `created_by_user_id` sütununa atıf yapar. Kod
-- geçişten ÖNCE dağıtılırsa sütun bulunamaz ve HESAP OLUŞTURMA TÜMÜYLE
-- KIRILIR — yalnızca yeni özellik değil, hâlihazırda çalışan akış da durur.
-- Sessiz bir yedeğe bilerek düşülmez: uygulanmamış bir geçiş görünür
-- olmalıdır, gizlenmemelidir.
--
-- SAHİPLİK İMZALANAN İÇERİĞİN PARÇASI DEĞİLDİR. `created_by_user_id` alıcının
-- EIP-712 manifestine, Merkle yapraklarına, borç taahhüdüne, meydan okuma
-- etiketine veya hesap kimliğine GİRMEZ. Bu sütun eklendikten sonra da aynı
-- girdi için imzalanan baytlar birebir aynıdır.
--
-- SAHİPLİK ÖDEME YETKİSİ DEĞİLDİR. Parayı hareket ettiren tek yetki borçlunun
-- kendi cüzdan imzasıdır; alacaklı yetkisi ise imzalı manifesttedir. Bu sütun
-- hiçbir ödeme yolunda OKUNMAZ; yalnızca "bu hesabı hangi uygulama kullanıcısı
-- oluşturdu" sorusunu yanıtlar.
--
-- NULL SERBESTTİR. Bu geçişten ÖNCE oluşturulmuş hesapların sahibi yoktur ve
-- geriye dönük doldurulmaz. Borçlunun ödeme yapabilmesi hesabın bir sahibi
-- olmasına ASLA bağlanmaz.
--
-- ON DELETE SET NULL: bir uygulama kullanıcısı silinse bile borçlunun hâlâ
-- ödemesi gereken hesap SİLİNMEZ; yalnızca atıf düşer.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE shared_bills
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid;

-- `ADD CONSTRAINT` için IF NOT EXISTS yoktur; geçiş tekrar çalıştırılabilsin
-- diye kısıt varlığı açıkça sorgulanır.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shared_bills_created_by_app_user'
  ) THEN
    ALTER TABLE shared_bills
      ADD CONSTRAINT shared_bills_created_by_app_user
      FOREIGN KEY (created_by_user_id) REFERENCES app_users (user_id)
      ON DELETE SET NULL;
  END IF;
END
$do$;

-- Sahibine göre listeleme: en yeni hesap önce. Sıralama SUNUCU zamanına
-- (`created_at`) göredir; `issued_at` istemciden gelir ve sıralamaya esas
-- alınmaz.
CREATE INDEX IF NOT EXISTS shared_bills_created_by_idx
  ON shared_bills (created_by_user_id, created_at DESC);

COMMIT;
