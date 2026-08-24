/**
 * Ödeme ekranının bayatlama (staleness) mantığı.
 *
 * Tahmin (estimate) ve onay, kendisini üreten girdilere bağlıdır. Hesap, ağ,
 * kur, borçlu, alıcı adresi veya tutar değiştiğinde önceki tahmin geçersizdir.
 * Bu saf fonksiyonlar UI'dan bağımsız test edilebilir.
 */
import { toCanonicalMinorUnits } from "./minor-units";

export type PaymentInputs = {
  accountAddress: string | null;
  chainId: number | null;
  rateInput: string;
  debtorParticipantId: string | null;
  recipientAddress: string;
  amountMicroUsdc: string | null;
};

/** Girdileri tek bir karşılaştırılabilir anahtara indirger. */
export function paymentInputsKey(inputs: PaymentInputs): string {
  return [
    (inputs.accountAddress ?? "").toLowerCase(),
    inputs.chainId === null ? "" : String(inputs.chainId),
    inputs.rateInput.trim(),
    inputs.debtorParticipantId ?? "",
    inputs.recipientAddress.trim().toLowerCase(),
    inputs.amountMicroUsdc ?? "",
  ].join("|");
}

/** Kaydedilmiş tahmin hâlâ geçerli mi? */
export function isEstimateStale(
  estimateKey: string | null,
  current: PaymentInputs,
): boolean {
  return estimateKey === null || estimateKey !== paymentInputsKey(current);
}

/** Borcun kimliği: yön + taraflar. */
export function debtIdentityKey(debt: {
  fromParticipantId: string;
  toParticipantId: string;
}): string {
  return `${debt.fromParticipantId}->${debt.toParticipantId}`;
}

type CompletedPaymentLike = {
  /** `tryMinor` KANONİK ondalık metindir; bkz. `./minor-units`. */
  snapshot: { debtKey: string; tryMinor: string };
};

/**
 * Bir borcu "ödendi" gösterebilmek için başarılı işlemin snapshot'ı o borçla
 * BİREBİR eşleşmelidir: hem borç kimliği hem TRY tutarı. Form sonradan değişse
 * bile eski bir işlem başka bir ödemenin kanıtı gibi kullanılamaz.
 *
 * Karşılaştırma KANONİK METİN üzerinden yapılır: fiş katmanından gelen
 * sayısal tutar burada — sınırda — kanonik metne çevrilir, snapshot'ın metni
 * `number`a DARALTILMAZ. Güvenli tam sayı aralığının dışındaki bir borç
 * kanonikleştirilemez ve hiçbir ödemeyle eşleşmez (fail-closed).
 */
export function findPaymentForDebt<T extends CompletedPaymentLike>(
  payments: readonly T[],
  debt: {
    fromParticipantId: string;
    toParticipantId: string;
    amountMinor: number;
  },
): T | null {
  const canonicalAmount = toCanonicalMinorUnits(debt.amountMinor);
  if (canonicalAmount === null) {
    return null;
  }
  const key = debtIdentityKey(debt);
  return (
    payments.find(
      (payment) =>
        payment.snapshot.debtKey === key &&
        payment.snapshot.tryMinor === canonicalAmount,
    ) ?? null
  );
}
