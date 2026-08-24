import { NextResponse } from "next/server";

import { SHARED_BILL_SESSION_COOKIE } from "@/lib/db/shared-bill-access-service";

/**
 * Paylaşılan hesap rotalarının ortak taşıma yardımcıları.
 *
 * Hassas uç noktalar ASLA önbelleklenmez ve hata gövdeleri yalnızca kod +
 * mesaj taşır.
 */

export const NO_STORE_HEADERS = {
  "cache-control": "no-store, private, max-age=0",
} as const;

export const MAX_ACCESS_BODY_BYTES = 8 * 1024;
export const BODY_READ_DEADLINE_MS = 5000;

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: NO_STORE_HEADERS },
  );
}

/**
 * Oturum çerezini başlıktan güvenli biçimde okur.
 *
 * Ham jeton LOGLANMAZ, yanıta konmaz ve yalnızca özeti hesaplanmak üzere
 * servise verilir. Tek bir uygulama vardır; her rota bunu kullanır.
 */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (header === null) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name === SHARED_BILL_SESSION_COOKIE) {
      const value = part.slice(separator + 1).trim();
      return value === "" ? null : value;
    }
  }
  return null;
}

/** Yoldan gelen hesap kimliği; biçim tutmuyorsa `null`. */
export function readBillIdParam(value: unknown): string | null {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

/**
 * Oturum çerezi.
 *
 * `HttpOnly`: JavaScript okuyamaz, bu yüzden XSS ile çalınamaz.
 * `SameSite=Strict`: başka sitelerden gelen isteklerde gönderilmez (CSRF).
 * `Secure`: üretimde zorunlu; geliştirmede localhost HTTP'ye izin verilir.
 * `Path=/`: yalnızca bu uygulamanın yolları.
 */
export function buildSessionCookie(
  token: string,
  maxAgeSeconds: number,
  isProduction: boolean,
): string {
  const parts = [
    `${SHARED_BILL_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isProduction) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/** Oturumu geçersiz kılan çerez. */
export function buildClearedSessionCookie(isProduction: boolean): string {
  return buildSessionCookie("", 0, isProduction);
}
