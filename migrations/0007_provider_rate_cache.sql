-- ---------------------------------------------------------------------------
-- 0007 — Paylaşılan sağlayıcı kur önbelleği (örnekler arası SONUÇ paylaşımı)
--
-- Bu geçiş yalnızca gözden geçirilip daha sonra ELLE uygulanır. Uygulama
-- istekleri şemayı tembel biçimde oluşturmaz.
--
-- NEDEN VAR: 0006 ile yukarı akış çağrılarının SAYISI bütün örnekler adına
-- tek yerden sınırlandı, ama o çağrıların SONUCU hâlâ süreç belleğinde
-- kalıyordu. Sonuç paylaşılmayınca limit, korumanın bedelini önbellek
-- isabetiyle değil KULLANICI HATASIYLA ödetiyor: penceredeki krediyi kapan
-- örnekler kuru alıp kendi belleklerine yazarken, aynı anda çalışan diğer
-- örnekler `exhausted` görüp kullanıcıya "kur alınamadı" dönüyor — taze kur
-- yan taraftaki örneğin belleğinde dururken.
--
-- Bu tablo o boşluğu kapatır: son gözlem TEK yerde durur, her örnek okur.
-- Bütçe tablosu KALDIRILMAZ; artık ona çok daha seyrek sıra gelir.
--
-- NE SAKLANIR: sağlayıcı adı, kanonik kur metni ve iki zaman damgası.
-- Satır sayısı sağlayıcı sayısı kadardır — bugün BİR.
--
-- GİZLİLİK: burada kullanıcıya ait hiçbir şey yoktur. Kur herkese açık bir
-- piyasa verisidir; kimin sorduğu yazılmaz.
--
-- SINIR: bu tablo bir DOĞRULAMA SINIRI DEĞİLDİR. Buradan okunan gözlem,
-- süreç içi önbellekten gelenle BİREBİR aynı tazelik kontrolünden geçer
-- (`QUOTE_MAX_OBSERVATION_AGE_MS`); bayat ya da gelecek tarihli bir satır
-- kullanılmaz, atılır. Teklifin kendisi her durumda TAZE basılır: yeni
-- quoteId, yeni issuedAt/expiresAt ve yeni HMAC etiketi.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS provider_rate_cache (
    /* Sağlayıcı adı; bugün yalnızca 'coingecko'. 0006 ile AYNI şekil. */
    provider_key text   NOT NULL,

    /*
     * Kanonik altı ondalıklı kur METNİ, ör. '42.123456'.
     *
     * Sayı olarak DEĞİL metin olarak saklanır: kur uygulama sınırında tek
     * kez kanonikleştirilir ve o andan sonra bütün aritmetik BigInt/rasyonel
     * yolda yapılır. Burada `numeric`e çevirip geri okumak, hiçbir kazancı
     * olmayan ikinci bir dönüşüm noktası açardı.
     *
     * Kısıt, `canonicalizeProviderRate` ile BİREBİR aynı düzenli ifadedir;
     * uygulama sınırından kaçan bir biçim veritabanına da giremez.
     */
    rate_text    text   NOT NULL,

    /*
     * Sağlayıcının BİLDİRDİĞİ gözlem anı (Unix SANİYE).
     *
     * Teklif ömrünü sınırlayan değer budur; yazma anı değil. Yavaş bir
     * yanıtın eski gözlemi, sırf geç yazıldı diye taze sayılamaz.
     */
    observed_at  bigint NOT NULL,

    /*
     * Satırın YAZILDIĞI an (Unix MİLİSANİYE).
     *
     * TTL bu değerden hesaplanır. `observed_at` ile ayrı tutulur çünkü
     * ikisi farklı soruları yanıtlar: biri "veri ne kadar eski", öteki
     * "en son ne zaman çekildi". Milisaniye, TypeScript tarafındaki
     * `Date.now()` ile birebir aynı birim olsun diyedir.
     */
    stored_at    bigint NOT NULL,

    CONSTRAINT provider_rate_cache_pkey PRIMARY KEY (provider_key),
    CONSTRAINT provider_rate_cache_key_shape
        CHECK (provider_key ~ '^[a-z0-9_-]{1,32}$'),
    CONSTRAINT provider_rate_cache_rate_shape
        CHECK (rate_text ~ '^(0|[1-9][0-9]*)\.[0-9]{6}$'),
    CONSTRAINT provider_rate_cache_observed_at_positive
        CHECK (observed_at > 0),
    CONSTRAINT provider_rate_cache_stored_at_positive
        CHECK (stored_at > 0)
);

/*
 * İNDEKS YOK ve gerekmez: tablo sağlayıcı başına TEK satır tutar ve her
 * erişim birincil anahtar üzerindendir.
 *
 * TEMİZLİK GÖREVİ DE YOK — 0005/0006'nın tersine. O tablolar zaman kovası
 * başına satır biriktirdiği için saklama temizliğine muhtaçtı; burada satır
 * eklenmez, YERİNE YAZILIR. Tablo hiç büyümez.
 */

COMMIT;
