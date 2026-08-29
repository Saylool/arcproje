"use server";

import { resolveAuthenticationRuntime } from "@/auth";
import { createAuthenticationActions } from "@/lib/auth/auth-action-service";

const actions = createAuthenticationActions(resolveAuthenticationRuntime);

export async function startGoogleSignIn() {
  await actions.beginGoogleSignIn();
}

export async function endGoogleSession() {
  await actions.endSession();
}
