import { resolveAuthenticationRuntime } from "@/auth";
import { createOAuthHandler } from "@/lib/auth/oauth-handler";

/* Bütçe: Google ile jeton takası. Gerekçe: `function-duration.test.ts`. */
export const maxDuration = 15;

export const GET = createOAuthHandler("GET", resolveAuthenticationRuntime);
export const POST = createOAuthHandler("POST", resolveAuthenticationRuntime);
