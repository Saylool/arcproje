import { NextResponse, type NextRequest } from "next/server";

import {
  CSP_NONCE_REQUEST_HEADER,
  buildContentSecurityPolicies,
  generateCspNonce,
} from "./headers";

/**
 * Her isteğe taze bir nonce ile CSP basar.
 *
 * `src/proxy.ts`'in yaptığı tek iş budur; mantık burada durur ki testler
 * gerçek `NextRequest` ile çalıştırabilsin.
 *
 * Nonce ÜÇ yere yazılır ve üçü aynı değerdir:
 *  1. İsteğin `content-security-policy` başlığı — Next kendi önyükleme
 *     script'lerini damgalamak için nonce'u BURADAN okur
 *     (`app-render.js`, `getScriptNonceFromHeader`).
 *  2. İsteğin `x-nonce` başlığı — düzen (`layout.tsx`) tema script'ini
 *     damgalamak için buradan okur.
 *  3. Yanıtın iki CSP başlığı — tarayıcının uyguladığı/ölçtüğü değer.
 *
 * İstemciden gelen `x-nonce` ÜZERİNE YAZILIR, eklenmez: dışarıdan seçilmiş
 * bir nonce, saldırganın kendi script'ini damgalaması demek olurdu.
 */
export function applyContentSecurityPolicy(request: NextRequest): NextResponse {
  const nonce = generateCspNonce();
  const { enforced, reportOnly } = buildContentSecurityPolicies(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_REQUEST_HEADER, nonce);
  requestHeaders.set("content-security-policy", enforced);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", enforced);
  response.headers.set("Content-Security-Policy-Report-Only", reportOnly);
  return response;
}
