import { useTranslator } from "@/lib/i18n/context";
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

export function DebtSummaryView({
  receipt,
  participants,
  result,
  onEditAssignments,
  onEditReceipt,
  onPay,
}: DebtSummaryProps) {
  const { t, tRich, locale } = useTranslator();

  /** Kisi adi VERIDIR; bulunamazsa yalnizca yer tutucu cevrilir. */
  const nameOf = (participantId: string) =>
    participants.find((participant) => participant.id === participantId)?.name ??
    t("common.unknownParticipant");

  const money = (minor: number) =>
    formatMinorForDisplay(minor, receipt.currency, locale);

  /**
   * Borc cumlesi dile gore FARKLI KURULUR.
   *
   * Turkcede alacaklinin adi yonelme haline girer ("Ayse'ye") ve "borclu"
   * eki tutardan SONRA gelir; Ingilizcede fiil ortadadir ("owes") ve ek
   * yoktur. Bu yuzden ad, sablona yerlestirilen bir YUVA olarak verilir ve
   * cumle sozlukte kurulur.
   */
  const debtorName = (participantId: string) => nameOf(participantId);
  const creditorName = (participantId: string) =>
    locale === "tr" ? toDativeName(nameOf(participantId)) : nameOf(participantId);
  const owesSuffix = t("debts.owesSuffix");

  const adjustmentRows = [
    {
      key: "tax",
      label: t("debts.taxShare"),
      separate: receipt.taxTreatment === "separate",
      read: (share: DebtCalculationSuccess["participantShares"][number]) =>
        share.taxMinor,
    },
    {
      key: "service",
      label: t("debts.serviceShare"),
      separate: receipt.serviceChargeTreatment === "separate",
      read: (share: DebtCalculationSuccess["participantShares"][number]) =>
        share.serviceChargeMinor,
    },
    {
      key: "discount",
      label: t("debts.discountShare"),
      separate: receipt.discountTreatment === "separate",
      read: (share: DebtCalculationSuccess["participantShares"][number]) =>
        share.discountMinor,
    },
  ];

  const totalsMatch = result.allocatedTotalMinor === result.receiptTotalMinor;

  return (
    <section
      aria-label={t("debts.sectionLabel")}
      className="flex flex-col gap-4 rounded-3xl border border-line bg-card p-4 shadow-card sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight text-ink">
          {t("debts.title")}
        </h2>
        <p className="text-xs leading-relaxed text-ink-faint">
          {tRich("debts.paidBy", {
            payer: (
              <strong className="font-semibold text-ink-soft">
                {nameOf(result.payerId)}
              </strong>
            ),
          })}
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
                  ? "border-brand-line-soft bg-brand-soft/50"
                  : "border-line"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-semibold text-ink">
                  {nameOf(share.participantId)}
                  {isPayer && (
                    <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-white">
                      {t("debts.payerBadge")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                  {money(share.totalMinor)}
                </span>
              </div>

              <dl className="mt-2 flex flex-col gap-1 border-t border-line-soft pt-2">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-ink-faint">{t("debts.itemShare")}</dt>
                  <dd className="text-xs tabular-nums text-ink-soft">
                    {money(share.itemSubtotalMinor)}
                  </dd>
                </div>
                {adjustmentRows.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <dt className="text-xs text-ink-faint">{row.label}</dt>
                    <dd className="text-xs tabular-nums text-ink-soft">
                      {row.separate ? money(row.read(share)) : t("debts.includedInPrice")}
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
            ? "bg-brand-soft text-brand-ink"
            : "border border-danger-line bg-danger-surface text-danger-ink"
        }`}
      >
        {totalsMatch ? (
          <>
            {t("debts.totalsMatchPrefix")}
            <strong className="font-semibold tabular-nums">
              {money(result.allocatedTotalMinor)}
            </strong>
            {t("debts.totalsMatchSuffix")}
          </>
        ) : (
          t("debts.totalsMismatch", {
            allocated: money(result.allocatedTotalMinor),
            stated: money(result.receiptTotalMinor),
          })
        )}
      </p>

      {/* --- Borçlar --- */}
      <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {t("debts.heading")}
        </h3>
        {result.debts.length === 0 ? (
          <p className="text-xs text-ink-faint">
            {t("debts.none")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {result.debts.map((debt) => (
              <li
                key={`${debt.fromParticipantId}-${debt.toParticipantId}`}
                className="flex items-baseline justify-between gap-3 rounded-2xl border border-line px-3 py-2"
              >
                <span className="min-w-0 text-sm text-ink-soft">
                  {tRich("debts.owes", {
                    from: (
                      <strong className="font-semibold text-ink">
                        {debtorName(debt.fromParticipantId)}
                      </strong>
                    ),
                    to: creditorName(debt.toParticipantId),
                  })}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                  {money(debt.amountMinor)}
                  {owesSuffix !== "" && (
                    <span className="ml-1 font-normal text-ink-faint">
                      {owesSuffix}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- Yuvarlama açıklaması --- */}
      <p className="rounded-2xl bg-muted px-3 py-2.5 text-[11px] leading-relaxed text-ink-faint">
        {t("debts.roundingDescription")}
      </p>

      {/* --- Gezinme --- */}
      <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
        {result.debts.length > 0 && (
          <button
            type="button"
            onClick={onPay}
            className="self-start rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t("debts.createRequest")}
          </button>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onEditAssignments}
            className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t("debts.editAssignments")}
          </button>
          <button
            type="button"
            onClick={onEditReceipt}
            className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t("debts.editReceipt")}
          </button>
        </div>

        <p className="text-xs leading-relaxed text-ink-faint">
          {t("debts.footnote")}
        </p>
      </div>
    </section>
  );
}
