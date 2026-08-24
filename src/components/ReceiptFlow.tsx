"use client";

import { useCallback, useRef, useState } from "react";

import { PaymentRequestCreator } from "@/components/PaymentRequestCreator";
import { SharedBillCreator } from "@/components/SharedBillCreator";
import { SHARED_BILL_FLOW_ENABLED } from "@/lib/arc/shared-bill-feature";
import { AssignmentSummaryView } from "@/components/AssignmentSummary";
import { DebtSummaryView } from "@/components/DebtSummary";
import { ParticipantAssignment } from "@/components/ParticipantAssignment";
import { ProgressSteps, type FlowStepId } from "@/components/ProgressSteps";
import { ReceiptEditor } from "@/components/ReceiptEditor";
import { ReceiptUploader } from "@/components/ReceiptUploader";
import { ReceiptSchema, type Receipt } from "@/lib/receipt/schema";
import {
  calculateDebts,
  type DebtCalculationFailure,
  type DebtCalculationSuccess,
} from "@/lib/split/debts";
import {
  checkReceiptReadyForSplit,
  createInitialAssignmentState,
  normalizeAssignments,
  type AssignmentState,
} from "@/lib/split/participants";

type AnalysisStatus = "idle" | "analyzing" | "error" | "ready";

/** Fiş düzenleme, kişi atama, atama özeti ve pay/borç ekranı. */
type FlowScreen = "receipt" | "participants" | "summary" | "debts" | "payment";

const SCREEN_HEADINGS: Record<FlowScreen, { title: string; description: string }> = {
  receipt: {
    title: "Fişini yükle",
    description:
      "Fişin fotoğrafını ekle. Sonraki adımlarda ürünleri kişilere dağıtıp herkesin payını hesaplayacağız.",
  },
  participants: {
    title: "Ürünleri kişilere dağıt",
    description:
      "Kişileri ekle ve her ürünü kimin aldığını işaretle. Bir ürünü birden fazla kişiye atayabilirsin.",
  },
  summary: {
    title: "Ürünleri kişilere dağıt",
    description:
      "Atamaların hazır. Kontrol edip herkesin payını hesaplayabilirsin.",
  },
  debts: {
    title: "Payları kontrol et",
    description:
      "Herkesin payı ve fişi ödeyene olan borcu aşağıda. Tutarlar kuruşuna kadar dağıtıldı.",
  },
  payment: {
    title: "Ödeme talebi oluştur",
    description:
      "Fişi sen ödedin. Her borçlu için ayrı bir ödeme talebi imzala; borçlu kendi cüzdanında onaylasın.",
  },
};

const GENERIC_ERROR_MESSAGE = "Fiş analiz edilemedi. Lütfen tekrar dene.";
const TIMEOUT_ERROR_MESSAGE =
  "Analiz zaman aşımına uğradı. Lütfen tekrar dene.";
const NETWORK_ERROR_MESSAGE =
  "Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.";

/**
 * Sunucu tarafındaki 30 saniyelik OpenAI timeout'undan birkaç saniye uzun.
 * Böylece sunucu kendi kontrollü 504'ünü döndürebilirse istemci onu gösterir;
 * istek tamamen takılırsa devreye bu sınır girer.
 */
const CLIENT_TIMEOUT_MS = 35_000;

/** Sunucunun { error: { code, message } } sözleşmesinden mesajı güvenle okur. */
function readErrorMessage(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("error" in payload)) {
    return GENERIC_ERROR_MESSAGE;
  }
  const { error } = payload as { error: unknown };
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return GENERIC_ERROR_MESSAGE;
  }
  const { message } = error as { message: unknown };
  return typeof message === "string" && message.trim() !== ""
    ? message
    : GENERIC_ERROR_MESSAGE;
}

function readReceiptField(payload: unknown): unknown {
  if (typeof payload === "object" && payload !== null && "receipt" in payload) {
    return (payload as { receipt: unknown }).receipt;
  }
  return null;
}

export function ReceiptFlow() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // Yeni bir analiz geldiğinde düzenleyicinin taslak input'ları sıfırlansın.
  const [analysisKey, setAnalysisKey] = useState(0);
  const isAnalyzingRef = useRef(false);

  const [screen, setScreen] = useState<FlowScreen>("receipt");
  // Üretilen ID'ler ilk render'da DOM'a yazılmaz; kişi ekranı başlangıçta kapalı.
  const [assignment, setAssignment] = useState<AssignmentState>(
    createInitialAssignmentState,
  );
  const [splitError, setSplitError] = useState<string | null>(null);
  const [debtResult, setDebtResult] = useState<DebtCalculationSuccess | null>(
    null,
  );
  const [debtError, setDebtError] = useState<DebtCalculationFailure | null>(
    null,
  );

  /** Atama veya fiş değişince önceki hesap geçersizdir. */
  const invalidateDebts = useCallback(() => {
    setDebtResult(null);
    setDebtError(null);
  }, []);

  const handleFileChange = useCallback((next: File | null) => {
    setFile(next);
    setReceipt(null);
    setErrorMessage(null);
    setStatus("idle");
    setScreen("receipt");
    setSplitError(null);
    setAssignment(createInitialAssignmentState());
    setDebtResult(null);
    setDebtError(null);
  }, []);

  /** Fiş düzenlenince atamaları mevcut ürün ID'lerine göre güvenli tut. */
  const handleReceiptChange = useCallback(
    (next: Receipt) => {
      setReceipt(next);
      setSplitError(null);
      invalidateDebts();
      setAssignment((previous) =>
        normalizeAssignments(
          previous,
          next.items.map((item) => item.id),
        ),
      );
    },
    [invalidateDebts],
  );

  const handleAssignmentChange = useCallback(
    (next: AssignmentState) => {
      setAssignment(next);
      invalidateDebts();
    },
    [invalidateDebts],
  );

  const calculate = () => {
    if (receipt === null) {
      return;
    }
    const result = calculateDebts(receipt, assignment);
    if (result.status === "success") {
      setDebtResult(result);
      setDebtError(null);
      setScreen("debts");
      return;
    }
    setDebtResult(null);
    setDebtError(result);
  };

  const analyze = async () => {
    // Aynı isteğin tekrar gönderilmesini engelle.
    if (file === null || isAnalyzingRef.current) {
      return;
    }
    isAnalyzingRef.current = true;
    setStatus("analyzing");
    setErrorMessage(null);

    const controller = new AbortController();
    let didTimeout = false;
    const timeoutId = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, CLIENT_TIMEOUT_MS);

    try {
      const body = new FormData();
      body.append("receipt", file);

      const response = await fetch("/api/receipts/analyze", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setErrorMessage(readErrorMessage(payload));
        setStatus("error");
        return;
      }

      const parsed = ReceiptSchema.safeParse(readReceiptField(payload));
      if (!parsed.success) {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
        setStatus("error");
        return;
      }

      setReceipt(parsed.data);
      setAnalysisKey((key) => key + 1);
      setStatus("ready");
      // Yeni fiş, yeni atama.
      setScreen("receipt");
      setSplitError(null);
      setAssignment(createInitialAssignmentState());
      setDebtResult(null);
      setDebtError(null);
    } catch {
      setErrorMessage(didTimeout ? TIMEOUT_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE);
      setStatus("error");
    } finally {
      // Timer her başarı ve hata yolunda temizlenir.
      window.clearTimeout(timeoutId);
      isAnalyzingRef.current = false;
    }
  };

  const goToParticipants = () => {
    if (receipt === null) {
      return;
    }
    const readiness = checkReceiptReadyForSplit(receipt);
    if (!readiness.ok) {
      setSplitError(readiness.message);
      return;
    }
    setSplitError(null);
    setScreen("participants");
  };

  const isAnalyzing = status === "analyzing";
  const ctaLabel = isAnalyzing
    ? "Analiz ediliyor…"
    : status === "error"
      ? "Tekrar dene"
      : status === "ready"
        ? "Yeniden analiz et"
        : "Fişi analiz et";

  const currentStepId: FlowStepId =
    screen === "receipt"
      ? "receipt"
      : screen === "debts" || screen === "payment"
        ? "payment"
        : "participants";

  const heading = SCREEN_HEADINGS[screen];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {heading.title}
        </h1>
        <p className="text-sm leading-relaxed text-slate-500 sm:text-base">
          {heading.description}
        </p>
      </header>

      <ProgressSteps currentStepId={currentStepId} />

      {screen === "receipt" && (
        <div className="flex flex-col gap-4">
          <ReceiptUploader
            onFileChange={handleFileChange}
            disabled={isAnalyzing}
          />

          {file !== null && (
            <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-card">
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={analyze}
                  disabled={isAnalyzing}
                  className="inline-flex items-center justify-center rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-200 transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:bg-violet-300 disabled:shadow-none"
                >
                  {ctaLabel}
                </button>
                <p className="text-xs leading-relaxed text-slate-400">
                  Fiş görselin analiz için OpenAI&apos;ye gönderilir. Görsel
                  sunucuda saklanmaz.
                </p>
              </div>

              {isAnalyzing && (
                <p className="rounded-2xl bg-violet-50 px-3 py-2.5 text-xs leading-relaxed text-violet-800 sm:text-sm">
                  Fişteki ürünler okunuyor, bu birkaç saniye sürebilir…
                </p>
              )}

              {status === "error" && errorMessage !== null && (
                <p className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700 sm:text-sm">
                  {errorMessage}
                </p>
              )}
            </div>
          )}

          {receipt !== null && (
            <>
              <ReceiptEditor
                key={analysisKey}
                receipt={receipt}
                onChange={handleReceiptChange}
              />

              <div className="flex flex-col gap-2 rounded-3xl border border-slate-200 bg-white p-4 shadow-card">
                <button
                  type="button"
                  onClick={goToParticipants}
                  className="inline-flex items-center justify-center rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-200 transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                >
                  Kişilere dağıt
                </button>
                {splitError === null ? (
                  <p className="text-xs leading-relaxed text-slate-400">
                    Ürünleri kişilere dağıtmadan önce tutarları kontrol et.
                  </p>
                ) : (
                  <p
                    role="alert"
                    className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700"
                  >
                    {splitError}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {screen === "participants" && receipt !== null && (
        <ParticipantAssignment
          receipt={receipt}
          state={assignment}
          onChange={handleAssignmentChange}
          onBack={() => setScreen("receipt")}
          onComplete={() => setScreen("summary")}
        />
      )}

      {screen === "summary" && receipt !== null && (
        <AssignmentSummaryView
          receipt={receipt}
          state={assignment}
          onEdit={() => setScreen("participants")}
          onCalculate={calculate}
          onFixReceipt={() => setScreen("receipt")}
          error={debtError}
        />
      )}

      {screen === "debts" && receipt !== null && debtResult !== null && (
        <DebtSummaryView
          receipt={receipt}
          participants={assignment.participants}
          result={debtResult}
          onEditAssignments={() => setScreen("participants")}
          onEditReceipt={() => setScreen("receipt")}
          onPay={() => setScreen("payment")}
        />
      )}

      {/*
        PART 1 KAPISI: `SHARED_BILL_FLOW_ENABLED` `false` oldugu surece ESKI,
        borclu basina ayri baglanti ureten akis calisir. Yeni tek-baglanti
        olusturucu derlenir ve test edilir ama kullaniciya gosterilmez; borclu
        tarafi (`/pay/<billId>`) Part 2'de eklenecektir.
      */}
      {screen === "payment" && receipt !== null && debtResult !== null && (
        SHARED_BILL_FLOW_ENABLED ? (
          <SharedBillCreator
            receipt={receipt}
            participants={assignment.participants}
            result={debtResult}
            onBack={() => setScreen("debts")}
          />
        ) : (
          <PaymentRequestCreator
            receipt={receipt}
            participants={assignment.participants}
            result={debtResult}
            onBack={() => setScreen("debts")}
          />
        )
      )}

      <p aria-live="polite" className="sr-only">
        {isAnalyzing
          ? "Fiş analiz ediliyor."
          : status === "error" && errorMessage !== null
            ? errorMessage
            : screen === "payment"
              ? "Ödeme talebi adımındasın."
              : screen === "debts"
                ? "Paylar hesaplandı."
              : screen === "summary"
                ? "Atamalar hazır. Özet gösteriliyor."
                : screen === "participants"
                  ? "Kişi atama adımındasın."
                  : status === "ready"
                    ? "Fiş analizi tamamlandı. Ürünleri düzenleyebilirsin."
                    : ""}
      </p>
    </div>
  );
}
