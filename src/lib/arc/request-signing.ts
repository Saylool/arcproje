import { recoverTypedDataAddress } from "viem";

import { normalizeWalletAddress, walletAddressesEqual } from "./address";
import { isArcTestnet, parseChainId } from "./network";
import {
  buildTypedData,
  isValidSignatureFormat,
  validatePaymentRequestPayload,
  type PaymentRequestPayload,
  type SignedPaymentRequest,
} from "./payment-request";
import { withProvider } from "./wallet";

/**
 * Ödeme talebinin imzalanması ve doğrulanması.
 *
 * İmza YALNIZCA talebi oluşturur; hiçbir transfer yetkisi vermez. İmzalayan,
 * fişi ödeyen (alıcı) olmalıdır. İmzadan hemen önce provider'a hesap ve zincir
 * yeniden sorulur; değişmişse imzalama yapılmaz.
 *
 * Cüzdana hiçbir şey sorulmadan ÖNCE gövdenin tamamı katı doğrulamadan geçer.
 * Kullanıcıya, uygulamanın kendi kurallarını geçemeyen bir gövde için cüzdan
 * onay ekranı gösterilmez; imzalanan şey her zaman doğrulanmış kanonik
 * gövdedir.
 *
 * Doğrulama viem'in `recoverTypedDataAddress` fonksiyonuyla yapılır; bu EOA
 * (harici hesap) imzalarını güvenle çözer. Sözleşme hesapları (ERC-1271) için
 * bir public client üzerinden zincir sorgusu gerekir; tarayıcı-yalnız bu
 * kurulumda desteklenmez ve bu sınır UI'da belirtilir.
 */

export type RequestSigningErrorCode =
  | "noProvider"
  | "rejected"
  | "noAccount"
  | "accountChanged"
  | "networkChanged"
  | "invalidPayload"
  | "invalidRecipient"
  | "signatureFormat"
  | "signerMismatch"
  | "signFailed";

const MESSAGES: Record<RequestSigningErrorCode, string> = {
  noProvider: "Cüzdan bağlantısı bulunamadı. Cüzdanı yeniden bağla.",
  rejected: "İmza cüzdanda reddedildi.",
  noAccount: "Cüzdanda açık bir hesap yok.",
  accountChanged:
    "Cüzdandaki aktif hesap, talebin alıcısı değil. Fişi ödeyen hesaba geçip tekrar dene.",
  networkChanged:
    "Cüzdan Arc Testnet'te değil. Ağı Arc Testnet'e alıp tekrar dene.",
  invalidPayload:
    "Ödeme talebi kendi doğrulamamızdan geçmedi; cüzdana hiçbir şey gönderilmedi. Tutarı, kuru ve adresleri kontrol edip tekrar dene.",
  invalidRecipient: "Alıcı cüzdan adresi geçersiz.",
  signatureFormat: "Cüzdan beklenen biçimde bir imza döndürmedi.",
  signerMismatch:
    "İmzayı atan hesap talebin alıcısıyla eşleşmiyor. Talep oluşturulmadı.",
  signFailed: "Ödeme talebi imzalanamadı. Lütfen tekrar dene.",
};

export function describeRequestSigningError(
  code: RequestSigningErrorCode,
): string {
  return MESSAGES[code];
}

export type RequestSigningResult =
  | { ok: true; request: SignedPaymentRequest }
  | { ok: false; code: RequestSigningErrorCode };

/** EIP-712 mesajı JSON'a yazılırken BigInt alanlar ondalık metne çevrilir. */
function toEip712Json(payload: PaymentRequestPayload): string {
  const typedData = buildTypedData(payload);
  return JSON.stringify({
    domain: typedData.domain,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      ...typedData.types,
    },
    primaryType: typedData.primaryType,
    message: {
      schemaVersion: payload.schemaVersion,
      requestId: payload.requestId,
      chainId: String(payload.chainId),
      recipient: payload.recipient,
      debtor: payload.debtor,
      debtKey: payload.debtKey,
      tryMinor: payload.tryMinor,
      rateNumerator: payload.rateNumerator,
      rateDenominator: payload.rateDenominator,
      microUsdc: payload.microUsdc,
      issuedAt: String(payload.issuedAt),
      expiresAt: String(payload.expiresAt),
      recipientLabel: payload.recipientLabel,
      debtorLabel: payload.debtorLabel,
    },
  });
}

/**
 * Talebi imzalar. Alıcı adresi, imzalayan hesapla birebir eşleşmelidir.
 * İmza alındıktan sonra, paylaşılabilir bağlantı üretilmeden önce doğrulanır.
 *
 * `now` yalnızca testlerde belirlenimci zaman vermek içindir; üretimde geçerli
 * zaman kullanılır.
 */
export async function signPaymentRequest(
  walletUuid: string,
  payload: PaymentRequestPayload,
  now: () => number = Date.now,
): Promise<RequestSigningResult> {
  /*
   * Sağlayıcıya dokunmadan önce gövdenin TAMAMI doğrulanır: talep kimliği,
   * zincir, adresler, zaman alanları, etiketler, kur, tutar ve tutarın borçla
   * ekonomik tutarlılığı. Geçersiz bir gövde için `withProvider` hiç çağrılmaz,
   * dolayısıyla `eth_signTypedData_v4` de çağrılmaz ve paylaşılabilir bir
   * bağlantı üretilemez.
   */
  const validated = validatePaymentRequestPayload(payload, now());
  if (!validated.ok) {
    return { ok: false, code: "invalidPayload" };
  }
  // Bundan sonra yalnızca normalleştirilmiş kanonik gövde kullanılır.
  const canonical = validated.payload;

  const recipient = normalizeWalletAddress(canonical.recipient);
  if (recipient === null) {
    return { ok: false, code: "invalidRecipient" };
  }

  let guard: RequestSigningErrorCode | null = null;
  let signature: string | null = null;

  const outcome = await withProvider(walletUuid, async (provider) => {
    // İmzadan hemen önce hesap ve ağ yeniden okunur.
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
    if (!walletAddressesEqual(active, recipient)) {
      guard = "accountChanged";
      throw new Error("preflight");
    }

    const chainId = parseChainId(await provider.request({ method: "eth_chainId" }));
    if (chainId === null || !isArcTestnet(chainId)) {
      guard = "networkChanged";
      throw new Error("preflight");
    }

    const result = await provider.request({
      method: "eth_signTypedData_v4",
      params: [active, toEip712Json(canonical)],
    });
    if (!isValidSignatureFormat(result)) {
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
  signature = outcome.value;

  // Paylaşılabilir bağlantı üretilmeden önce imza doğrulanır.
  const verified = await verifyPaymentRequestSignature({
    payload: canonical,
    signature,
  });
  if (!verified.ok) {
    return { ok: false, code: "signerMismatch" };
  }

  return { ok: true, request: Object.freeze({ payload: canonical, signature }) };
}

export type VerifyResult =
  | { ok: true; signer: string }
  | { ok: false; reason: "format" | "recoverFailed" | "signerMismatch" };

/**
 * İmzayı doğrular ve imzalayanın talebin alıcısı olduğunu kanıtlar.
 * EOA imzaları desteklenir; ERC-1271 sözleşme hesapları desteklenmez.
 */
export async function verifyPaymentRequestSignature(
  request: SignedPaymentRequest,
): Promise<VerifyResult> {
  if (!isValidSignatureFormat(request.signature)) {
    return { ok: false, reason: "format" };
  }

  const typedData = buildTypedData(request.payload);
  let signer: string;
  try {
    signer = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: request.signature as `0x${string}`,
    });
  } catch {
    return { ok: false, reason: "recoverFailed" };
  }

  if (!walletAddressesEqual(signer, request.payload.recipient)) {
    return { ok: false, reason: "signerMismatch" };
  }
  return { ok: true, signer };
}
