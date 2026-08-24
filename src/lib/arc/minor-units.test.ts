import { describe, expect, it } from "vitest";

import {
  MAX_MINOR_UNITS_DIGITS,
  isCanonicalMinorUnits,
  parsePositiveMinorUnits,
  toCanonicalMinorUnits,
} from "./minor-units";
import { convertTryMinorBigIntToMicroUsdc, parseSignedRate } from "./conversion";
import { validatePaymentSnapshot, type ArcPaymentSnapshot } from "./send";

/**
 * KANONİK TAM SAYI GÖSTERİMİ.
 *
 * Buradaki asıl mesele `Number.MAX_SAFE_INTEGER` ÜSTÜDÜR: paylaşılan hesap
 * borçları `numeric(30, 0)` olarak saklanır ve `number`a indirilirse SESSİZCE
 * yuvarlanır. Gösterilen, tahmin edilen, rezerve edilen, gönderilen ve
 * mutabakatı yapılan tutar aynı tam sayıdan türemek zorundadır.
 */

/** 2^53 - 1 = 9007199254740991; hemen üstü `number` ile temsil edilemez. */
const ABOVE_SAFE = "9007199254740993";

describe("kanonik minor unit metni", () => {
  it("kanonik biçimi kabul eder", () => {
    for (const value of ["0", "1", "20000", ABOVE_SAFE, "9".repeat(30)]) {
      expect(isCanonicalMinorUnits(value)).toBe(true);
    }
  });

  it("kanonik olmayan her biçimi reddeder", () => {
    for (const value of [
      "",
      " 1",
      "1 ",
      "+1",
      "-1",
      "01",
      "0.0",
      "1.5",
      "1e5",
      "0x10",
      "١٢٣",
      "1,5",
      "9".repeat(MAX_MINOR_UNITS_DIGITS + 1),
      1,
      null,
      undefined,
      {},
      ["1"],
    ]) {
      expect(isCanonicalMinorUnits(value)).toBe(false);
    }
  });

  it("pozitif olmayanı `null` döner, sıfırı kabul etmez", () => {
    expect(parsePositiveMinorUnits("0")).toBeNull();
    expect(parsePositiveMinorUnits("-1")).toBeNull();
    expect(parsePositiveMinorUnits("1")).toBe(BigInt(1));
  });

  it("güvenli aralığın ÜSTÜNDEKİ değeri kayıpsız taşır", () => {
    const parsed = parsePositiveMinorUnits(ABOVE_SAFE);
    expect(parsed).toBe(BigInt(ABOVE_SAFE));
    // `Number` üzerinden geçen bir yol burada 9007199254740992 üretirdi.
    expect(parsed?.toString()).toBe(ABOVE_SAFE);
    expect(String(Number(ABOVE_SAFE))).not.toBe(ABOVE_SAFE);
  });
});

describe("sınırda kanonikleştirme", () => {
  it("güvenli sayısal borcu kanonik metne çevirir", () => {
    expect(toCanonicalMinorUnits(0)).toBe("0");
    expect(toCanonicalMinorUnits(20000)).toBe("20000");
    expect(toCanonicalMinorUnits(Number.MAX_SAFE_INTEGER)).toBe(
      "9007199254740991",
    );
  });

  it("güvenli olmayan sayıyı SESSİZCE daraltmaz", () => {
    for (const value of [
      Number.MAX_SAFE_INTEGER + 2,
      1.5,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1e21,
    ]) {
      expect(toCanonicalMinorUnits(value)).toBeNull();
    }
  });

  it("BigInt'i `number`a indirmeden taşır", () => {
    expect(toCanonicalMinorUnits(BigInt(ABOVE_SAFE))).toBe(ABOVE_SAFE);
    expect(toCanonicalMinorUnits(BigInt(-1))).toBeNull();
    expect(toCanonicalMinorUnits(BigInt("1" + "0".repeat(30)))).toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * GÖNDERİM SINIRI — güvenli aralığın üstünde
 * ---------------------------------------------------------------------------
 */

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const DEBTOR = "0x2222222222222222222222222222222222222222";
const NOW = 1_800_000_000_000;

/** Kur: 1 USDC = 4000 TRY (kanonik altı ondalık payda). */
const RATE_NUMERATOR = "4000000000";
const RATE_DENOMINATOR = "1000000";

function microFor(tryMinor: string): string {
  const rate = parseSignedRate(RATE_NUMERATOR, RATE_DENOMINATOR);
  if (!rate.ok) throw new Error("rate");
  const converted = convertTryMinorBigIntToMicroUsdc(BigInt(tryMinor), rate.rate);
  if (!converted.ok) throw new Error("convert");
  return converted.microUsdc.toString();
}

function snapshotOf(tryMinor: string): ArcPaymentSnapshot {
  const micro = microFor(tryMinor);
  const whole = BigInt(micro) / BigInt(1_000_000);
  const fraction = (BigInt(micro) % BigInt(1_000_000)).toString().padStart(6, "0");
  return Object.freeze({
    debtKey: "b->a",
    debtorParticipantId: "b",
    recipientParticipantId: "a",
    debtorAddress: DEBTOR,
    recipientAddress: RECIPIENT,
    tryMinor,
    rateNumerator: RATE_NUMERATOR,
    rateDenominator: RATE_DENOMINATOR,
    microUsdc: micro,
    amount: `${whole}.${fraction}`,
    displayAmount: `${whole},${fraction}`,
    chainId: 5042002,
    requestId: `0x${"11".repeat(32)}`,
    issuedAt: Math.floor(NOW / 1000),
    // Talep ömrü teklif ömrünü (5 dk) aşamaz.
    expiresAt: Math.floor(NOW / 1000) + 240,
    quoteId: `0x${"22".repeat(32)}`,
    quoteExpiresAt: Math.floor(NOW / 1000) + 240,
  });
}

describe("gönderim sınırı güvenli tam sayı aralığının üstünde", () => {
  it("MAX_SAFE_INTEGER üstündeki borcu KAYIPSIZ doğrular", () => {
    expect(validatePaymentSnapshot(snapshotOf(ABOVE_SAFE), NOW)).toBeNull();
  });

  it("bitişik iki büyük tutar AYNI mikro USDC'ye çökmez", () => {
    // `number`a indirgeyen bir uygulamada ikisi de 9007199254740992 olurdu.
    const a = microFor("9007199254740993");
    const b = microFor("9007199254740992");
    expect(a).not.toBe(b);
  });

  it("komşu tutarın mikro USDC'siyle imzalanmış snapshot'ı reddeder", () => {
    const tampered = {
      ...snapshotOf(ABOVE_SAFE),
      microUsdc: microFor("9007199254740992"),
    };
    const micro = BigInt(tampered.microUsdc);
    const whole = micro / BigInt(1_000_000);
    const fraction = (micro % BigInt(1_000_000)).toString().padStart(6, "0");
    expect(
      validatePaymentSnapshot(
        { ...tampered, amount: `${whole}.${fraction}` },
        NOW,
      ),
    ).toBe("inconsistentAmount");
  });

  it("30 basamağa kadar borcu taşır", () => {
    const huge = "9".repeat(30);
    expect(validatePaymentSnapshot(snapshotOf(huge), NOW)).toBeNull();
  });
});
