import { describe, expect, it } from "vitest";

import {
  buildArcExplorerTxUrl,
  isValidTransactionHash,
  ARC_NATIVE_GAS_DECIMALS,
  ARC_TESTNET_APP_KIT_CHAIN,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID_HEX,
  ARC_USDC_ERC20_ADDRESS,
  ARC_USDC_ERC20_DECIMALS,
  buildAddArcTestnetParams,
  isArcTestnet,
  isValidArcExplorerUrl,
  parseChainId,
} from "./network";

describe("Arc Testnet sabitleri", () => {
  it("resmî ağ değerlerini taşır", () => {
    expect(ARC_TESTNET_CHAIN_ID).toBe(5042002);
    expect(ARC_TESTNET_APP_KIT_CHAIN).toBe("Arc_Testnet");
    expect(ARC_USDC_ERC20_ADDRESS).toBe(
      "0x3600000000000000000000000000000000000000",
    );
  });

  it("hex zincir kimliğini ondalıktan doğru türetir", () => {
    expect(Number.parseInt(ARC_TESTNET_CHAIN_ID_HEX, 16)).toBe(
      ARC_TESTNET_CHAIN_ID,
    );
  });

  it("ERC-20 ve native ondalıklarını ayrı tutar", () => {
    expect(ARC_USDC_ERC20_DECIMALS).toBe(6);
    expect(ARC_NATIVE_GAS_DECIMALS).toBe(18);
    expect(ARC_USDC_ERC20_DECIMALS).not.toBe(ARC_NATIVE_GAS_DECIMALS);
  });

  it("wallet_addEthereumChain parametrelerinde native 18 ondalık kullanır", () => {
    const params = buildAddArcTestnetParams();
    expect(params.nativeCurrency.decimals).toBe(ARC_NATIVE_GAS_DECIMALS);
    expect(params.chainId).toBe(ARC_TESTNET_CHAIN_ID_HEX);
    expect(params.rpcUrls[0].startsWith("https://")).toBe(true);
    expect(params.blockExplorerUrls[0]).toContain("arcscan.app");
  });
});

describe("parseChainId / isArcTestnet", () => {
  it("hex ve ondalık kimlikleri çözer", () => {
    expect(parseChainId("0x4cef52")).toBe(5042002);
    expect(parseChainId(5042002)).toBe(5042002);
    expect(parseChainId("5042002")).toBe(5042002);
  });

  it("geçersiz değerlerde null döner", () => {
    expect(parseChainId(null)).toBeNull();
    expect(parseChainId("abc")).toBeNull();
    expect(parseChainId({})).toBeNull();
  });

  it("yalnızca Arc Testnet için true döner", () => {
    expect(isArcTestnet(5042002)).toBe(true);
    expect(isArcTestnet(1)).toBe(false);
    expect(isArcTestnet(null)).toBe(false);
  });
});

describe("isValidArcExplorerUrl", () => {
  it("HTTPS ArcScan bağlantılarını kabul eder", () => {
    expect(isValidArcExplorerUrl("https://testnet.arcscan.app/tx/0xabc")).toBe(
      true,
    );
    expect(isValidArcExplorerUrl("https://arcscan.app/tx/0xabc")).toBe(true);
  });

  it("HTTP ve başka alan adlarını reddeder", () => {
    expect(isValidArcExplorerUrl("http://testnet.arcscan.app/tx/0xabc")).toBe(
      false,
    );
    expect(isValidArcExplorerUrl("https://evil.example.com/tx/0xabc")).toBe(false);
    // Alan adı sonuna eklenmiş sahte host.
    expect(isValidArcExplorerUrl("https://arcscan.app.evil.com/tx")).toBe(false);
    expect(isValidArcExplorerUrl("javascript:alert(1)")).toBe(false);
    expect(isValidArcExplorerUrl("")).toBe(false);
  });
});

describe("parseChainId — katı ayrıştırma", () => {
  it("tam eşleşen hex ve ondalık değerleri kabul eder", () => {
    expect(parseChainId("0x4cef52")).toBe(ARC_TESTNET_CHAIN_ID);
    expect(parseChainId("0X4CEF52")).toBe(ARC_TESTNET_CHAIN_ID);
    expect(parseChainId("5042002")).toBe(ARC_TESTNET_CHAIN_ID);
    expect(parseChainId(5042002)).toBe(ARC_TESTNET_CHAIN_ID);
    expect(parseChainId(BigInt(5042002))).toBe(ARC_TESTNET_CHAIN_ID);
    expect(parseChainId("0x1")).toBe(1);
  });

  it("sondaki çöpü sessizce yok saymaz", () => {
    // Number.parseInt bunları geçerli sayardı; kullanıcı yanlış ağda olduğu
    // hâlde doğru ağdaymış gibi görünürdü.
    expect(parseChainId("0x4cef52junk")).toBeNull();
    expect(parseChainId("5042002abc")).toBeNull();
    expect(parseChainId("0x4cef52 ")).toBe(ARC_TESTNET_CHAIN_ID);
    expect(parseChainId("0x4cef52,")).toBeNull();
    expect(parseChainId("5042002.0")).toBeNull();
  });

  it("boş, negatif ve bozuk değerleri reddeder", () => {
    expect(parseChainId("")).toBeNull();
    expect(parseChainId("   ")).toBeNull();
    expect(parseChainId("0x")).toBeNull();
    expect(parseChainId("-1")).toBeNull();
    expect(parseChainId("-0x1")).toBeNull();
    expect(parseChainId(-1)).toBeNull();
    expect(parseChainId(1.5)).toBeNull();
    expect(parseChainId(Number.NaN)).toBeNull();
    expect(parseChainId(null)).toBeNull();
    expect(parseChainId(undefined)).toBeNull();
    expect(parseChainId({})).toBeNull();
    expect(parseChainId("0xzz")).toBeNull();
  });

  it("güvenli tam sayı aralığını aşan değerleri reddeder", () => {
    expect(parseChainId("9007199254740993")).toBeNull();
    expect(parseChainId(`0x${(BigInt(2) ** BigInt(80)).toString(16)}`)).toBeNull();
  });

  it("yalnızca Arc Testnet kimliğini doğru sayar", () => {
    expect(isArcTestnet(parseChainId("0x4cef52"))).toBe(true);
    expect(isArcTestnet(parseChainId("0x1"))).toBe(false);
    expect(isArcTestnet(parseChainId("0x4cef52junk"))).toBe(false);
  });
});

describe("işlem hash'i ve explorer bağlantısı", () => {
  const valid = `0x${"a".repeat(64)}`;

  it("tam 32 baytlık hash'i kabul eder", () => {
    expect(isValidTransactionHash(valid)).toBe(true);
    expect(isValidTransactionHash(`0x${"A1b2".repeat(16)}`)).toBe(true);
  });

  it("hatalı uzunluk ve biçimleri reddeder", () => {
    expect(isValidTransactionHash(`0x${"a".repeat(63)}`)).toBe(false);
    expect(isValidTransactionHash(`0x${"a".repeat(65)}`)).toBe(false);
    expect(isValidTransactionHash("a".repeat(64))).toBe(false);
    expect(isValidTransactionHash(`0x${"z".repeat(64)}`)).toBe(false);
    expect(isValidTransactionHash("")).toBe(false);
    expect(isValidTransactionHash(null)).toBe(false);
    expect(isValidTransactionHash(123)).toBe(false);
  });

  it("bağlantıyı doğrulanmış hash'ten yerelde kurar", () => {
    expect(buildArcExplorerTxUrl(valid)).toBe(
      `https://testnet.arcscan.app/tx/${valid}`,
    );
  });

  it("geçersiz hash için bağlantı üretmez", () => {
    expect(buildArcExplorerTxUrl("0xdeadbeef")).toBeNull();
    expect(buildArcExplorerTxUrl("javascript:alert(1)")).toBeNull();
    expect(buildArcExplorerTxUrl(`${valid}/../evil`)).toBeNull();
  });

  it("kötü niyetli explorer URL'lerini kabul etmez", () => {
    expect(isValidArcExplorerUrl("http://testnet.arcscan.app/tx/0x1")).toBe(false);
    expect(isValidArcExplorerUrl("https://evil.com/tx/0x1")).toBe(false);
    expect(isValidArcExplorerUrl("https://testnet.arcscan.app.evil.com/")).toBe(false);
    expect(isValidArcExplorerUrl("javascript:alert(1)")).toBe(false);
  });
});
