import type { NextConfig } from "next";

import { SECURITY_HEADERS } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  /*
   * Güvenlik başlıkları HER yola uygulanır.
   *
   * Değerlerin kendisi `src/lib/security/headers.ts` içindedir; burada
   * yalnızca bağlanır. Testler o dosyayı okuyabilsin diye böyle.
   *
   * CSP burada DEĞİLDİR: isteğe özgü nonce taşır, `src/proxy.ts` basar.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...SECURITY_HEADERS],
      },
    ];
  },
};

export default nextConfig;
