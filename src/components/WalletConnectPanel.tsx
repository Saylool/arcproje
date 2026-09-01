"use client";

import { useMemo, useRef, useState } from "react";
import { renderSVG } from "uqr";

import type { WalletInfo } from "@/lib/arc/wallet";
import {
  beginWalletConnect,
  buildWalletDeepLink,
  isWalletConnectConfigured,
  type WalletConnectHandle,
} from "@/lib/arc/walletconnect";
import { useLocale, useTranslator } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/dictionary";

/**
 * MOBİL CÜZDAN BAĞLANTISI (WalletConnect).
 *
 * EIP-6963 açılır listesinin YANINDA durur, onun İÇİNDE değil: masaüstündeki
 * cüzdan listesi ve seçim akışı bu bileşenden hiç etkilenmez.
 *
 * Karekod ve derin bağlantı BURADA, uygulamanın kendi tasarım diliyle ve
 * kendi sözlüğüyle çizilir; sayfaya üçüncü taraf bir modal girmez. Karekod
 * `uqr` ile YERELDE üretilir, uzak bir görüntü çekilmez.
 *
 * projectId tanımlı değilse bileşen hiç görünmez: yarım bir akış gösterip
 * kullanıcıyı çıkmaza sokmaktansa seçenek hiç sunulmaz.
 */
type Stage =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "pairing"; handle: WalletConnectHandle }
  | { status: "error"; message: TranslationKey };

export function WalletConnectPanel({
  onConnected,
}: {
  onConnected: (info: WalletInfo) => void | Promise<void>;
}) {
  const { t } = useTranslator();
  const { locale } = useLocale();
  const [stage, setStage] = useState<Stage>({ status: "idle" });
  /** Vazgeçilen bir girişimin geç gelen sonucu ekrana YAZILMAZ. */
  const activeHandle = useRef<WalletConnectHandle | null>(null);

  const qrSvg = useMemo(
    () => (stage.status === "pairing" ? renderSVG(stage.handle.uri) : null),
    [stage],
  );
  const deepLink =
    stage.status === "pairing" ? buildWalletDeepLink(stage.handle.uri) : null;

  const start = async () => {
    setStage({ status: "starting" });
    const started = await beginWalletConnect({ locale });
    if (!started.ok) {
      setStage({ status: "error", message: "wallet.walletConnectFailed" });
      return;
    }

    activeHandle.current = started.value;
    setStage({ status: "pairing", handle: started.value });

    const approved = await started.value.approved;
    if (activeHandle.current !== started.value) {
      return;
    }
    activeHandle.current = null;

    if (!approved.ok) {
      setStage({
        status: "error",
        message:
          approved.code === "rejected"
            ? "wallet.connectRejected"
            : "wallet.walletConnectFailed",
      });
      return;
    }
    setStage({ status: "idle" });
    await onConnected(approved.value);
  };

  const cancel = async () => {
    if (stage.status !== "pairing") return;
    const handle = stage.handle;
    activeHandle.current = null;
    setStage({ status: "idle" });
    await handle.cancel();
  };

  // Kancalardan SONRA: kanca sırası her çizimde aynı kalmalı.
  if (!isWalletConnectConfigured()) {
    return null;
  }

  if (stage.status === "pairing") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-line-soft p-3">
        <p className="text-xs leading-relaxed text-ink-soft">
          {t("wallet.walletConnectScan")}
        </p>
        {qrSvg !== null && (
          <div
            aria-label={t("wallet.walletConnectQrLabel")}
            className="w-40 self-start [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {deepLink !== null && (
            <a
              href={deepLink}
              className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white"
            >
              {t("wallet.walletConnectOpen")}
            </a>
          )}
          <button
            type="button"
            onClick={cancel}
            className="rounded-full border border-line px-4 py-1.5 text-sm font-semibold text-ink-soft"
          >
            {t("wallet.walletConnectCancel")}
          </button>
        </div>
        <p className="text-xs text-ink-faint">
          {t("wallet.walletConnectWaiting")}
        </p>
        <p className="text-xs leading-relaxed text-ink-faint">
          {t("wallet.walletConnectArcNotice")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={start}
        disabled={stage.status === "starting"}
        className="self-start rounded-full border border-line px-4 py-1.5 text-sm font-semibold text-ink-soft disabled:opacity-50"
      >
        {stage.status === "starting"
          ? t("wallet.walletConnectWaiting")
          : t("wallet.walletConnect")}
      </button>
      {stage.status === "error" && (
        <p role="alert" className="text-xs leading-relaxed text-danger-ink">
          {t(stage.message)}
        </p>
      )}
    </div>
  );
}
