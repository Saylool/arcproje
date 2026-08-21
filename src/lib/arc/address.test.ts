import { describe, expect, it } from "vitest";

import {
  isValidWalletAddress,
  normalizeWalletAddress,
  shortenWalletAddress,
  walletAddressesEqual,
} from "./address";

const LOWER = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
const CHECKSUM = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

describe("normalizeWalletAddress", () => {
  it("geçerli adresi checksum'lı biçime çevirir", () => {
    expect(normalizeWalletAddress(LOWER)).toBe(CHECKSUM);
    expect(normalizeWalletAddress(CHECKSUM)).toBe(CHECKSUM);
    expect(normalizeWalletAddress(`  ${LOWER}  `)).toBe(CHECKSUM);
  });

  it("geçersiz adreslerde null döner", () => {
    expect(normalizeWalletAddress("")).toBeNull();
    expect(normalizeWalletAddress("0x123")).toBeNull();
    expect(normalizeWalletAddress("cuzdanim")).toBeNull();
    // 0x öneki eksik.
    expect(normalizeWalletAddress(LOWER.slice(2))).toBeNull();
    // Fazla karakter.
    expect(normalizeWalletAddress(`${LOWER}00`)).toBeNull();
  });

  it("isValidWalletAddress ile tutarlıdır", () => {
    expect(isValidWalletAddress(LOWER)).toBe(true);
    expect(isValidWalletAddress("0x123")).toBe(false);
  });
});

describe("walletAddressesEqual", () => {
  it("checksum farkını yok sayar", () => {
    expect(walletAddressesEqual(LOWER, CHECKSUM)).toBe(true);
    expect(walletAddressesEqual(CHECKSUM, LOWER.toUpperCase().replace("0X", "0x"))).toBe(
      true,
    );
  });

  it("farklı adresleri eşit saymaz", () => {
    expect(
      walletAddressesEqual(LOWER, "0x0000000000000000000000000000000000000001"),
    ).toBe(false);
  });

  it("geçersiz adresleri asla eşit saymaz", () => {
    expect(walletAddressesEqual("", "")).toBe(false);
    expect(walletAddressesEqual(LOWER, "bozuk")).toBe(false);
  });
});

describe("shortenWalletAddress", () => {
  it("kısa gösterim üretir", () => {
    expect(shortenWalletAddress(LOWER)).toBe("0x742d…f44e");
  });

  it("geçersiz adresi olduğu gibi bırakır", () => {
    expect(shortenWalletAddress("bozuk")).toBe("bozuk");
  });
});
