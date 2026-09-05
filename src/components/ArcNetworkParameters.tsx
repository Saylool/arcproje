"use client";

import { Fragment, useState } from "react";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID_HEX,
  ARC_TESTNET_EXPLORER_URL,
  ARC_TESTNET_RPC_URL,
} from "@/lib/arc/network";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import { useTranslator } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/dictionary";

/**
 * ARC TESTNET PARAMETRELERİ.
 *
 * Cüzdan ağı tanımıyorsa ya da geçiş isteğini sessizce yuttuysa gösterilir.
 * Eskiden bu durumda "cüzdanından Arc Testnet'i seç" yazıyordu; telefonda bu
 * YANLIŞ tavsiye, çünkü ağ listede yoktur ki seçilsin — eklenmesi gerekir.
 * Değerler ekranda durur: dokümana giden bir bağlantı, cüzdan uygulamasıyla
 * tarayıcı arasında gidip gelen birini çıkmaza sokar.
 *
 * Değerler AĞ PROFİLİNDEN okunur, elle yazılmaz: yanlış bir RPC ya da zincir
 * kimliği kullanıcıyı yanlış ağa bağlardı. Aynı nedenle çevrilmezler de —
 * onlar veridir, metin değil.
 */
const ROWS: readonly (readonly [TranslationKey, string])[] = [
  ["wallet.networkName", ACTIVE_NETWORK_PROFILE.displayName],
  ["wallet.chainId", `${ARC_TESTNET_CHAIN_ID} · ${ARC_TESTNET_CHAIN_ID_HEX}`],
  ["wallet.rpcUrl", ARC_TESTNET_RPC_URL],
  ["wallet.symbol", ACTIVE_NETWORK_PROFILE.nativeGasSymbol],
  ["wallet.explorer", ARC_TESTNET_EXPLORER_URL],
];

export function ArcNetworkParameters() {
  const { t } = useTranslator();
  const [copied, setCopied] = useState(false);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(
        ROWS.map(([key, value]) => `${t(key)}: ${value}`).join("\n"),
      );
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-warn-line bg-warn-surface px-3 py-2.5">
      <p className="text-xs font-semibold text-warn-ink">
        {t("wallet.addManuallyTitle")}
      </p>
      <p className="text-[11px] leading-relaxed text-warn-ink">
        {t("wallet.addManuallyIntro")}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        {ROWS.map(([key, value]) => (
          <Fragment key={key}>
            <dt className="text-warn-ink-faint">{t(key)}</dt>
            <dd className="break-all font-mono text-warn-ink">{value}</dd>
          </Fragment>
        ))}
      </dl>
      <button
        type="button"
        onClick={copyAll}
        className="self-start rounded-full border border-warn-line-strong px-3 py-1 text-[11px] font-semibold text-warn-ink min-h-11"
      >
        {copied ? t("common.copied") : t("wallet.copyNetwork")}
      </button>
    </div>
  );
}
