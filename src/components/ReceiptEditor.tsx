"use client";

import { useId, useState } from "react";

import {
  checkTotals,
  describeMoneyParseFailure,
  formatMinorForDisplay,
  formatMinorForInput,
  parseMoneyToMinor,
} from "@/lib/receipt/money";
import {
  ADJUSTMENT_TREATMENTS,
  UNKNOWN_CURRENCY,
  createItemId,
  type AdjustmentKind,
  type AdjustmentTreatment,
  type Receipt,
  type ReceiptItem,
} from "@/lib/receipt/schema";

const TREATMENT_LABELS: Record<AdjustmentTreatment, string> = {
  included_in_items: "Ürün fiyatlarına dahil",
  separate: "Ayrı uygula",
  unknown: "Belirsiz",
};

const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  tax: "vergi",
  serviceCharge: "servis ücreti",
  discount: "indirim",
};

type ReceiptEditorProps = {
  receipt: Receipt;
  onChange: (receipt: Receipt) => void;
};

type MoneyInputProps = {
  minor: number;
  ariaLabel: string;
  onValidChange: (minor: number) => void;
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
  onValidChange,
  className,
}: MoneyInputProps) {
  const errorId = useId();
  const [text, setText] = useState(() => formatMinorForInput(minor));
  const [error, setError] = useState<string | null>(null);

  const handleChange = (value: string) => {
    setText(value);

    const result = parseMoneyToMinor(value);
    if (result.ok) {
      setError(null);
      onValidChange(result.minor);
      return;
    }
    setError(describeMoneyParseFailure(result.reason));
  };

  return (
    <div className={className}>
      <input
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

export function ReceiptEditor({ receipt, onChange }: ReceiptEditorProps) {
  const totals = checkTotals(receipt);
  const currencyLabel =
    receipt.currency === UNKNOWN_CURRENCY ? "belirlenemedi" : receipt.currency;

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
      aria-label="Fiş içeriği"
      className="flex flex-col gap-4 rounded-3xl border border-line bg-card p-4 shadow-card sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight text-ink">
          {receipt.merchantName ?? "Satıcı adı okunamadı"}
        </h2>
        <p className="text-xs text-ink-faint">
          Para birimi: {currencyLabel} · Analiz sonucunu kontrol edip
          düzeltebilirsin.
        </p>
      </header>

      {receipt.warnings.length > 0 && (
        <div className="rounded-2xl border border-warn-line bg-warn-surface px-3 py-2.5">
          <p className="text-xs font-semibold text-warn-ink">Analiz notları</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-warn-ink-soft">
            {receipt.warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Ürünler
        </h3>

        {receipt.items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-3 py-4 text-center text-xs text-ink-faint">
            Ürün listesi boş. Aşağıdan ürün ekleyebilirsin.
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
                  placeholder="Ürün adı"
                  aria-label={`${index + 1}. ürünün adı`}
                  onChange={(event) =>
                    updateItem(item.id, { name: event.target.value })
                  }
                  className="min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink transition-colors focus:border-brand-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                />

                <div className="flex items-start gap-2">
                  <MoneyInput
                    minor={item.totalMinor}
                    ariaLabel={`${index + 1}. ürünün tutarı`}
                    onValidChange={(minor) =>
                      updateItem(item.id, { totalMinor: minor })
                    }
                    className="w-32 shrink-0"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    aria-label={`${index + 1}. ürünü sil`}
                    className="shrink-0 rounded-xl border border-transparent px-2.5 py-2 text-xs font-semibold text-ink-faint transition-colors hover:bg-danger-surface hover:text-danger-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    Sil
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={addItem}
          className="self-start rounded-full border border-line bg-card px-3.5 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          + Ürün ekle
        </button>
      </div>

      <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-faint">Ürünler toplamı</span>
          <span className="text-sm tabular-nums text-ink-faint">
            {formatMinorForDisplay(totals.itemsSubtotalMinor, receipt.currency)}
          </span>
        </div>

        <SummaryRow
          label="Vergi (KDV)"
          minor={receipt.taxMinor}
          treatment={receipt.taxTreatment}
          treatmentHint="Ayrı uygula seçilirse genel toplama eklenir."
          onTreatmentChange={(taxTreatment) =>
            onChange({ ...receipt, taxTreatment })
          }
          onValidChange={(taxMinor) => onChange({ ...receipt, taxMinor })}
        />
        <SummaryRow
          label="Servis ücreti"
          minor={receipt.serviceChargeMinor}
          treatment={receipt.serviceChargeTreatment}
          treatmentHint="Ayrı uygula seçilirse genel toplama eklenir."
          onTreatmentChange={(serviceChargeTreatment) =>
            onChange({ ...receipt, serviceChargeTreatment })
          }
          onValidChange={(serviceChargeMinor) =>
            onChange({ ...receipt, serviceChargeMinor })
          }
        />
        <SummaryRow
          label="İndirim"
          minor={receipt.discountMinor}
          treatment={receipt.discountTreatment}
          treatmentHint="Ayrı uygula seçilirse genel toplamdan düşülür."
          onTreatmentChange={(discountTreatment) =>
            onChange({ ...receipt, discountTreatment })
          }
          onValidChange={(discountMinor) =>
            onChange({ ...receipt, discountMinor })
          }
        />
        <SummaryRow
          label="Genel toplam"
          minor={receipt.totalMinor}
          emphasized
          onValidChange={(totalMinor) => onChange({ ...receipt, totalMinor })}
        />
      </div>

      {totals.status === "mismatch" && (
        <p
          role="status"
          className="rounded-2xl border border-warn-line bg-warn-surface px-3 py-2.5 text-xs leading-relaxed text-warn-ink"
        >
          Ürünler ve ayrı uygulanan kalemler{" "}
          <strong className="font-semibold tabular-nums">
            {formatMinorForDisplay(totals.expectedTotalMinor, receipt.currency)}
          </strong>{" "}
          ediyor ama fişteki genel toplam{" "}
          <strong className="font-semibold tabular-nums">
            {formatMinorForDisplay(totals.statedTotalMinor, receipt.currency)}
          </strong>
          . Değerleri senin onayın olmadan değiştirmiyoruz; kontrol edip
          düzeltebilirsin.
        </p>
      )}

      {totals.status === "indeterminate" && (
        <p
          role="status"
          className="rounded-2xl border border-line bg-muted px-3 py-2.5 text-xs leading-relaxed text-ink-soft"
        >
          Bazı ücretlerin ürün fiyatlarına dahil olup olmadığı belirsiz:{" "}
          <strong className="font-semibold">
            {totals.uncertainAdjustments
              .map((kind) => ADJUSTMENT_LABELS[kind])
              .join(", ")}
          </strong>
          . Bu yüzden genel toplamı doğrulamıyoruz. Yukarıdaki seçimleri
          güncelleyerek netleştirebilirsin.
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
  onValidChange: (minor: number) => void;
};

function SummaryRow({
  label,
  minor,
  emphasized = false,
  treatment,
  treatmentHint,
  onTreatmentChange,
  onValidChange,
}: SummaryRowProps) {
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
            aria-label={`${label} nasıl uygulanacak${
              treatmentHint === undefined ? "" : `. ${treatmentHint}`
            }`}
            onChange={(event) =>
              onTreatmentChange(event.target.value as AdjustmentTreatment)
            }
            className="min-w-0 flex-1 rounded-xl border border-line bg-card px-2 py-2 text-xs text-ink-soft transition-colors focus:border-brand-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:w-44 sm:flex-none"
          >
            {ADJUSTMENT_TREATMENTS.map((option) => (
              <option key={option} value={option}>
                {TREATMENT_LABELS[option]}
              </option>
            ))}
          </select>
        )}

        <MoneyInput
          minor={minor}
          ariaLabel={label}
          onValidChange={onValidChange}
          className="w-28 shrink-0 sm:w-32"
        />
      </div>
    </div>
  );
}
