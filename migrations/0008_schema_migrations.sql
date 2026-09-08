-- ---------------------------------------------------------------------------
-- 0008 — Uygulanmış geçişlerin kaydı
--
--   npm run migrate -- --apply
--
-- NEDEN VAR: bu dosyaya kadar geçişler ELLE uygulandı ve hangisinin
-- uygulandığını KAYDEDEN hiçbir şey yoktu. Öğrenmenin tek yolu veritabanına
-- bakıp "şu tablo var mı" diye çıkarım yapmaktı.
--
-- Bugüne kadar idare etti çünkü her dosya `CREATE TABLE IF NOT EXISTS`
-- kullanıyor; tekrar çalıştırmak zararsızdı. AMA BU GARANTİ KIRILGAN:
-- `IF NOT EXISTS` var olan bir tabloyu DEĞİŞTİRMEZ. İlk `ALTER TABLE ... ADD
-- COLUMN` yazıldığı gün tekrar çalıştırmak ya düşer ya iki kez uygulanır.
--
-- Onbeş test kullanıcısındayken veritabanı silinip yeniden kurulabilir.
-- Binde kurulamaz.
--
-- CHECKSUM NEDEN VAR: uygulanmış bir dosyanın SONRADAN düzenlendiğini yakalar.
-- Depo ile veritabanının sessizce ayrışması, başka hiçbir kontrolün fark
-- etmediği bir hata sınıfıdır — dosyaya bakan "bu uygulandı" sanır, oysa
-- veritabanında duran o değildir.
--
-- BU TABLO ŞEMANIN PARÇASIDIR ve numaralı bir geçişle gelir; çalıştırıcının
-- kendi kendine yarattığı gizli bir tablo DEĞİLDİR. Yalnızca ilk adımda,
-- kayıt okunabilsin diye, çalıştırıcı tarafından önce uygulanır — ve
-- `IF NOT EXISTS` olduğu için bu tekrar edilebilir.
--
-- GİZLİLİK: burada kullanıcıya ait hiçbir şey yoktur; yalnızca dosya adları,
-- özetler ve zaman damgaları.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    /* Dosya adının başındaki dört hane; sıralamayı ve kimliği o belirler. */
    version    text        NOT NULL,

    /*
     * Tam dosya adı. Sürümden türetilebilir görünür ama türetilmez: bir dosya
     * YENİDEN ADLANDIRILIRSA sürüm aynı kalır ve fark yalnızca burada görülür.
     */
    name       text        NOT NULL,

    /* Dosya içeriğinin SHA-256 özeti, küçük harf hex. */
    checksum   text        NOT NULL,

    applied_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT schema_migrations_pkey PRIMARY KEY (version),
    CONSTRAINT schema_migrations_version_shape
        CHECK (version ~ '^[0-9]{4}$'),
    /* `migrations.test.ts` içindeki dosya adı kalıbıyla AYNI. */
    CONSTRAINT schema_migrations_name_shape
        CHECK (name ~ '^[0-9]{4}_[a-z0-9_]+\.sql$'),
    CONSTRAINT schema_migrations_checksum_shape
        CHECK (checksum ~ '^[0-9a-f]{64}$')
);

/*
 * İNDEKS YOK ve gerekmez: tablo geçiş sayısı kadar satır tutar (bugün sekiz)
 * ve her erişim ya birincil anahtardan ya da tam taramadan yapılır.
 */

COMMIT;
