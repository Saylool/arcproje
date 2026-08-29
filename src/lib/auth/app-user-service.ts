import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  AppUser,
  AppUserRepository,
  UpsertAppUserInput,
} from "./app-user-repository";

const EMAIL_SCHEMA = z.string().trim().toLowerCase().email().max(320);
const PROVIDER_ACCOUNT_ID_SCHEMA = z.string().trim().min(1).max(255);

export type GoogleIdentityInput = Readonly<{
  provider: unknown;
  providerAccountId: unknown;
  email: unknown;
  emailVerified: unknown;
  displayName?: unknown;
  avatarUrl?: unknown;
}>;

export type ResolveGoogleIdentityOutcome =
  | { ok: true; user: AppUser }
  | { ok: false; reason: "invalid" | "unverified" | "unavailable" };

function optionalDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 120 ? normalized : null;
}

function optionalAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Doğrulanmış Google profilini minimal uygulama kaydına çözer.
 * Sağlayıcı kimliği veya profil verisi hiçbir hata mesajına ya da loga girmez.
 */
export async function resolveGoogleIdentity(
  input: GoogleIdentityInput,
  repository: AppUserRepository,
  createUserId: () => string = randomUUID,
): Promise<ResolveGoogleIdentityOutcome> {
  if (input.provider !== "google") {
    return { ok: false, reason: "invalid" };
  }
  if (input.emailVerified !== true) {
    return { ok: false, reason: "unverified" };
  }

  const account = PROVIDER_ACCOUNT_ID_SCHEMA.safeParse(input.providerAccountId);
  const email = EMAIL_SCHEMA.safeParse(input.email);
  if (!account.success || !email.success) {
    return { ok: false, reason: "invalid" };
  }

  const record: UpsertAppUserInput = {
    proposedUserId: createUserId(),
    provider: "google",
    providerAccountId: account.data,
    normalizedEmail: email.data,
    emailVerified: true,
    displayName: optionalDisplayName(input.displayName),
    avatarUrl: optionalAvatarUrl(input.avatarUrl),
  };

  const result = await repository.upsertGoogleUser(record);
  return result.ok
    ? result
    : { ok: false, reason: "unavailable" };
}
