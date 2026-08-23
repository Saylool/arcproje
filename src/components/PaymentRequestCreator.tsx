"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { renderSVG } from "uqr";

import { formatMinorForDisplay } from "@/lib/receipt/money";
import type { Receipt } from "@/lib/receipt/schema";
import { normalizeWalletAddress, shortenWalletAddress } from "@/lib/arc/address";
import {
  convertTryMinorToMicroUsdc,
  formatMicroUsdcForDisplay,
} from "@/lib/arc/conversion";
import { fetchQuoteFromServer } from "@/lib/rates/client";
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
import { prepareLabel } from "@/lib/arc/labels";
import {
  MAX_LABEL_LENGTH,
  createPaymentRequestPayload,
  describePaymentRequestProblem,
} from "@/lib/arc/payment-request";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import { buildShareUrl, encodeSignedRequest } from "@/lib/arc/request-codec";
import {
  describeRequestSigningError,
  signPaymentRequest,
} from "@/lib/arc/request-signing";
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
};

type QuoteState =
  | { status: "loading" }
  | { status: "ready"; signed: SignedRateQuote }
  | { status: "error"; message: string };

/** CoinGecko atıf bağlantısı — sağlayıcı görünür biçimde belirtilir. */
const COINGECKO_ATTRIBUTION_URL = "https://www.coingecko.com/en/api";

const LINK_CLASS =
  "underline underline-offset-2 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500";

export function PaymentRequestCreator({
  receipt,
  participants,
  result,
  onBack,
}: Props) {
  const quoteHeadingId = useId();

  const [debtorAddresses, setDebtorAddresses] = useState<Record<string, string>>({});
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "loading" });
  /** Geri sayım ve süre dolumu için saniyelik saat. */
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedDebtIndex, setSelectedDebtIndex] = useState<number | null>(null);

  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [walletsScanned, setWalletsScanned] = useState(false);
  const [selectedWalletUuid, setSelectedWalletUuid] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const [signing, setSigning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedRequest[]>([]);
  const [copied, setCopied] = useState(false);

  const nameOf = useCallback(
    (id: string) =>
      participants.find((participant) => participant.id === id)?.name ??
      "Bilinmeyen kişi",
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
    const result = await fetchQuoteFromServer();
    setQuoteState(
      result.ok
        ? { status: "ready", signed: result.signed }
        : { status: "error", message: result.message },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const result = await fetchQuoteFromServer();
      if (cancelled) {
        return;
      }
      setQuoteState(
        result.ok
          ? { status: "ready", signed: result.signed }
          : { status: "error", message: result.message },
      );
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const connect = async () => {
    if (selectedWalletUuid === null) return;
    setErrorMessage(null);
    const accounts = await requestAccounts(selectedWalletUuid);
    if (!accounts.ok) {
      setErrorMessage(
        accounts.code === "rejected"
          ? "Cüzdan bağlantısı reddedildi."
          : "Cüzdana bağlanılamadı.",
      );
      return;
    }
    setAccount(accounts.value[0] ?? null);
    const chain = await getChainId(selectedWalletUuid);
    setChainId(chain.ok ? chain.value : null);
  };

  const switchNetwork = async () => {
    if (selectedWalletUuid === null) return;
    setErrorMessage(null);
    const switched = await switchToArcTestnet(selectedWalletUuid);
    if (!switched.ok) {
      setErrorMessage(
        switched.code === "rejected"
          ? "Ağ değişikliği reddedildi."
          : "Arc Testnet'e geçilemedi.",
      );
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
        nameOf(selectedDebt.toParticipantId),
        MAX_LABEL_LENGTH,
      ),
      debtorLabel: prepareLabel(
        nameOf(selectedDebt.fromParticipantId),
        MAX_LABEL_LENGTH,
      ),
    });
    if (!built.ok) {
      setErrorMessage(describePaymentRequestProblem(built.problem));
      return;
    }

    setSigning(true);
    setErrorMessage(null);
    setCopied(false);
    const signed = await signPaymentRequest(selectedWalletUuid, built.payload);
    setSigning(false);

    if (!signed.ok) {
      setErrorMessage(describeRequestSigningError(signed.code));
      return;
    }

    const encoded = encodeSignedRequest(signed.request);
    const url = buildShareUrl(window.location.origin, encoded);
    const debtKey = debtIdentityKey(selectedDebt);
    setGenerated((current) => [
      ...current.filter((entry) => entry.debtKey !== debtKey),
      { debtKey, url, inputsKey },
    ]);
  };

  const copyLink = async () => {
    if (currentGenerated === null) return;
    try {
      await navigator.clipboard.writeText(currentGenerated.url);
      setCopied(true);
    } catch {
      setErrorMessage("Bağlantı kopyalanamadı. Elle seçip kopyalayabilirsin.");
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
        title: "Ödeme talebi",
        text: "Hesabı Böl ödeme talebi",
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
      aria-label="Ödeme talebi oluştur"
      className="flex flex-col gap-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-card sm:p-5"
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">
            Ödeme talebi oluştur
          </h2>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
            TEST AĞI
          </span>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          Fişi sen ödedin, yani <strong className="font-semibold">alıcı</strong>{" "}
          sensin. Her borç için ayrı bir talep imzalarsın;{" "}
          <strong className="font-semibold">
            borçlu bu bağlantıyı açıp ödemeyi kendi cüzdanında onaylar.
          </strong>{" "}
          İmzan yalnızca talebi oluşturur, kimsenin cüzdanından para çekmez.
        </p>
      </header>

      {!isTry ? (
        <p
          role="alert"
          className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700"
        >
          Bu fişin para birimi TRY değil ({receipt.currency}). Arc ödemesi şu an
          yalnızca TRY fişler için destekleniyor.
        </p>
      ) : (
        <>
          {/* 1 — Alıcı cüzdanı */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              1 · Fişi ödeyen / alıcı cüzdanı
            </h3>
            {!walletsScanned ? (
              <button
                type="button"
                onClick={scanWallets}
                disabled={signing}
                className="self-start rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cüzdanı bağla
              </button>
            ) : wallets.length === 0 ? (
              <p
                role="alert"
                className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900"
              >
                Tarayıcında cüzdan bulunamadı. MetaMask gibi bir EIP-6963 cüzdanı
                kurup sayfayı yenile.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {wallets.length > 1 && (
                  <p className="text-[11px] text-slate-500">
                    Birden fazla cüzdan bulundu, birini seç:
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {wallets.map((wallet) => (
                    <label key={wallet.uuid} className="cursor-pointer">
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
                      <span className="inline-block rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors peer-checked:border-violet-600 peer-checked:bg-violet-600 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet-500">
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
                    className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Hesabı bağla
                  </button>
                  {account !== null && !onArc && (
                    <button
                      type="button"
                      onClick={switchNetwork}
                      disabled={signing}
                      className="rounded-full bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Arc Testnet&apos;e geç
                    </button>
                  )}
                </div>
                {recipientAddress !== null && (
                  <p className="text-[11px] text-slate-500">
                    Alıcı (sen):{" "}
                    <span className="font-mono">
                      {shortenWalletAddress(recipientAddress)}
                    </span>
                    {" · "}
                    {onArc ? (
                      <span className="text-violet-700">
                        {ACTIVE_NETWORK_PROFILE.displayName}
                      </span>
                    ) : (
                      <span className="text-amber-700">
                        Arc Testnet değil (zincir {chainId ?? "bilinmiyor"})
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 2 — Kur (sunucudan otomatik) */}
          <div
            className="flex flex-col gap-2 border-t border-slate-100 pt-4"
            aria-labelledby={quoteHeadingId}
          >
            <h3
              id={quoteHeadingId}
              className="text-xs font-semibold uppercase tracking-wide text-slate-400"
            >
              2 · Kur (otomatik)
            </h3>

            {quoteState.status === "loading" && (
              <p className="text-xs text-slate-500">Kur alınıyor…</p>
            )}

            {quoteState.status === "error" && (
              <div className="flex flex-col items-start gap-2">
                <p
                  role="alert"
                  className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700"
                >
                  {quoteState.message}
                </p>
                <button
                  type="button"
                  onClick={() => void loadQuote()}
                  className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                >
                  Kuru yeniden dene
                </button>
              </div>
            )}

            {signedQuote !== null && (
              <div className="flex flex-col gap-2">
                <dl className="flex flex-col gap-1 rounded-2xl border border-slate-200 p-3 text-xs">
                  <Row
                    label="Kur"
                    value={`1 USDC = ${formatQuoteRate(signedQuote.quote)} TRY`}
                    strong
                  />
                  <Row
                    label="Güncelleme"
                    value={new Date(
                      signedQuote.quote.observedAt * 1000,
                    ).toLocaleString("tr-TR")}
                  />
                  <Row
                    label="Geçerlilik"
                    value={
                      quoteExpired
                        ? "süresi doldu"
                        : `${Math.floor(quoteSecondsLeft / 60)} dk ${quoteSecondsLeft % 60} sn`
                    }
                  />
                </dl>

                {quoteExpired ? (
                  <p
                    role="alert"
                    className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900"
                  >
                    Kur teklifinin süresi doldu. Talep oluşturmak için kuru
                    yenile.
                  </p>
                ) : (
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Kur sunucuda alınır ve sunucu tarafından imzalanır; ödeme
                    talebine bu imzalı teklif yazılır. Borçlunun tarayıcısı kuru
                    ayrıca sunucuya doğrulatır.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void loadQuote()}
                  disabled={signing}
                  className="self-start rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Kuru yenile
                </button>
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-slate-400">
              <a
                href={COINGECKO_ATTRIBUTION_URL}
                target="_blank"
                rel="noreferrer"
                className={LINK_CLASS}
              >
                Data provided by CoinGecko
              </a>
            </p>
          </div>

          {/* 3 — Borç ve borçlu adresi */}
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              3 · Borç ve borçlu / gönderen adresi
            </h3>
            {result.debts.length === 0 ? (
              <p className="text-xs text-slate-500">Ödeme talebi gereken borç yok.</p>
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
                        selected ? "border-violet-300 bg-violet-50/40" : "border-slate-200"
                      }`}
                    >
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="creator-debt"
                          checked={selected}
                          disabled={signing}
                          onChange={() => {
                            setSelectedDebtIndex(index);
                            setCopied(false);
                          }}
                          className="accent-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                        />
                        <span className="min-w-0 flex-1 text-xs text-slate-700">
                          <strong className="font-semibold text-slate-900">
                            {nameOf(debt.fromParticipantId)}
                          </strong>{" "}
                          (borçlu), {toDativeName(nameOf(debt.toParticipantId))}{" "}
                          {formatMinorForDisplay(debt.amountMinor, receipt.currency)}{" "}
                          borçlu
                        </span>
                      </label>
                      <label className="text-[11px] text-slate-600">
                        {nameOf(debt.fromParticipantId)} cüzdan adresi
                        <input
                          type="text"
                          value={raw}
                          placeholder="0x…"
                          spellCheck={false}
                          disabled={signing}
                          onChange={(event) =>
                            setDebtorAddress(debt.fromParticipantId, event.target.value)
                          }
                          aria-invalid={raw.trim() !== "" && valid === null ? true : undefined}
                          className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 font-mono text-xs text-slate-900 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-60 ${
                            raw.trim() !== "" && valid === null
                              ? "border-red-300 bg-red-50/50"
                              : "border-slate-200 focus:border-violet-300"
                          }`}
                        />
                      </label>
                      {raw.trim() !== "" && valid === null && (
                        <p className="text-[11px] text-red-600">
                          Geçerli bir cüzdan adresi değil.
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
            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                4 · Talebi imzala
              </h3>
              <dl className="flex flex-col gap-1 rounded-2xl border border-slate-200 p-3 text-xs">
                <Row label="Borç (TRY)" value={formatMinorForDisplay(selectedDebt.amountMinor, receipt.currency)} />
                <Row
                  label="Kur"
                  value={
                    signedQuote === null
                      ? "—"
                      : `1 USDC = ${formatQuoteRate(signedQuote.quote)} TRY`
                  }
                />
                <Row label="Kur kaynağı" value={QUOTE_SOURCE} />
                <Row
                  label="İstenecek tutar"
                  value={`${formatMicroUsdcForDisplay(conversion.microUsdc)} USDC`}
                  strong
                />
                <Row label="Borçlu / gönderen" value={nameOf(selectedDebt.fromParticipantId)} />
                <Row
                  label="Borçlu adresi"
                  value={debtorAddress === null ? "Girilmedi" : shortenWalletAddress(debtorAddress)}
                />
                <Row label="Fişi ödeyen / alıcı" value={nameOf(selectedDebt.toParticipantId)} />
                <Row
                  label="Alıcı adresi"
                  value={recipientAddress === null ? "Bağlanmadı" : shortenWalletAddress(recipientAddress)}
                />
                <Row label="Ağ" value={ACTIVE_NETWORK_PROFILE.displayName} />
              </dl>

              <button
                type="button"
                onClick={createRequest}
                disabled={!canCreate}
                className="self-start rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-200 transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:bg-violet-300"
              >
                {signing ? "Cüzdanda imzalanıyor…" : "Ödeme talebi oluştur"}
              </button>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Cüzdanın yalnızca bir <strong className="font-semibold">imza</strong>{" "}
                soracak. Bu imza para göndermez.
              </p>
            </div>
          )}

          {/* 5 — Üretilen bağlantı */}
          {currentGenerated !== null && (
            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                5 · Talep bağlantısı
              </h3>
              <p className="text-xs leading-relaxed text-slate-600">
                Bu bağlantıyı{" "}
                <strong className="font-semibold">
                  {nameOf(selectedDebt?.fromParticipantId ?? "")}
                </strong>{" "}
                kişisine gönder. Borçlu bu bağlantıyı açıp ödemeyi kendi
                cüzdanında onaylar.
              </p>

              {qrSvg !== null && (
                <div
                  aria-label="Talep bağlantısının QR kodu"
                  role="img"
                  className="w-40 self-start rounded-2xl border border-slate-200 bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
              )}

              <p className="break-all rounded-2xl bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600">
                {currentGenerated.url}
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                >
                  {copied ? "Kopyalandı" : "Talep bağlantısını kopyala"}
                </button>
                <button
                  type="button"
                  onClick={shareLink}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                >
                  Paylaş
                </button>
              </div>

              <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                Bu bağlantı kişi adlarını, cüzdan adreslerini ve ödeme tutarını
                içerir; yalnızca ilgili borçluyla paylaş. Bağlantı 7 gün
                geçerlidir. Bağlantı teknik olarak tekrar açılabilir — aynı borç
                için ikinci bir ödeme yapılmasını engelleyen bir sunucu veya
                zincir üstü kayıt yoktur.
              </p>
            </div>
          )}

          {errorMessage !== null && (
            <p
              role="alert"
              className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700"
            >
              {errorMessage}
            </p>
          )}
        </>
      )}

      <p aria-live="polite" className="sr-only">
        {signing
          ? "Ödeme talebi cüzdanda imzalanıyor."
          : currentGenerated !== null
            ? "Ödeme talebi bağlantısı hazır."
            : errorMessage !== null
              ? errorMessage
              : ""}
      </p>

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={onBack}
          disabled={signing}
          className="self-start rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Paylara dön
        </button>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Test USDC için{" "}
          <a href={ARC_TESTNET_FAUCET_URL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            Circle Faucet
          </a>
          , ağ kurulumu için{" "}
          <a href={ARC_TESTNET_DOCS_URL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            Arc dokümanı
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
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right ${
          strong ? "font-semibold text-slate-900" : "text-slate-700"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
