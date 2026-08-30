import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { convertTryMinorBigIntToMicroUsdc } from "@/lib/arc/conversion";
import {
  buildSharedBillTypedData,
  createSharedBill,
} from "@/lib/arc/shared-bill";
import {
  QUOTE_BASE_CURRENCY,
  QUOTE_CURRENCY,
  QUOTE_RATE_DENOMINATOR,
  QUOTE_SOURCE,
  RATE_QUOTE_VERSION,
  parseQuoteRate,
  type RateQuote,
} from "@/lib/rates/quote";
import type { QuoteMintResult } from "@/lib/rates/quote-service";

import {
  createFakeSharedBillRepository,
  type FakeSession,
} from "./shared-bill-repository.fixture";
import { hashSessionToken } from "./shared-bill-auth";

/**
 * ÖDEME TESTLERİNİN ORTAK KURULUMU. YALNIZCA TEST.
 *
 * Hiçbir gerçek servis çağrılmaz: CoinGecko, Neon, Arc RPC ve cüzdan yerine
 * belirlenimci sahteler kullanılır. Adresler her çağrıda rastgele üretilir;
 * depoya, git geçmişine veya çıktıya GERÇEK bir cüzdan adresi girmez.
 */

export const PAYMENT_NOW = 1_700_000_000_000;
export const PAYMENT_BILL_ID = `0x${"5c".repeat(32)}`;

/** 1 USDC = 40,000000 TRY — kanonik altı ondalık payda. */
export const RATE_NUMERATOR = "40000000";
export const RATE_DENOMINATOR = QUOTE_RATE_DENOMINATOR.toString();

export type Wallet = ReturnType<typeof privateKeyToAccount>;

/** Belirlenimci, sunucu kimliklendirmeli teklif üretir; ağa ÇIKMAZ. */
export function fakeQuote(
  overrides: Partial<RateQuote> = {},
  nowMs: number = PAYMENT_NOW,
): RateQuote {
  const issuedAt = Math.floor(nowMs / 1000);
  return Object.freeze({
    quoteVersion: RATE_QUOTE_VERSION,
    quoteId: `0x${"91".repeat(32)}`,
    baseCurrency: QUOTE_BASE_CURRENCY,
    quoteCurrency: QUOTE_CURRENCY,
    source: QUOTE_SOURCE,
    rateNumerator: RATE_NUMERATOR,
    rateDenominator: RATE_DENOMINATOR,
    observedAt: issuedAt - 5,
    issuedAt,
    expiresAt: issuedAt + 300,
    ...overrides,
  });
}

export function fakeMint(
  overrides: Partial<RateQuote> = {},
  nowMs: number = PAYMENT_NOW,
): () => Promise<QuoteMintResult> {
  const quote = fakeQuote(overrides, nowMs);
  return async () => ({
    ok: true,
    signed: Object.freeze({ quote, tag: `0x${"ab".repeat(32)}` }),
    source: "provider",
  });
}

export function failingMint(): () => Promise<QuoteMintResult> {
  return async () => ({
    ok: false,
    code: "providerUnavailable",
    cooldown: false,
    retryAfterSeconds: null,
  });
}

/** Beklenen mikro USDC'yi ÜRETİMLE AYNI BigInt çekirdeğinden hesaplar. */
export function expectedMicroUsdc(tryMinor: string): string {
  const rate = parseQuoteRate(RATE_NUMERATOR, RATE_DENOMINATOR);
  if (!rate.ok) throw new Error("kur");
  const converted = convertTryMinorBigIntToMicroUsdc(BigInt(tryMinor), rate.rate);
  if (!converted.ok) throw new Error("donusum");
  return converted.microUsdc.toString();
}

export type SeededBill = {
  repository: ReturnType<typeof createFakeSharedBillRepository>;
  billId: string;
  recipient: Wallet;
  debtors: Wallet[];
  debts: readonly { debtor: string; tryMinor: string; debtKey: string }[];
  /** Her borçlu için kurulmuş oturumun HAM jetonu (yalnızca testte). */
  sessionTokens: string[];
};

/**
 * Üç borçlulu bir hesap kurar, depoya yazar ve her borçlu için bir oturum
 * açar. Oturumlar doğrudan sahte depoya yazılır: bu dosya erişim akışını
 * değil ÖDEME akışını test eder.
 */
export async function seedPaidBill(input: {
  amounts?: readonly string[];
  nowMs?: number;
  billId?: string;
} = {}): Promise<SeededBill> {
  const nowMs = input.nowMs ?? PAYMENT_NOW;
  const amounts = input.amounts ?? ["12345", "6789", "1"];
  const repository = createFakeSharedBillRepository();

  const recipient = privateKeyToAccount(generatePrivateKey());
  const debtors = amounts.map(() => privateKeyToAccount(generatePrivateKey()));

  const created = createSharedBill({
    recipient: recipient.address,
    recipientLabel: "Poyraz",
    debts: debtors.map((wallet, index) => ({
      debtor: wallet.address,
      debtorLabel: `Kisi${index}`,
      debtKey: `k${index}->p`,
      tryMinor: amounts[index],
    })),
    nowMs,
    billId: input.billId ?? PAYMENT_BILL_ID,
  });
  if (!created.ok) throw new Error(`hesap uretilemedi: ${created.problem}`);

  const typed = buildSharedBillTypedData(created.manifest);
  const signature = await recipient.signTypedData({
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
  });
  const stored = await repository.createSharedBill(
    {
      manifest: created.manifest,
      debts: created.debts,
      signature,
    },
    /* Borçlu akışı sahipliği HİÇ bilmez: atıfsız yazılır. */
    { createdByUserId: null },
  );
  if (!stored.ok) throw new Error("depoya yazilamadi");

  /*
   * Oturumlar doğrudan kurulur. KANONİK SIRA borçlu adresine göredir, bu
   * yüzden jetonlar `created.debts` sırasıyla eşleştirilir.
   */
  const sessions = repository.sessions as Map<string, FakeSession>;
  const sessionTokens = created.debts.map((debt, index) => {
    const token = `test-session-${index}-${debt.debtor.toLowerCase()}`;
    sessions.set(hashSessionToken(token), {
      sessionHash: hashSessionToken(token),
      billId: created.manifest.billId,
      debtor: debt.debtor,
      chainId: created.manifest.chainId,
      expiresAtMs: nowMs + 15 * 60 * 1000,
    });
    return token;
  });

  return {
    repository,
    billId: created.manifest.billId,
    recipient,
    debtors,
    debts: created.debts.map((debt) => ({
      debtor: debt.debtor,
      tryMinor: debt.tryMinor,
      debtKey: debt.debtKey,
    })),
    sessionTokens,
  };
}

/**
 * Depodaki bir borç satırının tutarını DOĞRUDAN değiştirir. YALNIZCA TEST.
 *
 * NEDEN GEREKLİ: manifest katmanı (`canonicalizeSharedBillDebts`) tutarları
 * BİLEREK `Number.MAX_SAFE_INTEGER` ile sınırlar ve bu sınır bu görevde
 * ZAYIFLATILMAMIŞTIR. Ama ödeme yaşam döngüsünün kendisi — teklif, türetme,
 * rezervasyon, snapshot ve makbuz doğrulaması — hiçbir aşamada `number`a
 * indirgeme YAPMAMALIDIR.
 *
 * Bu yardımcı, o iddiayı manifest sınırını gevşetmeden test edilebilir kılar:
 * satır depoya sanki daha geniş bir sınırla yazılmış gibi yerleştirilir ve
 * ödeme yolunun tamamı BigInt kalıp kalmadığı üzerinden ölçülür.
 */
export function overrideStoredDebtAmount(
  seeded: SeededBill,
  debtor: string,
  tryMinor: string,
): void {
  const bill = seeded.repository.bills.get(
    (seeded.billId ?? PAYMENT_BILL_ID).toLowerCase(),
  );
  if (bill === undefined) throw new Error("hesap yok");
  const index = bill.debts.findIndex(
    (row) => row.debtor.toLowerCase() === debtor.toLowerCase(),
  );
  if (index === -1) throw new Error("borc yok");
  bill.debts[index] = Object.freeze({ ...bill.debts[index], tryMinor });
}
