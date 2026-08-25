import { useTranslator } from "@/lib/i18n/context";

/**
 * Adim KIMLIKLERI kararlidir ve cevrilmez; gorunen etiket sozlukten gelir.
 */
export const FLOW_STEPS = [
  { id: "receipt", labelKey: "progress.receipt" },
  { id: "participants", labelKey: "progress.participants" },
  { id: "payment", labelKey: "progress.payment" },
] as const;

export type FlowStepId = (typeof FLOW_STEPS)[number]["id"];

/** Ödeme adımı yalnızca paylar hesaplandığında aktif olur. */
const PAYMENT_STEP_ID: FlowStepId = "payment";

type ProgressStepsProps = {
  currentStepId: FlowStepId;
};

export function ProgressSteps({ currentStepId }: ProgressStepsProps) {
  const { t } = useTranslator();
  const currentIndex = FLOW_STEPS.findIndex((step) => step.id === currentStepId);

  return (
    <nav aria-label={t("progress.label")}>
      <ol className="flex items-center">
        {FLOW_STEPS.map((step, index) => {
          const isActive = index === currentIndex;
          const isCompleted = index < currentIndex;
          const isPaymentPreview = step.id === PAYMENT_STEP_ID && !isActive;
          const isLast = index === FLOW_STEPS.length - 1;

          return (
            <li
              key={step.id}
              aria-current={isActive ? "step" : undefined}
              className={`flex items-center gap-2 ${isLast ? "" : "flex-1"}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold sm:h-7 sm:w-7 sm:text-xs ${
                  isActive
                    ? "bg-brand text-white shadow-sm shadow-brand"
                    : isCompleted
                      ? "bg-brand-soft-strong text-brand-ink"
                      : "border border-line bg-card text-ink-faint"
                }`}
              >
                {isCompleted ? "✓" : index + 1}
              </span>

              <span
                className={`whitespace-nowrap text-[11px] font-medium sm:text-sm ${
                  isActive
                    ? "text-ink"
                    : isCompleted
                      ? "text-brand-ink"
                      : "text-ink-faint"
                }`}
              >
                {t(step.labelKey)}
              </span>

              <span className="sr-only">
                {isActive
                  ? t("progress.current")
                  : isCompleted
                    ? t("progress.completed")
                    : isPaymentPreview
                      ? t("progress.upcoming")
                      : t("progress.notCompleted")}
              </span>

              {!isLast && (
                <span
                  aria-hidden="true"
                  className={`mx-1 h-px flex-1 sm:mx-2 ${
                    isCompleted ? "bg-brand-soft-strong" : "bg-muted-strong"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
