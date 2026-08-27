export type AuthenticatedAppUser = Readonly<{
  id: string;
  name: string | null;
  image: string | null;
}>;

export type AuthenticationResult =
  | { status: "authenticated"; user: AuthenticatedAppUser }
  | { status: "signedOut" }
  | { status: "unavailable" };

type ResolveRuntime = () =>
  | import("./auth-runtime").AuthenticationRuntimeResolution
  | Promise<import("./auth-runtime").AuthenticationRuntimeResolution>;

export type AuthenticateRequest = () => Promise<AuthenticationResult>;

const resolveDefaultRuntime: ResolveRuntime = async () => {
  const { resolveAuthenticationRuntime } = await import("@/auth");
  return resolveAuthenticationRuntime();
};

/** Sunucu oturumundan yalnızca güvenli, minimal uygulama kimliğini çıkarır. */
export function createAuthenticateRequest(
  resolveRuntime: ResolveRuntime = resolveDefaultRuntime,
): AuthenticateRequest {
  return async () => {
    const resolved = await resolveRuntime();
    if (resolved.status === "unavailable") {
      return { status: "unavailable" };
    }

    try {
      const session = await resolved.runtime.readSession();
      const sessionUser = session?.user;
      const id = sessionUser?.id;
      if (
        sessionUser === undefined ||
        typeof id !== "string" ||
        id.length === 0
      ) {
        return { status: "signedOut" };
      }
      return {
        status: "authenticated",
        user: {
          id,
          name: typeof sessionUser.name === "string" ? sessionUser.name : null,
          image:
            typeof sessionUser.image === "string" ? sessionUser.image : null,
        },
      };
    } catch {
      return { status: "unavailable" };
    }
  };
}

export const authenticateRequest = createAuthenticateRequest();
