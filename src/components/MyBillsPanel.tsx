"use client";

import { useEffect, useState } from "react";

import {
  listMyBillsFromServer,
  type MyBillSummary,
} from "@/lib/arc/shared-bill-client";
import { useTranslator } from "@/lib/i18n/context";
import { formatDateTime, formatTryMinor } from "@/lib/i18n/format";

/**
 * OLUŞTURDUĞUN HESAPLAR.
 *
 * Bu panel, Google oturumunun yalnızca "pahalı işlemi kapatan bir kapı"
 * olmaktan çıkıp gerçek bir YETKİ ölçütü olduğu tek kullanıcı yüzeyidir:
 * gösterilen satırlar sunucuda oturumdaki uygulama kullanıcısına göre
 * süzülür. İstemci hangi kullanıcının listesini istediğini SÖYLEYEMEZ.
 *
 * SAHİPLİK ÖDEME YETKİSİ DEĞİLDİR. Panel yalnızca okuma yapar; buradan hiçbir
 * transfer başlatılamaz, hiçbir borç satırı değiştirilemez. Bu sınır kullanıcı
 * metninde de AÇIKÇA söylenir.
 *
 * Yalnızca oturum açıkken oluşturulur: oturumsuz bir ziyaretçide bu bileşen
 * hiç render edilmez, bu yüzden gereksiz bir istek de atılmaz.
 */

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ready";
      bills: readonly MyBillSummary[];
      /** Ust sinirdan fazlasi var mi? Kirpma kullaniciya SOYLENIR. */
      hasMore: boolean;
      /**
       * Listenin OKUNDUĞU an. Süre dolumu render sırasında `Date.now()`
       * okunarak değil, bu sabit ana göre hesaplanır: render saf kalır ve
       * aynı veri her zaman aynı çıktıyı verir.
       */
      loadedAtMs: number;
    }
  | { kind: "failed" };

function StatusBadge({
  bill,
  asOfMs,
}: {
  bill: MyBillSummary;
  asOfMs: number;
}) {
  const { t } = useTranslator();

  /*
   * Süre dolumu SUNUM içindir. Gerçek kapı sunucudadır: süresi dolmuş bir
   * hesap borçlu tarafında zaten `notFound` döner.
   */
  const expired = bill.expiresAt * 1000 <= asOfMs;
  const [label, className] =
    bill.status === "closed"
      ? [t("myBills.statusClosed"), "bg-muted-strong text-ink-faint"]
      : expired
        ? [t("myBills.statusExpired"), "bg-warn-surface text-warn-ink-soft"]
        : [t("myBills.statusOpen"), "bg-ok-surface text-ok-ink"];

  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

function BillRow({
  bill,
  asOfMs,
}: {
  bill: MyBillSummary;
  asOfMs: number;
}) {
  const { t, tp, locale } = useTranslator();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const total = formatTryMinor(bill.totalTryMinor, locale) ?? "—";
  const paid = formatTryMinor(bill.paidTryMinor, locale) ?? "—";

  async function copyLink() {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${bill.path}`,
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          {t("myBills.amountPaid", { paid, total })}
        </span>
        <StatusBadge bill={bill} asOfMs={asOfMs} />
      </div>

      <p className="text-xs text-ink-soft">
        {tp("billDebtorsPaid", bill.debtCount, { paid: bill.paidCount })}
      </p>

      {/*
        Etiket ZATEN cümlenin içinde ("Veriliş: …"), bu yüzden ayrı bir
        `<dt>` konmaz: ekran okuyucu aksi hâlde etiketi iki kez okurdu.
      */}
      <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ink-faint">
        <span>
          {t("myBills.issuedAt", {
            date: formatDateTime(bill.issuedAt, locale),
          })}
        </span>
        <span>
          {t("myBills.expiresAt", {
            date: formatDateTime(bill.expiresAt, locale),
          })}
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex min-h-8 items-center rounded-full border border-line bg-card px-3 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {copied ? t("myBills.copied") : t("myBills.copyLink")}
        </button>
        <a
          href={bill.path}
          className="inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold text-brand-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {t("myBills.openLink")}
        </a>
      </div>

      {copyFailed && (
        <p role="status" className="text-[11px] text-warn-ink-soft">
          {t("myBills.copyFailed")}
        </p>
      )}
    </li>
  );
}

export function MyBillsPanel() {
  const { t } = useTranslator();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  /*
   * İlk yükleme ve "Yenile" TEK yoldan geçer: yenileme yalnızca jetonu
   * artırır. Böylece iki ayrı yükleme kodu birbirinden ayrışamaz ve sökülmüş
   * bileşende durum güncellenmez.
   */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await listMyBillsFromServer();
      if (!active) {
        return;
      }
      setState(
        result.ok
          ? {
              kind: "ready",
              bills: result.bills,
              hasMore: result.hasMore,
              loadedAtMs: Date.now(),
            }
          : { kind: "failed" },
      );
    })();
    return () => {
      active = false;
    };
  }, [reloadToken]);

  /* "Yükleniyor" durumunu OLAY İŞLEYİCİ kurar; efekt yalnızca sonucu yazar. */
  const reload = () => {
    setState({ kind: "loading" });
    setReloadToken((token) => token + 1);
  };

  return (
    <section
      aria-labelledby="my-bills-title"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-muted p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="my-bills-title" className="text-sm font-semibold text-ink">
            {t("myBills.title")}
          </h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            {t("myBills.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={state.kind === "loading"}
          aria-disabled={state.kind === "loading"}
          className="shrink-0 rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-60"
        >
          {t("myBills.refresh")}
        </button>
      </div>

      {state.kind === "loading" && (
        <p role="status" className="text-xs text-ink-faint">
          {t("myBills.loading")}
        </p>
      )}

      {/*
        Hata halinde AYRI bir "tekrar dene" dugmesi YOKTUR: yukarudaki
        "Yenile" ayni islevi gorur ve hemen ustundedir. Iki ayni eylemi yan
        yana koymak, kullaniciya ikisinin farkli seyler yaptigini dusundurur.
      */}
      {state.kind === "failed" && (
        <p role="status" className="text-xs text-warn-ink-soft">
          {t("myBills.failed")}
        </p>
      )}

      {state.kind === "ready" && state.bills.length === 0 && (
        <p className="text-xs text-ink-faint">{t("myBills.empty")}</p>
      )}

      {state.kind === "ready" && state.bills.length > 0 && (
        <ul
          aria-label={t("myBills.listLabel")}
          className="flex flex-col gap-2"
        >
          {state.bills.map((bill) => (
            <BillRow
              key={bill.billId}
              bill={bill}
              asOfMs={state.loadedAtMs}
            />
          ))}
        </ul>
      )}

      {/*
        Liste sinira dayandiysa bu SOYLENIR. Sessiz kirpma, kullanicinin
        "bir hesabim kaybolmus" diye dusunmesine yol acardi.
      */}
      {state.kind === "ready" && state.hasMore && (
        <p className="text-[11px] text-ink-faint">
          {t("myBills.truncated", { count: String(state.bills.length) })}
        </p>
      )}

      {/*
        Yetki sınırı KULLANICIYA da söylenir: bu liste bir kayıttır, ödeme
        yetkisi değil.
      */}
      <p className="text-[11px] leading-relaxed text-ink-faint">
        {t("myBills.authorityNotice")}
      </p>
    </section>
  );
}
