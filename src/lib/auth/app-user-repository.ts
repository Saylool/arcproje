/**
 * Google kimliği ile uygulama kullanıcısı arasındaki SUNUCU sınırı.
 *
 * E-posta yalnızca değişebilir profil metadatasıdır. Yetkilendirme kimliği
 * her zaman `provider + providerAccountId` çiftidir.
 */

export type AuthProvider = "google";

export type AppUser = Readonly<{
  id: string;
  provider: AuthProvider;
  providerAccountId: string;
  normalizedEmail: string;
  emailVerified: true;
  displayName: string | null;
  avatarUrl: string | null;
}>;

export type UpsertAppUserInput = Readonly<{
  proposedUserId: string;
  provider: AuthProvider;
  providerAccountId: string;
  normalizedEmail: string;
  emailVerified: true;
  displayName: string | null;
  avatarUrl: string | null;
}>;

export type UpsertAppUserOutcome =
  | { ok: true; user: AppUser }
  | { ok: false; reason: "unavailable" | "constraint" };

export type AppUserRepository = Readonly<{
  /**
   * İlk girişte yaratır; aynı Google hesabının eşzamanlı girişlerini tek
   * kullanıcıya çözer. E-posta çakışması hiçbir zaman hesap birleştirmez.
   */
  upsertGoogleUser(input: UpsertAppUserInput): Promise<UpsertAppUserOutcome>;
}>;
