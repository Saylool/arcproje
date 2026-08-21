import { getAddress, isAddress } from "viem";

/**
 * Adresi doğrular ve checksum'lı biçime çevirir. Geçersizse null döner.
 * Doğrulama viem'e bırakılır; elle regex yazılmaz.
 */
export function normalizeWalletAddress(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || !isAddress(trimmed, { strict: false })) {
    return null;
  }
  try {
    return getAddress(trimmed);
  } catch {
    return null;
  }
}

export function isValidWalletAddress(value: string): boolean {
  return normalizeWalletAddress(value) !== null;
}

/**
 * İki adresin aynı hesabı gösterip göstermediğini karşılaştırır.
 * Karşılaştırma checksum'a duyarsızdır; ikisi de geçerli olmalıdır.
 */
export function walletAddressesEqual(a: string, b: string): boolean {
  const left = normalizeWalletAddress(a);
  const right = normalizeWalletAddress(b);
  return left !== null && right !== null && left === right;
}

/** Kısa gösterim: 0x1234…abcd */
export function shortenWalletAddress(value: string): string {
  const normalized = normalizeWalletAddress(value);
  if (normalized === null) {
    return value;
  }
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}
