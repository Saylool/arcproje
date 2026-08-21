import type { Receipt } from "@/lib/receipt/schema";
import {
  summarizeAssignments,
  type AssignmentState,
} from "@/lib/split/participants";

type AssignmentSummaryViewProps = {
  receipt: Receipt;
  state: AssignmentState;
  onEdit: () => void;
};

export function AssignmentSummaryView({
  receipt,
  state,
  onEdit,
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
          Ürünlerin kimlere ait olduğunu kaydettik. Tutarlar bir sonraki adımda
          hesaplanacak.
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
          onClick={onEdit}
          className="self-start rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
        >
          Atamaları düzenle
        </button>

        <p className="text-xs leading-relaxed text-slate-400">
          Sonraki aşama: herkesin payını hesaplayıp Arc üzerinden USDC ile ödeme.
          Bu adım henüz hazır değil.
        </p>
      </div>
    </section>
  );
}
