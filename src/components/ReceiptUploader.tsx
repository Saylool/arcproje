"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const ACCEPT_ATTRIBUTE = ACCEPTED_MIME_TYPES.join(",");
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

type SelectedReceipt = {
  file: File;
  previewUrl: string;
};

type ReceiptUploaderProps = {
  /** Seçilen gerçek File nesnesini üst akışa iletir. */
  onFileChange: (file: File | null) => void;
  /** Analiz sürerken seçimin değiştirilmesini engeller. */
  disabled?: boolean;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toLocaleString("tr-TR", {
      maximumFractionDigits: 0,
    })} KB`;
  }

  return `${(kilobytes / 1024).toLocaleString("tr-TR", {
    maximumFractionDigits: 1,
  })} MB`;
}

function isAcceptedImage(file: File): boolean {
  if (file.type) {
    return ACCEPTED_MIME_TYPES.includes(file.type);
  }

  // Bazı sistemler dosya türünü boş bırakır; bu durumda uzantıya bakıyoruz.
  const lowerCaseName = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) =>
    lowerCaseName.endsWith(extension),
  );
}

function getValidationError(file: File): string | null {
  if (!isAcceptedImage(file)) {
    return "Bu dosya türü desteklenmiyor. Lütfen JPG, PNG veya WEBP formatında bir fiş görseli seç.";
  }

  if (file.size === 0) {
    return "Dosya boş görünüyor. Lütfen fişin okunabilir bir fotoğrafını seç.";
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `Görsel çok büyük (${formatFileSize(
      file.size,
    )}). En fazla 10 MB yükleyebilirsin.`;
  }

  return null;
}

export function ReceiptUploader({
  onFileChange,
  disabled = false,
}: ReceiptUploaderProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [receipt, setReceipt] = useState<SelectedReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  // Bileşen kaldırıldığında kalan object URL'i serbest bırak.
  useEffect(() => revokePreviewUrl, [revokePreviewUrl]);

  const selectFile = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }

      const validationError = getValidationError(file);
      if (validationError) {
        // Geçerli bir seçim varsa hatalı dosya yüzünden onu kaybetme.
        setError(validationError);
        return;
      }

      revokePreviewUrl();
      const previewUrl = URL.createObjectURL(file);
      previewUrlRef.current = previewUrl;

      setError(null);
      setReceipt({ file, previewUrl });
      onFileChange(file);
    },
    [onFileChange, revokePreviewUrl],
  );

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0]);
    // Aynı dosya tekrar seçilebilsin diye input sıfırlanır.
    event.target.value = "";
  };

  const openFilePicker = () => {
    if (disabled) {
      return;
    }
    inputRef.current?.click();
  };

  const removeReceipt = () => {
    revokePreviewUrl();
    setReceipt(null);
    setError(null);
    onFileChange(null);
    // Klavye kullanıcısı yükleme alanına geri dönsün.
    inputRef.current?.focus();
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // Alt öğeler arasında gezinirken durumun titremesini engelle.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files?.[0]);
  };

  const describedByIds = [hintId];
  if (error) {
    describedByIds.push(errorId);
  }

  return (
    <section aria-label="Fiş yükleme" className="flex flex-col gap-3">
      <div
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-3xl border bg-white p-3 shadow-card transition-colors sm:p-4 ${
          isDragging ? "border-violet-300" : "border-slate-200"
        }`}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="peer sr-only"
          aria-label="Fiş görseli seç"
          aria-describedby={describedByIds.join(" ")}
          tabIndex={receipt ? -1 : 0}
          disabled={disabled}
          onChange={handleInputChange}
        />

        {receipt ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-3 sm:gap-4">
              <div className="h-24 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:h-28 sm:w-24">
                {/* eslint-disable-next-line @next/next/no-img-element -- yerel object URL önizlemesi; next/image bir blob için değer katmıyor */}
                <img
                  src={receipt.previewUrl}
                  alt={`Seçilen fiş görseli: ${receipt.file.name}`}
                  className="h-full w-full object-cover"
                />
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="min-w-0">
                  <p
                    className="truncate text-sm font-semibold text-slate-900"
                    title={receipt.file.name}
                  >
                    {receipt.file.name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatFileSize(receipt.file.size)}
                  </p>
                </div>

                <div className="mt-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openFilePicker}
                    disabled={disabled}
                    className="disabled:cursor-not-allowed disabled:opacity-50 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                  >
                    Değiştir
                  </button>
                  <button
                    type="button"
                    onClick={removeReceipt}
                    disabled={disabled}
                    className="disabled:cursor-not-allowed disabled:opacity-50 rounded-full border border-transparent px-3.5 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                  >
                    Kaldır
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <label
            htmlFor={inputId}
            className={`flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-4 py-9 text-center transition-colors peer-focus-visible:border-violet-400 peer-focus-visible:bg-violet-50 sm:px-6 sm:py-12 ${
              isDragging
                ? "border-violet-400 bg-violet-50"
                : "border-slate-200 bg-slate-50/70 hover:border-violet-300 hover:bg-violet-50/60"
            }`}
          >
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-600"
            >
              <UploadIcon />
            </span>

            <span className="flex flex-col gap-1">
              <span className="text-base font-semibold text-slate-900">
                Fişini buraya sürükle
              </span>
              <span className="text-sm text-slate-500">
                ya da cihazından bir görsel seç
              </span>
            </span>

            <span className="inline-flex items-center rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-200 transition-colors hover:bg-violet-700">
              Fiş görseli seç
            </span>
          </label>
        )}
      </div>

      {error && (
        <p
          id={errorId}
          className="flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700 sm:text-sm"
        >
          <AlertIcon />
          <span>{error}</span>
        </p>
      )}

      <p id={hintId} className="px-1 text-xs text-slate-400">
        JPG, PNG veya WEBP · en fazla 10 MB
      </p>

      {/* Durum değişikliklerini ekran okuyuculara duyuran kalıcı canlı bölge. */}
      <p aria-live="polite" className="sr-only">
        {error
          ? error
          : receipt
            ? `${receipt.file.name} seçildi. Fiş yüklemeye hazır.`
            : ""}
      </p>
    </section>
  );
}

function UploadIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}
