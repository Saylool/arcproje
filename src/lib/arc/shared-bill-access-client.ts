import { walletAddressesEqual } from "./address";
import { isArcTestnet } from "./network";
import {
  canonicalizeSharedBillDebts,
  validateSharedBillManifest,
  verifySharedBillDebtInclusion,
  type SharedBillDebt,
  type SharedBillManifest,
} from "./shared-bill";
import {
  MAX_SHARED_BILL_PROOF_LENGTH,
  type SharedBillProof,
} from "./shared-bill-merkle";
import { verifySharedBillSignature } from "./shared-bill-signing";
import type { SharedBillAccessChallenge } from "./shared-bill-access";

/**
 * Borçlu tarafının SUNUCUYA GÜVENMEYEN doğrulaması.
 *
 * Sunucudan gelen hiçbir şey doğruluğu varsayılarak gösterilmez. Borç
 * ekranda görünmeden önce istemci BAĞIMSIZ olarak şunları doğrular:
 *
 *  1. manifestin katı şeması ve zaman penceresi,
 *  2. ALICININ EIP-712 imzası (kök gerçekten alıcı tarafından imzalanmış mı),
 *  3. borç satırının imzalanan köke MERKLE İÇERME kanıtı,
 *  4. satırdaki adresin BAĞLI cüzdanla aynı olması,
 *  5. Arc Testnet zinciri.
 *
 * Herhangi biri düşerse borç GÖSTERİLMEZ ve hiçbir ödeme kontrolü açılmaz.
 */

export const SHARED_BILL_API_BASE = "/api/shared-bills";

const BILL_ID = /^0x[0-9a-f]{64}$/i;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const BYTES32 = /^0x[0-9a-f]{64}$/i;

const GENERIC_FAILURE = "Borç görüntülenemedi. Lütfen tekrar dene.";

export type AccessFetchResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function messageOf(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { error?: { message?: unknown } }).error?.message ===
      "string"
  ) {
    return (payload as { error: { message: string } }).error.message;
  }
  return GENERIC_FAILURE;
}

export type ChallengeEnvelope = Readonly<{
  challenge: SharedBillAccessChallenge;
  tag: string;
}>;

/** Meydan okuma ister. Yanıt biçimi KATI doğrulanır. */
export async function requestAccessChallenge(
  billId: string,
  debtor: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AccessFetchResult<ChallengeEnvelope>> {
  let response: Response;
  try {
    response = await fetchImpl(`${SHARED_BILL_API_BASE}/${billId}/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ debtor }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: GENERIC_FAILURE };
  }
  const payload = await readJson(response);
  if (!response.ok) {
    return { ok: false, message: messageOf(payload) };
  }
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, message: GENERIC_FAILURE };
  }
  const record = payload as Record<string, unknown>;
  if (
    typeof record.tag !== "string" ||
    !BYTES32.test(record.tag) ||
    typeof record.challenge !== "object" ||
    record.challenge === null
  ) {
    return { ok: false, message: GENERIC_FAILURE };
  }
  return {
    ok: true,
    value: Object.freeze({
      challenge: record.challenge as SharedBillAccessChallenge,
      tag: record.tag,
    }),
  };
}

/**
 * İmzalı meydan okumayı gönderir; sunucu oturum çerezini kurar.
 *
 * `credentials: "same-origin"` çerezin kurulup sonraki isteklerde
 * gönderilmesini sağlar. Ham jeton JavaScript'e HİÇ verilmez.
 */
export async function submitAccessResolution(
  billId: string,
  body: { challenge: unknown; tag: string; signature: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AccessFetchResult<true>> {
  let response: Response;
  try {
    response = await fetchImpl(`${SHARED_BILL_API_BASE}/${billId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, message: GENERIC_FAILURE };
  }
  if (!response.ok) {
    return { ok: false, message: messageOf(await readJson(response)) };
  }
  return { ok: true, value: true };
}

export type AuthenticatedDebtPayload = Readonly<{
  manifest: SharedBillManifest;
  recipientSignature: string;
  recipient: Readonly<{ address: string; label: string }>;
  debt: SharedBillDebt;
  proof: SharedBillProof;
  billExpiresAt: number;
  status: string;
}>;

/** Kimliği doğrulanmış görünümü ister. Şema KATI doğrulanır. */
export async function fetchAuthenticatedDebt(
  billId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AccessFetchResult<unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(`${SHARED_BILL_API_BASE}/${billId}/me`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, message: GENERIC_FAILURE };
  }
  const payload = await readJson(response);
  if (!response.ok) {
    return { ok: false, message: messageOf(payload) };
  }
  return { ok: true, value: payload };
}

export type VerifiedView = Readonly<{
  manifest: SharedBillManifest;
  debt: SharedBillDebt;
  recipient: Readonly<{ address: string; label: string }>;
  billExpiresAt: number;
}>;

export type ViewProblem =
  | "malformedResponse"
  | "invalidManifest"
  | "invalidRecipientSignature"
  | "invalidProof"
  | "walletMismatch"
  | "wrongChain"
  | "notOpen";

const VIEW_MESSAGES: Record<ViewProblem, string> = {
  malformedResponse: "Sunucudan beklenmeyen bir yanıt geldi. Borç gösterilmiyor.",
  invalidManifest:
    "Paylaşılan hesap doğrulanamadı veya süresi dolmuş. Borç gösterilmiyor.",
  invalidRecipientSignature:
    "Hesabın alıcı imzası doğrulanamadı. Bu bağlantıya güvenme; borç gösterilmiyor.",
  invalidProof:
    "Borcun imzalanan hesaba ait olduğu kanıtlanamadı. Borç gösterilmiyor.",
  walletMismatch:
    "Bu borç bağlı cüzdana ait değil. Doğru cüzdana geçip tekrar dene.",
  wrongChain: "Cüzdan Arc Testnet'te değil. Borç gösterilmiyor.",
  notOpen: "Bu paylaşılan hesap artık açık değil.",
};

export function describeViewProblem(problem: ViewProblem): string {
  return VIEW_MESSAGES[problem];
}

export type VerifyViewResult =
  | { ok: true; view: VerifiedView }
  | { ok: false; problem: ViewProblem };

function isProofShape(value: unknown): value is SharedBillProof {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.leafIndex) || (record.leafIndex as number) < 0) {
    return false;
  }
  if (!Array.isArray(record.siblings)) {
    return false;
  }
  if (record.siblings.length > MAX_SHARED_BILL_PROOF_LENGTH) {
    return false;
  }
  return record.siblings.every(
    (entry) => typeof entry === "string" && BYTES32.test(entry),
  );
}

/**
 * Sunucu yanıtının TAM bağımsız doğrulaması.
 *
 * `now` ve `connectedChainId` çağırandan gelir; böylece React'ten bağımsız
 * ve belirlenimci biçimde test edilebilir.
 */
export async function verifyAuthenticatedView(input: {
  payload: unknown;
  connectedAddress: string;
  connectedChainId: number | null;
  billId: string;
  nowMs: number;
}): Promise<VerifyViewResult> {
  const { payload, connectedAddress, connectedChainId, billId, nowMs } = input;

  if (!isArcTestnet(connectedChainId)) {
    return { ok: false, problem: "wrongChain" };
  }
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, problem: "malformedResponse" };
  }
  const record = payload as Record<string, unknown>;

  if (
    typeof record.recipientSignature !== "string" ||
    !SIGNATURE.test(record.recipientSignature) ||
    typeof record.billExpiresAt !== "number" ||
    !Number.isSafeInteger(record.billExpiresAt) ||
    typeof record.status !== "string" ||
    typeof record.recipient !== "object" ||
    record.recipient === null
  ) {
    return { ok: false, problem: "malformedResponse" };
  }
  if (record.status !== "open") {
    return { ok: false, problem: "notOpen" };
  }
  if (!isProofShape(record.proof)) {
    return { ok: false, problem: "malformedResponse" };
  }

  // 1) Manifest: katı şema ve zaman penceresi.
  const validated = validateSharedBillManifest(record.manifest, nowMs);
  if (!validated.ok) {
    return { ok: false, problem: "invalidManifest" };
  }
  const manifest = validated.manifest;
  if (!BILL_ID.test(billId) || manifest.billId !== billId.toLowerCase()) {
    return { ok: false, problem: "invalidManifest" };
  }
  if (manifest.chainId !== connectedChainId) {
    return { ok: false, problem: "wrongChain" };
  }

  /*
   * 2) Borç satırı, ÜRETİMDE kullanılan AYNI katı doğrulayıcıdan geçer.
   * Tek satırlık bir liste olarak kanonikleştirilir; böylece adres, etiket,
   * borç kimliği ve tutar kuralları burada da uygulanır.
   */
  const canonical = canonicalizeSharedBillDebts(
    [record.debt],
    manifest.recipient,
  );
  if (!canonical.ok || canonical.debts.length !== 1) {
    return { ok: false, problem: "malformedResponse" };
  }
  const debt = canonical.debts[0];

  // 3) Satır BAĞLI cüzdana mı ait?
  if (!walletAddressesEqual(debt.debtor, connectedAddress)) {
    return { ok: false, problem: "walletMismatch" };
  }

  // 4) ALICI imzası: kökü gerçekten alıcı imzalamış mı?
  const signatureOk = await verifySharedBillSignature(
    manifest,
    record.recipientSignature,
  );
  if (!signatureOk.ok) {
    return { ok: false, problem: "invalidRecipientSignature" };
  }

  // 5) MERKLE içerme: satır imzalanan köke ait mi?
  const inclusion = verifySharedBillDebtInclusion({
    manifest,
    debt,
    proof: record.proof,
  });
  if (!inclusion.ok) {
    return { ok: false, problem: "invalidProof" };
  }

  return {
    ok: true,
    view: Object.freeze({
      manifest,
      debt,
      /*
       * Alıcı adresi ve etiketi MANİFESTTEN alınır, yanıttaki `recipient`
       * alanından DEĞİL: imzalanan — ve dolayısıyla güvenilebilecek — değer
       * manifesttekidir. Sunucu farklı bir etiket gönderse bile gösterilmez.
       */
      recipient: Object.freeze({
        address: manifest.recipient,
        label: manifest.recipientLabel,
      }),
      billExpiresAt: manifest.expiresAt,
    }),
  };
}
