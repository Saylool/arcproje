import { readDatabaseUrl, type DatabaseEnv } from "@/lib/db/env";

import type {
  AppUser,
  AppUserRepository,
  UpsertAppUserInput,
} from "./app-user-repository";

const UPSERT_GOOGLE_USER = `
INSERT INTO app_users (
  user_id, provider, provider_account_id, normalized_email, email_verified,
  display_name, avatar_url
) VALUES ($1::uuid, 'google', $2, $3, TRUE, $4, $5)
ON CONFLICT (provider, provider_account_id) DO UPDATE SET
  normalized_email = EXCLUDED.normalized_email,
  email_verified = TRUE,
  display_name = EXCLUDED.display_name,
  avatar_url = EXCLUDED.avatar_url,
  updated_at = now()
RETURNING user_id::text, provider, provider_account_id, normalized_email,
          email_verified, display_name, avatar_url
`;

type AppUserRow = Record<string, unknown>;

function rowToAppUser(row: AppUserRow | undefined): AppUser | null {
  if (
    row === undefined ||
    typeof row.user_id !== "string" ||
    row.provider !== "google" ||
    typeof row.provider_account_id !== "string" ||
    typeof row.normalized_email !== "string" ||
    row.email_verified !== true
  ) {
    return null;
  }
  return Object.freeze({
    id: row.user_id,
    provider: "google",
    providerAccountId: row.provider_account_id,
    normalizedEmail: row.normalized_email,
    emailVerified: true,
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    avatarUrl: typeof row.avatar_url === "string" ? row.avatar_url : null,
  });
}

/**
 * Üretim deposu yalnızca Neon'dur. Yapılandırma/sürücü yoksa `null` döner;
 * bellek içi depoya sessiz düşüş yoktur.
 */
export async function createNeonAppUserRepository(
  env: DatabaseEnv = process.env,
): Promise<AppUserRepository | null> {
  const database = readDatabaseUrl(env);
  if (!database.ok) return null;

  let sql: Awaited<ReturnType<typeof import("@neondatabase/serverless").neon>>;
  try {
    const { neon } = await import("@neondatabase/serverless");
    sql = neon(database.url);
  } catch {
    return null;
  }

  return Object.freeze({
    async upsertGoogleUser(input: UpsertAppUserInput) {
      try {
        const rows = (await sql.query(UPSERT_GOOGLE_USER, [
          input.proposedUserId,
          input.providerAccountId,
          input.normalizedEmail,
          input.displayName,
          input.avatarUrl,
        ])) as AppUserRow[];
        const user = rowToAppUser(rows[0]);
        return user === null
          ? { ok: false as const, reason: "unavailable" as const }
          : { ok: true as const, user };
      } catch {
        return { ok: false as const, reason: "unavailable" as const };
      }
    },
  });
}
