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
import { readApiErrorCode } from "@/lib/i18n/api-errors";
import { useTranslator } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/dictionary";
import {
  messageApi,
  messageKey,
  resolveMessage,
  type MessageDescriptor,
} from "@/lib/i18n/messages";
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
  type ReceiptSplitBlockReason,
} from "@/lib/split/participants";

type AnalysisStatus = "idle" | "analyzing" | "error" | "ready";

/** Fiş düzenleme, kişi atama, atama özeti ve pay/borç ekranı. */
type FlowScreen = "receipt" | "participants" | "summary" | "debts" | "payment";

/** Ekran -> baslik/aciklama SOZLUK ANAHTARLARI. Metin dile gore secilir. */
const SCREEN_HEADINGS: Record<
  FlowScreen,
  { title: TranslationKey; description: TranslationKey }
> = {
  receipt: { title: "flow.receiptTitle", description: "flow.receiptDescription" },
  participants: {
    title: "flow.participantsTitle",
    description: "flow.participantsDescription",
  },
  summary: { title: "flow.summaryTitle", description: "flow.summaryDescription" },
  debts: { title: "flow.debtsTitle", description: "flow.debtsDescription" },
  payment: { title: "flow.paymentTitle", description: "flow.paymentDescription" },
};

/** Fis ekranina gecisi engelleyen neden -> sozluk anahtari. */
const SPLIT_BLOCK_KEYS: Record<ReceiptSplitBlockReason, TranslationKey> = {
  invalidReceipt: "participants.receiptInvalid",
  noItems: "participants.receiptNoItems",
  emptyItemName: "participants.receiptEmptyNames",
};

/**
 * Sunucu tarafındaki 30 saniyelik OpenAI timeout'undan birkaç saniye uzun.
 * Böylece sunucu kendi kontrollü 504'ünü döndürebilirse istemci onu gösterir;
 * istek tamamen takılırsa devreye bu sınır girer.
 */
const CLIENT_TIMEOUT_MS = 35_000;

function readReceiptField(payload: unknown): unknown {
  if (typeof payload === "object" && payload !== null && "receipt" in payload) {
    return (payload as { receipt: unknown }).receipt;
  }
  return null;
}

export function ReceiptFlow() {
  const { t, locale } = useTranslator();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  /*
   * Hata durumda METIN degil METNIN TARIFI tutulur; boylece dil degisince
   * gosterilen cumle de ANINDA yeni dile gecer.
   */
  const [errorMessage, setErrorMessage] =
    useState<MessageDescriptor | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // Yeni bir analiz geldiğinde düzenleyicinin taslak input'ları sıfırlansın.
  const [analysisKey, setAnalysisKey] = useState(0);
  const isAnalyzingRef = useRef(false);

  const [screen, setScreen] = useState<FlowScreen>("receipt");
  /*
   * Ilk kisinin adi KURULUS ANINDAKI dile gore secilir ve o andan sonra
   * KULLANICI VERISIDIR: dil degistirmek onu yeniden adlandirmaz.
   * Uretilen ID'ler ilk render'da DOM'a yazilmaz; kisi ekrani baslangicta
   * kapalidir.
   */
  const [assignment, setAssignment] = useState<AssignmentState>(() =>
    createInitialAssignmentState(t("participants.defaultName")),
  );
  const [splitError, setSplitError] =
    useState<ReceiptSplitBlockReason | null>(null);
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

  const handleFileChange = useCallback(
    (next: File | null) => {
      setFile(next);
      setReceipt(null);
      setErrorMessage(null);
      setStatus("idle");
      setScreen("receipt");
      setSplitError(null);
      setAssignment(createInitialAssignmentState(t("participants.defaultName")));
      setDebtResult(null);
      setDebtError(null);
    },
    [t],
  );

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
        /*
         * Sunucunun hazir metni GOSTERILMEZ: yalnizca KARARLI KOD okunur ve
         * cumle sozlukten, etkin dilde secilir. Taninmayan kod guvenli genel
         * karsiliga duser.
         */
        setErrorMessage(messageApi(readApiErrorCode(payload) ?? undefined));
        setStatus("error");
        return;
      }

      const parsed = ReceiptSchema.safeParse(readReceiptField(payload));
      if (!parsed.success) {
        setErrorMessage(messageKey("errors.analyzeFailed"));
        setStatus("error");
        return;
      }

      setReceipt(parsed.data);
      setAnalysisKey((key) => key + 1);
      setStatus("ready");
      // Yeni fiş, yeni atama.
      setScreen("receipt");
      setSplitError(null);
      setAssignment(createInitialAssignmentState(t("participants.defaultName")));
      setDebtResult(null);
      setDebtError(null);
    } catch {
      setErrorMessage(
        messageKey(didTimeout ? "errors.analyzeTimeout" : "errors.network"),
      );
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
      setSplitError(readiness.reason);
      return;
    }
    setSplitError(null);
    setScreen("participants");
  };

  const isAnalyzing = status === "analyzing";
  const ctaLabel = isAnalyzing
    ? t("flow.analyzing")
    : status === "error"
      ? t("flow.retry")
      : status === "ready"
        ? t("flow.reanalyze")
        : t("flow.analyze");

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
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {t(heading.title)}
        </h1>
        <p className="text-sm leading-relaxed text-ink-faint sm:text-base">
          {t(heading.description)}
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
            <div className="flex flex-col gap-3 rounded-3xl border border-line bg-card p-4 shadow-card">
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={analyze}
                  disabled={isAnalyzing}
                  className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-disabled disabled:shadow-none"
                >
                  {ctaLabel}
                </button>
                <p className="text-xs leading-relaxed text-ink-faint">
                  {t("flow.uploadNotice")}
                </p>
              </div>

              {isAnalyzing && (
                <p className="rounded-2xl bg-brand-soft px-3 py-2.5 text-xs leading-relaxed text-brand-ink sm:text-sm">
                  {t("flow.reading")}
                </p>
              )}

              {status === "error" && errorMessage !== null && (
                <p className="rounded-2xl border border-danger-line bg-danger-surface px-3 py-2.5 text-xs leading-relaxed text-danger-ink sm:text-sm">
                  {resolveMessage(locale, errorMessage)}
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

              <div className="flex flex-col gap-2 rounded-3xl border border-line bg-card p-4 shadow-card">
                <button
                  type="button"
                  onClick={goToParticipants}
                  className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {t("flow.toParticipants")}
                </button>
                {splitError === null ? (
                  <p className="text-xs leading-relaxed text-ink-faint">
                    {t("flow.checkBeforeSplit")}
                  </p>
                ) : (
                  <p
                    role="alert"
                    className="rounded-2xl border border-danger-line bg-danger-surface px-3 py-2.5 text-xs leading-relaxed text-danger-ink"
                  >
                    {t(SPLIT_BLOCK_KEYS[splitError])}
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
        ORTAK HESAP KAPISI: `SHARED_BILL_FLOW_ENABLED` ACIK oldugu icin
        olusturma ekraninda TEK BAGLANTILI ortak hesap olusturucusu gosterilir.
        Bayrak kapatilirsa ESKI, borclu basina ayri baglanti ureten akis geri
        doner; iki yol da derlenir ve test edilir.
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
          ? t("flow.liveAnalyzing")
          : status === "error" && errorMessage !== null
            ? resolveMessage(locale, errorMessage)
            : screen === "payment"
              ? t("flow.livePayment")
              : screen === "debts"
                ? t("flow.liveDebts")
                : screen === "summary"
                  ? t("flow.liveSummary")
                  : screen === "participants"
                    ? t("flow.liveParticipants")
                    : status === "ready"
                      ? t("flow.liveReady")
                      : ""}
      </p>
    </div>
  );
}
