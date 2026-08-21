"use client";

import { useCallback, useRef, useState } from "react";

import { ReceiptEditor } from "@/components/ReceiptEditor";
import { ReceiptUploader } from "@/components/ReceiptUploader";
import { ReceiptSchema, type Receipt } from "@/lib/receipt/schema";

type AnalysisStatus = "idle" | "analyzing" | "error" | "ready";

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

  const handleFileChange = useCallback((next: File | null) => {
    setFile(next);
    setReceipt(null);
    setErrorMessage(null);
    setStatus("idle");
  }, []);

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
    } catch {
      setErrorMessage(didTimeout ? TIMEOUT_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE);
      setStatus("error");
    } finally {
      // Timer her başarı ve hata yolunda temizlenir.
      window.clearTimeout(timeoutId);
      isAnalyzingRef.current = false;
    }
  };

  const isAnalyzing = status === "analyzing";
  const ctaLabel = isAnalyzing
    ? "Analiz ediliyor…"
    : status === "error"
      ? "Tekrar dene"
      : status === "ready"
        ? "Yeniden analiz et"
        : "Fişi analiz et";

  return (
    <div className="flex flex-col gap-4">
      <ReceiptUploader onFileChange={handleFileChange} disabled={isAnalyzing} />

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
        <ReceiptEditor
          key={analysisKey}
          receipt={receipt}
          onChange={setReceipt}
        />
      )}

      <p aria-live="polite" className="sr-only">
        {isAnalyzing
          ? "Fiş analiz ediliyor."
          : status === "error" && errorMessage !== null
            ? errorMessage
            : status === "ready"
              ? "Fiş analizi tamamlandı. Ürünleri düzenleyebilirsin."
              : ""}
      </p>
    </div>
  );
}
