import "next-auth";

declare module "next-auth" {
  interface User {
    /** Auth.js'nin geçici OAuth kullanıcı kimliği. */
    id: string;
    /** Uygulamanın opak iç kullanıcı kimliği; Google `sub` değeri değildir. */
    appUserId?: string;
  }

  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
