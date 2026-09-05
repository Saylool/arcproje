"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { renderSVG } from "uqr";

import { useTranslator } from "@/lib/i18n/context";
import { formatDateTime, formatUsdcAmount } from "@/lib/i18n/format";
import {
  messageKey,
  messageRate,
  resolveMessage,
  type MessageDescriptor,
} from "@/lib/i18n/messages";
import { formatMinorForDisplay } from "@/lib/receipt/money";
import type { Receipt } from "@/lib/receipt/schema";
import { normalizeWalletAddress, shortenWalletAddress } from "@/lib/arc/address";
import { convertTryMinorToMicroUsdc } from "@/lib/arc/conversion";
import { fetchQuoteFromServer, verifyQuoteWithServer } from "@/lib/rates/client";
import {
  QUOTE_SOURCE,
  formatQuoteRate,
  parseQuoteRate,
  type SignedRateQuote,
} from "@/lib/rates/quote";
import {
  ARC_TESTNET_DOCS_URL,
  ARC_TESTNET_FAUCET_URL,
  isArcTestnet,
} from "@/lib/arc/network";
import {
  PAYMENT_REQUEST_UNKNOWN_PARTICIPANT_LABEL,
  prepareLabel,
} from "@/lib/arc/labels";
import {
  MAX_LABEL_LENGTH,
  createPaymentRequestPayload,
} from "@/lib/arc/payment-request";
import { ensureSignedRequestPublishable } from "@/lib/arc/request-publication";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import { buildShareUrl, encodeSignedRequest } from "@/lib/arc/request-codec";
import { signPaymentRequest } from "@/lib/arc/request-signing";
import {
  discoverWallets,
  getChainId,
  requestAccounts,
  subscribeToWallet,
  switchToArcTestnet,
  type WalletInfo,
} from "@/lib/arc/wallet";
import { debtIdentityKey } from "@/lib/arc/payment-state";
import type { DebtCalculationSuccess } from "@/lib/split/debts";
import type { Participant } from "@/lib/split/participants";
import { toDativeName } from "@/lib/split/turkish";
import { WalletConnectPanel } from "./WalletConnectPanel";
import {
  needsManualNetwork,
  switchFailureMessage,
} from "@/lib/arc/wallet-messages";
import { ArcNetworkParameters } from "./ArcNetworkParameters";

/**
 * Ödeme talebi oluşturucu — fişi ödeyen (ALICI) tarafı.
 *
 * Ödeyen kendi cüzdanını alıcı olarak bağlar ve her borç için ayrı bir
 * EIP-712 talebi imzalar. Bu imza yalnızca talebi oluşturur; hiçbir token
 * transferi yetkisi vermez ve borçlunun cüzdanından para çekemez. Transferi
 * her zaman borçlu kendi cüzdanında imzalar.
 */

type Props = {
  receipt: Receipt;
  participants: readonly Participant[];
  result: DebtCalculationSuccess;
  onBack: () => void;
};

type GeneratedRequest = {
  debtKey: string;
  url: string;
  /** Üretildiği andaki girdi imzası; girdi değişirse bağlantı geçersiz sayılır. */
  inputsKey: string;
  /** İmzalı talebin GERÇEK bitiş anı (Unix saniye). */
  expiresAt: number;
};

type QuoteState =
  | { status: "loading" }
  | { status: "ready"; signed: SignedRateQuote }
  /* Metin degil TARIF saklanir; dil degisince cumle de degisir. */
  | { status: "error"; message: MessageDescriptor };

/** CoinGecko atıf bağlantısı — sağlayıcı görünür biçimde belirtilir. */
const COINGECKO_ATTRIBUTION_URL = "https://www.coingecko.com/en/api";

const LINK_CLASS =
  "underline underline-offset-2 hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function PaymentRequestCreator({
  receipt,
  participants,
  result,
  onBack,
}: Props) {
  const { t, locale } = useTranslator();
  const quoteHeadingId = useId();

  const [debtorAddresses, setDebtorAddresses] = useState<Record<string, string>>({});
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "loading" });
  /** Geri sayım ve süre dolumu için saniyelik saat. */
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedDebtIndex, setSelectedDebtIndex] = useState<number | null>(null);

  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [walletsScanned, setWalletsScanned] = useState(false);
  const [selectedWalletUuid, setSelectedWalletUuid] = useState<string | null>(null);
  const [manualNetwork, setManualNetwork] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const [signing, setSigning] = useState(false);
  const [errorMessage, setErrorMessage] =
    useState<MessageDescriptor | null>(null);
  /** Yayim kapisi dustuyse mesaja "kuru yenile" ipucu eklenir. */
  const [needsRefreshHint, setNeedsRefreshHint] = useState(false);
  const [generated, setGenerated] = useState<GeneratedRequest[]>([]);
  const [copied, setCopied] = useState(false);

  const nameOf = useCallback(
    (id: string) =>
      participants.find((participant) => participant.id === id)?.name ??
      t("common.unknownParticipant"),
    [participants, t],
  );

  /**
   * IMZALANACAK etiket icin yedek ad DILDEN BAGIMSIZDIR: imzali talep hicbir
   * kosulda arayuz diline gore degismemelidir.
   */
  const signingNameOf = useCallback(
    (id: string) =>
      participants.find((participant) => participant.id === id)?.name ??
      PAYMENT_REQUEST_UNKNOWN_PARTICIPANT_LABEL,
    [participants],
  );

  const isTry = receipt.currency === "TRY";
  const signedQuote = quoteState.status === "ready" ? quoteState.signed : null;
  const nowSeconds = Math.floor(nowMs / 1000);
  const quoteExpired =
    signedQuote !== null && nowSeconds >= signedQuote.quote.expiresAt;
  const quoteSecondsLeft =
    signedQuote === null
      ? 0
      : Math.max(0, signedQuote.quote.expiresAt - nowSeconds);
  /** Kur artık elle girilmez; kanonik rasyonel değer tekliften okunur. */
  const parsedRate = useMemo(() => {
    if (signedQuote === null) {
      return null;
    }
    const parsed = parseQuoteRate(
      signedQuote.quote.rateNumerator,
      signedQuote.quote.rateDenominator,
    );
    return parsed.ok ? parsed.rate : null;
  }, [signedQuote]);
  const selectedDebt =
    selectedDebtIndex === null ? null : (result.debts[selectedDebtIndex] ?? null);

  /** Alıcı adresi bağlanan hesaptır; elle yazılmaz. */
  const recipientAddress = account === null ? null : normalizeWalletAddress(account);
  const debtorRaw =
    selectedDebt === null
      ? ""
      : (debtorAddresses[selectedDebt.fromParticipantId] ?? "");
  const debtorAddress = normalizeWalletAddress(debtorRaw);

  const conversion = useMemo(() => {
    if (selectedDebt === null || parsedRate === null) {
      return null;
    }
    return convertTryMinorToMicroUsdc(selectedDebt.amountMinor, parsedRate);
  }, [selectedDebt, parsedRate]);

  const onArc = isArcTestnet(chainId);

  /** Girdi imzası: bunlardan biri değişirse üretilmiş bağlantı geçersizdir. */
  const inputsKey = [
    (recipientAddress ?? "").toLowerCase(),
    (debtorAddress ?? "").toLowerCase(),
    signedQuote?.quote.quoteId ?? "",
    selectedDebt === null ? "" : debtIdentityKey(selectedDebt),
    selectedDebt === null ? "" : String(selectedDebt.amountMinor),
    String(chainId ?? ""),
  ].join("|");

  const currentGenerated =
    selectedDebt === null
      ? null
      : (generated.find(
          (entry) =>
            entry.debtKey === debtIdentityKey(selectedDebt) &&
            entry.inputsKey === inputsKey,
        ) ?? null);

  const generatedSecondsLeft =
    currentGenerated === null
      ? 0
      : Math.max(0, currentGenerated.expiresAt - nowSeconds);
  /** Süresi dolan bağlantı kullanılabilir gibi sunulmaz. */
  const generatedExpired =
    currentGenerated !== null && generatedSecondsLeft === 0;

  const qrSvg = useMemo(
    () => (currentGenerated === null ? null : renderSVG(currentGenerated.url)),
    [currentGenerated],
  );

  useEffect(() => {
    if (selectedWalletUuid === null) {
      return;
    }
    return subscribeToWallet(selectedWalletUuid, {
      onAccountsChanged: (accounts) => setAccount(accounts[0] ?? null),
      onChainChanged: (next) => setChainId(next),
    });
  }, [selectedWalletUuid]);

  /**
   * Kur, bu ekrana gelindiğinde BİR KEZ istenir; her render'da değil.
   * Yenileme yalnızca kullanıcının açık isteğiyle olur.
   */
  const loadQuote = useCallback(async () => {
    setQuoteState({ status: "loading" });
    const result = await fetchQuoteFromServer(Date.now(), fetch, locale);
    setQuoteState(
      result.ok
        ? { status: "ready", signed: result.signed }
        : { status: "error", message: messageKey("errors.rateService") },
    );
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const result = await fetchQuoteFromServer(Date.now(), fetch, locale);
      if (cancelled) {
        return;
      }
      setQuoteState(
        result.ok
          ? { status: "ready", signed: result.signed }
          : { status: "error", message: messageKey("errors.rateService") },
      );
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  /** Geri sayım ve süre dolumu için saniyelik saat. */
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const scanWallets = async () => {
    const found = await discoverWallets();
    setWallets(found);
    setWalletsScanned(true);
    if (found.length === 1) {
      setSelectedWalletUuid(found[0].uuid);
    }
  };

  const connectWith = async (uuid: string) => {
    setErrorMessage(null);
    const accounts = await requestAccounts(uuid);
    if (!accounts.ok) {
      setErrorMessage(
        messageKey(
          accounts.code === "rejected"
            ? "wallet.connectRejected"
            : "wallet.connectFailed",
        ),
      );
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
    setErrorMessage(null);
    setManualNetwork(false);
    const switched = await switchToArcTestnet(selectedWalletUuid);
    if (!switched.ok) {
      setManualNetwork(needsManualNetwork(switched.code));
      setErrorMessage(messageKey(switchFailureMessage(switched.code)));
      return;
    }
    const chain = await getChainId(selectedWalletUuid);
    setChainId(chain.ok ? chain.value : null);
  };

  const canCreate =
    isTry &&
    !signing &&
    selectedDebt !== null &&
    signedQuote !== null &&
    !quoteExpired &&
    parsedRate !== null &&
    conversion !== null &&
    conversion.ok &&
    recipientAddress !== null &&
    debtorAddress !== null &&
    selectedWalletUuid !== null &&
    onArc;

  const createRequest = async () => {
    if (
      !canCreate ||
      selectedDebt === null ||
      recipientAddress === null ||
      debtorAddress === null ||
      selectedWalletUuid === null ||
      conversion === null ||
      !conversion.ok ||
      signedQuote === null ||
      quoteExpired
    ) {
      return;
    }

    const built = createPaymentRequestPayload({
      recipient: recipientAddress,
      debtor: debtorAddress,
      debtKey: debtIdentityKey(selectedDebt),
      tryMinor: selectedDebt.amountMinor,
      // Kur ve teklif meta verisi YALNIZCA sunucu teklifinden gelir;
      // düzenlenebilir istemci durumu bu alanların yerine geçemez.
      quote: signedQuote.quote,
      quoteTag: signedQuote.tag,
      microUsdc: conversion.microUsdc,
      // İsimler kanonik biçime (NFC) indirgenip kod noktası sınırında kesilir;
      // katı doğrulama yine createPaymentRequestPayload içinde yapılır.
      recipientLabel: prepareLabel(
        signingNameOf(selectedDebt.toParticipantId),
        MAX_LABEL_LENGTH,
      ),
      debtorLabel: prepareLabel(
        signingNameOf(selectedDebt.fromParticipantId),
        MAX_LABEL_LENGTH,
      ),
    });
    if (!built.ok) {
      setErrorMessage(messageKey(`errors.paymentRequest.${built.problem}`));
      return;
    }

    setSigning(true);
    setErrorMessage(null);
    setNeedsRefreshHint(false);
    setCopied(false);
    // Önceki denemeden kalan bağlantı, yeni deneme sırasında gösterilmemeli.
    const debtKeyForRun = debtIdentityKey(selectedDebt);
    setGenerated((current) =>
      current.filter((entry) => entry.debtKey !== debtKeyForRun),
    );
    const signed = await signPaymentRequest(selectedWalletUuid, built.payload);
    setSigning(false);

    if (!signed.ok) {
      setErrorMessage(messageKey(`errors.requestSigning.${signed.code}`));
      return;
    }

    /*
     * Kullanıcı cüzdanda onaylarken teklifin süresi dolmuş olabilir. Bağlantı
     * ÜRETİLMEDEN önce imzalanan gövde ve teklifi güncel saatle yeniden
     * doğrulanır; aynı katı doğrulayıcılar kullanılır, ayrı bir kısmi kontrol
     * yazılmaz. Sunucu doğrulaması da URL açığa çıkmadan yapılır.
     */
    const publishable = await ensureSignedRequestPublishable(
      signed.request,
      (quote, tag) => verifyQuoteWithServer(quote, tag, fetch, locale),
      Date.now,
      locale,
    );
    if (!publishable.ok) {
      /*
       * Sunucunun ya da dogrulayicinin hazir metni tasinmaz: KARARLI KOD
       * saklanir ve cumle her render'da etkin dilde kurulur. Ipuc cumlesi
       * gosterim sirasinda eklenir.
       */
      setErrorMessage(
        publishable.problem !== undefined
          ? messageKey(`errors.paymentRequest.${publishable.problem}`)
          : messageRate(publishable.quoteCode),
      );
      setNeedsRefreshHint(true);
      return;
    }

    const encoded = encodeSignedRequest(signed.request);
    const url = buildShareUrl(window.location.origin, encoded);
    setGenerated((current) => [
      ...current.filter((entry) => entry.debtKey !== debtKeyForRun),
      {
        debtKey: debtKeyForRun,
        url,
        inputsKey,
        expiresAt: signed.request.payload.expiresAt,
      },
    ]);
  };

  const copyLink = async () => {
    if (currentGenerated === null) return;
    try {
      await navigator.clipboard.writeText(currentGenerated.url);
      setCopied(true);
    } catch {
      setErrorMessage(messageKey("common.linkCopyFailed"));
    }
  };

  const shareLink = async () => {
    if (currentGenerated === null) return;
    if (typeof navigator.share !== "function") {
      await copyLink();
      return;
    }
    try {
      await navigator.share({
        title: t("request.shareTitle"),
        text: t("request.shareText"),
        url: currentGenerated.url,
      });
    } catch {
      // Kullanıcı paylaşımı iptal etmiş olabilir; sessiz geçilir.
    }
  };

  const setDebtorAddress = (participantId: string, value: string) => {
    setDebtorAddresses((current) => ({ ...current, [participantId]: value }));
    setCopied(false);
  };

  return (
    <section
      aria-label={t("request.sectionLabel")}
      className="flex flex-col gap-5 rounded-3xl border border-line bg-card p-4 shadow-card sm:p-5"
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-ink">
            {t("request.title")}
          </h2>
          <span className="rounded-full bg-warn-surface-strong px-2 py-0.5 text-[10px] font-semibold text-warn-ink">
            {t("common.testNetworkBadge")}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-ink-faint">
          {t("request.introPrefix")}
          <strong className="font-semibold">{t("request.introRecipient")}</strong>
          {t("request.introMiddle")}
          <strong className="font-semibold">
            {t("request.introDebtorOpens")}
          </strong>
          {t("request.introSuffix")}
        </p>
      </header>

      {!isTry ? (
        <p
          role="alert"
          className="rounded-2xl border border-danger-line bg-danger-surface px-3 py-2.5 text-xs leading-relaxed text-danger-ink"
        >
          {t("request.notTry", { currency: receipt.currency })}
        </p>
      ) : (
        <>
          {/* 1 — Alıcı cüzdanı */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {t("request.stepWallet")}
            </h3>
            {!walletsScanned ? (
              <button
                type="button"
                onClick={scanWallets}
                disabled={signing}
                className="self-start rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60 min-h-11"
              >
                {t("wallet.connect")}
              </button>
            ) : wallets.length === 0 ? (
              <p
                role="alert"
                className="rounded-2xl border border-warn-line bg-warn-surface px-3 py-2.5 text-xs leading-relaxed text-warn-ink"
              >
                {t("wallet.notFoundInstall")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {wallets.length > 1 && (
                  <p className="text-[11px] text-ink-faint">
                    {t("wallet.multipleFound")}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {wallets.map((wallet) => (
                    <label key={wallet.uuid} className="inline-flex cursor-pointer items-center min-h-11">
                      <input
                        type="radio"
                        name="creator-wallet"
                        checked={selectedWalletUuid === wallet.uuid}
                        disabled={signing}
                        onChange={() => {
                          setSelectedWalletUuid(wallet.uuid);
                          setAccount(null);
                          setChainId(null);
                        }}
                        className="peer sr-only"
                      />
                      <span className="inline-block rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
                        {wallet.name}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={connect}
                    disabled={selectedWalletUuid === null || signing}
                    className="rounded-full border border-line bg-card px-3.5 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 min-h-11"
                  >
                    {t("wallet.connectAccount")}
                  </button>
                  {account !== null && !onArc && (
                    <button
                      type="button"
                      onClick={switchNetwork}
                      disabled={signing}
                      className="rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60 min-h-11"
                    >
                      {t("wallet.switchToArc")}
                    </button>
                  )}
                </div>
                {manualNetwork && <ArcNetworkParameters />}
                {recipientAddress !== null && (
                  <p className="text-[11px] text-ink-faint">
                    {t("wallet.recipientIsYou")}{" "}
                    <span className="font-mono">
                      {shortenWalletAddress(recipientAddress)}
                    </span>
                    {" · "}
                    {onArc ? (
                      <span className="text-brand-ink">
                        {ACTIVE_NETWORK_PROFILE.displayName}
                      </span>
                    ) : (
                      <span className="text-warn-ink-faint">
                        {t("wallet.notArcWithChain", {
                          chainId: chainId ?? t("common.unknownChain"),
                        })}
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}
            {account === null && (
              <WalletConnectPanel onConnected={adoptWalletConnect} />
            )}
          </div>

          {/* 2 — Kur (sunucudan otomatik) */}
          <div
            className="flex flex-col gap-2 border-t border-line-soft pt-4"
            aria-labelledby={quoteHeadingId}
          >
            <h3
              id={quoteHeadingId}
              className="text-xs font-semibold uppercase tracking-wide text-ink-faint"
            >
              {t("request.stepRate")}
            </h3>

            {quoteState.status === "loading" && (
              <p className="text-xs text-ink-faint">{t("request.rateLoading")}</p>
            )}

            {quoteState.status === "error" && (
              <div className="flex flex-col items-start gap-2">
                <p
                  role="alert"
                  className="rounded-2xl border border-danger-line bg-danger-surface px-3 py-2.5 text-xs leading-relaxed text-danger-ink"
                >
                  {resolveMessage(locale, quoteState.message)}
                </p>
                <button
                  type="button"
                  onClick={() => void loadQuote()}
                  className="rounded-full border border-line bg-card px-3.5 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-h-11 inline-flex items-center"
                >
                  {t("request.rateRetry")}
                </button>
              </div>
            )}

            {signedQuote !== null && (
              <div className="flex flex-col gap-2">
                <dl className="flex flex-col gap-1 rounded-2xl border border-line p-3 text-xs">
                  <Row
                    label={t("request.rowRate")}
                    value={`1 USDC = ${formatQuoteRate(signedQuote.quote)} TRY`}
                    strong
                  />
                  <Row
                    label={t("request.rowUpdated")}
                    value={formatDateTime(signedQuote.quote.observedAt, locale)}
                  />
                  <Row
                    label={t("request.rowValidity")}
                    value={
                      quoteExpired
                        ? t("request.rateExpiredShort")
                        : t("request.rateCountdown", {
                            minutes: Math.floor(quoteSecondsLeft / 60),
                            seconds: quoteSecondsLeft % 60,
                          })
                    }
                  />
                </dl>

                {quoteExpired ? (
                  <p
                    role="alert"
                    className="rounded-2xl border border-warn-line bg-warn-surface px-3 py-2 text-[11px] leading-relaxed text-warn-ink"
                  >
                    {t("request.rateExpired")}
                  </p>
                ) : (
                  <p className="text-[11px] leading-relaxed text-ink-faint">
                    {t("request.rateExplains")}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void loadQuote()}
                  disabled={signing}
                  className="self-start rounded-full border border-line bg-card px-3.5 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 min-h-11 inline-flex items-center"
                >
                  {t("request.rateRefresh")}
                </button>
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-ink-faint">
              <a
                href={COINGECKO_ATTRIBUTION_URL}
                target="_blank"
                rel="noreferrer"
                className={LINK_CLASS}
              >
                {t("request.coingeckoAttribution")}
              </a>
            </p>
          </div>

          {/* 3 — Borç ve borçlu adresi */}
          <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {t("request.stepDebt")}
            </h3>
            {result.debts.length === 0 ? (
              <p className="text-xs text-ink-faint">{t("request.noDebts")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {result.debts.map((debt, index) => {
                  const key = debtIdentityKey(debt);
                  const raw = debtorAddresses[debt.fromParticipantId] ?? "";
                  const valid = raw.trim() === "" ? null : normalizeWalletAddress(raw);
                  const selected = selectedDebtIndex === index;
                  return (
                    <li
                      key={key}
                      className={`flex flex-col gap-2 rounded-2xl border p-3 ${
                        selected ? "border-brand-line bg-brand-soft/40" : "border-line"
                      }`}
                    >
                      <label className="flex min-h-11 cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="creator-debt"
                          checked={selected}
                          disabled={signing}
                          onChange={() => {
                            setSelectedDebtIndex(index);
                            setCopied(false);
                          }}
                          className="accent-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        />
                        <span className="min-w-0 flex-1 text-xs text-ink-soft">
                          <strong className="font-semibold text-ink">
                            {nameOf(debt.fromParticipantId)}
                          </strong>{" "}
                          {t("request.debtOptionSuffix", {
                            to:
                              locale === "tr"
                                ? toDativeName(nameOf(debt.toParticipantId))
                                : nameOf(debt.toParticipantId),
                            amount: formatMinorForDisplay(
                              debt.amountMinor,
                              receipt.currency,
                              locale,
                            ),
                          })}
                        </span>
                      </label>
                      <label className="text-[11px] text-ink-soft">
                        {t("request.debtorAddressLabel", {
                          name: nameOf(debt.fromParticipantId),
                        })}
                        <input
                          type="text"
                          value={raw}
                          placeholder={t("common.addressPlaceholder")}
                          spellCheck={false}
                          disabled={signing}
                          onChange={(event) =>
                            setDebtorAddress(debt.fromParticipantId, event.target.value)
                          }
                          aria-invalid={raw.trim() !== "" && valid === null ? true : undefined}
                          className={`mt-1 w-full rounded-xl border bg-card px-3 py-2 font-mono text-xs text-ink transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60 ${
                            raw.trim() !== "" && valid === null
                              ? "border-danger-line-strong bg-danger-surface/50"
                              : "border-line focus:border-brand-line"
                          }`}
                        />
                      </label>
                      {raw.trim() !== "" && valid === null && (
                        <p className="text-[11px] text-danger-ink-soft">
                          {t("request.invalidAddress")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 4 — Önizleme ve imzalama */}
          {selectedDebt !== null && conversion !== null && conversion.ok && (
            <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t("request.stepSign")}
              </h3>
              <dl className="flex flex-col gap-1 rounded-2xl border border-line p-3 text-xs">
                <Row
                  label={t("request.rowDebtTry")}
                  value={formatMinorForDisplay(
                    selectedDebt.amountMinor,
                    receipt.currency,
                    locale,
                  )}
                />
                <Row
                  label={t("request.rowRate")}
                  value={
                    signedQuote === null
                      ? t("common.dash")
                      : `1 USDC = ${formatQuoteRate(signedQuote.quote)} TRY`
                  }
                />
                <Row label={t("request.rowRateSource")} value={QUOTE_SOURCE} />
                <Row
                  label={t("request.rowAmountRequested")}
                  /* Gosterim kanonik tam sayidan turer; protokol metni degismez. */
                  value={`${formatUsdcAmount(conversion.microUsdc, locale)} USDC`}
                  strong
                />
                <Row
                  label={t("request.rowDebtor")}
                  value={nameOf(selectedDebt.fromParticipantId)}
                />
                <Row
                  label={t("request.rowDebtorAddress")}
                  value={
                    debtorAddress === null
                      ? t("common.notEntered")
                      : shortenWalletAddress(debtorAddress)
                  }
                />
                <Row
                  label={t("request.rowPayer")}
                  value={nameOf(selectedDebt.toParticipantId)}
                />
                <Row
                  label={t("request.rowRecipientAddress")}
                  value={
                    recipientAddress === null
                      ? t("common.notConnected")
                      : shortenWalletAddress(recipientAddress)
                  }
                />
                <Row
                  label={t("request.rowNetwork")}
                  value={ACTIVE_NETWORK_PROFILE.displayName}
                />
              </dl>

              <button
                type="button"
                onClick={createRequest}
                disabled={!canCreate}
                className="self-start rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-disabled min-h-11"
              >
                {signing ? t("request.signing") : t("request.create")}
              </button>
              <p className="text-[11px] leading-relaxed text-ink-faint">
                {t("request.signaturePrefix")}
                <strong className="font-semibold">
                  {t("request.signatureWord")}
                </strong>
                {t("request.signatureSuffix")}
              </p>
            </div>
          )}

          {/* 5 — Üretilen bağlantı */}
          {currentGenerated !== null && (
            <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t("request.stepLink")}
              </h3>
              <p className="text-xs leading-relaxed text-ink-soft">
                {t("request.sendToPrefix")}
                <strong className="font-semibold">
                  {nameOf(selectedDebt?.fromParticipantId ?? "")}
                </strong>
                {t("request.sendToSuffix")}
              </p>

              {qrSvg !== null && (
                <div
                  aria-label={t("request.qrLabel")}
                  role="img"
                  className="w-40 self-start rounded-2xl border border-line bg-card p-2 [&>svg]:h-auto [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
              )}

              <p className="break-all rounded-2xl bg-muted px-3 py-2 font-mono text-[11px] text-ink-soft">
                {currentGenerated.url}
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  disabled={generatedExpired}
                  className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-h-11"
                >
                  {copied ? t("common.copied") : t("request.copyLink")}
                </button>
                <button
                  type="button"
                  onClick={shareLink}
                  disabled={generatedExpired}
                  className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-h-11"
                >
                  {t("common.share")}
                </button>
              </div>

              <p className="rounded-2xl border border-warn-line bg-warn-surface px-3 py-2 text-[11px] leading-relaxed text-warn-ink">
                {t("request.linkWarningPrefix")}
                <strong className="font-semibold">
                  {t("request.linkWarningStrong")}
                </strong>
                {t("request.linkWarningEndsAt", {
                  date: formatDateTime(currentGenerated.expiresAt, locale),
                })}
                {generatedExpired
                  ? t("request.linkWarningExpired")
                  : t("request.linkWarningRemaining", {
                      minutes: Math.floor(generatedSecondsLeft / 60),
                      seconds: generatedSecondsLeft % 60,
                    })}
                {t("request.linkWarningSuffix")}
              </p>

              {generatedExpired && (
                <p
                  role="alert"
                  className="rounded-2xl border border-danger-line bg-danger-surface px-3 py-2 text-[11px] leading-relaxed text-danger-ink"
                >
                  {t("request.linkExpired")}
                </p>
              )}
            </div>
          )}

          {errorMessage !== null && (
            <p
              role="alert"
              className="rounded-2xl border border-danger-line bg-danger-surface px-3 py-2.5 text-xs leading-relaxed text-danger-ink"
            >
              {resolveMessage(locale, errorMessage)}
              {needsRefreshHint ? ` ${t("request.refreshHint")}` : ""}
            </p>
          )}
        </>
      )}

      <p aria-live="polite" className="sr-only">
        {signing
          ? t("request.liveSigning")
          : currentGenerated !== null
            ? t("request.liveReady")
            : errorMessage !== null
              ? resolveMessage(locale, errorMessage)
              : ""}
      </p>

      <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <button
          type="button"
          onClick={onBack}
          disabled={signing}
          className="self-start rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60 min-h-11"
        >
          {t("request.backToShares")}
        </button>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {t("request.faucetPrefix")}
          <a href={ARC_TESTNET_FAUCET_URL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            {t("common.faucet")}
          </a>
          {t("request.faucetMiddle")}
          <a href={ARC_TESTNET_DOCS_URL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            {t("common.arcDocs")}
          </a>
          .
        </p>
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-faint">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right ${
          strong ? "font-semibold text-ink" : "text-ink-soft"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
