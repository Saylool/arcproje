-- ---------------------------------------------------------------------------
-- 0002 — Uygulama kullanıcıları (Google kimlik eşlemesi)
--
-- Bu geçiş yalnızca gözden geçirilip daha sonra ELLE uygulanır. Uygulama
-- istekleri şemayı tembel biçimde oluşturmaz.
--
-- Kimlik anahtarı e-posta DEĞİLDİR. Google'ın kararlı provider hesap kimliği
-- (`sub`) yalnızca sunucudaki bu eşlemede tutulur; tarayıcıya gönderilmez.
-- OAuth access, refresh ve ID tokenları bu tabloda veya başka bir uygulama
-- tablosunda SAKLANMAZ.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS app_users (
  user_id             uuid        NOT NULL,
  provider            text        NOT NULL,
  provider_account_id text        NOT NULL,
  normalized_email    text        NOT NULL,
  email_verified      boolean     NOT NULL,
  display_name        text,
  avatar_url          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_users_pkey PRIMARY KEY (user_id),
  CONSTRAINT app_users_provider_google_only CHECK (provider = 'google'),
  CONSTRAINT app_users_provider_account_id_bounded
    CHECK (char_length(provider_account_id) BETWEEN 1 AND 255),
  CONSTRAINT app_users_email_normalized
    CHECK (
      char_length(normalized_email) BETWEEN 3 AND 320
      AND normalized_email = lower(btrim(normalized_email))
    ),
  CONSTRAINT app_users_email_must_be_verified CHECK (email_verified),
  CONSTRAINT app_users_display_name_bounded
    CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT app_users_avatar_url_bounded
    CHECK (avatar_url IS NULL OR char_length(avatar_url) BETWEEN 1 AND 2048),
  CONSTRAINT app_users_updated_after_created CHECK (updated_at >= created_at),
  CONSTRAINT app_users_provider_account_unique
    UNIQUE (provider, provider_account_id)
);

COMMIT;
