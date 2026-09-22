import type { NextRequest } from "next/server";

import { applyContentSecurityPolicy } from "@/lib/security/csp-proxy";

/**
 * Next 16'nın istek öncesi kancası (eski adıyla middleware).
 *
 * Bugün tek görevi CSP'yi her isteğe özgü nonce ile basmak. Coğrafi kapı
 * gibi ileride gelecek kurallar da buraya eklenir; her biri kendi
 * modülünde yaşar, bu dosya yalnızca sıralar.
 */
export function proxy(request: NextRequest) {
  return applyContentSecurityPolicy(request);
}

export const config = {
  matcher: [
    {
      /*
       * API yanıtları JSON'dur, CSP onlara anlamsız; `_next/static` ve
       * `_next/image` değişmez varlıklardır. Geri kalan HER sayfa geçer.
       */
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      /* Ön yükleme (prefetch) istekleri sayfa çizmez; nonce'a gerek yok. */
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
