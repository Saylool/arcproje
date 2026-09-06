-- ---------------------------------------------------------------------------
-- 0006 — Dış sağlayıcı çağrı bütçesi (örnekler arası oran sınırlama)
--
-- Bu geçiş yalnızca gözden geçirilip daha sonra ELLE uygulanır. Uygulama
-- istekleri şemayı tembel biçimde oluşturmaz.
--
--   psql "$DATABASE_URL" -f migrations/0006_provider_call_budget.sql
--
-- NEDEN VAR: kur servisinin önbelleği, tek uçuşu ve soğuması SÜREÇ İÇİDİR.
-- Vercel'de her soğuk başlangıç ve her eşzamanlı sunucusuz örnek kendi
-- kopyasını taşır, bu yüzden toplam CoinGecko hızını hiçbir şey sınırlamaz.
-- Bu tablo, yukarı akış çağrılarını bütün örnekler adına TEK yerde sayar.
--
-- NE SAYILIR: yalnızca GERÇEKTEN yapılan sağlayıcı çağrıları. Önbellekten
-- karşılanan istekler buraya hiç uğramaz; sayaç kullanıcı isteğiyle değil,
-- harcanan krediyle orantılıdır.
--
-- GİZLİLİK: burada kullanıcıya ait hiçbir şey yoktur. Satırlar yalnızca
-- sağlayıcı adı, zaman kovası ve bir sayaçtır.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS provider_call_budget (
    /* Sağlayıcı adı; bugün yalnızca 'coingecko'. */
    provider_key text   NOT NULL,

    /*
     * Pencerenin başlangıcı, Unix DAKİKA olarak (floor(epoch / 60)).
     *
     * Neden bigint ve neden dakika: sayaç sabit genişlikte kovalara düşsün
     * diye. `timestamptz` + `date_trunc` de olurdu, ama tam sayı kova
     * hesabı sunucu saat dilimine ve tür dönüşümüne hiç bağlı değildir —
     * aynı hesap hem SQL'de hem TypeScript'te birebir yapılabilir.
     */
    window_start bigint NOT NULL,

    used         integer NOT NULL DEFAULT 0,

    CONSTRAINT provider_call_budget_pkey PRIMARY KEY (provider_key, window_start),
    CONSTRAINT provider_call_budget_used_non_negative CHECK (used >= 0),
    CONSTRAINT provider_call_budget_window_non_negative CHECK (window_start >= 0),
    CONSTRAINT provider_call_budget_key_shape CHECK (provider_key ~ '^[a-z0-9_-]{1,32}$')
);

/*
 * Eski kovaların temizliği için. Satırlar küçüktür ama sonsuza kadar
 * birikmeleri gerekmez; `receipt_analysis_quota` ile aynı gerekçe.
 */
CREATE INDEX IF NOT EXISTS provider_call_budget_window_idx
    ON provider_call_budget (window_start);

COMMIT;
