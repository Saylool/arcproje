import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { SharedBillAccessChallenge } from "@/lib/arc/shared-bill-access";

/**
 * Paylaşılan hesap erişiminin SUNUCU tarafı sırları ve kanonik zarfı.
 * YALNIZCA SUNUCU (`node:crypto` import eder, istemci paketine girmez).
 *
 * İKİ AYRI SIR: kur teklifi `RATE_QUOTE_SECRET` ile imzalanır, erişim
 * meydan okuması `SHARED_BILL_AUTH_SECRET` ile. Sır PAYLAŞILMAZ: birini ele
 * geçiren diğerinin etiketlerini üretemez.
 *
 * Değerlerin kendisi asla loglanmaz, döndürülmez veya hata mesajına konmaz.
 */

export type AuthEnv = Record<string, string | undefined>;

/** Zayıf bir sır sessizce kabul edilmez. */
export const MIN_AUTH_SECRET_LENGTH = 32;

export type AuthSecretProblem = "missing" | "tooShort";

export type AuthSecretResult =
  | { ok: true; secret: string }
  | { ok: false; problem: AuthSecretProblem };

export function readSharedBillAuthSecret(
  env: AuthEnv = process.env,
): AuthSecretResult {
  const secret = env.SHARED_BILL_AUTH_SECRET?.trim();
  if (secret === undefined || secret === "") {
    return { ok: false, problem: "missing" };
  }
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    return { ok: false, problem: "tooShort" };
  }
  return { ok: true, secret };
}

/** Geliştirmede kullanılan AÇIK yerel origin. Üretimde ASLA kullanılmaz. */
export const DEVELOPMENT_APP_ORIGIN = "http://localhost:3000";

export type AppOriginProblem = "missing" | "malformed";

export type AppOriginResult =
  | { ok: true; origin: string }
  | { ok: false; problem: AppOriginProblem };

/**
 * Güvenilen uygulama origin'i.
 *
 * İstemcinin gönderdiği `Host`, `Origin`, `Referer` veya `X-Forwarded-Host`
 * başlıklarına ASLA güvenilmez: hepsi saldırgan tarafından belirlenebilir.
 * Hedef (audience) yalnızca bu sunucu değişkeninden gelir.
 *
 * Üretimde eksik veya bozuk bir değer kontrollü bir 503'e dönüşür; sessizce
 * localhost'a düşülmez.
 */
export function readAppOrigin(
  env: AuthEnv = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): AppOriginResult {
  const raw = env.APP_ORIGIN?.trim();
  if (raw === undefined || raw === "") {
    return nodeEnv === "production"
      ? { ok: false, problem: "missing" }
      : { ok: true, origin: DEVELOPMENT_APP_ORIGIN };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, problem: "malformed" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, problem: "malformed" };
  }
  // Üretimde düz HTTP kabul edilmez.
  if (nodeEnv === "production" && parsed.protocol !== "https:") {
    return { ok: false, problem: "malformed" };
  }
  // Yol, sorgu veya parça taşıyan bir origin kabul edilmez.
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    return { ok: false, problem: "malformed" };
  }
  return { ok: true, origin: parsed.origin };
}

/**
 * Meydan okumanın KANONİK metni.
 *
 * `JSON.stringify` KULLANILMAZ: anahtar sırası ve kaçışlar uygulamadan
 * uygulamaya değişir. Alanlar burada açıkça ve sabit sırayla yazılır; ayraç
 * hiçbir alanın içinde geçemeyecek biçimde seçilir (adres/hex/sayı alanları
 * `\n` içeremez, `audience` uzunluk öneki ile yazılır).
 */
export function serializeChallengeForAuth(
  challenge: SharedBillAccessChallenge,
): string {
  return [
    "HesabiBolSharedBillAccess",
    String(challenge.authVersion),
    challenge.billId.toLowerCase(),
    String(challenge.chainId),
    challenge.debtor.toLowerCase(),
    challenge.nonce.toLowerCase(),
    // Uzunluk öneki: "abc|def" ile "abc" + "|def" ayrımı korunur.
    `${challenge.audience.length}:${challenge.audience}`,
    String(challenge.issuedAt),
    String(challenge.expiresAt),
  ].join("\n");
}

/** Kanonik metnin HMAC-SHA-256 etiketi (0x + 64 küçük hex). */
export function signChallengeTag(
  challenge: SharedBillAccessChallenge,
  secret: string,
): string {
  return `0x${createHmac("sha256", secret)
    .update(serializeChallengeForAuth(challenge), "utf8")
    .digest("hex")}`;
}

const TAG_PATTERN = /^0x[0-9a-f]{64}$/;

export function isValidChallengeTagFormat(value: unknown): value is string {
  return typeof value === "string" && TAG_PATTERN.test(value);
}

/** SABİT ZAMANLI karşılaştırma; erken çıkışla etiket tahmin edilemez. */
export function verifyChallengeTag(
  challenge: SharedBillAccessChallenge,
  tag: unknown,
  secret: string,
): boolean {
  if (!isValidChallengeTagFormat(tag)) {
    return false;
  }
  const expected = Buffer.from(
    signChallengeTag(challenge, secret).slice(2),
    "hex",
  );
  const received = Buffer.from(tag.slice(2), "hex");
  if (expected.length !== received.length) {
    return false;
  }
  return timingSafeEqual(expected, received);
}

/** Kriptografik olarak rastgele tek kullanımlık değer (0x + 64 hex). */
export function createAccessNonce(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

/**
 * Kriptografik olarak rastgele oturum jetonu.
 *
 * HAM jeton YALNIZCA HttpOnly çerezde taşınır; veritabanına ASLA yazılmaz.
 */
export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Oturum jetonunun depoya yazılan biçimi.
 *
 * Yalnızca SHA-256 özeti saklanır: veritabanını okuyan biri geçerli bir çerez
 * üretemez.
 */
export function hashSessionToken(token: string): string {
  return `0x${createHash("sha256").update(token, "utf8").digest("hex")}`;
}
