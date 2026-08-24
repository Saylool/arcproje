import { describe, expect, it } from "vitest";

import {
  debtIdentityKey,
  findPaymentForDebt,
  isEstimateStale,
  paymentInputsKey,
  type PaymentInputs,
} from "./payment-state";

const BASE: PaymentInputs = {
  accountAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  chainId: 5042002,
  rateInput: "34,25",
  debtorParticipantId: "p2",
  recipientAddress: "0x0000000000000000000000000000000000000001",
  amountMicroUsdc: "6600000",
};

describe("paymentInputsKey", () => {
  it("aynı girdiler için aynı anahtarı üretir", () => {
    expect(paymentInputsKey(BASE)).toBe(paymentInputsKey({ ...BASE }));
  });

  it("adres büyük/küçük harfini normalize eder", () => {
    expect(
      paymentInputsKey({ ...BASE, accountAddress: BASE.accountAddress?.toLowerCase() ?? null }),
    ).toBe(paymentInputsKey(BASE));
  });
});

describe("isEstimateStale", () => {
  const key = paymentInputsKey(BASE);

  it("tahmin yoksa bayat sayar", () => {
    expect(isEstimateStale(null, BASE)).toBe(true);
  });

  it("girdiler değişmediyse geçerli kalır", () => {
    expect(isEstimateStale(key, BASE)).toBe(false);
  });

  it("hesap değişince bayatlar", () => {
    expect(
      isEstimateStale(key, {
        ...BASE,
        accountAddress: "0x0000000000000000000000000000000000000009",
      }),
    ).toBe(true);
  });

  it("ağ değişince bayatlar", () => {
    expect(isEstimateStale(key, { ...BASE, chainId: 1 })).toBe(true);
  });

  it("kur değişince bayatlar", () => {
    expect(isEstimateStale(key, { ...BASE, rateInput: "35,00" })).toBe(true);
  });

  it("borçlu değişince bayatlar", () => {
    expect(isEstimateStale(key, { ...BASE, debtorParticipantId: "p3" })).toBe(true);
  });

  it("alıcı adresi değişince bayatlar", () => {
    expect(
      isEstimateStale(key, {
        ...BASE,
        recipientAddress: "0x0000000000000000000000000000000000000002",
      }),
    ).toBe(true);
  });

  it("tutar değişince bayatlar", () => {
    expect(isEstimateStale(key, { ...BASE, amountMicroUsdc: "6600001" })).toBe(
      true,
    );
  });
});

describe("işlem kaydının borca bağlanması", () => {
  const debt = {
    fromParticipantId: "b",
    toParticipantId: "a",
    amountMinor: 20000,
  };
  const payment = {
    txHash: `0x${"a".repeat(64)}`,
    snapshot: { debtKey: "b->a", tryMinor: "20000" },
  };

  it("borç kimliğini yönüyle birlikte üretir", () => {
    expect(debtIdentityKey(debt)).toBe("b->a");
    expect(
      debtIdentityKey({ fromParticipantId: "a", toParticipantId: "b" }),
    ).toBe("a->b");
  });

  it("birebir eşleşen işlemi bulur", () => {
    expect(findPaymentForDebt([payment], debt)).toBe(payment);
  });

  it("tutar değiştiyse eski işlemi ödeme kanıtı saymaz", () => {
    expect(findPaymentForDebt([payment], { ...debt, amountMinor: 20001 })).toBeNull();
  });

  it("başka bir borcun işlemini kullanmaz", () => {
    expect(
      findPaymentForDebt([payment], { ...debt, fromParticipantId: "c" }),
    ).toBeNull();
    expect(
      findPaymentForDebt([payment], {
        fromParticipantId: "a",
        toParticipantId: "b",
        amountMinor: 20000,
      }),
    ).toBeNull();
  });

  it("form değişse bile önceki kayıtları kaybetmez", () => {
    const second = {
      txHash: `0x${"b".repeat(64)}`,
      snapshot: { debtKey: "c->a", tryMinor: "500" },
    };
    const kayitlar = [payment, second];
    expect(findPaymentForDebt(kayitlar, debt)).toBe(payment);
    expect(
      findPaymentForDebt(kayitlar, {
        fromParticipantId: "c",
        toParticipantId: "a",
        amountMinor: 500,
      }),
    ).toBe(second);
    expect(kayitlar).toHaveLength(2);
  });
});

describe("tahmin ile gönderim arasında girdi değişimi", () => {
  const base = {
    accountAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    chainId: 5042002,
    rateInput: "40",
    debtorParticipantId: "b",
    recipientAddress: "0x0000000000000000000000000000000000000aBc",
    amountMicroUsdc: "5000000",
  };

  it("hiçbir şey değişmezse tahmin geçerli kalır", () => {
    expect(isEstimateStale(paymentInputsKey(base), base)).toBe(false);
  });

  it("hesap değişince tahmin bayatlar", () => {
    const key = paymentInputsKey(base);
    expect(
      isEstimateStale(key, { ...base, accountAddress: "0x1111111111111111111111111111111111111111" }),
    ).toBe(true);
  });

  it("ağ değişince tahmin bayatlar", () => {
    expect(isEstimateStale(paymentInputsKey(base), { ...base, chainId: 1 })).toBe(true);
  });

  it("kur değişince tahmin bayatlar", () => {
    expect(isEstimateStale(paymentInputsKey(base), { ...base, rateInput: "41" })).toBe(true);
  });

  it("borçlu veya alıcı adresi değişince tahmin bayatlar", () => {
    const key = paymentInputsKey(base);
    expect(isEstimateStale(key, { ...base, debtorParticipantId: "c" })).toBe(true);
    expect(
      isEstimateStale(key, { ...base, recipientAddress: "0x2222222222222222222222222222222222222222" }),
    ).toBe(true);
  });

  it("tutar değişince tahmin bayatlar", () => {
    expect(
      isEstimateStale(paymentInputsKey(base), { ...base, amountMicroUsdc: "5000001" }),
    ).toBe(true);
  });
});
