"use server";

import { signIn, signOut } from "@/auth";

export async function startGoogleSignIn() {
  await signIn("google", { redirectTo: "/" });
}

export async function endGoogleSession() {
  await signOut({ redirectTo: "/" });
}
