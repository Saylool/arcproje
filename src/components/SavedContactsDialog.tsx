"use client";

import { useEffect, useRef } from "react";

import { SavedContactsPanel } from "@/components/SavedContactsPanel";
import { useTranslator } from "@/lib/i18n/context";

/**
 * REHBERİ AKIŞIN İÇİNDEN AÇAN DİYALOG.
 *
 * İçerik ana sayfadaki panelin AYNISIDIR — tek bileşen, iki giriş noktası.
 * Böylece "akışta gördüğün rehber" ile "ana sayfadaki rehber" birbirinden
 * ayrışamaz.
 *
 * Yerli `<dialog>` kullanılır: Escape ile kapanma, odak tuzağı ve arka planın
 * etkisizleşmesi tarayıcıdan gelir. Kendi elle yazılmış bir modalda bu üçü de
 * kolayca eksik kalır.
 */
export function SavedContactsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslator();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={t("contacts.panelTitle")}
      /*
       * `close` HER kapanışta çalışır — Escape ve düğme dâhil. Durumu tek
       * yerden geri bildirmek, "kapandı ama React hâlâ açık sanıyor" hâlini
       * imkânsız kılar.
       */
      onClose={onClose}
      onClick={(event) => {
        /* Zeminine tıklayınca kapanır; içeriğe tıklamak kapatmaz. */
        if (event.target === ref.current) {
          onClose();
        }
      }}
      className="w-full max-w-xl rounded-2xl bg-surface p-0 text-ink backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-3 p-4">
        <SavedContactsPanel />
        <button
          type="button"
          onClick={onClose}
          className="self-end rounded-full border border-line bg-card px-4 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {t("contacts.closeBook")}
        </button>
      </div>
    </dialog>
  );
}
