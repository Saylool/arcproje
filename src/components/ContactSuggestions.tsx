"use client";

import { useEffect, useState } from "react";

import { shortenWalletAddress } from "@/lib/arc/address";
import {
  listContactsFromServer,
  type Contact,
} from "@/lib/arc/contacts-client";
import { useTranslator } from "@/lib/i18n/context";
import { formatDateTime, formatRelativeAge } from "@/lib/i18n/format";

/**
 * GEÇMİŞTEN ADRES ÖNERİLERİ.
 *
 * Rehber ayrı bir depo değildir: kişinin KENDİ oluşturduğu hesaplarda daha
 * önce kullandığı borçlular okunur. Sunucu süzmeyi oturuma göre yapar.
 *
 * ÖNERİ ASLA KENDİLİĞİNDEN DOLDURMAZ. Kullanıcı açıkça tıklar; ancak o zaman
 * adres alana yazılır ve oradan itibaren elle yazılmış bir adresle AYNI
 * doğrulamadan geçer. Etiket adresin yerine geçmez — aynı ada sahip iki farklı
 * kişi olabilir, bu yüzden tam adres imzalamadan önce zaten gösterilir.
 */

/** Ekranda aynı anda gösterilen en fazla öneri. */
const MAX_VISIBLE = 3;

/**
 * Rehberi BİR KEZ okur.
 *
 * Başarısızlık SESSİZDİR: öneri isteğe bağlı bir kolaylıktır, akışı
 * durdurmamalıdır. Oturum yoksa sunucu 401 döner ve liste boş kalır.
 */
export type RecentContacts = Readonly<{
  contacts: readonly Contact[];
  /**
   * Listenin OKUNDUĞU an. Yaş, render sırasında `Date.now()` okunarak değil
   * bu sabit ana göre hesaplanır; render saf kalır.
   */
  loadedAtMs: number;
}>;

export function useRecentContacts(): RecentContacts {
  const [state, setState] = useState<RecentContacts>({
    contacts: [],
    loadedAtMs: 0,
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await listContactsFromServer();
      if (active && result.ok) {
        setState({ contacts: result.contacts, loadedAtMs: Date.now() });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return state;
}

/**
 * Aramayı AKSAN DUYARSIZ hâle getirir.
 *
 * Türkçe adlar çoğu zaman aksansız yazılır ("cagla" → "Çağla"), bu yüzden
 * eşleştirme öncesi her iki taraf da sadeleştirilir: birleşen işaretler atılır
 * ve noktasız `ı` ile büyük `I` tek bir harfe indirgenir.
 *
 * Bu YALNIZCA bir süzgeçtir. Hiçbir güvenlik kararı buna bağlı değildir:
 * seçilen adres yine tam hâliyle doğrulanır.
 */
function foldForSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u0131I]/g, "i")
    .toLowerCase();
}

/**
 * Bu satır için en uygun önerileri seçer.
 *
 * Sıra: katılımcı adıyla eşleşenler önce, sonra en son kullanılanlar. Kullanıcı
 * yazmaya başladıysa yalnızca yazdığına uyanlar kalır.
 */
export function pickSuggestions(
  contacts: readonly Contact[],
  participantName: string,
  typed: string,
): readonly Contact[] {
  const needle = foldForSearch(typed.trim());
  const name = foldForSearch(participantName.trim());

  const matches = contacts.filter((contact) => {
    if (needle === "") {
      return true;
    }
    return (
      contact.address.toLowerCase().startsWith(needle) ||
      foldForSearch(contact.label).includes(needle)
    );
  });

  return [...matches]
    .sort((left, right) => {
      const leftName = foldForSearch(left.label.trim()) === name ? 0 : 1;
      const rightName = foldForSearch(right.label.trim()) === name ? 0 : 1;
      if (leftName !== rightName) {
        return leftName - rightName;
      }
      return right.lastUsedAt - left.lastUsedAt;
    })
    .slice(0, MAX_VISIBLE);
}

export function ContactSuggestions({
  contacts,
  asOfMs,
  participantName,
  value,
  onPick,
}: {
  contacts: readonly Contact[];
  /** Listenin okunduğu an; yaş buna göre hesaplanır. */
  asOfMs: number;
  participantName: string;
  value: string;
  onPick: (address: string) => void;
}) {
  const { t, locale } = useTranslator();
  const suggestions = pickSuggestions(contacts, participantName, value);

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-ink-faint">{t("contacts.hint")}</span>
      <ul
        aria-label={t("contacts.suggestionsLabel")}
        className="flex flex-wrap gap-1.5"
      >
        {suggestions.map((contact) => (
          <li key={contact.address}>
            <button
              type="button"
              onClick={() => onPick(contact.address)}
              /* Tam adres ipucu olarak da verilir; kısaltma yalnızca yer içindir. */
              title={`${contact.address} — ${t("contacts.lastUsed", {
                date: formatDateTime(contact.lastUsedAt, locale),
              })}`}
              aria-label={t("contacts.useAddress", { label: contact.label })}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-card px-2.5 text-[11px] text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <span className="font-medium">{contact.label}</span>
              <span className="font-mono text-ink-faint">
                {shortenWalletAddress(contact.address)}
              </span>
              {/*
                YAŞ EKRANDA DURUR, ipucunda değil: dokunmatik ekranda hover
                yoktur ve "bu adres ne kadar eski" sorusu tam da kullanıcının
                tıklamadan önce sorması gereken sorudur.
              */}
              <span className="text-ink-faint">
                {formatRelativeAge(contact.lastUsedAt, asOfMs, locale)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
