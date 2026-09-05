"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

import { PaymentRequestCreator } from "@/components/PaymentRequestCreator";
import { dropStaleLinks } from "@/lib/split/linked-addresses";
import { SharedBillCreator } from "@/components/SharedBillCreator";
import { SHARED_BILL_FLOW_ENABLED } from "@/lib/arc/shared-bill-feature";
import { AssignmentSummaryView } from "@/components/AssignmentSummary";
import { DebtSummaryView } from "@/components/DebtSummary";
import { ParticipantAssignment } from "@/components/ParticipantAssignment";
import { ProgressSteps, type FlowStepId } from "@/components/ProgressSteps";
import { ReceiptEditor } from "@/components/ReceiptEditor";
import { ReceiptUploader } from "@/components/ReceiptUploader";
import { GoogleSignInButton } from "@/components/AuthControl";
import { readApiErrorCode } from "@/lib/i18n/api-errors";
import { quotaDisplayAfterFailure } from "@/lib/receipt/quota-feedback";
import { useTranslator } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/dictionary";
import {
  messageApi,
  messageKey,
  resolveMessage,
  type MessageDescriptor,
} from "@/lib/i18n/messages";
import { prepareReceiptUpload } from "@/lib/receipt/prepare-upload";
import { readRemainingAnalyses } from "@/lib/receipt/quota-response";
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

export function ReceiptFlow({
  authStatus,
  contactsPanel,
}: {
  authStatus: "authenticated" | "signedOut" | "unavailable";
  /**
   * Kayıtlı kişiler paneli. YALNIZCA ilk ekranda gösterilir: kişi ve
   * ödeme adımlarında aynı kutuyu tekrar basmak, o adımın işini
   * bölmekten başka bir şey yapmaz. Akışın içinde rehbere kişi
   * adımındaki düğmeden ulaşılır.
   */
  contactsPanel?: ReactNode;
}) {
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
  /*
   * Bugün kalan analiz hakkı. SUNUCUDAN gelir; istemci saymaz. `null`,
   * "henüz bilinmiyor" demektir ve hiçbir şey gösterilmez.
   */
  const [remainingAnalyses, setRemainingAnalyses] = useState<number | null>(
    null,
  );
  // Yeni bir analiz geldiğinde düzenleyicinin taslak input'ları sıfırlansın.
  const [analysisKey, setAnalysisKey] = useState(0);
  const isAnalyzingRef = useRef(false);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);

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
      setShowAuthPrompt(false);
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

  /**
   * KİŞİ ADIMINDA bağlanan cüzdan adresleri: katılımcı kimliği → adres.
   *
   * Eşleştirme burada yapılır çünkü insanları İSİMLE tanırsın, adresle değil.
   * Ödeme adımı bu eşleşmeyi hazır bulur; orada yeniden öneri gösterilmez.
   */
  const [linkedAddresses, setLinkedAddresses] = useState<
    Record<string, string>
  >({});

  const handleAssignmentChange = useCallback(
    (next: AssignmentState) => {
      /*
       * Bayat bağlar ÖNCE düşürülür: adı değişmiş ya da silinmiş bir kişinin
       * cüzdan bağı ödeme adımına taşınmamalıdır.
       */
      setLinkedAddresses((links) =>
        dropStaleLinks(links, assignment.participants, next.participants),
      );
      setAssignment(next);
      invalidateDebts();
    },
    [assignment.participants, invalidateDebts],
  );

  const linkAddress = useCallback((participantId: string, address: string) => {
    setLinkedAddresses((links) => ({ ...links, [participantId]: address }));
  }, []);

  const unlinkAddress = useCallback((participantId: string) => {
    setLinkedAddresses((links) => {
      const next = { ...links };
      delete next[participantId];
      return next;
    });
  }, []);

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
    if (authStatus !== "authenticated") {
      /* FormData yaratılmaz ve dosya API'ye gönderilmez. */
      setShowAuthPrompt(true);
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
      /*
       * GÖNDERMEDEN ÖNCE küçült. Platformun istek gövdesi sınırı uygulama
       * koduna ULAŞMADAN devreye giriyor; sunucudaki hiçbir doğrulama bu
       * duruma yetişemez. Sınırın altındaki dosyaya dokunulmaz.
       */
      const prepared = await prepareReceiptUpload(file);
      if (!prepared.ok) {
        setErrorMessage(
          messageKey(
            prepared.reason === "tooLarge"
              ? "errors.receiptTooLargeToSend"
              : "errors.receiptUnreadableImage",
          ),
        );
        setStatus("error");
        return;
      }

      const body = new FormData();
      body.append("receipt", prepared.file);

      const response = await fetch("/api/receipts/analyze", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        /*
         * 413 PLATFORMDAN gelir, uygulamadan değil: gövdesi JSON değil düz
         * metindir ve okunacak bir kod TAŞIMAZ. Ayrıca karşılanmazsa
         * kullanıcı, sebebini anlatmayan genel bir hata görür.
         */
        /*
         * 429 TEK BAŞINA "senin hakkın bitti" DEMEK DEĞİLDİR.
         *
         *   DAILY_LIMIT_REACHED — kişinin KENDİ hakkı doldu. Kalan sıfırdır.
         *   SERVICE_BUSY        — GENEL tavan doldu. Kişinin hakkı durur;
         *                         sıfır yazmak ona olmayan bir şey söylerdi.
         *
         * Eskiden her 429'da sıfır yazılıyordu: genel tavan dolduğunda
         * kullanıcı, hiç kullanmadığı hakkını bitmiş sanıyordu. Bilinmeyeni
         * uydurmak yerine bilinen değer KORUNUR.
         */
        const failureCode = readApiErrorCode(payload);
        if (
          quotaDisplayAfterFailure(response.status, failureCode).kind ===
          "showExhausted"
        ) {
          setRemainingAnalyses(0);
        }
        if (response.status === 413) {
          setErrorMessage(messageKey("errors.receiptTooLargeToSend"));
          setStatus("error");
          return;
        }
        /*
         * Sunucunun hazir metni GOSTERILMEZ: yalnizca KARARLI KOD okunur ve
         * cumle sozlukten, etkin dilde secilir. Taninmayan kod guvenli genel
         * karsiliga duser.
         */
        setErrorMessage(messageApi(failureCode ?? undefined));
        setStatus("error");
        return;
      }

      /*
       * Kalan hak sunucudan gelir. Kullanıcı sınıra çarpınca şaşırmasın diye
       * gösterilir; istemci bunu SAYMAZ, yalnızca sunucunun söylediğini
       * yansıtır.
       */
      setRemainingAnalyses(readRemainingAnalyses(payload));

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

          {remainingAnalyses !== null && (
            /*
             * Yalnızca sunucu bir sayı bildirdiğinde görünür. Sınıra
             * çarpmadan önce uyarmak, çarptıktan sonra açıklamaktan iyidir.
             */
            <p
              role="status"
              className="text-xs text-ink-faint"
            >
              {t("upload.remainingAnalyses", {
                count: String(remainingAnalyses),
              })}
            </p>
          )}

          {file !== null && (
            <div className="flex flex-col gap-3 rounded-3xl border border-line bg-card p-4 shadow-card">
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={analyze}
                  disabled={isAnalyzing}
                  className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-disabled disabled:shadow-none min-h-11"
                >
                  {ctaLabel}
                </button>
                <p className="text-xs leading-relaxed text-ink-faint">
                  {t("flow.uploadNotice")}
                </p>
              </div>

              {showAuthPrompt && authStatus !== "authenticated" && (
                <div
                  role="alert"
                  className="flex flex-col items-start gap-2 rounded-2xl border border-brand-line bg-brand-soft px-3 py-3 text-sm text-brand-ink"
                >
                  <p>
                    {t(
                      authStatus === "unavailable"
                        ? "auth.unavailable"
                        : "auth.analysisRequired",
                    )}
                  </p>
                  {authStatus === "signedOut" && (
                    <>
                      <p className="text-xs leading-relaxed">
                        {t("auth.chooseAgainAfterSignIn")}
                      </p>
                      <GoogleSignInButton />
                    </>
                  )}
                </div>
              )}

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
                  className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-h-11"
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

      {/*
        Rehber paneli YALNIZCA ilk ekranda. Sonraki adımlarda aynı kutuyu
        tekrar basmak o adımın işini bölerdi; oralarda rehbere kişi
        adımındaki düğmeden ulaşılır.
      */}
      {screen === "receipt" && contactsPanel}

      {screen === "participants" && receipt !== null && (
        <ParticipantAssignment
          receipt={receipt}
          state={assignment}
          onChange={handleAssignmentChange}
          linkedAddresses={linkedAddresses}
          onLinkAddress={linkAddress}
          onUnlinkAddress={unlinkAddress}
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
            initialAddresses={linkedAddresses}
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
