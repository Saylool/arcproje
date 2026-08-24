import { encodeAbiParameters, keccak256, stringToBytes } from "viem";

import { normalizeWalletAddress, walletAddressesEqual } from "./address";
import { toCanonicalLabel, validateCanonicalLabel } from "./labels";
import {
  MAX_DEBT_KEY_LENGTH,
  MAX_DECIMAL_STRING_LENGTH,
  MAX_LABEL_LENGTH,
} from "./payment-request";
import { ACTIVE_NETWORK_PROFILE } from "./profile";

/**
 * PAYLAŞILAN GRUP HESABI (shared bill) sözleşmesi — EIP-712.
 *
 * Amaç: fişi ödeyen kişi TEK bir manifest imzalar, sunucu onu saklar ve
 * borçluların HEPSİ aynı kısa bağlantıyı alır. Bugünkü "borçlu başına ayrı
 * imza + ayrı bağlantı" akışı KALDIRILMAZ; bu modül onun yanında, AYRI bir
 * EIP-712 alanı ve ayrı bir şema sürümüyle yaşar. Şema 2 ödeme talepleri
 * (`payment-request.ts`) hiç etkilenmez.
 *
 * İmza YALNIZCA talebi oluşturur; hiçbir token transferi yetkisi vermez ve
 * borçlunun cüzdanından para çekemez. Transferi her zaman borçlu kendi
 * cüzdanında imzalar.
 *
 * KUR MANİFESTE GÖMÜLMEZ. Alıcı yalnızca TRY minor unit borçları imzalar;
 * USDC tutarı, borçlu ödediği anda alınan TAZE ve sunucu kimliklendirmeli
 * bir USDC/TRY teklifinden türetilir (Part 2). Böylece günlerce yaşayan bir
 * bağlantı, dakikalar ömürlü bir kura çakılmaz.
 *
 * Tam sayı alanlar JSON'da güvenle taşınamayacağı için ondalık METİN olarak
 * tutulur; BigInt asla doğrudan JSON'a yazılmaz.
 */

/** Bu modülün şeması. Ödeme talebi şemasından BAĞIMSIZDIR. */
export const SHARED_BILL_SCHEMA_VERSION = 1;

/** Ayrı EIP-712 alanı: ödeme talebi imzası paylaşılan hesap imzası olamaz. */
export const SHARED_BILL_DOMAIN_NAME = "Hesabi Bol Shared Bill";
export const SHARED_BILL_DOMAIN_VERSION = "1";

/**
 * Hesabın SONLU ömrü.
 *
 * Paylaşılan bağlantı bir kur teklifine bağlı olmadığı için ödeme talebinden
 * uzun yaşayabilir; yine de sonsuz değildir. Üst sınır YEDİ GÜNDÜR.
 */
export const SHARED_BILL_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const SHARED_BILL_DEFAULT_LIFETIME_MS = SHARED_BILL_MAX_LIFETIME_MS;
/** Saat kaymasına karşı geçmişe tolerans. */
export const SHARED_BILL_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Bir hesapta izin verilen en fazla borç satırı. */
export const MAX_SHARED_BILL_DEBTS = 50;

/** Genel (public) hesap kimliği: 0x + 64 hex = 256 bit rastgelelik. */
export const SHARED_BILL_ID_HEX_LENGTH = 64;

/** Paylaşılan hesabın yolu. Part 2'de bu rota borçlu tarafını sunacak. */
export const SHARED_BILL_ROUTE = "/pay";

/**
 * İmzalanan manifest alanlarının kanonik sırası.
 *
 * Borç LİSTESİ manifeste gömülmez; yerine kriptografik bir taahhüt
 * (`debtsHash`) imzalanır. Böylece imza tüm borçları kapsar ama manifest
 * sabit boyutlu kalır ve liste bağlantıya sızmaz.
 */
export const SHARED_BILL_TYPES = {
  SharedBillManifest: [
    { name: "schemaVersion", type: "uint16" },
    { name: "billId", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "recipientLabel", type: "string" },
    { name: "debtsHash", type: "bytes32" },
    { name: "debtCount", type: "uint16" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export type SharedBillManifest = Readonly<{
  schemaVersion: number;
  /** 0x + 64 hex; crypto.getRandomValues ile üretilir. */
  billId: string;
  chainId: number;
  recipient: string;
  recipientLabel: string;
  /** Borç listesinin kanonik kriptografik taahhüdü (0x + 64 hex). */
  debtsHash: string;
  debtCount: number;
  /** Unix saniye. */
  issuedAt: number;
  expiresAt: number;
}>;

export type SharedBillDebt = Readonly<{
  /** Checksum'lı borçlu adresi. */
  debtor: string;
  debtorLabel: string;
  /** Borcun kararlı kimliği ("<borçlu>-><alacaklı>"). */
  debtKey: string;
  /** Pozitif tam sayı TRY minor unit, ondalık metin. */
  tryMinor: string;
}>;

export type SignedSharedBill = Readonly<{
  manifest: SharedBillManifest;
  debts: readonly SharedBillDebt[];
  /** 0x + 130 hex (65 bayt) EOA imzası. */
  signature: string;
}>;

const MANIFEST_KEYS = SHARED_BILL_TYPES.SharedBillManifest.map(
  (field) => field.name as keyof SharedBillManifest,
);

const DEBT_KEYS = ["debtor", "debtorLabel", "debtKey", "tryMinor"] as const;

export type SharedBillProblem =
  | "notAnObject"
  | "unexpectedField"
  | "missingField"
  | "unsupportedSchemaVersion"
  | "invalidBillId"
  | "invalidChainId"
  | "invalidRecipient"
  | "invalidLabel"
  | "invalidDebtor"
  | "selfTransfer"
  | "duplicateDebtor"
  | "duplicateDebtKey"
  | "invalidDebtKey"
  | "invalidAmount"
  | "noDebts"
  | "tooManyDebts"
  | "debtCountMismatch"
  | "commitmentMismatch"
  | "invalidTimestamps"
  | "expired"
  | "notYetValid"
  | "lifetimeTooLong"
  | "invalidSignatureFormat";

const PROBLEM_MESSAGES: Record<SharedBillProblem, string> = {
  notAnObject: "Paylaşılan hesap okunamadı.",
  unexpectedField: "Paylaşılan hesapta beklenmeyen alan var.",
  missingField: "Paylaşılan hesapta eksik alan var.",
  unsupportedSchemaVersion: "Bu paylaşılan hesap sürümü desteklenmiyor.",
  invalidBillId: "Paylaşılan hesap kimliği geçersiz.",
  invalidChainId: "Paylaşılan hesap Arc Testnet için oluşturulmamış.",
  invalidRecipient: "Alıcı adresi geçersiz.",
  invalidLabel: "İsim alanı geçersiz.",
  invalidDebtor: "Borçlu adresi geçersiz.",
  selfTransfer: "Alıcı kendi kendine borçlu olamaz.",
  duplicateDebtor: "Aynı borçlu adresi birden fazla kez kullanılamaz.",
  duplicateDebtKey: "Aynı borç kimliği birden fazla kez kullanılamaz.",
  invalidDebtKey: "Borç kimliği geçersiz.",
  invalidAmount: "Borç tutarı geçersiz.",
  noDebts: "Paylaşılan hesapta hiç borç yok.",
  tooManyDebts: "Paylaşılan hesapta izin verilenden fazla borç var.",
  debtCountMismatch: "Borç sayısı manifest ile uyuşmuyor.",
  commitmentMismatch:
    "Borç listesi, imzalanan taahhütle uyuşmuyor. Bu hesaba güvenme.",
  invalidTimestamps: "Paylaşılan hesabın zaman bilgisi geçersiz.",
  expired: "Bu paylaşılan hesabın süresi dolmuş.",
  notYetValid: "Bu paylaşılan hesap henüz geçerli değil.",
  lifetimeTooLong: "Paylaşılan hesabın geçerlilik süresi izin verilenden uzun.",
  invalidSignatureFormat: "Paylaşılan hesap imzası geçersiz biçimde.",
};

export function describeSharedBillProblem(problem: SharedBillProblem): string {
  return PROBLEM_MESSAGES[problem];
}

const DECIMAL_STRING = /^(0|[1-9][0-9]*)$/;
const BILL_ID = new RegExp(`^0x[0-9a-f]{${SHARED_BILL_ID_HEX_LENGTH}}$`, "i");
const BYTES32 = /^0x[0-9a-f]{64}$/i;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

export function isValidSharedBillSignatureFormat(
  value: unknown,
): value is string {
  return typeof value === "string" && SIGNATURE.test(value);
}

function isSafeLabel(value: unknown, maxLength: number): value is string {
  return validateCanonicalLabel(value, maxLength).ok;
}

function isDecimalString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_DECIMAL_STRING_LENGTH &&
    DECIMAL_STRING.test(value)
  );
}

/** Kriptografik olarak rastgele hesap kimliği (256 bit). */
export function createSharedBillId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/*
 * ---------------------------------------------------------------------------
 * KANONİK BORÇ TAAHHÜDÜ
 * ---------------------------------------------------------------------------
 *
 * `JSON.stringify` çıktısı taahhüt olarak KULLANILMAZ: anahtar sırası, boşluk
 * ve Unicode kaçışları uygulamadan uygulamaya değişir ve aynı borç listesi
 * farklı baytlar üretebilir.
 *
 * Bunun yerine her satır EIP-712 struct hash'i gibi ABI-kodlanır, satırlar
 * KANONİK SIRAYA (borçlu adresi, küçük harf, artan) dizilir ve alan
 * ayrılmış bir etiketle tek bir bytes32'ye indirgenir. Taahhüt zincire,
 * hesap kimliğine ve borç SAYISINA da bağlıdır; satır ekleme/çıkarma veya
 * başka bir hesaba kopyalama taahhüdü bozar.
 */

/** Satır struct'ının tip hash'i. */
export const SHARED_BILL_DEBT_TYPEHASH = keccak256(
  stringToBytes(
    "SharedBillDebt(address debtor,string debtorLabel,string debtKey,uint256 tryMinor)",
  ),
);

/** Taahhüdün alan ayracı; başka bir bağlamdaki hash ile karışamaz. */
export const SHARED_BILL_DEBTS_COMMITMENT_TAG = keccak256(
  stringToBytes(`HesabiBolSharedBillDebts(${SHARED_BILL_SCHEMA_VERSION})`),
);

/** Tek bir kanonik borç satırının yaprak hash'i. */
export function hashSharedBillDebtRow(debt: SharedBillDebt): string {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
      ],
      [
        SHARED_BILL_DEBT_TYPEHASH as `0x${string}`,
        debt.debtor as `0x${string}`,
        keccak256(stringToBytes(debt.debtorLabel)),
        keccak256(stringToBytes(debt.debtKey)),
        BigInt(debt.tryMinor),
      ],
    ),
  );
}

/**
 * KANONİK SIRA: borçlu adresine göre (küçük harf, sözlük sırası) ARTAN.
 *
 * Borçlu adresi hesap başına benzersiz olduğu için bu sıra TAM'dır: iki satır
 * asla eşit sıralanamaz. Girdi sırası ne olursa olsun aynı manifest üretilir.
 */
export function canonicalDebtOrder(
  a: SharedBillDebt,
  b: SharedBillDebt,
): number {
  const left = a.debtor.toLowerCase();
  const right = b.debtor.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Kanonik sıradaki satırlardan borç taahhüdünü hesaplar.
 *
 * Satırların ZATEN kanonik ve doğrulanmış olduğu varsayılır; ham girdi için
 * önce `canonicalizeSharedBillDebts` çağrılır.
 */
export function computeSharedBillDebtsHash(input: {
  chainId: number;
  billId: string;
  debts: readonly SharedBillDebt[];
}): string {
  const leaves = input.debts.map(
    (debt) => hashSharedBillDebtRow(debt) as `0x${string}`,
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint16" },
        { type: "bytes32[]" },
      ],
      [
        SHARED_BILL_DEBTS_COMMITMENT_TAG as `0x${string}`,
        BigInt(input.chainId),
        input.billId as `0x${string}`,
        input.debts.length,
        leaves,
      ],
    ),
  );
}

export type CanonicalizeDebtsResult =
  | { ok: true; debts: readonly SharedBillDebt[] }
  | { ok: false; problem: SharedBillProblem };

/**
 * Ham borç satırlarını katı biçimde doğrular, normalleştirir ve kanonik
 * sıraya dizer.
 *
 * Her satır ayrı ayrı doğrulanır; ayrıca hesap düzeyinde benzersizlik
 * (adres ve borç kimliği) ve alıcıyla çakışmama aranır.
 */
export function canonicalizeSharedBillDebts(
  value: unknown,
  recipient: string,
): CanonicalizeDebtsResult {
  if (!Array.isArray(value)) {
    return { ok: false, problem: "notAnObject" };
  }
  if (value.length === 0) {
    return { ok: false, problem: "noDebts" };
  }
  if (value.length > MAX_SHARED_BILL_DEBTS) {
    return { ok: false, problem: "tooManyDebts" };
  }

  const normalizedRecipient = normalizeWalletAddress(recipient);
  if (normalizedRecipient === null) {
    return { ok: false, problem: "invalidRecipient" };
  }

  const seenDebtors = new Set<string>();
  const seenDebtKeys = new Set<string>();
  const rows: SharedBillDebt[] = [];

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, problem: "notAnObject" };
    }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!(DEBT_KEYS as readonly string[]).includes(key)) {
        return { ok: false, problem: "unexpectedField" };
      }
    }
    for (const key of DEBT_KEYS) {
      if (!(key in record)) {
        return { ok: false, problem: "missingField" };
      }
    }

    const debtor =
      typeof record.debtor === "string"
        ? normalizeWalletAddress(record.debtor)
        : null;
    if (debtor === null) {
      return { ok: false, problem: "invalidDebtor" };
    }
    if (walletAddressesEqual(debtor, normalizedRecipient)) {
      return { ok: false, problem: "selfTransfer" };
    }
    if (seenDebtors.has(debtor.toLowerCase())) {
      return { ok: false, problem: "duplicateDebtor" };
    }

    if (!isSafeLabel(record.debtorLabel, MAX_LABEL_LENGTH)) {
      return { ok: false, problem: "invalidLabel" };
    }
    if (!isSafeLabel(record.debtKey, MAX_DEBT_KEY_LENGTH)) {
      return { ok: false, problem: "invalidDebtKey" };
    }
    if (seenDebtKeys.has(record.debtKey)) {
      return { ok: false, problem: "duplicateDebtKey" };
    }

    if (
      !isDecimalString(record.tryMinor) ||
      BigInt(record.tryMinor) <= BigInt(0) ||
      !Number.isSafeInteger(Number(record.tryMinor))
    ) {
      return { ok: false, problem: "invalidAmount" };
    }

    seenDebtors.add(debtor.toLowerCase());
    seenDebtKeys.add(record.debtKey);
    rows.push(
      Object.freeze({
        debtor,
        debtorLabel: record.debtorLabel,
        debtKey: record.debtKey,
        tryMinor: record.tryMinor,
      }),
    );
  }

  return { ok: true, debts: Object.freeze([...rows].sort(canonicalDebtOrder)) };
}

/*
 * ---------------------------------------------------------------------------
 * MANİFEST
 * ---------------------------------------------------------------------------
 */

export type CreateSharedBillInput = {
  recipient: string;
  recipientLabel: string;
  /** Ham borç satırları; burada doğrulanır ve kanonikleştirilir. */
  debts: readonly {
    debtor: string;
    debtorLabel: string;
    debtKey: string;
    tryMinor: number | string;
  }[];
  /** Test edilebilirlik için dışarıdan verilebilir. */
  nowMs?: number;
  billId?: string;
  lifetimeMs?: number;
};

export type CreateSharedBillResult =
  | { ok: true; manifest: SharedBillManifest; debts: readonly SharedBillDebt[] }
  | { ok: false; problem: SharedBillProblem };

/**
 * Manifesti ve kanonik borç listesini üretir.
 *
 * Üretim ve tüketim TEK katı yoldan geçer: burada yalnızca aday kurulur,
 * kuralların tamamını `validateSharedBillManifest` uygular.
 */
export function createSharedBill(
  input: CreateSharedBillInput,
): CreateSharedBillResult {
  const lifetimeMs = input.lifetimeMs ?? SHARED_BILL_DEFAULT_LIFETIME_MS;
  if (
    !Number.isFinite(lifetimeMs) ||
    lifetimeMs <= 0 ||
    lifetimeMs > SHARED_BILL_MAX_LIFETIME_MS
  ) {
    return { ok: false, problem: "lifetimeTooLong" };
  }

  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    return { ok: false, problem: "invalidTimestamps" };
  }

  const recipient = normalizeWalletAddress(input.recipient);
  if (recipient === null) {
    return { ok: false, problem: "invalidRecipient" };
  }

  const rawDebts = input.debts.map((debt) => ({
    debtor: debt.debtor,
    debtorLabel: toCanonicalLabel(String(debt.debtorLabel)),
    debtKey: toCanonicalLabel(String(debt.debtKey)),
    tryMinor:
      typeof debt.tryMinor === "string" ? debt.tryMinor : String(debt.tryMinor),
  }));

  const canonical = canonicalizeSharedBillDebts(rawDebts, recipient);
  if (!canonical.ok) {
    return { ok: false, problem: canonical.problem };
  }

  const billId = input.billId ?? createSharedBillId();
  const chainId = ACTIVE_NETWORK_PROFILE.chainId;

  const candidate: Record<string, unknown> = {
    schemaVersion: SHARED_BILL_SCHEMA_VERSION,
    billId,
    chainId,
    recipient,
    recipientLabel: toCanonicalLabel(input.recipientLabel),
    debtsHash: computeSharedBillDebtsHash({
      chainId,
      billId,
      debts: canonical.debts,
    }),
    debtCount: canonical.debts.length,
    issuedAt: Math.floor(nowMs / 1000),
    expiresAt: Math.floor((nowMs + lifetimeMs) / 1000),
  };

  const validated = validateSharedBillManifest(candidate, nowMs);
  if (!validated.ok) {
    return { ok: false, problem: validated.problem };
  }
  return { ok: true, manifest: validated.manifest, debts: canonical.debts };
}

/**
 * İmzalama ve doğrulama AYNI yapıyı kullanır; imza bütünlüğü JSON anahtar
 * sırasına değil bu kanonik tip tanımına bağlıdır.
 */
export function buildSharedBillTypedData(manifest: SharedBillManifest) {
  return {
    domain: {
      name: SHARED_BILL_DOMAIN_NAME,
      version: SHARED_BILL_DOMAIN_VERSION,
      chainId: ACTIVE_NETWORK_PROFILE.chainId,
    },
    types: SHARED_BILL_TYPES,
    primaryType: "SharedBillManifest" as const,
    message: {
      schemaVersion: manifest.schemaVersion,
      billId: manifest.billId as `0x${string}`,
      chainId: BigInt(manifest.chainId),
      recipient: manifest.recipient as `0x${string}`,
      recipientLabel: manifest.recipientLabel,
      debtsHash: manifest.debtsHash as `0x${string}`,
      debtCount: manifest.debtCount,
      issuedAt: BigInt(manifest.issuedAt),
      expiresAt: BigInt(manifest.expiresAt),
    },
  };
}

export type ValidateManifestResult =
  | { ok: true; manifest: SharedBillManifest }
  | { ok: false; problem: SharedBillProblem };

/** Bilinmeyen kaynaktan gelen bir manifesti katı biçimde doğrular. */
export function validateSharedBillManifest(
  value: unknown,
  nowMs: number,
): ValidateManifestResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, problem: "notAnObject" };
  }
  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(MANIFEST_KEYS as string[]).includes(key)) {
      return { ok: false, problem: "unexpectedField" };
    }
  }
  for (const key of MANIFEST_KEYS) {
    if (!(key in record)) {
      return { ok: false, problem: "missingField" };
    }
  }

  if (record.schemaVersion !== SHARED_BILL_SCHEMA_VERSION) {
    return { ok: false, problem: "unsupportedSchemaVersion" };
  }
  if (typeof record.billId !== "string" || !BILL_ID.test(record.billId)) {
    return { ok: false, problem: "invalidBillId" };
  }
  if (record.chainId !== ACTIVE_NETWORK_PROFILE.chainId) {
    return { ok: false, problem: "invalidChainId" };
  }

  const recipient =
    typeof record.recipient === "string"
      ? normalizeWalletAddress(record.recipient)
      : null;
  if (recipient === null) {
    return { ok: false, problem: "invalidRecipient" };
  }
  if (!isSafeLabel(record.recipientLabel, MAX_LABEL_LENGTH)) {
    return { ok: false, problem: "invalidLabel" };
  }

  if (typeof record.debtsHash !== "string" || !BYTES32.test(record.debtsHash)) {
    return { ok: false, problem: "commitmentMismatch" };
  }

  const debtCount = record.debtCount;
  if (
    typeof debtCount !== "number" ||
    !Number.isSafeInteger(debtCount) ||
    debtCount <= 0
  ) {
    return { ok: false, problem: "debtCountMismatch" };
  }
  if (debtCount > MAX_SHARED_BILL_DEBTS) {
    return { ok: false, problem: "tooManyDebts" };
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
  if ((expiresAt - issuedAt) * 1000 > SHARED_BILL_MAX_LIFETIME_MS) {
    return { ok: false, problem: "lifetimeTooLong" };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const skewSeconds = Math.floor(SHARED_BILL_MAX_CLOCK_SKEW_MS / 1000);
  if (issuedAt - skewSeconds > nowSeconds) {
    return { ok: false, problem: "notYetValid" };
  }
  if (expiresAt <= nowSeconds) {
    return { ok: false, problem: "expired" };
  }

  return {
    ok: true,
    manifest: Object.freeze({
      schemaVersion: SHARED_BILL_SCHEMA_VERSION,
      billId: record.billId.toLowerCase(),
      chainId: ACTIVE_NETWORK_PROFILE.chainId,
      recipient,
      recipientLabel: record.recipientLabel,
      debtsHash: record.debtsHash.toLowerCase(),
      debtCount,
      issuedAt,
      expiresAt,
    }),
  };
}

export type ValidateSubmissionResult =
  | { ok: true; bill: SignedSharedBill }
  | { ok: false; problem: SharedBillProblem };

/**
 * Zarfın TAMAMINI doğrular: manifest, borç satırları, imza BİÇİMİ ve borç
 * taahhüdünün YENİDEN HESAPLANMASI.
 *
 * İmzanın kriptografik doğrulaması ayrı bir adımdır
 * (`verifySharedBillSignature`); bu fonksiyon ona verilecek kanonik gövdeyi
 * üretir. Taahhüt, gönderilen satırlardan sunucu tarafında yeniden hesaplanır:
 * istemcinin bildirdiği `debtsHash`e asla güvenilmez.
 */
export function validateSharedBillSubmission(
  value: unknown,
  nowMs: number,
): ValidateSubmissionResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, problem: "notAnObject" };
  }
  const envelope = value as Record<string, unknown>;
  const allowed = ["manifest", "debts", "signature"];
  for (const key of Object.keys(envelope)) {
    if (!allowed.includes(key)) {
      return { ok: false, problem: "unexpectedField" };
    }
  }
  for (const key of allowed) {
    if (!(key in envelope)) {
      return { ok: false, problem: "missingField" };
    }
  }
  if (!isValidSharedBillSignatureFormat(envelope.signature)) {
    return { ok: false, problem: "invalidSignatureFormat" };
  }

  const validatedManifest = validateSharedBillManifest(
    envelope.manifest,
    nowMs,
  );
  if (!validatedManifest.ok) {
    return { ok: false, problem: validatedManifest.problem };
  }
  const manifest = validatedManifest.manifest;

  const canonical = canonicalizeSharedBillDebts(
    envelope.debts,
    manifest.recipient,
  );
  if (!canonical.ok) {
    return { ok: false, problem: canonical.problem };
  }
  if (canonical.debts.length !== manifest.debtCount) {
    return { ok: false, problem: "debtCountMismatch" };
  }

  // Taahhüt SUNUCUDA yeniden hesaplanır; bildirilen değer yalnızca karşılaştırılır.
  const recomputed = computeSharedBillDebtsHash({
    chainId: manifest.chainId,
    billId: manifest.billId,
    debts: canonical.debts,
  });
  if (recomputed.toLowerCase() !== manifest.debtsHash.toLowerCase()) {
    return { ok: false, problem: "commitmentMismatch" };
  }

  return {
    ok: true,
    bill: Object.freeze({
      manifest,
      debts: canonical.debts,
      signature: envelope.signature,
    }),
  };
}

/** Paylaşılan bağlantının göreli yolu. Tam URL çağıran tarafta kurulur. */
export function buildSharedBillPath(billId: string): string {
  return `${SHARED_BILL_ROUTE}/${billId}`;
}

/** Paylaşılan bağlantı. Origin çağıran taraftan gelir. */
export function buildSharedBillUrl(origin: string, billId: string): string {
  return `${origin.replace(/\/+$/, "")}${buildSharedBillPath(billId)}`;
}
