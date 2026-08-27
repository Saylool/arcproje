import NextAuth from "next-auth";

import { createAuthConfig } from "@/lib/auth/auth-config";

export const { handlers, auth, signIn, signOut } = NextAuth(createAuthConfig());
