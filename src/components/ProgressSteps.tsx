const STEPS = [
  { id: "upload", label: "Fiş Yükle" },
  { id: "assign", label: "Ürünleri Ata" },
  { id: "pay", label: "Ödeme" },
] as const;

/** Bu aşamada yalnızca ilk adım aktif; sonraki adımlar henüz uygulanmadı. */
const ACTIVE_STEP_INDEX = 0;

export function ProgressSteps() {
  return (
    <nav aria-label="İlerleme durumu">
      <ol className="flex items-center">
        {STEPS.map((step, index) => {
          const isActive = index === ACTIVE_STEP_INDEX;
          const isLast = index === STEPS.length - 1;

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
                    ? "bg-violet-600 text-white shadow-sm shadow-violet-200"
                    : "border border-slate-200 bg-white text-slate-400"
                }`}
              >
                {index + 1}
              </span>

              <span
                className={`whitespace-nowrap text-[11px] font-medium sm:text-sm ${
                  isActive ? "text-slate-900" : "text-slate-400"
                }`}
              >
                {step.label}
              </span>

              <span className="sr-only">
                {isActive ? "(şu anki adım)" : "(henüz tamamlanmadı)"}
              </span>

              {!isLast && (
                <span
                  aria-hidden="true"
                  className="mx-1 h-px flex-1 bg-slate-200 sm:mx-2"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
