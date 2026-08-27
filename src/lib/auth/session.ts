export type AuthenticatedAppUser = Readonly<{
  id: string;
  name: string | null;
  image: string | null;
}>;

export type AuthenticateRequest = () => Promise<AuthenticatedAppUser | null>;

/** Sunucu oturumundan yalnızca güvenli, minimal uygulama kimliğini çıkarır. */
export const authenticateRequest: AuthenticateRequest = async () => {
  try {
    /* Test taşıma katmanı Auth.js/NextRequest modüllerini yüklemek zorunda kalmaz. */
    const { auth } = await import("@/auth");
    const session = await auth();
    const sessionUser = session?.user;
    const id = sessionUser?.id;
    if (sessionUser === undefined || typeof id !== "string" || id.length === 0) {
      return null;
    }
    return {
      id,
      name: typeof sessionUser.name === "string" ? sessionUser.name : null,
      image: typeof sessionUser.image === "string" ? sessionUser.image : null,
    };
  } catch {
    // Eksik/bozuk auth veya veritabanı yapılandırması fail-closed kalır.
    return null;
  }
};
