import type {
  AppUser,
  AppUserRepository,
  UpsertAppUserInput,
  UpsertAppUserOutcome,
} from "./app-user-repository";

export type FakeAppUserRepository = AppUserRepository & {
  readonly users: ReadonlyMap<string, AppUser>;
  readonly calls: number;
  failWithUnavailable: boolean;
};

function identityKey(input: Pick<UpsertAppUserInput, "provider" | "providerAccountId">) {
  return `${input.provider}\u0000${input.providerAccountId}`;
}

/** Yalnızca testler için; üretim kodu bu depoya hiçbir zaman düşmez. */
export function createFakeAppUserRepository(): FakeAppUserRepository {
  const users = new Map<string, AppUser>();
  let calls = 0;

  const repository: FakeAppUserRepository = {
    users,
    failWithUnavailable: false,
    get calls() {
      return calls;
    },
    async upsertGoogleUser(
      input: UpsertAppUserInput,
    ): Promise<UpsertAppUserOutcome> {
      calls += 1;
      if (repository.failWithUnavailable) {
        return { ok: false, reason: "unavailable" };
      }

      /*
       * Bu kritik bölümde `await` yoktur. Aynı hesapla eşzamanlı iki çağrıdan
       * ilki haritaya yazar, ikincisi aynı kullanıcı kimliğini okur.
       */
      const key = identityKey(input);
      const existing = users.get(key);
      const user: AppUser = Object.freeze({
        id: existing?.id ?? input.proposedUserId,
        provider: "google",
        providerAccountId: input.providerAccountId,
        normalizedEmail: input.normalizedEmail,
        emailVerified: true,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
      });
      users.set(key, user);
      return { ok: true, user };
    },
  };

  return repository;
}
