"use client";

import { useEffect, useState } from "react";

import { describeAddressShape } from "@/lib/arc/address-shape";
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
import { formatRelativeAge } from "@/lib/i18n/format";

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

/**
 * Adres biçimini KULLANICIYA anlatır.
 *
 * "Geçersiz" demek ne yapacağını söylemez; en sık hata karakter sayısını
 * tutturamamaktır, o yüzden fark SAYIYLA anlatılır.
 */
function addressProblem(
  value: string,
): { key: TranslationKey; params: Record<string, string> } | null {
  const shape = describeAddressShape(value);
  if (shape.kind === "short") {
    return {
      key: "contacts.errorAddressShort",
      params: { missing: String(shape.missing) },
    };
  }
  if (shape.kind === "long") {
    return {
      key: "contacts.errorAddressLong",
      params: { extra: String(shape.extra) },
    };
  }
  if (shape.kind === "malformed") {
    return { key: "contacts.errorInvalid", params: {} };
  }
  return null;
}

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

export function SavedContactsPanel({
  onPick,
}: {
  /**
   * Verilirse panel SEÇİM kipine geçer: yalnızca kayıtlı kişiler listelenir
   * ve tıklanınca çağırana geçilir. Ekleme, düzenleme, silme ve geçmiş
   * bölümü GÖSTERİLMEZ.
   *
   * Neden: akışın içinden açılan rehberin işi tek bir soruyu yanıtlamaktır —
   * "bu kişiyi ekle". Yönetim ana sayfadaki panelde yapılır.
   */
  onPick?: (contact: Contact) => void;
} = {}) {
  const { t, locale } = useTranslator();
  const picking = onPick !== undefined;
  const [contacts, setContacts] = useState<readonly Contact[]>([]);
  const [history, setHistory] = useState<readonly Contact[]>([]);
  const [loadedAtMs, setLoadedAtMs] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [errorParams, setErrorParams] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await listContactsFromServer();
      if (active && result.ok) {
        /*
         * Panel iki listeyi de gösterir: KAYITLILAR yönetilir, GEÇMİŞ ise
         * "eklemeye hazır" olarak durur. Asıl kolaylık budur — daha önce
         * ödeme yaptığın birini tek dokunuşla deftere alırsın.
         */
        setContacts(result.contacts.filter((row) => row.source === "saved"));
        setHistory(result.contacts.filter((row) => row.source === "history"));
        setLoadedAtMs(Date.now());
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
    setErrorParams({});
    const result = await action();
    setBusy(false);
    if (result.ok) {
      reload();
      return true;
    }
    setErrorKey(errorKeyFor(result.code ?? null));
    return false;
  }

  /*
   * Düğme, adres TAM GEÇERLİ olmadan da basılabilir olmalıdır.
   *
   * Aksi hâlde eksik karakter yazan kullanıcı düğmeye basamaz ve NEDEN
   * basamadığını da öğrenemez — sessizce sıkışır. Basılınca `checkAddress`
   * farkı sayıyla anlatır. Boş alanlarda hâlâ pasiftir: söyleyecek bir şey
   * yoktur.
   */
  const draftReady =
    draft.label.trim() !== "" && draft.address.trim() !== "";

  /** Kaydetmeden önce biçimi anlat; sunucuya gitmeye gerek yok. */
  function checkAddress(value: string): boolean {
    const problem = addressProblem(value);
    if (problem === null) {
      return true;
    }
    setErrorParams(problem.params);
    setErrorKey(problem.key);
    return false;
  }

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
        {contacts.length > 0 && !picking && (
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
                        if (!checkAddress(editDraft.address)) {
                          return;
                        }
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
              ) : picking ? (
                /*
                 * SEÇİM KİPİ: satırın tamamı tek bir eylemdir. Düzenle ve sil
                 * burada YOKTUR — akışın ortasında yanlışlıkla silmek, aramaya
                 * geldiği kişiyi kaybetmek demektir.
                 */
                <button
                  type="button"
                  onClick={() => onPick?.(contact)}
                  className="flex flex-col gap-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <span className="text-sm font-semibold text-ink">
                    {contact.label}
                  </span>
                  <span className="break-all font-mono text-[11px] text-ink-faint">
                    {contact.address}
                  </span>
                </button>
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

      {history.length > 0 && !picking && (
        <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {t("contacts.historyHeading")}
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              {t("contacts.historyHint")}
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {history.map((contact) => (
              <li
                key={contact.address}
                className="flex flex-col gap-1 rounded-xl border border-line bg-card p-3"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-ink">
                    {contact.label}
                  </span>
                  {contact.lastUsedAt !== null && (
                    <span className="text-[11px] text-ink-faint">
                      {formatRelativeAge(contact.lastUsedAt, loadedAtMs, locale)}
                    </span>
                  )}
                </div>
                {/* Burada da TAM adres: kaydetmeden önce görülmelidir. */}
                <span className="break-all font-mono text-[11px] text-ink-faint">
                  {contact.address}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      saveContactOnServer({
                        label: contact.label,
                        address: contact.address,
                      }),
                    )
                  }
                  className="self-start rounded-full border border-line px-3 py-1 text-xs font-semibold text-brand-ink transition-colors hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60"
                >
                  {t("contacts.save")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!picking && (
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
          disabled={busy || !draftReady}
          onClick={() => {
            if (!checkAddress(draft.address)) {
              return;
            }
            void run(() => saveContactOnServer(draft)).then((ok) => {
              if (ok) setDraft(EMPTY);
            });
          }}
          className="self-start rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:bg-disabled disabled:text-disabled-ink"
        >
          {t("contacts.add")}
        </button>
      </div>
      )}

      {errorKey !== null && (
        <p role="status" className="text-xs text-danger-ink">
          {t(errorKey, errorParams)}
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-ink-faint">
        {t("contacts.privacyNotice")}
      </p>
    </section>
  );
}
