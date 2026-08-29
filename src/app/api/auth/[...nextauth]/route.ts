import { resolveAuthenticationRuntime } from "@/auth";
import { createOAuthHandler } from "@/lib/auth/oauth-handler";

export const GET = createOAuthHandler("GET", resolveAuthenticationRuntime);
export const POST = createOAuthHandler("POST", resolveAuthenticationRuntime);
