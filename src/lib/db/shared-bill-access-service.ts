import { scanForDuplicateKeys } from "@/lib/arc/json-duplicate-keys";
import { normalizeWalletAddress } from "@/lib/arc/address";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import {
  SHARED_BILL_ACCESS_MAX_LIFETIME_MS,
  SHARED_BILL_ACCESS_VERSION,
  describeAccessChallengeProblem,
  isValidAccessSignatureFormat,
  validateSharedBillAccessChallenge,
  verifySharedBillAccessSignature,
  type SharedBillAccessChallenge,
} from "@/lib/arc/shared-bill-access";
import { proveSharedBillDebt, type SharedBillDebt } from "@/lib/arc/shared-bill";
import type { SharedBillProof } from "@/lib/arc/shared-bill-merkle";

import {
  createAccessNonce,
  createSessionToken,
  hashSessionToken,
  readAppOrigin,
  readSharedBillAuthSecret,
  signChallengeTag,
  verifyChallengeTag,
  type AuthEnv,
} from "./shared-bill-auth";
import type { SharedBillRepository } from "./shared-bill-repository";

/**
 * Borçlu erişiminin iş mantığı. HTTP'den BAĞIMSIZ.
 *
 * Rotalar yalnızca taşıma katmanıdır; meydan okuma üretimi, imza doğrulaması,
 * nonce tüketimi, oturum kurulumu ve tek satırlık görünüm burada yaşar ve
 * gerçek bir veritabanı olmadan test edilebilir.
 *
 * GİZLİLİK: bu modül hesap kimliği, adres, nonce, imza, oturum jetonu veya
 * etiket LOGLAMAZ. Hata mesajları belirli bir cüzdanın bir hesapta olup
 * olmadığını AÇIĞA VURMAZ: hesabın yokluğu, kapalılığı, süresinin dolması ve
 * üyeliğin bulunmaması AYNI genel yanıtı üretir.
 */

/** Oturumun ÜST SINIR ömrü. Veritabanı kısıtı da aynı sınırı uygular. */
export const SHARED_BILL_SESSION_LIFETIME_MS = 15 * 60 * 1000;

/** Oturum çerezinin adı. Ham jeton YALNIZCA burada taşınır. */
export const SHARED_BILL_SESSION_COOKIE = "hb_shared_bill_session";

export type AccessConfig = Readonly<{ secret: string; audience: string }>;

export type AccessConfigResult =
  | { ok: true; config: AccessConfig }
  | { ok: false };

/**
 * Sunucu yapılandırması.
 *
 * Üretimde eksik/bozuk `APP_ORIGIN` veya eksik `SHARED_BILL_AUTH_SECRET`
 * kontrollü bir 503'e dönüşür; sessizce localhost'a DÜŞÜLMEZ.
 */
export function readAccessConfig(
  env: AuthEnv = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): AccessConfigResult {
  const secret = readSharedBillAuthSecret(env);
  if (!secret.ok) {
    return { ok: false };
  }
  const origin = readAppOrigin(env, nodeEnv);
  if (!origin.ok) {
    return { ok: false };
  }
  return { ok: true, config: { secret: secret.secret, audience: origin.origin } };
}

export type ServiceFailure = Readonly<{
  ok: false;
  status: number;
  code: string;
  message: string;
}>;

function failure(status: number, code: string, message: string): ServiceFailure {
  return Object.freeze({ ok: false as const, status, code, message });
}

/** Üyelik sızdırmayan TEK genel hata. */
const GENERIC_UNAVAILABLE = failure(
  404,
  "NOT_AVAILABLE",
  "Bu bağlantı için görüntülenecek bir borç bulunamadı. Bağlantı geçersiz veya süresi dolmuş olabilir.",
);

const STORAGE_UNAVAILABLE = failure(
  503,
  "SERVICE_UNAVAILABLE",
  "Servis şu anda kullanılamıyor. Lütfen birazdan tekrar dene.",
);

/*
 * ---------------------------------------------------------------------------
 * MEYDAN OKUMA ÜRETİMİ
 * ---------------------------------------------------------------------------
 */

export type IssuedChallenge = Readonly<{
  ok: true;
  challenge: SharedBillAccessChallenge;
  /** Sunucunun HMAC kimlik etiketi. */
  tag: string;
}>;

export type IssueChallengeResult = IssuedChallenge | ServiceFailure;

/**
 * Meydan okuma üretir.
 *
 * Hesabın VAR OLUP OLMADIĞINA BAKMAZ ve veritabanına DOKUNMAZ: aksi hâlde
 * yanıt farkı "bu hesap kimliği gerçek mi?" sorusunu yanıtlardı. Doğrulama
 * `resolve` adımında yapılır.
 */
export function issueAccessChallenge(input: {
  billId: unknown;
  debtor: unknown;
  nowMs: number;
  config: AccessConfig;
  /** Testlerde belirlenimci değer vermek için. */
  nonce?: string;
}): IssueChallengeResult {
  const billId =
    typeof input.billId === "string" && /^0x[0-9a-f]{64}$/i.test(input.billId)
      ? input.billId.toLowerCase()
      : null;
  if (billId === null) {
    return failure(400, "INVALID_BILL_ID", "Hesap kimliği geçersiz.");
  }
  const debtor =
    typeof input.debtor === "string"
      ? normalizeWalletAddress(input.debtor)
      : null;
  if (debtor === null) {
    return failure(400, "INVALID_ADDRESS", "Cüzdan adresi geçersiz.");
  }

  const issuedAt = Math.floor(input.nowMs / 1000);
  const challenge: SharedBillAccessChallenge = Object.freeze({
    authVersion: SHARED_BILL_ACCESS_VERSION,
    billId,
    chainId: ACTIVE_NETWORK_PROFILE.chainId,
    debtor,
    nonce: input.nonce ?? createAccessNonce(),
    audience: input.config.audience,
    issuedAt,
    expiresAt: issuedAt + SHARED_BILL_ACCESS_MAX_LIFETIME_MS / 1000,
  });

  return Object.freeze({
    ok: true as const,
    challenge,
    tag: signChallengeTag(challenge, input.config.secret),
  });
}

/*
 * ---------------------------------------------------------------------------
 * ÇÖZÜMLEME (resolve)
 * ---------------------------------------------------------------------------
 */

export type ResolveSuccess = Readonly<{
  ok: true;
  /** HAM oturum jetonu. YALNIZCA HttpOnly çerezde taşınır. */
  sessionToken: string;
  sessionExpiresAtMs: number;
}>;

export type ResolveResult = ResolveSuccess | ServiceFailure;

/**
 * Borçlunun imzasını doğrular, nonce'u atomik tüketir ve oturum kurar.
 *
 * SIRA: gövde → yinelenen anahtar → zarf → meydan okuma doğrulaması →
 * SUNUCU ETİKETİ → borçlu imzası → imzalayan eşleşmesi → ATOMİK nonce
 * tüketimi + oturum. Doğrulanmamış hiçbir veri depoya ulaşmaz.
 */
export async function resolveSharedBillAccess(input: {
  bodyText: string;
  pathBillId: string;
  repository: SharedBillRepository;
  nowMs: number;
  config: AccessConfig;
  /** Testlerde belirlenimci jeton vermek için. */
  sessionToken?: string;
}): Promise<ResolveResult> {
  const scan = scanForDuplicateKeys(input.bodyText);
  if (scan === "duplicate") {
    return failure(400, "DUPLICATE_FIELD", "İstek gövdesinde yinelenen alan var.");
  }
  if (scan === "malformed") {
    return failure(400, "MALFORMED_JSON", "İstek gövdesi okunamadı.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.bodyText);
  } catch {
    return failure(400, "MALFORMED_JSON", "İstek gövdesi okunamadı.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return failure(400, "INVALID_BODY", "İstek gövdesi beklenen biçimde değil.");
  }

  const body = parsed as Record<string, unknown>;
  const allowed = ["challenge", "tag", "signature"];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      return failure(400, "UNEXPECTED_FIELD", "İstek gövdesinde beklenmeyen alan var.");
    }
  }
  for (const key of allowed) {
    if (!(key in body)) {
      return failure(400, "MISSING_FIELD", "İstek gövdesinde eksik alan var.");
    }
  }
  if (!isValidAccessSignatureFormat(body.signature)) {
    return failure(400, "INVALID_SIGNATURE_FORMAT", "İmza geçersiz biçimde.");
  }

  const validated = validateSharedBillAccessChallenge(
    body.challenge,
    input.nowMs,
    input.config.audience,
  );
  if (!validated.ok) {
    return failure(
      400,
      "INVALID_CHALLENGE",
      describeAccessChallengeProblem(validated.problem),
    );
  }
  const challenge = validated.challenge;

  // Yoldaki hesap kimliği ile imzalanan hesap kimliği BİREBİR eşleşmelidir.
  if (challenge.billId !== input.pathBillId.toLowerCase()) {
    return failure(400, "INVALID_CHALLENGE", "Erişim isteği bu hesap için değil.");
  }

  /*
   * SUNUCU ETİKETİ: meydan okumanın bizden çıktığını kanıtlar. Bu olmadan bir
   * saldırgan kendi uydurduğu bir meydan okumayı imzalatıp gönderebilirdi.
   */
  if (!verifyChallengeTag(challenge, body.tag, input.config.secret)) {
    return failure(400, "INVALID_CHALLENGE", "Erişim isteği doğrulanamadı.");
  }

  const verified = await verifySharedBillAccessSignature(
    challenge,
    body.signature,
  );
  if (!verified.ok) {
    return failure(
      400,
      "INVALID_SIGNATURE",
      "İmza doğrulanamadı. Bağlı cüzdanla imzaladığından emin ol.",
    );
  }

  const sessionToken = input.sessionToken ?? createSessionToken();
  const sessionExpiresAtMs = input.nowMs + SHARED_BILL_SESSION_LIFETIME_MS;

  const resolved = await input.repository.resolveAccess({
    billId: challenge.billId,
    debtor: challenge.debtor,
    nonce: challenge.nonce,
    nonceExpiresAt: challenge.expiresAt * 1000,
    sessionHash: hashSessionToken(sessionToken),
    sessionExpiresAt: sessionExpiresAtMs,
    chainId: challenge.chainId,
    nowMs: input.nowMs,
  });

  if (!resolved.ok) {
    if (resolved.reason === "unavailable") {
      return STORAGE_UNAVAILABLE;
    }
    if (resolved.reason === "replay") {
      return failure(
        400,
        "CHALLENGE_ALREADY_USED",
        "Bu erişim isteği zaten kullanılmış. Yeniden dene.",
      );
    }
    // "notFound": üyelik sızdırmayan tek genel yanıt.
    return GENERIC_UNAVAILABLE;
  }

  return Object.freeze({
    ok: true as const,
    sessionToken,
    sessionExpiresAtMs,
  });
}

/*
 * ---------------------------------------------------------------------------
 * KİMLİĞİ DOĞRULANMIŞ GÖRÜNÜM (/me)
 * ---------------------------------------------------------------------------
 */

export type AuthenticatedDebtView = Readonly<{
  ok: true;
  manifest: unknown;
  recipientSignature: string;
  recipient: Readonly<{ address: string; label: string }>;
  /** YALNIZCA kimliği doğrulanmış borçlunun KENDİ satırı. */
  debt: SharedBillDebt;
  proof: SharedBillProof;
  billExpiresAt: number;
  status: string;
}>;

export type AuthenticatedViewResult = AuthenticatedDebtView | ServiceFailure;

/**
 * Oturum sahibinin TEK satırlık görünümü.
 *
 * Diğer borç satırları, adresler, etiketler ve toplam katılımcı verisi
 * DÖNMEZ. Kanıt yalnızca kardeş ÖZETLERİNİ taşır.
 */
export async function readAuthenticatedDebtView(input: {
  sessionToken: string | null;
  pathBillId: string;
  repository: SharedBillRepository;
  nowMs: number;
}): Promise<AuthenticatedViewResult> {
  if (input.sessionToken === null || input.sessionToken === "") {
    return failure(401, "NOT_AUTHENTICATED", "Önce cüzdanınla giriş yap.");
  }

  const found = await input.repository.readSession({
    sessionHash: hashSessionToken(input.sessionToken),
    nowMs: input.nowMs,
  });
  if (!found.ok) {
    return found.reason === "unavailable"
      ? STORAGE_UNAVAILABLE
      : failure(
          401,
          "SESSION_EXPIRED",
          "Oturumun sona erdi. Cüzdanınla yeniden giriş yap.",
        );
  }

  /*
   * Oturum BAŞKA bir hesaba aitse kullanılamaz: A hesabı için alınan çerez
   * B hesabının borcunu açamaz.
   */
  if (
    found.bill.manifest.billId.toLowerCase() !== input.pathBillId.toLowerCase()
  ) {
    return failure(401, "SESSION_EXPIRED", "Oturum bu hesap için geçerli değil.");
  }

  // Hesabın süresi oturumdan bağımsız olarak yeniden ölçülür.
  if (found.bill.manifest.expiresAt * 1000 <= input.nowMs) {
    return GENERIC_UNAVAILABLE;
  }
  if (found.bill.status !== "open") {
    return GENERIC_UNAVAILABLE;
  }

  const debt: SharedBillDebt = Object.freeze({
    debtor: found.debt.debtor,
    debtorLabel: found.debt.debtorLabel,
    debtKey: found.debt.debtKey,
    tryMinor: found.debt.tryMinor,
  });

  const proof = proveSharedBillDebt({
    chainId: found.bill.manifest.chainId,
    billId: found.bill.manifest.billId,
    debts: found.bill.debts.map((row) => ({
      debtor: row.debtor,
      debtorLabel: row.debtorLabel,
      debtKey: row.debtKey,
      tryMinor: row.tryMinor,
    })),
    leafIndex: found.debt.leafIndex,
  });
  if (proof === null) {
    return GENERIC_UNAVAILABLE;
  }

  return Object.freeze({
    ok: true as const,
    manifest: found.bill.manifest,
    recipientSignature: found.bill.signature,
    recipient: Object.freeze({
      address: found.bill.manifest.recipient,
      label: found.bill.manifest.recipientLabel,
    }),
    debt,
    proof,
    billExpiresAt: found.bill.manifest.expiresAt,
    status: found.bill.status,
  });
}
