"use client";

import { useEffect, useRef } from "react";

import { SavedContactsPanel } from "@/components/SavedContactsPanel";
import type { Contact } from "@/lib/arc/contacts-client";
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
  openToken,
  onClosed,
  onPick,
}: {
  /**
   * Her ARTIŞ bir "aç" isteğidir.
   *
   * Boolean bir `open` yerine sayaç kullanılır çünkü diyalog TARAYICI
   * tarafından da kapanabilir (Escape, geri tuşu). Böyle bir kapanışta React
   * hâlâ "açık" sanırsa, `setOpen(true)` durumu DEĞİŞTİRMEZ ve diyalog bir
   * daha açılmaz — kullanıcı için düğme ölmüş olur.
   *
   * Sayaç bu tuzağı yapısal olarak yok eder: her tıklama yeni bir değerdir,
   * dolayısıyla efekt HER SEFERİNDE çalışır ve `showModal()` çağrılır.
   */
  openToken: number;
  /** Kapanış YAKALANABİLİRSE bildirilir; doğruluk buna BAĞLI DEĞİLDİR. */
  onClosed: () => void;
  /** Kayıtlı bir kişi seçildiğinde çağrılır; diyalog kapanır. */
  onPick: (contact: Contact) => void;
}) {
  const { t } = useTranslator();
  const ref = useRef<HTMLDialogElement>(null);
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  }, [onClosed]);

  /*
   * `close` olayı KABARMAZ ve bazı ortamlarda programatik `close()` çağrısında
   * hiç tetiklenmez — tarayıcıda ölçüldü. Bu yüzden dinlenir ama yalnızca
   * TAZELEME için: açılma doğruluğu buna dayanmaz.
   */
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    const handleClose = () => onClosedRef.current();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null || openToken === 0) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
  }, [openToken]);

  const close = () => {
    ref.current?.close();
    onClosedRef.current();
  };

  return (
    <dialog
      ref={ref}
      aria-label={t("contacts.panelTitle")}
      onClick={(event) => {
        /* Zeminine tıklayınca kapanır; içeriğe tıklamak kapatmaz. */
        if (event.target === ref.current) {
          close();
        }
      }}
      /*
       * `m-auto` OLMADAN yerli `<dialog>` sola yaslanır. Genişlik sınırı
       * ekranı taşırmasın diye `max-w` ile birlikte verilir.
       */
      className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-2xl bg-surface p-0 text-ink backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-3 p-4">
        <SavedContactsPanel
          onPick={(contact) => {
            onPick(contact);
            close();
          }}
        />
        <button
          type="button"
          onClick={close}
          className="self-end rounded-full border border-line bg-card px-4 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {t("contacts.closeBook")}
        </button>
      </div>
    </dialog>
  );
}
