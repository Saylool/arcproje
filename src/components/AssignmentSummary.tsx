import type { Receipt } from "@/lib/receipt/schema";
import type { DebtCalculationFailure } from "@/lib/split/debts";
import {
  summarizeAssignments,
  type AssignmentState,
} from "@/lib/split/participants";

type AssignmentSummaryViewProps = {
  receipt: Receipt;
  state: AssignmentState;
  onEdit: () => void;
  onCalculate: () => void;
  onFixReceipt: () => void;
  error: DebtCalculationFailure | null;
};

/** Atama kaynaklı hatalar atama ekranında, diğerleri fiş ekranında düzeltilir. */
function isReceiptProblem(failure: DebtCalculationFailure): boolean {
  return failure.status !== "invalidAssignments";
}

export function AssignmentSummaryView({
  receipt,
  state,
  onEdit,
  onCalculate,
  onFixReceipt,
  error,
}: AssignmentSummaryViewProps) {
  const summary = summarizeAssignments(state, receipt.items);

  const rows: { label: string; value: string }[] = [
    { label: "Fişi ödeyen", value: summary.payerName ?? "Seçilmedi" },
    { label: "Kişi sayısı", value: `${summary.participantCount}` },
    { label: "Atanmış ürün", value: `${summary.assignedItemCount}` },
    { label: "Paylaşılan ürün", value: `${summary.sharedItemCount}` },
  ];

  return (
    <section
      aria-label="Atama özeti"
      className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-card sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight text-slate-900">
          Atamalar hazır
        </h2>
        <p className="text-xs leading-relaxed text-slate-500">
          Ürünlerin kimlere ait olduğunu kaydettik. Şimdi herkesin payını
          hesaplayabiliriz.
        </p>
      </header>

      <dl className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0"
          >
            <dt className="text-sm text-slate-500">{row.label}</dt>
            <dd className="min-w-0 truncate text-sm font-semibold text-slate-900">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={onCalculate}
          className="inline-flex items-center justify-center rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-200 transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
        >
          Payları hesapla
        </button>

        {error !== null && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-2xl border border-red-100 bg-red-50 px-3 py-2.5"
          >
            <p className="text-xs leading-relaxed text-red-700">
              {error.message}
            </p>
            <button
              type="button"
              onClick={isReceiptProblem(error) ? onFixReceipt : onEdit}
              className="self-start rounded-full border border-red-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              {isReceiptProblem(error) ? "Fişi düzelt" : "Atamaları düzenle"}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onEdit}
          className="self-start rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
        >
          Atamaları düzenle
        </button>
      </div>
    </section>
  );
}
