import type { AuthenticationConfigurationResult } from "./auth-runtime-config";

export type AuthenticationSession = Readonly<{
  user?: Readonly<{
    id?: string;
    name?: string | null;
    image?: string | null;
  }>;
}> | null;

export type OperationalAuthenticationRuntime = Readonly<{
  handle(method: "GET" | "POST", request: Request): Promise<Response>;
  readSession(): Promise<AuthenticationSession>;
  beginGoogleSignIn(): Promise<unknown>;
  endSession(): Promise<unknown>;
}>;

export type AuthenticationRuntimeResolution =
  | { status: "ready"; runtime: OperationalAuthenticationRuntime }
  | { status: "unavailable" };

type RuntimeResolverDependencies = Readonly<{
  readConfiguration: () => AuthenticationConfigurationResult;
  initialize: (
    configuration: Extract<
      AuthenticationConfigurationResult,
      { ok: true }
    >["configuration"],
  ) => OperationalAuthenticationRuntime;
}>;

/**
 * Geçerli yapılandırmayı ilk kullanımda bir kez başlatır ve önbellekler.
 * Geçersiz yapılandırma başlatıcıya hiçbir zaman ulaşmaz.
 */
export function createAuthenticationRuntimeResolver(
  dependencies: RuntimeResolverDependencies,
): () => AuthenticationRuntimeResolution {
  let cached: OperationalAuthenticationRuntime | undefined;

  return () => {
    if (cached !== undefined) {
      return { status: "ready", runtime: cached };
    }

    const resolved = dependencies.readConfiguration();
    if (!resolved.ok) {
      return { status: "unavailable" };
    }

    try {
      cached = dependencies.initialize(resolved.configuration);
      return { status: "ready", runtime: cached };
    } catch {
      return { status: "unavailable" };
    }
  };
}
