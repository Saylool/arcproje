import { useTranslator } from "@/lib/i18n/context";
import type { Receipt } from "@/lib/receipt/schema";
import { describeDebtFailure, type DebtCalculationFailure } from "@/lib/split/debts";
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
  const { t, locale } = useTranslator();
  const summary = summarizeAssignments(state, receipt.items);

  /*
   * Kisi adi VERIDIR ve cevrilmez; yalnizca "secilmedi" durumu cevrilir.
   */
  const rows: { key: string; label: string; value: string }[] = [
    {
      key: "payer",
      label: t("assignmentSummary.payer"),
      value: summary.payerName ?? t("common.notSelected"),
    },
    {
      key: "count",
      label: t("assignmentSummary.participantCount"),
      value: `${summary.participantCount}`,
    },
    {
      key: "assigned",
      label: t("assignmentSummary.assignedItems"),
      value: `${summary.assignedItemCount}`,
    },
    {
      key: "shared",
      label: t("assignmentSummary.sharedItems"),
      value: `${summary.sharedItemCount}`,
    },
  ];

  return (
    <section
      aria-label={t("assignmentSummary.sectionLabel")}
      className="flex flex-col gap-4 rounded-3xl border border-line bg-card p-4 shadow-card sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight text-ink">
          {t("assignmentSummary.title")}
        </h2>
        <p className="text-xs leading-relaxed text-ink-faint">
          {t("assignmentSummary.description")}
        </p>
      </header>

      <dl className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-baseline justify-between gap-3 border-b border-line-soft pb-2 last:border-b-0 last:pb-0"
          >
            <dt className="text-sm text-ink-faint">{row.label}</dt>
            <dd className="min-w-0 truncate text-sm font-semibold text-ink">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <button
          type="button"
          onClick={onCalculate}
          className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-h-11"
        >
          {t("assignmentSummary.calculate")}
        </button>

        {error !== null && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-2xl border border-danger-line bg-danger-surface px-3 py-2.5"
          >
            <p className="text-xs leading-relaxed text-danger-ink">
              {describeDebtFailure(error, locale)}
            </p>
            <button
              type="button"
              onClick={isReceiptProblem(error) ? onFixReceipt : onEdit}
              className="self-start rounded-full border border-danger-line bg-card px-3.5 py-1.5 text-xs font-semibold text-danger-ink transition-colors hover:bg-danger-surface-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-h-11"
            >
              {isReceiptProblem(error)
                ? t("assignmentSummary.fixReceipt")
                : t("assignmentSummary.editAssignments")}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onEdit}
          className="self-start rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-h-11"
        >
          {t("assignmentSummary.editAssignments")}
        </button>
      </div>
    </section>
  );
}
