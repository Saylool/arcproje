import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTypedData,
  createPaymentRequestPayload,
  type PaymentRequestPayload,
} from "./payment-request";
import { buildShareUrl, encodeSignedRequest } from "./request-codec";

/**
 * İmzalamadan ÖNCE gövdenin tamamının doğrulandığını kanıtlar.
 *
 * Buradaki asıl iddia, hangi hata kodunun döndüğü değil: geçersiz bir gövde
 * için cüzdan katmanına HİÇ dokunulmadığıdır. Kullanıcıya imzalanamaz bir
 * talep için cüzdan onay penceresi açılmaz ve paylaşılabilir bir bağlantı
 * üretilemez.
 */

const providerRequest = vi.fn(async ({ method }: { method: string }) => {
  if (method === "eth_accounts") return accountsResponse;
  if (method === "eth_chainId") return "0x4cef52";
  if (method === "eth_signTypedData_v4") return signResponse;
  throw new Error("desteklenmeyen metot");
});

const withProviderMock = vi.fn(
  async (_uuid: string, run: (p: unknown) => Promise<unknown>) => {
    try {
      return { ok: true, value: await run({ request: providerRequest }) };
    } catch {
      return { ok: false, code: "requestFailed" };
    }
  },
);

vi.mock("./wallet", () => ({ withProvider: withProviderMock }));

const { signPaymentRequest } = await import("./request-signing");

const NOW = 1_700_000_000_000;
const at = (nowMs: number) => () => nowMs;
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

/** Test süresince bellekte kalan geçici imzalayanlar. */
const signer = privateKeyToAccount(generatePrivateKey());
const debtor = privateKeyToAccount(generatePrivateKey());

let accountsResponse: unknown = [signer.address];
let signResponse: unknown = null;

function honestPayload(): PaymentRequestPayload {
  const created = createPaymentRequestPayload({
    recipient: signer.address,
    debtor: debtor.address,
    debtKey: "b->a",
    tryMinor: 20000,
    rateNumerator: BigInt(4000),
    rateDenominator: BigInt(1),
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

beforeEach(() => {
  providerRequest.mockClear();
  withProviderMock.mockClear();
  accountsResponse = [signer.address];
  signResponse = null;
});

describe("geçersiz gövde için cüzdana hiç gidilmez", () => {
  const cases: Array<[string, Partial<PaymentRequestPayload>]> = [
    ["geçersiz talep kimliği", { requestId: "0x123" }],
    ["talep kimliği eksik uzunlukta", { requestId: `0x${"aa".repeat(31)}` }],
    ["bitiş başlangıçtan önce", { expiresAt: 1, issuedAt: 2 }],
    ["süresi dolmuş talep", { expiresAt: Math.floor(NOW / 1000) - 1 }],
    [
      "sıfır genişlikli karakter içeren etiket",
      { recipientLabel: `Ay${ZERO_WIDTH_SPACE}şe` },
    ],
    ["baştaki boşluklu etiket", { debtorLabel: " Ayşe" }],
    ["boş etiket", { debtorLabel: "" }],
    ["Arc Testnet dışı zincir", { chainId: 1 }],
    ["geçersiz alıcı adresi", { recipient: "0x1" }],
    ["geçersiz borçlu adresi", { debtor: "yok" }],
    ["kanonik olmayan kur paydası", { rateDenominator: "3" }],
    ["tutarsız tutar", { microUsdc: "5000000" }],
    ["sıfır tutar", { microUsdc: "0" }],
  ];

  for (const [name, override] of cases) {
    it(`${name}: imzalamaz, sağlayıcıya dokunmaz`, async () => {
      const result = await signPaymentRequest(
        "w",
        { ...honestPayload(), ...override },
        at(NOW),
      );

      expect(result).toEqual({ ok: false, code: "invalidPayload" });
      // Cüzdan katmanı hiç çağrılmadı: eth_signTypedData_v4 de çağrılmadı.
      expect(withProviderMock).not.toHaveBeenCalled();
      expect(providerRequest).not.toHaveBeenCalled();
      // Sonuçta talep yok; paylaşılabilir bağlantı üretilemez.
      expect("request" in result).toBe(false);
    });
  }
});

describe("geçerli gövde normal akışı tamamlar", () => {
  it("cüzdana gider, imzalar ve bağlantı üretilebilir", async () => {
    const payload = honestPayload();
    const typedData = buildTypedData(payload);
    signResponse = await signer.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    const result = await signPaymentRequest("w", payload, at(NOW));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(withProviderMock).toHaveBeenCalledTimes(1);
    expect(
      providerRequest.mock.calls.some(
        ([args]) => args.method === "eth_signTypedData_v4",
      ),
    ).toBe(true);

    const url = buildShareUrl(
      "https://ornek.test",
      encodeSignedRequest(result.request),
    );
    expect(url.startsWith("https://ornek.test/pay?request=")).toBe(true);
  });

  it("imzalanan gövde, doğrulanmış kanonik gövdedir", async () => {
    // Adres küçük harfle verilse bile imzalanan checksum'lı biçimdir.
    const payload = { ...honestPayload(), debtor: debtor.address.toLowerCase() };
    const canonical = { ...payload, debtor: debtor.address };
    const typedData = buildTypedData(canonical);
    signResponse = await signer.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    const result = await signPaymentRequest("w", payload, at(NOW));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.payload.debtor).toBe(debtor.address);
  });
});
