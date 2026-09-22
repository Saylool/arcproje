import type { NextRequest } from "next/server";

import {
  applyContentSecurityPolicy,
  stampContentSecurityPolicy,
} from "@/lib/security/csp-proxy";
import {
  ALLOWED_COUNTRIES_ENV,
  blockedResponse,
  decideGeo,
  parseAllowedCountries,
} from "@/lib/security/geo-gate";

/**
 * Next 16'nın istek öncesi kancası (eski adıyla middleware).
 *
 * Sıra önemlidir: önce coğrafi kapı, çünkü engellenen bir isteğe sayfa
 * çizdirmenin anlamı yok; sonra CSP, çünkü kapıdan geçen HER yanıt —
 * 451 sayfası dâhil — nonce'lu politikayı taşımalı. Her kural kendi
 * modülünde yaşar, bu dosya yalnızca sıralar.
 *
 * Ortam değişkeni her istekte okunur: ucuz, ve testler onu değiştirebilir.
 */
export function proxy(request: NextRequest) {
  const decision = decideGeo(
    parseAllowedCountries(process.env[ALLOWED_COUNTRIES_ENV]),
    request.headers,
  );
  if (decision.kind === "blocked") {
    return stampContentSecurityPolicy(blockedResponse(request, decision));
  }
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
