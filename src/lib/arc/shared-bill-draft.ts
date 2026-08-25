import { normalizeWalletAddress, walletAddressesEqual } from "./address";
import { prepareLabel } from "./labels";
import { MAX_LABEL_LENGTH } from "./payment-request";
import { MAX_SHARED_BILL_DEBTS } from "./shared-bill";
import { translate } from "../i18n/dictionary";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";

/**
 * Paylasilan hesap TASLAGI — olusturucu arayuzunun saf kurallari.
 *
 * Cuzdana veya sunucuya hicbir sey gonderilmeden ONCE calisir: her borclu icin
 * tam bir adres toplanmis mi, adresler birbirinden ve aliciden farkli mi,
 * tutarlar pozitif tam sayi mi. Bu kurallar React'ten bagimsiz test edilir.
 *
 * Burasi son savunma DEGILDIR: sunucu ve `shared-bill.ts` ayni kurallari
 * yeniden uygular. Buradaki amac, kullaniciyi imzalamadan once uyarmaktir.
 */

export type SharedBillDraftRow = Readonly<{
  participantId: string;
  /** Gosterim adi; kanonik etikete indirgenir. */
  name: string;
  /** Borcun kararli kimligi. */
  debtKey: string;
  /** TRY minor unit; tam sayi olmalidir. */
  amountMinor: number;
  /** Kullanicinin girdigi ham adres. */
  address: string;
}>;

export type SharedBillDraftProblem =
  | "noDebts"
  | "tooManyDebts"
  | "invalidRecipient"
  | "missingAddress"
  | "invalidAddress"
  | "duplicateAddress"
  | "recipientIsDebtor"
  | "invalidAmount";

/** Kodun kullaniciya gosterilecek karsiligi. Sinir degeri burada verilir. */
export function describeSharedBillDraftProblem(
  problem: SharedBillDraftProblem,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return translate(locale, `errors.draft.${problem}`, {
    max: MAX_SHARED_BILL_DEBTS,
  });
}

export type SharedBillDraftDebt = Readonly<{
  debtor: string;
  debtorLabel: string;
  debtKey: string;
  tryMinor: string;
}>;

export type SharedBillDraftResult =
  | { ok: true; debts: readonly SharedBillDraftDebt[] }
  | {
      ok: false;
      problem: SharedBillDraftProblem;
      /** Sorunlu satiri arayuzde isaretlemek icin. */
      participantId: string | null;
    };

function fail(
  problem: SharedBillDraftProblem,
  participantId: string | null = null,
): SharedBillDraftResult {
  return { ok: false, problem, participantId };
}

/**
 * Taslagi dogrular ve imzalanacak kanonik borc satirlarini uretir.
 *
 * Adres esitligi checksum'a duyarsiz karsilastirilir; buyuk/kucuk harf farki
 * yinelenmeyi gizleyemez.
 */
export function validateSharedBillDraft(input: {
  recipient: string | null;
  rows: readonly SharedBillDraftRow[];
}): SharedBillDraftResult {
  const { recipient, rows } = input;

  if (rows.length === 0) {
    return fail("noDebts");
  }
  if (rows.length > MAX_SHARED_BILL_DEBTS) {
    return fail("tooManyDebts");
  }

  const normalizedRecipient =
    recipient === null ? null : normalizeWalletAddress(recipient);
  if (normalizedRecipient === null) {
    return fail("invalidRecipient");
  }

  const seen = new Set<string>();
  const debts: SharedBillDraftDebt[] = [];

  for (const row of rows) {
    const raw = row.address.trim();
    if (raw === "") {
      return fail("missingAddress", row.participantId);
    }
    const debtor = normalizeWalletAddress(raw);
    if (debtor === null) {
      return fail("invalidAddress", row.participantId);
    }
    if (walletAddressesEqual(debtor, normalizedRecipient)) {
      return fail("recipientIsDebtor", row.participantId);
    }
    if (seen.has(debtor.toLowerCase())) {
      return fail("duplicateAddress", row.participantId);
    }
    if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0) {
      return fail("invalidAmount", row.participantId);
    }

    seen.add(debtor.toLowerCase());
    debts.push(
      Object.freeze({
        debtor,
        debtorLabel: prepareLabel(row.name, MAX_LABEL_LENGTH),
        debtKey: row.debtKey,
        tryMinor: String(row.amountMinor),
      }),
    );
  }

  return { ok: true, debts: Object.freeze(debts) };
}

/**
 * Uretilmis baglantinin BAYATLIK anahtari.
 *
 * Kaynak girdilerden herhangi biri (alici, borclu adresi, tutar, borc kimligi
 * veya ad) degisirse anahtar degisir ve arayuz onceki baglantiyi gecersiz
 * sayar. Boylece kullanici, artik gecerli olmayan bir listeye ait bir
 * bagalantiyi paylasamaz.
 */
export function sharedBillDraftKey(input: {
  recipient: string | null;
  rows: readonly SharedBillDraftRow[];
}): string {
  const recipient = (input.recipient ?? "").trim().toLowerCase();
  const rows = input.rows
    .map((row) =>
      [
        row.participantId,
        row.debtKey,
        String(row.amountMinor),
        prepareLabel(row.name, MAX_LABEL_LENGTH),
        row.address.trim().toLowerCase(),
      ].join("~"),
    )
    // Satir sirasi anahtar icin onemsizdir; icerik onemlidir.
    .sort();
  return [recipient, ...rows].join("|");
}
