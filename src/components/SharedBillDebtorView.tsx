"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { shortenWalletAddress } from "@/lib/arc/address";
import {
  ARC_TESTNET_DOCS_URL,
  ARC_TESTNET_FAUCET_URL,
  isArcTestnet,
} from "@/lib/arc/network";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import { SHARED_BILL_ACCESS_MAX_LIFETIME_MS } from "@/lib/arc/shared-bill-access";
import { signSharedBillAccessChallenge } from "@/lib/arc/shared-bill-access";
import {
  fetchAuthenticatedDebt,
  requestAccessChallenge,
  submitAccessResolution,
  verifyAuthenticatedView,
  type VerifiedView,
} from "@/lib/arc/shared-bill-access-client";
import {
  discoverWallets,
  getChainId,
  requestAccounts,
  subscribeToWallet,
  switchToArcTestnet,
  type WalletInfo,
} from "@/lib/arc/wallet";
import { formatMinorUnitsAsTry } from "@/lib/arc/minor-units";
import { useTranslator } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/i18n/format";
import {
  messageApi,
  messageKey,
  resolveMessage,
  type MessageDescriptor,
} from "@/lib/i18n/messages";

import { SharedBillPaymentPanel } from "./SharedBillPaymentPanel";
import { WalletConnectPanel } from "./WalletConnectPanel";

/**
 * ORTAK BAĞLANTI — borçlu tarafı.
 *
 * Herkes AYNI bağlantıyı alır. Bir borçlu yalnızca KENDİ borcunu görebilir:
 * cüzdanını bağlar, işlem OLMAYAN bir EIP-712 kimlik doğrulama mesajı imzalar
 * ve sunucu ona yalnızca kendi satırını + Merkle kanıtını döner.
 *
 * Bu bileşen sunucuya GÜVENMEZ: borç ekranda görünmeden önce manifest, alıcı
 * imzası ve Merkle kanıtı istemcide bağımsız olarak doğrulanır.
 *
 * ÖDEME, doğrulama BİTTİKTEN SONRA açılır ve ayrı bir panelde yaşar
 * (`SharedBillPaymentPanel`). Kimlik doğrulanmadan ve manifest/Merkle
 * doğrulaması geçmeden HİÇBİR ödeme kontrolü görünmez.
 */

type Props = { billId: string };

/*
 * Adim ve hata metinleri durumda METIN olarak DEGIL, TARIF olarak tutulur.
 * Dil degistiginde ekrandaki cumle de aninda yeni dile gecer.
 */
type Stage =
  | { status: "idle" }
  | { status: "working"; step: MessageDescriptor }
  | { status: "ready"; view: VerifiedView }
  | { status: "error"; message: MessageDescriptor };

const CARD_CLASS =
  "flex flex-col gap-4 rounded-3xl border border-line bg-card p-5 shadow-sm";
const LINK_CLASS =
  "underline underline-offset-2 hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function SharedBillDebtorView({ billId }: Props) {
  const { t, tRich, locale } = useTranslator();
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [walletsScanned, setWalletsScanned] = useState(false);
  const [selectedWalletUuid, setSelectedWalletUuid] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  const onArc = isArcTestnet(chainId);

  /**
   * Çözülmüş borç, bağlı hesaba ve zincire BAĞLIDIR.
   *
   * Hesap veya ağ değişirse görünüm tamamen atılır: eski bir cüzdanın borcu
   * yeni cüzdana ait gibi ekranda kalamaz.
   */
  const resetResolved = useCallback(() => {
    setStage({ status: "idle" });
    setCopied(false);
  }, []);

  useEffect(() => {
    if (selectedWalletUuid === null) {
      return;
    }
    return subscribeToWallet(selectedWalletUuid, {
      onAccountsChanged: (next) => {
        setAccount(next[0] ?? null);
        resetResolved();
      },
      onChainChanged: (next) => {
        setChainId(next);
        resetResolved();
      },
    });
  }, [selectedWalletUuid, resetResolved]);

  const scanWallets = async () => {
    const found = await discoverWallets();
    setWallets(found);
    setWalletsScanned(true);
    if (found.length === 1) {
      setSelectedWalletUuid(found[0].uuid);
    }
  };

  const connectWith = async (uuid: string) => {
    setStage({ status: "idle" });
    const accounts = await requestAccounts(uuid);
    if (!accounts.ok) {
      setStage({
        status: "error",
        message: messageKey(
          accounts.code === "rejected"
            ? "wallet.connectRejected"
            : "wallet.connectFailed",
        ),
      });
      return;
    }
    setAccount(accounts.value[0] ?? null);
    const chain = await getChainId(uuid);
    setChainId(chain.ok ? chain.value : null);
  };

  const connect = async () => {
    if (selectedWalletUuid === null) return;
    await connectWith(selectedWalletUuid);
  };

  /**
   * WalletConnect oturumu onaylandı: cüzdanı listeye ekle, seç ve AYNI
   * bağlanma akışını sürdür. EIP-6963 yolu bundan hiç etkilenmez.
   */
  const adoptWalletConnect = async (info: WalletInfo) => {
    setWallets((current) => [
      ...current.filter((wallet) => wallet.uuid !== info.uuid),
      info,
    ]);
    setWalletsScanned(true);
    setSelectedWalletUuid(info.uuid);
    await connectWith(info.uuid);
  };

  const switchNetwork = async () => {
    if (selectedWalletUuid === null) return;
    const switched = await switchToArcTestnet(selectedWalletUuid);
    if (!switched.ok) {
      setStage({
        status: "error",
        message: messageKey("wallet.switchFailedPickManually"),
      });
      return;
    }
    const chain = await getChainId(selectedWalletUuid);
    setChainId(chain.ok ? chain.value : null);
    resetResolved();
  };

  /** Bağlan → meydan okuma → imza → çözümle → doğrula → göster. */
  const authenticate = async () => {
    if (selectedWalletUuid === null || account === null || !onArc) {
      return;
    }
    setCopied(false);

    setStage({ status: "working", step: messageKey("sharedPay.stepChallenge") });
    const challenge = await requestAccessChallenge(billId, account);
    if (!challenge.ok) {
      // Sunucunun hazir metni degil, KARARLI KODU tasinir.
      setStage({ status: "error", message: messageApi(challenge.code) });
      return;
    }

    setStage({ status: "working", step: messageKey("sharedPay.stepSignature") });
    const signed = await signSharedBillAccessChallenge(
      selectedWalletUuid,
      challenge.value.challenge,
      challenge.value.challenge.audience,
    );
    if (!signed.ok) {
      setStage({
        status: "error",
        message: messageKey(`errors.accessSigning.${signed.code}`),
      });
      return;
    }

    setStage({ status: "working", step: messageKey("sharedPay.stepLookup") });
    const resolved = await submitAccessResolution(billId, {
      challenge: challenge.value.challenge,
      tag: challenge.value.tag,
      signature: signed.signature,
    });
    if (!resolved.ok) {
      setStage({ status: "error", message: messageApi(resolved.code) });
      return;
    }

    const fetched = await fetchAuthenticatedDebt(billId);
    if (!fetched.ok) {
      setStage({ status: "error", message: messageApi(fetched.code) });
      return;
    }

    setStage({ status: "working", step: messageKey("sharedPay.stepVerify") });
    const verified = await verifyAuthenticatedView({
      payload: fetched.value,
      connectedAddress: account,
      connectedChainId: chainId,
      billId,
      nowMs: Date.now(),
    });
    if (!verified.ok) {
      // Doğrulama düşerse HİÇBİR borç gösterilmez.
      setStage({
        status: "error",
        message: messageKey(`errors.view.${verified.problem}`),
      });
      return;
    }

    setStage({ status: "ready", view: verified.view });
  };

  const copyRecipient = async () => {
    if (stage.status !== "ready") return;
    try {
      await navigator.clipboard.writeText(stage.view.recipient.address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const expiryText = useMemo(() => {
    if (stage.status !== "ready") return null;
    return formatDateTime(stage.view.billExpiresAt, locale);
  }, [stage, locale]);

  return (
    <section aria-label={t("sharedPay.sectionLabel")} className={CARD_CLASS}>
      <h1 className="text-base font-semibold tracking-tight text-ink">
        {t("sharedPay.title")}
      </h1>

      {/*
        Hesabın VAR OLUP OLMADIĞI burada açıklanmaz: cüzdan doğrulamasından
        önce hiçbir hesap verisi gösterilmez.
      */}
      <p className="text-sm leading-relaxed text-ink-soft">
        {t("sharedPay.introPrefix")}
        <strong>{t("sharedPay.introEveryone")}</strong>
        {t("sharedPay.introMiddle")}
        <strong>{t("sharedPay.introAuthMessage")}</strong>
        {t("sharedPay.introSuffix")}
      </p>

      <p className="rounded-2xl border border-brand-line-soft bg-brand-soft px-3 py-2.5 text-xs leading-relaxed text-brand-ink">
        {t("sharedPay.noticePrefix")}
        <strong>{t("sharedPay.noticeNotATransaction")}</strong>
        {t("sharedPay.noticeSuffix", {
          minutes: SHARED_BILL_ACCESS_MAX_LIFETIME_MS / 60000,
        })}
      </p>

      {/* Cüzdan */}
      <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
        {!walletsScanned && (
          <button
            type="button"
            onClick={scanWallets}
            className="self-start rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            {t("wallet.connect")}
          </button>
        )}
        {walletsScanned && wallets.length === 0 && (
          <p className="text-xs text-ink-faint">
            {t("wallet.notFound")}{" "}
            <a
              href={ARC_TESTNET_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className={LINK_CLASS}
            >
              {t("common.arcSetup")}
            </a>
          </p>
        )}
        {wallets.length > 0 && account === null && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedWalletUuid ?? ""}
              onChange={(event) => setSelectedWalletUuid(event.target.value)}
              className="rounded-full border border-line px-3 py-1.5 text-sm"
            >
              <option value="">{t("wallet.select")}</option>
              {wallets.map((wallet) => (
                <option key={wallet.uuid} value={wallet.uuid}>
                  {wallet.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={connect}
              disabled={selectedWalletUuid === null}
              className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t("wallet.connectShort")}
            </button>
          </div>
        )}
        {account === null && (
          <WalletConnectPanel onConnected={adoptWalletConnect} />
        )}
        {account !== null && (
          <p className="text-xs text-ink-soft">
            {t("wallet.connectedWallet")}{" "}
            <span className="font-mono">{shortenWalletAddress(account)}</span>
          </p>
        )}
        {account !== null && !onArc && (
          <button
            type="button"
            onClick={switchNetwork}
            className="self-start rounded-full border border-warn-line-strong bg-warn-surface px-3 py-1.5 text-xs font-semibold text-warn-ink"
          >
            {t("wallet.switchTo", {
              network: ACTIVE_NETWORK_PROFILE.displayName,
            })}
          </button>
        )}
        {account !== null && onArc && stage.status !== "ready" && (
          <button
            type="button"
            onClick={authenticate}
            disabled={stage.status === "working"}
            className="self-start rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {stage.status === "working"
              ? resolveMessage(locale, stage.step)
              : t("sharedPay.authenticate")}
          </button>
        )}
      </div>

      {stage.status === "error" && (
        <p
          role="alert"
          className="rounded-2xl border border-danger-line bg-danger-surface px-3 py-2.5 text-xs leading-relaxed text-danger-ink"
        >
          {resolveMessage(locale, stage.message)}
        </p>
      )}

      {/* Yalnızca KENDİ borcu */}
      {stage.status === "ready" && (
        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <h2 className="text-sm font-semibold text-ink">
            {t("sharedPay.yourDebt")}
          </h2>
          <p className="text-2xl font-semibold tracking-tight text-ink">
            {/* Gösterim TAM SAYIDAN türer; `Number` ile daraltılmaz. */}
            {formatMinorUnitsAsTry(stage.view.debt.tryMinor, locale) ??
              t("common.dash")}
          </p>
          <p className="text-xs text-ink-soft">
            {tRich("sharedPay.debtorToRecipient", {
              debtor: stage.view.debt.debtorLabel,
              recipient: <strong>{stage.view.recipient.label}</strong>,
            })}
          </p>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-soft">
              {t("sharedPay.recipientAddress")}
            </span>
            <p className="break-all rounded-2xl border border-line bg-muted px-3 py-2 font-mono text-[11px] text-ink-soft">
              {stage.view.recipient.address}
            </p>
            <button
              type="button"
              onClick={copyRecipient}
              className="self-start rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-ink-soft"
            >
              {copied ? t("common.copied") : t("common.copyAddress")}
            </button>
          </div>

          {expiryText !== null && (
            <p className="text-xs text-ink-faint">
              {t("sharedPay.validUntil", { date: expiryText })}
            </p>
          )}

          {/*
            ÖDEME PANELİ. Yalnızca kimlik doğrulandıktan VE manifest/alıcı
            imzası/Merkle kanıtı istemcide bağımsız doğrulandıktan SONRA
            görünür.

            `key`: hesap, ağ veya borç değişirse panel SÖKÜLÜP yeniden kurulur.
            Böylece eski bir teklif, tahmin ya da inceleme yeni bir bağlama
            taşınamaz.
          */}
          {selectedWalletUuid !== null && account !== null && (
            <SharedBillPaymentPanel
              key={`${account.toLowerCase()}|${chainId ?? ""}|${stage.view.debt.debtKey}|${stage.view.debt.tryMinor}`}
              billId={billId}
              view={stage.view}
              walletUuid={selectedWalletUuid}
              account={account}
              chainId={chainId}
            />
          )}

          <p className="text-xs leading-relaxed text-ink-faint">
            {t("sharedPay.networkNotePrefix", {
              network: ACTIVE_NETWORK_PROFILE.displayName,
            })}
            <strong>{t("sharedPay.networkNoteStrong")}</strong>
            {t("sharedPay.networkNoteSuffix")}
            <a
              href={ARC_TESTNET_FAUCET_URL}
              target="_blank"
              rel="noreferrer"
              className={LINK_CLASS}
            >
              {t("common.faucet")}
            </a>
            .
          </p>
        </div>
      )}
    </section>
  );
}
