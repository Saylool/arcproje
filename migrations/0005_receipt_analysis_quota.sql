-- ---------------------------------------------------------------------------
-- 0005 — Fiş analizi kotası (OpenAI maliyet sınırı)
--
-- Bu geçiş yalnızca gözden geçirilip daha sonra ELLE uygulanır. Uygulama
-- istekleri şemayı tembel biçimde oluşturmaz.
--
-- >>> SIRA ÖNEMLİDİR: BU GEÇİŞ, KODDAN ÖNCE UYGULANMALIDIR. <<<
--
-- Kod geçişten önce dağıtılırsa fiş analizi hata verir. (Ödeme ve ortak hesap
-- akışları ETKİLENMEZ: bu tablo yalnızca analiz ucunu ilgilendirir.)
--
-- NEDEN VAR
--
-- Google girişi vardı ama sayı sınırı yoktu: oturum açmış bir kullanıcı
-- istediği kadar analiz çağırabiliyordu ve her çağrı OpenAI'de gerçek para
-- harcıyor. Üst sınırı olmayan tek maliyet buydu.
--
-- İKİ FARKLI İŞ, İKİ FARKLI SAYAÇ
--
-- Kullanıcı başına kota ADALET içindir: bir kişi diğerlerinin hakkını yiyemez.
-- Ama Google hesabı açmak bedava ve sınırsızdır; tek başına faturayı korumaz.
--
-- Genel tavan FATURAYI korur: hesap sayısından bağımsız olarak günlük toplam
-- sınırdır. İkisi aynı tabloda, `quota_key` ile ayrılır.
--
-- ANAHTAR ÇAKIŞMASI YOK: kullanıcı satırları `app_users.user_id` (uuid
-- biçimi), genel satır ise `@global`. Bir uuid asla `@` ile başlamaz.
--
-- YABANCI ANAHTAR YOK — bilerek. `app_users`a bağlansaydı genel satır
-- yazılamazdı. Ayrıca hesabını silen biri zaten yeni bir `user_id` ile
-- döneceği için kotası her hâlükârda sıfırlanır; bunu engellemenin tek yolu
-- e-postayı saklamak olurdu ve bu gizlilik açısından daha kötüdür.
--
-- GÜN ALANI UYGULAMADAN GELİR. `current_date` sunucunun saat dilimine bağlıdır;
-- sınırın hangi anda sıfırlandığı sunucu ayarına bırakılmaz.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS receipt_analysis_quota (
    quota_key text NOT NULL,
    day       date NOT NULL,
    used      integer NOT NULL DEFAULT 0,

    CONSTRAINT receipt_analysis_quota_pkey PRIMARY KEY (quota_key, day),

    -- Sayaç geriye gidemez.
    CONSTRAINT receipt_analysis_quota_used_non_negative CHECK (used >= 0),

    -- Anahtar ya bir uuid ya da genel satırdır; başka bir şey yazılamaz.
    CONSTRAINT receipt_analysis_quota_key_shape CHECK (
        quota_key = '@global'
        OR quota_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
);

/*
 * Eski günlerin temizliği için. Kota satırları küçüktür ama sonsuza kadar
 * birikmeleri gerekmez.
 */
CREATE INDEX IF NOT EXISTS receipt_analysis_quota_day_idx
    ON receipt_analysis_quota (day);

COMMIT;
