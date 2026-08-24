import { recoverTypedDataAddress } from "viem";

import { normalizeWalletAddress, walletAddressesEqual } from "./address";
import { isArcTestnet, parseChainId } from "./network";
import { ACTIVE_NETWORK_PROFILE } from "./profile";
import { withProvider } from "./wallet";

/**
 * BORÇLU CÜZDAN KİMLİK DOĞRULAMASI — erişim meydan okuması (challenge).
 *
 * Herkes AYNI `/pay/<billId>` bağlantısını alır. Bir borçlunun yalnızca KENDİ
 * borcunu görebilmesi için bağlı cüzdanın kontrolünü kanıtlaması gerekir.
 * Bunu bu EIP-712 imzası yapar.
 *
 * BU İMZANIN YAPMADIKLARI — kullanıcıya da böyle anlatılır:
 * - USDC veya başka bir token ONAYLAMAZ (approve değildir),
 * - hiçbir transfer YETKİSİ vermez,
 * - hiçbir işlem göndermez,
 * - ödeme talebi ya da paylaşılan hesap OLUŞTURAMAZ.
 *
 * BU İMZANIN KANITLAMADIĞI: borcun gerçek dünyada meşru olduğu. İmza yalnızca
 * "bu adresi kontrol eden kişi buradayım" der. Kimlik/KYC DEĞİLDİR.
 *
 * AYRI EIP-712 ALANI kullanılır. Ne paylaşılan hesap manifesti ne de ödeme
 * talebi imzası buraya, bu imza da oralara geçemez: alan adı, sürüm ve birincil
 * tip farklıdır.
 */

export const SHARED_BILL_ACCESS_VERSION = 1;
export const SHARED_BILL_ACCESS_DOMAIN_NAME = "Hesabi Bol Shared Bill Access";
export const SHARED_BILL_ACCESS_DOMAIN_VERSION = "1";

/** Meydan okumanın ÜST SINIR ömrü: beş dakika. */
export const SHARED_BILL_ACCESS_MAX_LIFETIME_MS = 5 * 60 * 1000;
/** Saat kaymasına karşı tolerans. */
export const SHARED_BILL_ACCESS_MAX_CLOCK_SKEW_MS = 60 * 1000;
/** Güvenilen hedef (audience) metni için üst sınır. */
export const MAX_AUDIENCE_LENGTH = 200;

export const SHARED_BILL_ACCESS_TYPES = {
  SharedBillAccess: [
    { name: "authVersion", type: "uint16" },
    { name: "billId", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "debtor", type: "address" },
    { name: "nonce", type: "bytes32" },
    { name: "audience", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export type SharedBillAccessChallenge = Readonly<{
  authVersion: number;
  billId: string;
  chainId: number;
  debtor: string;
  /** Kriptografik olarak rastgele, tek kullanımlık (0x + 64 hex). */
  nonce: string;
  /** Sunucunun GÜVENDİĞİ origin. İstemciden gelen değere asla güvenilmez. */
  audience: string;
  issuedAt: number;
  expiresAt: number;
}>;

const CHALLENGE_KEYS = SHARED_BILL_ACCESS_TYPES.SharedBillAccess.map(
  (field) => field.name as keyof SharedBillAccessChallenge,
);

export type AccessChallengeProblem =
  | "notAnObject"
  | "unexpectedField"
  | "missingField"
  | "unsupportedVersion"
  | "invalidBillId"
  | "invalidChainId"
  | "invalidDebtor"
  | "invalidNonce"
  | "invalidAudience"
  | "audienceMismatch"
  | "invalidTimestamps"
  | "expired"
  | "notYetValid"
  | "lifetimeTooLong"
  | "invalidSignatureFormat";

const PROBLEM_MESSAGES: Record<AccessChallengeProblem, string> = {
  notAnObject: "Erişim isteği okunamadı.",
  unexpectedField: "Erişim isteğinde beklenmeyen alan var.",
  missingField: "Erişim isteğinde eksik alan var.",
  unsupportedVersion: "Bu erişim isteği sürümü desteklenmiyor.",
  invalidBillId: "Hesap kimliği geçersiz.",
  invalidChainId: "Erişim isteği Arc Testnet için oluşturulmamış.",
  invalidDebtor: "Cüzdan adresi geçersiz.",
  invalidNonce: "Erişim isteğinin tek kullanımlık değeri geçersiz.",
  invalidAudience: "Erişim isteğinin hedefi geçersiz.",
  audienceMismatch: "Erişim isteği bu uygulama için oluşturulmamış.",
  invalidTimestamps: "Erişim isteğinin zaman bilgisi geçersiz.",
  expired: "Erişim isteğinin süresi doldu. Yeniden dene.",
  notYetValid: "Erişim isteği henüz geçerli değil.",
  lifetimeTooLong: "Erişim isteğinin ömrü izin verilenden uzun.",
  invalidSignatureFormat: "İmza geçersiz biçimde.",
};

export function describeAccessChallengeProblem(
  problem: AccessChallengeProblem,
): string {
  return PROBLEM_MESSAGES[problem];
}

const BILL_ID = /^0x[0-9a-f]{64}$/i;
const NONCE = /^0x[0-9a-f]{64}$/i;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

export function isValidAccessSignatureFormat(value: unknown): value is string {
  return typeof value === "string" && SIGNATURE.test(value);
}

export type ValidateChallengeResult =
  | { ok: true; challenge: SharedBillAccessChallenge }
  | { ok: false; problem: AccessChallengeProblem };

/**
 * Meydan okumayı katı biçimde doğrular.
 *
 * `expectedAudience` SUNUCUNUN güvendiği origin'dir. İstemcinin gönderdiği
 * `audience` alanı yalnızca bununla BİREBİR eşleşiyorsa kabul edilir; Host,
 * Origin, Referer veya forwarded-host başlıklarına asla güvenilmez.
 */
export function validateSharedBillAccessChallenge(
  value: unknown,
  nowMs: number,
  expectedAudience: string,
): ValidateChallengeResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, problem: "notAnObject" };
  }
  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(CHALLENGE_KEYS as string[]).includes(key)) {
      return { ok: false, problem: "unexpectedField" };
    }
  }
  for (const key of CHALLENGE_KEYS) {
    if (!(key in record)) {
      return { ok: false, problem: "missingField" };
    }
  }

  if (record.authVersion !== SHARED_BILL_ACCESS_VERSION) {
    return { ok: false, problem: "unsupportedVersion" };
  }
  if (typeof record.billId !== "string" || !BILL_ID.test(record.billId)) {
    return { ok: false, problem: "invalidBillId" };
  }
  if (record.chainId !== ACTIVE_NETWORK_PROFILE.chainId) {
    return { ok: false, problem: "invalidChainId" };
  }
  const debtor =
    typeof record.debtor === "string"
      ? normalizeWalletAddress(record.debtor)
      : null;
  if (debtor === null) {
    return { ok: false, problem: "invalidDebtor" };
  }
  if (typeof record.nonce !== "string" || !NONCE.test(record.nonce)) {
    return { ok: false, problem: "invalidNonce" };
  }
  if (
    typeof record.audience !== "string" ||
    record.audience.length === 0 ||
    record.audience.length > MAX_AUDIENCE_LENGTH
  ) {
    return { ok: false, problem: "invalidAudience" };
  }
  if (record.audience !== expectedAudience) {
    return { ok: false, problem: "audienceMismatch" };
  }

  const issuedAt = record.issuedAt;
  const expiresAt = record.expiresAt;
  if (
    typeof issuedAt !== "number" ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt <= 0 ||
    expiresAt <= issuedAt
  ) {
    return { ok: false, problem: "invalidTimestamps" };
  }
  if ((expiresAt - issuedAt) * 1000 > SHARED_BILL_ACCESS_MAX_LIFETIME_MS) {
    return { ok: false, problem: "lifetimeTooLong" };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const skewSeconds = Math.floor(SHARED_BILL_ACCESS_MAX_CLOCK_SKEW_MS / 1000);
  if (issuedAt - skewSeconds > nowSeconds) {
    return { ok: false, problem: "notYetValid" };
  }
  if (expiresAt <= nowSeconds) {
    return { ok: false, problem: "expired" };
  }

  return {
    ok: true,
    challenge: Object.freeze({
      authVersion: SHARED_BILL_ACCESS_VERSION,
      billId: record.billId.toLowerCase(),
      chainId: ACTIVE_NETWORK_PROFILE.chainId,
      debtor,
      nonce: record.nonce.toLowerCase(),
      audience: record.audience,
      issuedAt,
      expiresAt,
    }),
  };
}

/** İmzalama ve doğrulama AYNI tip tanımını kullanır. */
export function buildSharedBillAccessTypedData(
  challenge: SharedBillAccessChallenge,
) {
  return {
    domain: {
      name: SHARED_BILL_ACCESS_DOMAIN_NAME,
      version: SHARED_BILL_ACCESS_DOMAIN_VERSION,
      chainId: ACTIVE_NETWORK_PROFILE.chainId,
    },
    types: SHARED_BILL_ACCESS_TYPES,
    primaryType: "SharedBillAccess" as const,
    message: {
      authVersion: challenge.authVersion,
      billId: challenge.billId as `0x${string}`,
      chainId: BigInt(challenge.chainId),
      debtor: challenge.debtor as `0x${string}`,
      nonce: challenge.nonce as `0x${string}`,
      audience: challenge.audience,
      issuedAt: BigInt(challenge.issuedAt),
      expiresAt: BigInt(challenge.expiresAt),
    },
  };
}

function toEip712JsonValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(toEip712JsonValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        toEip712JsonValue(entry),
      ]),
    );
  }
  return value;
}

/** Cüzdana gönderilen JSON, TEK yetkili tip tanımından türetilir. */
export function toSharedBillAccessEip712Json(
  challenge: SharedBillAccessChallenge,
): string {
  const typedData = buildSharedBillAccessTypedData(challenge);
  return JSON.stringify({
    domain: toEip712JsonValue(typedData.domain),
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      ...typedData.types,
    },
    primaryType: typedData.primaryType,
    message: toEip712JsonValue(typedData.message),
  });
}

export type AccessSignResult =
  | { ok: true; signature: string }
  | { ok: false; code: AccessSigningErrorCode };

export type AccessSigningErrorCode =
  | "noProvider"
  | "rejected"
  | "noAccount"
  | "accountChanged"
  | "networkChanged"
  | "invalidChallenge"
  | "signatureFormat"
  | "signerMismatch"
  | "signFailed";

const SIGNING_MESSAGES: Record<AccessSigningErrorCode, string> = {
  noProvider: "Cüzdan bağlantısı bulunamadı. Cüzdanı yeniden bağla.",
  rejected: "İmza cüzdanda reddedildi. Borcunu görmek için imzalaman gerekir.",
  noAccount: "Cüzdanda açık bir hesap yok.",
  accountChanged:
    "Cüzdandaki aktif hesap değişti. Görmek istediğin borcun cüzdanına geçip tekrar dene.",
  networkChanged:
    "Cüzdan Arc Testnet'te değil. Ağı Arc Testnet'e alıp tekrar dene.",
  invalidChallenge:
    "Erişim isteği kendi doğrulamamızdan geçmedi; cüzdana hiçbir şey gönderilmedi.",
  signatureFormat: "Cüzdan beklenen biçimde bir imza döndürmedi.",
  signerMismatch: "İmzayı atan hesap, isteği yapılan adresle eşleşmiyor.",
  signFailed: "İmzalanamadı. Lütfen tekrar dene.",
};

export function describeAccessSigningError(
  code: AccessSigningErrorCode,
): string {
  return SIGNING_MESSAGES[code];
}

/**
 * Meydan okumayı imzalar.
 *
 * Cüzdana dokunulmadan ÖNCE meydan okuma katı doğrulamadan geçer; imzadan
 * HEMEN ÖNCE hesap ve zincir sağlayıcıya yeniden sorulur. Hiçbir işlem
 * gönderilmez ve hiçbir token onayı istenmez.
 */
export async function signSharedBillAccessChallenge(
  walletUuid: string,
  challenge: SharedBillAccessChallenge,
  expectedAudience: string,
  now: () => number = Date.now,
): Promise<AccessSignResult> {
  const validated = validateSharedBillAccessChallenge(
    challenge,
    now(),
    expectedAudience,
  );
  if (!validated.ok) {
    return { ok: false, code: "invalidChallenge" };
  }
  const canonical = validated.challenge;

  let guard: AccessSigningErrorCode | null = null;

  const outcome = await withProvider(walletUuid, async (provider) => {
    const accounts = await provider.request({ method: "eth_accounts" });
    if (!Array.isArray(accounts)) {
      guard = "noAccount";
      throw new Error("preflight");
    }
    const active = accounts.find(
      (entry): entry is string =>
        typeof entry === "string" && normalizeWalletAddress(entry) !== null,
    );
    if (active === undefined) {
      guard = "noAccount";
      throw new Error("preflight");
    }
    if (!walletAddressesEqual(active, canonical.debtor)) {
      guard = "accountChanged";
      throw new Error("preflight");
    }

    const chainId = parseChainId(
      await provider.request({ method: "eth_chainId" }),
    );
    if (chainId === null || !isArcTestnet(chainId)) {
      guard = "networkChanged";
      throw new Error("preflight");
    }

    const result = await provider.request({
      method: "eth_signTypedData_v4",
      params: [active, toSharedBillAccessEip712Json(canonical)],
    });
    if (!isValidAccessSignatureFormat(result)) {
      guard = "signatureFormat";
      throw new Error("signature format");
    }
    return result;
  });

  if (!outcome.ok) {
    if (guard !== null) {
      return { ok: false, code: guard };
    }
    if (outcome.code === "noProvider") {
      return { ok: false, code: "noProvider" };
    }
    if (outcome.code === "rejected") {
      return { ok: false, code: "rejected" };
    }
    return { ok: false, code: "signFailed" };
  }

  // Sunucuya gönderilmeden önce imza yerelde doğrulanır.
  const verified = await verifySharedBillAccessSignature(
    canonical,
    outcome.value,
  );
  if (!verified.ok) {
    return { ok: false, code: "signerMismatch" };
  }
  return { ok: true, signature: outcome.value };
}

export type AccessVerifyResult =
  | { ok: true; signer: string }
  | { ok: false; reason: "format" | "recoverFailed" | "signerMismatch" };

/**
 * İmzayı doğrular ve imzalayanın meydan okunan BORÇLU olduğunu kanıtlar.
 * EOA imzaları desteklenir; ERC-1271 sözleşme hesapları desteklenmez.
 */
export async function verifySharedBillAccessSignature(
  challenge: SharedBillAccessChallenge,
  signature: string,
): Promise<AccessVerifyResult> {
  if (!isValidAccessSignatureFormat(signature)) {
    return { ok: false, reason: "format" };
  }
  const typedData = buildSharedBillAccessTypedData(challenge);
  let signer: string;
  try {
    signer = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return { ok: false, reason: "recoverFailed" };
  }
  if (!walletAddressesEqual(signer, challenge.debtor)) {
    return { ok: false, reason: "signerMismatch" };
  }
  return { ok: true, signer };
}
