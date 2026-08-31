"use client";

import { useEffect, useState } from "react";

import { normalizeWalletAddress } from "@/lib/arc/address";
import {
  deleteAllContactsOnServer,
  deleteContactOnServer,
  listContactsFromServer,
  saveContactOnServer,
  updateContactOnServer,
  type Contact,
} from "@/lib/arc/contacts-client";
import { useTranslator } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/dictionary";

/**
 * KAYITLI KİŞİLER PANELİ.
 *
 * Bu tablo, uygulamanın açtığı tek kalıcı "kişi → cüzdan" kaydıdır. Karşılığı
 * budur: kullanıcı burada tek tek ve toptan silebilir. Silme hakkı olmadan
 * böyle bir kayıt tutmak doğru olmazdı.
 *
 * ADRES TAM HÂLİYLE GÖSTERİLİR. Kısaltma, kullanıcının kayıtlı bir adresi
 * gözden geçirmesini imkânsız kılardı; yanlış adrese giden transfer geri
 * alınamaz.
 */

type Draft = { label: string; address: string };

const EMPTY: Draft = { label: "", address: "" };

/** Sunucu kodunu gösterilecek cümleye çevirir. */
function errorKeyFor(code: string | null): TranslationKey {
  if (code === "CONTACT_LABEL_EXISTS") return "contacts.errorLabelExists";
  if (code === "CONTACT_ADDRESS_EXISTS") return "contacts.errorAddressExists";
  if (code === "CONTACT_LIMIT_REACHED") return "contacts.errorLimit";
  if (code === "INVALID_LABEL" || code === "INVALID_ADDRESS") {
    return "contacts.errorInvalid";
  }
  return "contacts.errorGeneric";
}

export function SavedContactsPanel() {
  const { t } = useTranslator();
  const [contacts, setContacts] = useState<readonly Contact[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await listContactsFromServer();
      if (active && result.ok) {
        /* Panel YALNIZCA kayıtlıları yönetir; geçmiş önerileri buraya girmez. */
        setContacts(result.contacts.filter((row) => row.source === "saved"));
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const reload = () => setReloadToken((token) => token + 1);

  async function run(action: () => Promise<{ ok: boolean; code?: string | null }>) {
    setBusy(true);
    setErrorKey(null);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      reload();
      return true;
    }
    setErrorKey(errorKeyFor(result.code ?? null));
    return false;
  }

  const draftValid =
    draft.label.trim() !== "" && normalizeWalletAddress(draft.address) !== null;

  return (
    <section
      aria-labelledby="saved-contacts-title"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-muted p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            id="saved-contacts-title"
            className="text-sm font-semibold text-ink"
          >
            {t("contacts.panelTitle")}
          </h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            {t("contacts.panelSubtitle")}
          </p>
        </div>
        {contacts.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              /*
                TOPLU SİLME GERİ ALINAMAZ, bu yüzden onay istenir.
              */
              if (window.confirm(t("contacts.confirmRemoveAll"))) {
                void run(() => deleteAllContactsOnServer());
              }
            }}
            className="shrink-0 rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold text-danger-ink transition-colors hover:border-danger-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60"
          >
            {t("contacts.removeAll")}
          </button>
        )}
      </div>

      {contacts.length === 0 ? (
        <p className="text-xs text-ink-faint">{t("contacts.panelEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {contacts.map((contact) => (
            <li
              key={contact.contactId}
              className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3"
            >
              {editing === contact.contactId ? (
                <>
                  <input
                    type="text"
                    value={editDraft.label}
                    aria-label={t("contacts.nameField")}
                    onChange={(event) =>
                      setEditDraft((previous) => ({
                        ...previous,
                        label: event.target.value,
                      }))
                    }
                    className="rounded-xl border border-line bg-field px-3 py-2 text-sm text-ink"
                  />
                  <input
                    type="text"
                    value={editDraft.address}
                    spellCheck={false}
                    aria-label={t("contacts.addressField")}
                    onChange={(event) =>
                      setEditDraft((previous) => ({
                        ...previous,
                        address: event.target.value,
                      }))
                    }
                    className="rounded-xl border border-line bg-field px-3 py-2 font-mono text-xs text-ink"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void run(() =>
                          updateContactOnServer(
                            contact.contactId ?? "",
                            editDraft,
                          ),
                        ).then((ok) => {
                          if (ok) setEditing(null);
                        });
                      }}
                      className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {t("contacts.saveChanges")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        setErrorKey(null);
                      }}
                      className="rounded-full px-3 py-1 text-xs font-semibold text-ink-faint"
                    >
                      {t("contacts.cancel")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="text-sm font-semibold text-ink">
                    {contact.label}
                  </span>
                  {/* TAM adres; kısaltma gözden geçirmeyi imkânsız kılardı. */}
                  <span className="break-all font-mono text-[11px] text-ink-faint">
                    {contact.address}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(contact.contactId);
                        setEditDraft({
                          label: contact.label,
                          address: contact.address,
                        });
                        setErrorKey(null);
                      }}
                      className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      {t("contacts.edit")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          deleteContactOnServer(contact.contactId ?? ""),
                        )
                      }
                      className="rounded-full px-3 py-1 text-xs font-semibold text-danger-ink transition-colors hover:bg-danger-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60"
                    >
                      {t("contacts.remove")}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
        <input
          type="text"
          value={draft.label}
          placeholder={t("contacts.nameField")}
          aria-label={t("contacts.nameField")}
          onChange={(event) =>
            setDraft((previous) => ({ ...previous, label: event.target.value }))
          }
          className="rounded-xl border border-line bg-field px-3 py-2 text-sm text-ink"
        />
        <input
          type="text"
          value={draft.address}
          spellCheck={false}
          placeholder={t("contacts.addressField")}
          aria-label={t("contacts.addressField")}
          onChange={(event) =>
            setDraft((previous) => ({
              ...previous,
              address: event.target.value,
            }))
          }
          className="rounded-xl border border-line bg-field px-3 py-2 font-mono text-xs text-ink"
        />
        <button
          type="button"
          disabled={busy || !draftValid}
          onClick={() => {
            void run(() => saveContactOnServer(draft)).then((ok) => {
              if (ok) setDraft(EMPTY);
            });
          }}
          className="self-start rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:bg-disabled disabled:text-disabled-ink"
        >
          {t("contacts.add")}
        </button>
      </div>

      {errorKey !== null && (
        <p role="status" className="text-xs text-danger-ink">
          {t(errorKey)}
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-ink-faint">
        {t("contacts.privacyNotice")}
      </p>
    </section>
  );
}
