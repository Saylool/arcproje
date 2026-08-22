import { formatMinorForDisplay } from "@/lib/receipt/money";
import type { Receipt } from "@/lib/receipt/schema";
import type { DebtCalculationSuccess } from "@/lib/split/debts";
import type { Participant } from "@/lib/split/participants";
import { toDativeName } from "@/lib/split/turkish";

type DebtSummaryProps = {
  receipt: Receipt;
  participants: readonly Participant[];
  result: DebtCalculationSuccess;
  onEditAssignments: () => void;
  onEditReceipt: () => void;
  onPay: () => void;
};

const INCLUDED_LABEL = "— fiyata dahil";

export function DebtSummaryView({
  receipt,
  participants,
  result,
  onEditAssignments,
  onEditReceipt,
  onPay,
}: DebtSummaryProps) {
  const nameOf = (participantId: string) =>
    participants.find((participant) => participant.id === participantId)?.name ??
    "Bilinmeyen kişi";

  const money = (minor: number) =>
    formatMinorForDisplay(minor, receipt.currency);

  const adjustmentRows = [
    {
      label: "Vergi payı",
      separate: receipt.taxTreatment === "separate",
      read: (share: DebtCalculationSuccess["participantShares"][number]) =>
        share.taxMinor,
    },
    {
      label: "Servis payı",
      separate: receipt.serviceChargeTreatment === "separate",
      read: (share: DebtCalculationSuccess["participantShares"][number]) =>
        share.serviceChargeMinor,
    },
    {
      label: "İndirim payı",
      separate: receipt.discountTreatment === "separate",
      read: (share: DebtCalculationSuccess["participantShares"][number]) =>
        share.discountMinor,
    },
  ];

  const totalsMatch = result.allocatedTotalMinor === result.receiptTotalMinor;

  return (
    <section
      aria-label="Pay ve borç özeti"
      className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-card sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight text-slate-900">
          Kimin ne kadar payı var
        </h2>
        <p className="text-xs leading-relaxed text-slate-500">
          Fişi <strong className="font-semibold text-slate-700">
            {nameOf(result.payerId)}
          </strong>{" "}
          ödedi. Diğerleri payları kadar ona borçlu.
        </p>
      </header>

      {/* --- Kişi payları --- */}
      <ul className="flex flex-col gap-2">
        {result.participantShares.map((share) => {
          const isPayer = share.participantId === result.payerId;
          return (
            <li
              key={share.participantId}
              className={`rounded-2xl border p-3 ${
                isPayer
                  ? "border-violet-200 bg-violet-50/50"
                  : "border-slate-200"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                  {nameOf(share.participantId)}
                  {isPayer && (
                    <span className="ml-2 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                      ödeyen
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                  {money(share.totalMinor)}
                </span>
              </div>

              <dl className="mt-2 flex flex-col gap-1 border-t border-slate-100 pt-2">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-slate-500">Ürün payı</dt>
                  <dd className="text-xs tabular-nums text-slate-600">
                    {money(share.itemSubtotalMinor)}
                  </dd>
                </div>
                {adjustmentRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <dt className="text-xs text-slate-500">{row.label}</dt>
                    <dd className="text-xs tabular-nums text-slate-600">
                      {row.separate ? money(row.read(share)) : INCLUDED_LABEL}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>

      {/* --- Toplam doğrulaması --- */}
      <p
        role="status"
        className={`rounded-2xl px-3 py-2.5 text-xs leading-relaxed ${
          totalsMatch
            ? "bg-violet-50 text-violet-800"
            : "border border-red-200 bg-red-50 text-red-700"
        }`}
      >
        {totalsMatch ? (
          <>
            Payların toplamı{" "}
            <strong className="font-semibold tabular-nums">
              {money(result.allocatedTotalMinor)}
            </strong>{" "}
            — fişteki genel toplamla birebir aynı. Hiçbir kuruş kaybolmadı.
          </>
        ) : (
          <>
            Payların toplamı {money(result.allocatedTotalMinor)}, fişteki genel
            toplam {money(result.receiptTotalMinor)}. Bu bir hesaplama hatası.
          </>
        )}
      </p>

      {/* --- Borçlar --- */}
      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Borçlar
        </h3>
        {result.debts.length === 0 ? (
          <p className="text-xs text-slate-500">
            Ödeyen dışında kimsenin payı yok, bu yüzden borç oluşmadı.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {result.debts.map((debt) => (
              <li
                key={`${debt.fromParticipantId}-${debt.toParticipantId}`}
                className="flex items-baseline justify-between gap-3 rounded-2xl border border-slate-200 px-3 py-2"
              >
                <span className="min-w-0 text-sm text-slate-700">
                  <strong className="font-semibold text-slate-900">
                    {nameOf(debt.fromParticipantId)}
                  </strong>
                  , {toDativeName(nameOf(debt.toParticipantId))}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                  {money(debt.amountMinor)}
                  <span className="ml-1 font-normal text-slate-500">borçlu</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- Yuvarlama açıklaması --- */}
      <p className="rounded-2xl bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
        {result.rounding.description}
      </p>

      {/* --- Gezinme --- */}
      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
        {result.debts.length > 0 && (
          <button
            type="button"
            onClick={onPay}
            className="self-start rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-200 transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          >
            Ödeme talebi oluştur
          </button>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onEditAssignments}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          >
            Atamaları düzenle
          </button>
          <button
            type="button"
            onClick={onEditReceipt}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          >
            Fişi düzelt
          </button>
        </div>

        <p className="text-xs leading-relaxed text-slate-400">
          Her borçlu için ayrı bir ödeme talebi imzalarsın; borçlu kendi
          cüzdanında onaylar. Arc Testnet test USDC&apos;si kullanılır.
        </p>
      </div>
    </section>
  );
}
