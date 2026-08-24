import { recoverTypedDataAddress } from "viem";

import { normalizeWalletAddress, walletAddressesEqual } from "./address";
import { isArcTestnet, parseChainId } from "./network";
import {
  buildSharedBillTypedData,
  isValidSharedBillSignatureFormat,
  validateSharedBillManifest,
  type SharedBillManifest,
} from "./shared-bill";
import { withProvider } from "./wallet";

/**
 * Paylaşılan grup hesabı manifestinin imzalanması ve doğrulanması.
 *
 * İmza YALNIZCA hesabı oluşturur; hiçbir transfer yetkisi vermez ve borçlunun
 * cüzdanından para çekemez. İmzalayan, fişi ödeyen (alıcı) olmalıdır.
 *
 * Cüzdana hiçbir şey sorulmadan ÖNCE manifestin tamamı katı doğrulamadan
 * geçer; imzadan hemen önce hesap ve zincir sağlayıcıya YENİDEN sorulur.
 * Dönen imza, yayımlamaya izin verilmeden önce yerelde doğrulanır.
 *
 * EOA imzaları desteklenir; ERC-1271 sözleşme hesapları desteklenmez.
 */

export type SharedBillSigningErrorCode =
  | "noProvider"
  | "rejected"
  | "noAccount"
  | "accountChanged"
  | "networkChanged"
  | "invalidManifest"
  | "invalidRecipient"
  | "signatureFormat"
  | "signerMismatch"
  | "signFailed";

const MESSAGES: Record<SharedBillSigningErrorCode, string> = {
  noProvider: "Cüzdan bağlantısı bulunamadı. Cüzdanı yeniden bağla.",
  rejected: "İmza cüzdanda reddedildi.",
  noAccount: "Cüzdanda açık bir hesap yok.",
  accountChanged:
    "Cüzdandaki aktif hesap, hesabın alıcısı değil. Fişi ödeyen hesaba geçip tekrar dene.",
  networkChanged:
    "Cüzdan Arc Testnet'te değil. Ağı Arc Testnet'e alıp tekrar dene.",
  invalidManifest:
    "Paylaşılan hesap kendi doğrulamamızdan geçmedi; cüzdana hiçbir şey gönderilmedi. Adresleri ve tutarları kontrol edip tekrar dene.",
  invalidRecipient: "Alıcı cüzdan adresi geçersiz.",
  signatureFormat: "Cüzdan beklenen biçimde bir imza döndürmedi.",
  signerMismatch:
    "İmzayı atan hesap hesabın alıcısıyla eşleşmiyor. Paylaşılan hesap oluşturulmadı.",
  signFailed: "Paylaşılan hesap imzalanamadı. Lütfen tekrar dene.",
};

export function describeSharedBillSigningError(
  code: SharedBillSigningErrorCode,
): string {
  return MESSAGES[code];
}

export type SharedBillSigningResult =
  | { ok: true; manifest: SharedBillManifest; signature: string }
  | { ok: false; code: SharedBillSigningErrorCode };

/**
 * EIP-712 mesajını cüzdanın beklediği JSON'a çevirir.
 *
 * Alan listesi ELLE YAZILMAZ: doğrudan `buildSharedBillTypedData` çıktısı
 * dönüştürülür. İkinci, elle tutulan bir liste şema büyüdüğünde sessizce
 * eksik kalır ve cüzdana imzalatılan özet ile doğrulanan özet ayrışırdı.
 */
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

export function toSharedBillEip712Json(manifest: SharedBillManifest): string {
  const typedData = buildSharedBillTypedData(manifest);
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

/**
 * Manifesti imzalar. Alıcı adresi, imzalayan hesapla birebir eşleşmelidir.
 *
 * `now` yalnızca testlerde belirlenimci zaman vermek içindir.
 */
export async function signSharedBillManifest(
  walletUuid: string,
  manifest: SharedBillManifest,
  now: () => number = Date.now,
): Promise<SharedBillSigningResult> {
  /*
   * Sağlayıcıya dokunmadan önce manifestin TAMAMI doğrulanır: hesap kimliği,
   * zincir, alıcı, taahhüt biçimi, borç sayısı ve zaman penceresi. Geçersiz
   * bir manifest için `withProvider` hiç çağrılmaz, dolayısıyla
   * `eth_signTypedData_v4` de çağrılmaz.
   */
  const validated = validateSharedBillManifest(manifest, now());
  if (!validated.ok) {
    return { ok: false, code: "invalidManifest" };
  }
  const canonical = validated.manifest;

  const recipient = normalizeWalletAddress(canonical.recipient);
  if (recipient === null) {
    return { ok: false, code: "invalidRecipient" };
  }

  let guard: SharedBillSigningErrorCode | null = null;

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

    const chainId = parseChainId(
      await provider.request({ method: "eth_chainId" }),
    );
    if (chainId === null || !isArcTestnet(chainId)) {
      guard = "networkChanged";
      throw new Error("preflight");
    }

    const result = await provider.request({
      method: "eth_signTypedData_v4",
      params: [active, toSharedBillEip712Json(canonical)],
    });
    if (!isValidSharedBillSignatureFormat(result)) {
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

  // Yayımlamaya izin verilmeden önce imza YERELDE doğrulanır.
  const verified = await verifySharedBillSignature(canonical, outcome.value);
  if (!verified.ok) {
    return { ok: false, code: "signerMismatch" };
  }

  return { ok: true, manifest: canonical, signature: outcome.value };
}

export type SharedBillVerifyResult =
  | { ok: true; signer: string }
  | { ok: false; reason: "format" | "recoverFailed" | "signerMismatch" };

/**
 * İmzayı doğrular ve imzalayanın manifestin alıcısı olduğunu kanıtlar.
 * EOA imzaları desteklenir; ERC-1271 sözleşme hesapları desteklenmez.
 */
export async function verifySharedBillSignature(
  manifest: SharedBillManifest,
  signature: string,
): Promise<SharedBillVerifyResult> {
  if (!isValidSharedBillSignatureFormat(signature)) {
    return { ok: false, reason: "format" };
  }

  const typedData = buildSharedBillTypedData(manifest);
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

  if (!walletAddressesEqual(signer, manifest.recipient)) {
    return { ok: false, reason: "signerMismatch" };
  }
  return { ok: true, signer };
}
