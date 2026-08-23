import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { MAX_RATE_VALUE } from "./conversion";
import {
  buildTypedData,
  createPaymentRequestPayload,
  validatePaymentRequestPayload,
  type PaymentRequestPayload,
} from "./payment-request";
import { decodeSignedRequest, encodeSignedRequest } from "./request-codec";

/**
 * Ekonomik tutarlılık sınırı.
 *
 * Geçerli bir EIP-712 imzası yalnızca alanları KİMİN imzaladığını kanıtlar.
 * Alanların birbiriyle tutarlı olduğunu kanıtlamaz: kötü niyetli bir talep
 * oluşturucu, küçük bir TRY borcunu büyük bir USDC tutarıyla eşleştirip bunu
 * kendi cüzdanıyla kusursuz biçimde imzalayabilir.
 *
 * Buradaki testlerde imza GERÇEK kriptografiyle üretilir; anahtar test
 * çalışırken bellekte doğar, hiçbir yere yazılmaz. Gerçek bir cüzdan, gerçek
 * bir anahtar veya zincir işlemi kullanılmaz.
 */

import { buildTestQuote } from "@/lib/rates/quote-fixture";

const NOW = 1_700_000_000_000;
const RATE_4000 = buildTestQuote({ nowMs: NOW, wholeRate: 4000 });
const RATE_32 = buildTestQuote({ nowMs: NOW, wholeRate: 32 });

/** Kötü niyetli talep oluşturucu: kendi cüzdanı var, imzası geçerli. */
const attacker = privateKeyToAccount(generatePrivateKey());
const debtor = privateKeyToAccount(generatePrivateKey());

/** 20000 kuruş, 1 USDC = 4000 TRY -> tam olarak 50000 mikro USDC. */
function honestPayload(): PaymentRequestPayload {
  const created = createPaymentRequestPayload({
    recipient: attacker.address,
    debtor: debtor.address,
    debtKey: "b->a",
    tryMinor: 20000,
    quote: RATE_4000.quote,
    quoteTag: RATE_4000.tag,
    microUsdc: BigInt(50_000),
    recipientLabel: "Sen",
    debtorLabel: "Ayşe",
    nowMs: NOW,
    requestId: `0x${"33".repeat(32)}`,
  });
  if (!created.ok) {
    throw new Error(`dürüst talep üretilemedi: ${created.problem}`);
  }
  return created.payload;
}

/** Gövdeyi saldırganın cüzdanıyla gerçekten imzalar. */
async function signAndEncode(payload: PaymentRequestPayload) {
  const typedData = buildTypedData(payload);
  const signature = await attacker.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
  return { signature, encoded: encodeSignedRequest({ payload, signature }) };
}

describe("kriptografik olarak geçerli ama ekonomik olarak tutarsız talep", () => {
  it("imza kusursuzdur ama talep cüzdan adımına gelmeden reddedilir", async () => {
    // Borç aynı kalır, gönderilecek USDC 100 katına çıkarılır.
    const tampered: PaymentRequestPayload = {
      ...honestPayload(),
      microUsdc: "5000000",
    };
    const { signature, encoded } = await signAndEncode(tampered);

    // İmza gerçekten geçerli: alanları imzalayan, talebin alıcısıdır.
    const typedData = buildTypedData(tampered);
    const signer = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature,
    });
    expect(signer.toLowerCase()).toBe(attacker.address.toLowerCase());

    // Yine de çözümleme reddeder; imza doğrulaması, cüzdan keşfi ve ödeme
    // arayüzü bu noktadan sonra hiç çalışmaz.
    expect(decodeSignedRequest(encoded, NOW)).toEqual({
      ok: false,
      problem: "inconsistentAmount",
    });
  });

  it("tek mikro USDC'lik sapmayı bile yakalar", async () => {
    for (const microUsdc of ["50001", "49999"]) {
      const { encoded } = await signAndEncode({
        ...honestPayload(),
        microUsdc,
      });
      expect(decodeSignedRequest(encoded, NOW), microUsdc).toEqual({
        ok: false,
        problem: "inconsistentAmount",
      });
    }
  });

  it("dürüst talep kabul edilmeye devam eder", async () => {
    const payload = honestPayload();
    const { encoded } = await signAndEncode(payload);
    const decoded = decodeSignedRequest(encoded, NOW);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.request.payload).toEqual(payload);
  });
});

describe("kur alanları elle girilen kurla aynı sınırlara tabidir", () => {
  const rejectedRate = (
    rateNumerator: string,
    rateDenominator: string,
    microUsdc: string,
  ) =>
    validatePaymentRequestPayload(
      { ...honestPayload(), rateNumerator, rateDenominator, microUsdc },
      NOW,
    );

  it("kanonik olmayan ondalık paydayı reddeder", () => {
    // 3, 20 ve 10^7 hiçbir "1 USDC = X TRY" girdisinden doğamaz.
    for (const denominator of ["3", "20", "10000000", "0"]) {
      expect(
        rejectedRate("4000", denominator, "50000"),
        denominator,
      ).toEqual({ ok: false, problem: "invalidRate" });
    }
  });

  it("kanonik paydaları kabul eder", () => {
    // 1 USDC = 400,0 TRY -> 4000/10; tutar yine tam olarak 50000 mikro USDC.
    const result = validatePaymentRequestPayload(
      {
        ...honestPayload(),
        rateNumerator: "40000",
        rateDenominator: "10",
        microUsdc: "50000",
      },
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("üst sınırın üstündeki kuru reddeder", () => {
    const tooLarge = (MAX_RATE_VALUE + BigInt(1)).toString();
    expect(rejectedRate(tooLarge, "1", "1")).toEqual({
      ok: false,
      problem: "invalidRate",
    });
  });

  it("sıfır veya negatif payı reddeder", () => {
    expect(rejectedRate("0", "1", "50000")).toEqual({
      ok: false,
      problem: "invalidRate",
    });
    expect(rejectedRate("-4000", "1", "50000")).toEqual({
      ok: false,
      problem: "invalidRate",
    });
  });
});

describe("yuvarlama sınırı üretim ve doğrulamada aynıdır", () => {
  /** 1 kuruş, 1 USDC = 32 TRY -> 312,5 mikro USDC -> yarım yukarı -> 313. */
  const halfUpInput = {
    recipient: attacker.address,
    debtor: debtor.address,
    debtKey: "b->a",
    tryMinor: 1,
    quote: RATE_32.quote,
    quoteTag: RATE_32.tag,
    recipientLabel: "Sen",
    debtorLabel: "Ayşe",
    nowMs: NOW,
    requestId: `0x${"44".repeat(32)}`,
  };

  it("yarım yukarı yuvarlanmış tutarla üretilebilir", () => {
    const created = createPaymentRequestPayload({
      ...halfUpInput,
      microUsdc: BigInt(313),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.payload.microUsdc).toBe("313");
  });

  it("aşağı yuvarlanmış tutar üretimde de reddedilir", () => {
    expect(
      createPaymentRequestPayload({ ...halfUpInput, microUsdc: BigInt(312) }),
    ).toEqual({ ok: false, problem: "inconsistentAmount" });
  });

  it("doğrulama da aynı sınırı uygular", () => {
    const base = honestPayload();
    const accepted = validatePaymentRequestPayload(
      {
        ...base,
        tryMinor: "1",
        rateNumerator: "32",
        rateDenominator: "1",
        microUsdc: "313",
      },
      NOW,
    );
    expect(accepted.ok).toBe(true);

    const rejected = validatePaymentRequestPayload(
      {
        ...base,
        tryMinor: "1",
        rateNumerator: "32",
        rateDenominator: "1",
        microUsdc: "312",
      },
      NOW,
    );
    expect(rejected).toEqual({ ok: false, problem: "inconsistentAmount" });
  });
});
