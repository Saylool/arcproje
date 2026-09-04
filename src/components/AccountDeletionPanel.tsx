"use client";

import { useState } from "react";

import { endGoogleSession } from "@/app/auth-actions";
import { useTranslator } from "@/lib/i18n/context";
import { PRIVACY_CONTACT_EMAIL } from "@/lib/legal/privacy";

/**
 * HESAP SİLME PANELİ.
 *
 * İKİ ADIMLIDIR. Tek tıkla hesap gitmez: önce neyin gittiği ve neyin kaldığı
 * okunur, sonra ayrı bir düğmeyle onaylanır. Geri alınamayan bir işlem için
 * yanlışlıkla tıklama tek başına yeterli olmamalıdır.
 *
 * ÇEREZ SUNUCUDA ÖLDÜRÜLÜR. Silme yanıtı oturum çerezini temizler; buradaki
 * düğme yalnızca kullanıcıyı ana sayfaya götürür.
 *
 * Bu yorumun eski hâli "kalan çerez bir yetki taşımaz" diyordu ve YAZILDIĞI
 * GÜN doğruydu: bütün tablolarda `app_users`a yabancı anahtar vardı, yazma
 * düşer okuma boş dönerdi. Sonradan eklenen kota tablosunun yabancı anahtarı
 * YOK ve o yol para harcıyor; gerekçe böylece geçersiz kaldı.
 *
 * Çerez temizliği yalnızca İSTEĞİ GÖNDEREN tarayıcıyı kapatır. Başka bir
 * cihazdaki oturumu kapatan şey, analiz ucundaki varlık kontrolüdür.
 */

type Phase =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "working" }
  | { status: "done" }
  | { status: "failed" };

export function AccountDeletionPanel() {
  const { t } = useTranslator();
  const [phase, setPhase] = useState<Phase>({ status: "idle" });

  const remove = async () => {
    setPhase({ status: "working" });
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      setPhase(response.ok ? { status: "done" } : { status: "failed" });
    } catch {
      setPhase({ status: "failed" });
    }
  };

  if (phase.status === "done") {
    return (
      <section
        role="status"
        className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4"
      >
        <h2 className="text-base font-semibold text-ink">
          {t("account.doneTitle")}
        </h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          {t("account.doneBody")}
        </p>
        <form action={endGoogleSession}>
          <button
            type="submit"
            className="inline-flex min-h-9 items-center justify-center rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t("auth.signOut")}
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-ink">
          {t("account.deleteHeading")}
        </h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          {t("account.deleteIntro")}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t("account.goesHeading")}
          </h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-ink-soft">
            <li>{t("account.goesEmail")}</li>
            <li>{t("account.goesName")}</li>
            <li>{t("account.goesContacts")}</li>
          </ul>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t("account.staysHeading")}
          </h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-ink-soft">
            <li>{t("account.staysBills")}</li>
            <li>{t("account.staysChain")}</li>
          </ul>
        </div>
      </div>

      {phase.status === "failed" ? (
        <p
          role="alert"
          className="rounded-2xl border border-warn-line bg-warn-surface px-3 py-2.5 text-sm leading-relaxed text-warn-ink"
        >
          {t("account.failed")}
        </p>
      ) : null}

      {phase.status === "confirming" ? (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-warn-line bg-warn-surface px-3 py-3">
          <p className="text-sm font-semibold leading-relaxed text-warn-ink">
            {t("account.confirmQuestion")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void remove()}
              className="inline-flex min-h-9 items-center justify-center rounded-full bg-warn-ink px-3 py-1.5 text-xs font-semibold text-card transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {t("account.confirmButton")}
            </button>
            <button
              type="button"
              onClick={() => setPhase({ status: "idle" })}
              className="inline-flex min-h-9 items-center justify-center rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {t("account.cancelButton")}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            disabled={phase.status === "working"}
            aria-disabled={phase.status === "working"}
            onClick={() => setPhase({ status: "confirming" })}
            className="inline-flex min-h-9 items-center justify-center rounded-full border border-warn-line bg-card px-3 py-1.5 text-xs font-semibold text-warn-ink transition-colors hover:bg-warn-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-60"
          >
            {phase.status === "working"
              ? t("account.working")
              : t("account.startButton")}
          </button>
        </div>
      )}

      <p className="text-xs leading-relaxed text-ink-faint">
        {t("account.contactNote")}{" "}
        <a
          href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
          className="underline underline-offset-2 hover:text-ink-soft"
        >
          {PRIVACY_CONTACT_EMAIL}
        </a>
      </p>
    </section>
  );
}
