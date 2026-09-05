"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useTranslator } from "@/lib/i18n/context";
import {
  checkTotals,
  describeMoneyParseFailure,
  formatMinorForDisplay,
  formatMinorForInput,
  parseMoneyToMinor,
} from "@/lib/receipt/money";
import {
  DISCOUNT_AMOUNT_FIELD,
  SERVICE_AMOUNT_FIELD,
  TAX_AMOUNT_FIELD,
  TOTAL_AMOUNT_FIELD,
  amountFieldDomId,
  itemAmountField,
  type AmountFieldId,
} from "@/lib/receipt/amount-fields";
import {
  ADJUSTMENT_TREATMENTS,
  UNKNOWN_CURRENCY,
  createItemId,
  type AdjustmentKind,
  type AdjustmentTreatment,
  type Receipt,
  type ReceiptItem,
} from "@/lib/receipt/schema";

/** Kod -> sozluk anahtari. Kodlar veri sozlesmesidir ve cevrilmez. */
const TREATMENT_KEYS: Record<AdjustmentTreatment, "editor.treatmentIncluded" | "editor.treatmentSeparate" | "editor.treatmentUnknown"> = {
  included_in_items: "editor.treatmentIncluded",
  separate: "editor.treatmentSeparate",
  unknown: "editor.treatmentUnknown",
};

const ADJUSTMENT_KEYS: Record<AdjustmentKind, "editor.adjustmentTax" | "editor.adjustmentServiceCharge" | "editor.adjustmentDiscount"> = {
  tax: "editor.adjustmentTax",
  serviceCharge: "editor.adjustmentServiceCharge",
  discount: "editor.adjustmentDiscount",
};

type ReceiptEditorProps = {
  receipt: Receipt;
  onChange: (receipt: Receipt) => void;
  /**
   * Bir tutar alanı okunabilir olmaktan çıktığında ya da düzeldiğinde haber
   * verir. Akış bunu ilerlemeyi engellemek için kullanır: geçersiz metin
   * `receipt`e YAZILAMAZ, dolayısıyla fişe bakarak anlaşılamaz.
   */
  onAmountValidityChange: (fieldId: AmountFieldId, valid: boolean) => void;
};

type MoneyInputProps = {
  minor: number;
  ariaLabel: string;
  fieldId: AmountFieldId;
  onValidChange: (minor: number) => void;
  onValidityChange: (fieldId: AmountFieldId, valid: boolean) => void;
  className?: string;
};

/**
 * Para alanı. Kaynak değer minor unit'tir; kullanıcı `320,50` veya `320.50`
 * yazabilir. Geçersiz girdi sessizce yuvarlanmaz: son geçerli değer korunur ve
 * alanın altında açık bir hata gösterilir.
 */
function MoneyInput({
  minor,
  ariaLabel,
  fieldId,
  onValidChange,
  onValidityChange,
  className,
}: MoneyInputProps) {
  const { locale } = useTranslator();
  const errorId = useId();
  const [text, setText] = useState(() => formatMinorForInput(minor, locale));
  const [error, setError] = useState<string | null>(null);

  /*
   * DIL DEGISINCE AYRAC DA DEGISIR — ama YALNIZCA kullanicinin DOKUNMADIGI
   * alanlarda.
   *
   * Alan "el degmemis" sayilir ancak icindeki metin, ONCEKI dilde ayni tam
   * sayidan uretilmis metnin BIREBIR aynisiysa. Kullanici tek bir karakter
   * bile yazdiysa metin oldugu gibi birakilir: dil degistirmek kimsenin
   * yazdigi degeri silmemelidir.
   *
   * Her iki durumda da TUTAR degismez: `parseMoneyToMinor` hem "," hem "."
   * ayracini kabul eder ve iki dilde de AYNI tam sayiyi geri okur.
   */
  const previousLocale = useRef(locale);
  useEffect(() => {
    const previous = previousLocale.current;
    if (previous === locale) {
      return;
    }
    previousLocale.current = locale;
    setText((current) =>
      current === formatMinorForInput(minor, previous)
        ? formatMinorForInput(minor, locale)
        : current,
    );
  }, [locale, minor]);

  const handleChange = (value: string) => {
    setText(value);

    const result = parseMoneyToMinor(value);
    if (result.ok) {
      setError(null);
      onValidityChange(fieldId, true);
      onValidChange(result.minor);
      return;
    }
    /*
     * Hata YALNIZCA burada görünürdü. `onValidChange` çağrılmadığı için fiş
     * son geçerli sayıda kalır — bu doğru, ama sessiz kalırsa kullanıcı
     * düzeltmediği tutarla ilerleyebilir. Geçersizlik bu yüzden yukarı da
     * bildirilir.
     */
    setError(describeMoneyParseFailure(result.reason, locale));
    onValidityChange(fieldId, false);
  };

  return (
    <div className={className}>
      <input
        id={amountFieldDomId(fieldId)}
        type="text"
        inputMode="decimal"
        value={text}
        aria-label={ariaLabel}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={error === null ? undefined : errorId}
        onChange={(event) => handleChange(event.target.value)}
        className={`w-full rounded-xl border bg-card px-3 py-2 text-right text-sm tabular-nums text-ink transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
          error === null
            ? "border-line focus:border-brand-line"
            : "border-danger-line-strong bg-danger-surface/50"
        }`}
      />
      {error !== null && (
        <p id={errorId} className="mt-1 text-[11px] leading-snug text-danger-ink-soft">
          {error}
        </p>
      )}
    </div>
  );
}

export function ReceiptEditor({
  receipt,
  onChange,
  onAmountValidityChange,
}: ReceiptEditorProps) {
  const { t, locale } = useTranslator();
  const totals = checkTotals(receipt);
  /** Para birimi KODU veridir; yalnizca "bilinmiyor" durumu cevrilir. */
  const currencyLabel =
    receipt.currency === UNKNOWN_CURRENCY
      ? t("editor.unknownCurrency")
      : receipt.currency;
  const money = (minor: number) =>
    formatMinorForDisplay(minor, receipt.currency, locale);

  const updateItem = (
    id: string,
    patch: Partial<Pick<ReceiptItem, "name" | "totalMinor">>,
  ) => {
    onChange({
      ...receipt,
      items: receipt.items.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  };

  const removeItem = (id: string) => {
    onChange({
      ...receipt,
      items: receipt.items.filter((item) => item.id !== id),
    });
  };

  const addItem = () => {
    onChange({
      ...receipt,
      items: [
        ...receipt.items,
        { id: createItemId(), name: "", totalMinor: 0 },
      ],
    });
  };

  return (
    <section
      aria-label={t("editor.sectionLabel")}
      className="flex flex-col gap-4 rounded-3xl border border-line bg-card p-4 shadow-card sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight text-ink">
          {receipt.merchantName ?? t("editor.unknownMerchant")}
        </h2>
        <p className="text-xs text-ink-faint">
          {t("editor.currencyLine", { currency: currencyLabel })}
        </p>
      </header>

      {receipt.warnings.length > 0 && (
        <div className="rounded-2xl border border-warn-line bg-warn-surface px-3 py-2.5">
          <p className="text-xs font-semibold text-warn-ink">
            {t("editor.analysisNotes")}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-warn-ink-soft">
            {receipt.warnings.map((code) => (
              /*
               * Model artık KOD döndürüyor; cümle etkin dilde sözlükten
               * geliyor. Eskiden modelin yazdığı Türkçe metin doğrudan
               * basılıyordu ve İngilizce arayüzde Türkçe uyarı çıkıyordu.
               */
              <li key={code}>{t(`editor.analysisWarnings.${code}`)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {t("editor.items")}
        </h3>

        {receipt.items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-3 py-4 text-center text-xs text-ink-faint">
            {t("editor.emptyItems")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {receipt.items.map((item, index) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-2xl border border-line p-2.5 sm:flex-row sm:items-start sm:gap-3"
              >
                <input
                  type="text"
                  value={item.name}
                  placeholder={t("editor.itemNamePlaceholder")}
                  aria-label={t("editor.itemNameLabel", { index: index + 1 })}
                  onChange={(event) =>
                    updateItem(item.id, { name: event.target.value })
                  }
                  className="min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink transition-colors focus:border-brand-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                />

                <div className="flex items-start gap-2">
                  <MoneyInput
                    minor={item.totalMinor}
                    ariaLabel={t("editor.itemAmountLabel", { index: index + 1 })}
                    fieldId={itemAmountField(item.id)}
                    onValidChange={(minor) =>
                      updateItem(item.id, { totalMinor: minor })
                    }
                    onValidityChange={onAmountValidityChange}
                    className="w-32 shrink-0"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    aria-label={t("editor.itemDeleteLabel", { index: index + 1 })}
                    className="shrink-0 rounded-xl border border-transparent px-2.5 py-2 text-xs font-semibold text-ink-faint transition-colors hover:bg-danger-surface hover:text-danger-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-h-11 inline-flex items-center"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={addItem}
          className="self-start rounded-full border border-line bg-card px-3.5 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-h-11"
        >
          {t("editor.addItem")}
        </button>
      </div>

      <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-faint">{t("editor.itemsSubtotal")}</span>
          <span className="text-sm tabular-nums text-ink-faint">
            {money(totals.itemsSubtotalMinor)}
          </span>
        </div>

        <SummaryRow
          label={t("editor.tax")}
          minor={receipt.taxMinor}
          treatment={receipt.taxTreatment}
          treatmentHint={t("editor.addsToTotal")}
          onTreatmentChange={(taxTreatment) =>
            onChange({ ...receipt, taxTreatment })
          }
          fieldId={TAX_AMOUNT_FIELD}
          onValidChange={(taxMinor) => onChange({ ...receipt, taxMinor })}
          onValidityChange={onAmountValidityChange}
        />
        <SummaryRow
          label={t("editor.serviceCharge")}
          minor={receipt.serviceChargeMinor}
          treatment={receipt.serviceChargeTreatment}
          treatmentHint={t("editor.addsToTotal")}
          onTreatmentChange={(serviceChargeTreatment) =>
            onChange({ ...receipt, serviceChargeTreatment })
          }
          fieldId={SERVICE_AMOUNT_FIELD}
          onValidChange={(serviceChargeMinor) =>
            onChange({ ...receipt, serviceChargeMinor })
          }
          onValidityChange={onAmountValidityChange}
        />
        <SummaryRow
          label={t("editor.discount")}
          minor={receipt.discountMinor}
          treatment={receipt.discountTreatment}
          treatmentHint={t("editor.subtractsFromTotal")}
          onTreatmentChange={(discountTreatment) =>
            onChange({ ...receipt, discountTreatment })
          }
          fieldId={DISCOUNT_AMOUNT_FIELD}
          onValidChange={(discountMinor) =>
            onChange({ ...receipt, discountMinor })
          }
          onValidityChange={onAmountValidityChange}
        />
        <SummaryRow
          label={t("editor.total")}
          minor={receipt.totalMinor}
          emphasized
          fieldId={TOTAL_AMOUNT_FIELD}
          onValidChange={(totalMinor) => onChange({ ...receipt, totalMinor })}
          onValidityChange={onAmountValidityChange}
        />
      </div>

      {totals.status === "mismatch" && (
        <p
          role="status"
          className="rounded-2xl border border-warn-line bg-warn-surface px-3 py-2.5 text-xs leading-relaxed text-warn-ink"
        >
          {t("editor.mismatchPrefix")}
          <strong className="font-semibold tabular-nums">
            {money(totals.expectedTotalMinor)}
          </strong>
          {t("editor.mismatchMiddle")}
          <strong className="font-semibold tabular-nums">
            {money(totals.statedTotalMinor)}
          </strong>
          {t("editor.mismatchSuffix")}
        </p>
      )}

      {totals.status === "indeterminate" && (
        <p
          role="status"
          className="rounded-2xl border border-line bg-muted px-3 py-2.5 text-xs leading-relaxed text-ink-soft"
        >
          {t("editor.indeterminatePrefix")}
          <strong className="font-semibold">
            {totals.uncertainAdjustments
              .map((kind) => t(ADJUSTMENT_KEYS[kind]))
              .join(", ")}
          </strong>
          {t("editor.indeterminateSuffix")}
        </p>
      )}
    </section>
  );
}

type SummaryRowProps = {
  label: string;
  minor: number;
  emphasized?: boolean;
  /** Verilirse satırda erişilebilir bir "nasıl uygulanacak" seçimi gösterilir. */
  treatment?: AdjustmentTreatment;
  treatmentHint?: string;
  onTreatmentChange?: (treatment: AdjustmentTreatment) => void;
  fieldId: AmountFieldId;
  onValidChange: (minor: number) => void;
  onValidityChange: (fieldId: AmountFieldId, valid: boolean) => void;
};

function SummaryRow({
  label,
  minor,
  emphasized = false,
  treatment,
  treatmentHint,
  onTreatmentChange,
  fieldId,
  onValidChange,
  onValidityChange,
}: SummaryRowProps) {
  const { t } = useTranslator();
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <span
        className={`text-sm sm:pt-2 ${
          emphasized ? "font-semibold text-ink" : "text-ink-soft"
        }`}
      >
        {label}
      </span>

      <div className="flex items-start gap-2">
        {treatment !== undefined && onTreatmentChange !== undefined && (
          <select
            value={treatment}
            aria-label={
              treatmentHint === undefined
                ? t("editor.treatmentLabel", { label })
                : t("editor.treatmentLabelWithHint", {
                    label,
                    hint: treatmentHint,
                  })
            }
            onChange={(event) =>
              onTreatmentChange(event.target.value as AdjustmentTreatment)
            }
            className="min-w-0 flex-1 rounded-xl border border-line bg-card px-2 py-2 text-xs text-ink-soft transition-colors focus:border-brand-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:w-44 sm:flex-none"
          >
            {ADJUSTMENT_TREATMENTS.map((option) => (
              <option key={option} value={option}>
                {t(TREATMENT_KEYS[option])}
              </option>
            ))}
          </select>
        )}

        <MoneyInput
          minor={minor}
          fieldId={fieldId}
          onValidityChange={onValidityChange}
          ariaLabel={label}
          onValidChange={onValidChange}
          className="w-28 shrink-0 sm:w-32"
        />
      </div>
    </div>
  );
}
