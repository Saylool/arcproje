"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { formatMinorForDisplay } from "@/lib/receipt/money";
import type { Receipt } from "@/lib/receipt/schema";
import {
  normalizeWalletAddress,
  shortenWalletAddress,
  walletAddressesEqual,
} from "@/lib/arc/address";
import {
  convertTryMinorToMicroUsdc,
  describeRateFailure,
  formatMicroUsdcForDisplay,
  parseRate,
} from "@/lib/arc/conversion";
import {
  ARC_TESTNET_DOCS_URL,
  ARC_TESTNET_EXPLORER_URL,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_FAUCET_URL,
  isArcTestnet,
} from "@/lib/arc/network";
import {
  debtIdentityKey,
  findPaymentForDebt,
  isEstimateStale,
  paymentInputsKey,
  type PaymentInputs,
} from "@/lib/arc/payment-state";
import {
  describeArcSendError,
  estimateArcSend,
  sendArcUsdc,
  validatePaymentSnapshot,
  type ArcPaymentSnapshot,
  type ArcSendSuccess,
} from "@/lib/arc/send";
import {
  discoverWallets,
  getChainId,
  requestAccounts,
  subscribeToWallet,
  switchToArcTestnet,
  type WalletInfo,
} from "@/lib/arc/wallet";
import type { DebtCalculationSuccess } from "@/lib/split/debts";
import type { Participant } from "@/lib/split/participants";
import { toDativeName } from "@/lib/split/turkish";

type ArcPaymentProps = {
  receipt: Receipt;
  participants: readonly Participant[];
  result: DebtCalculationSuccess;
  onBack: () => void;
};

type PaymentStatus = "idle" | "estimating" | "review" | "sending" | "success";

const LINK_CLASS =
  "underline underline-offset-2 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500";

export function ArcPayment({
  receipt,
  participants,
  result,
  onBack,
}: ArcPaymentProps) {
  const rateInputId = useId();
  const confirmId = useId();

  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [rateInput, setRateInput] = useState("");
  const [selectedDebtIndex, setSelectedDebtIndex] = useState<number | null>(null);

  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [walletsScanned, setWalletsScanned] = useState(false);
  const [selectedWalletUuid, setSelectedWalletUuid] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const [status, setStatus] = useState<PaymentStatus>("idle");
  const [estimateKey, setEstimateKey] = useState<string | null>(null);
  const [estimateSummary, setEstimateSummary] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Kullanıcının incelediği ödemenin değişmez kaydı. */
  const [reviewedSnapshot, setReviewedSnapshot] =
    useState<ArcPaymentSnapshot | null>(null);
  /**
   * Başarılı işlemler. Form sonradan değişse bile bu kayıtlar silinmez ve
   * yalnızca kendi snapshot'larıyla birebir eşleşen borcu "ödendi" gösterir.
   */
  const [transactions, setTransactions] = useState<ArcSendSuccess[]>([]);

  const nameOf = useCallback(
    (id: string) =>
      participants.find((participant) => participant.id === id)?.name ??
      "Bilinmeyen kişi",
    [participants],
  );

  const isTry = receipt.currency === "TRY";
  const parsedRate = useMemo(() => parseRate(rateInput), [rateInput]);
  const selectedDebt =
    selectedDebtIndex === null ? null : (result.debts[selectedDebtIndex] ?? null);

  const debtKey = debtIdentityKey;

  const conversion = useMemo(() => {
    if (selectedDebt === null || !parsedRate.ok) {
      return null;
    }
    return convertTryMinorToMicroUsdc(selectedDebt.amountMinor, parsedRate.rate);
  }, [selectedDebt, parsedRate]);

  const busy = status === "estimating" || status === "sending";

  const recipientAddressRaw = addresses[result.payerId] ?? "";
  const debtorAddressRaw =
    selectedDebt === null ? "" : (addresses[selectedDebt.fromParticipantId] ?? "");
  const recipientAddress = normalizeWalletAddress(recipientAddressRaw);
  const debtorAddress = normalizeWalletAddress(debtorAddressRaw);

  const paymentInputs: PaymentInputs = {
    accountAddress: account,
    chainId,
    rateInput,
    debtorParticipantId: selectedDebt?.fromParticipantId ?? null,
    recipientAddress: recipientAddress ?? "",
    amountMicroUsdc:
      conversion !== null && conversion.ok ? conversion.microUsdc.toString() : null,
  };

  /**
   * Bayatlık render sırasında türetilir; effect içinde setState yapılmaz.
   * Girdiler değişir değişmez tahmin, onay ve inceleme durumu düşer.
   */
  const isStale = isEstimateStale(estimateKey, paymentInputs);
  const effectiveStatus: PaymentStatus =
    isStale && (status === "review" || status === "success") ? "idle" : status;
  const effectiveEstimateSummary = isStale ? null : estimateSummary;
  const effectiveConfirmed = isStale ? false : confirmed;

  // Hesap ve ağ değişikliklerini dinle.
  useEffect(() => {
    if (selectedWalletUuid === null) {
      return;
    }
    return subscribeToWallet(selectedWalletUuid, {
      onAccountsChanged: (accounts) => {
        setAccount(accounts[0] ?? null);
        setEstimateKey(null);
      },
      onChainChanged: (nextChainId) => {
        setChainId(nextChainId);
        setEstimateKey(null);
      },
    });
  }, [selectedWalletUuid]);

  const scanWallets = async () => {
    const found = await discoverWallets();
    setWallets(found);
    setWalletsScanned(true);
    if (found.length === 1) {
      setSelectedWalletUuid(found[0].uuid);
    }
  };

  const connect = async () => {
    if (selectedWalletUuid === null) {
      return;
    }
    setErrorMessage(null);
    const accountsResult = await requestAccounts(selectedWalletUuid);
    if (!accountsResult.ok) {
      setErrorMessage(
        accountsResult.code === "rejected"
          ? "Cüzdan bağlantısı reddedildi."
          : "Cüzdana bağlanılamadı.",
      );
      return;
    }
    setAccount(accountsResult.value[0] ?? null);
    const chainResult = await getChainId(selectedWalletUuid);
    setChainId(chainResult.ok ? chainResult.value : null);
    setEstimateKey(null);
  };

  const switchNetwork = async () => {
    if (selectedWalletUuid === null) {
      return;
    }
    setErrorMessage(null);
    const switched = await switchToArcTestnet(selectedWalletUuid);
    if (!switched.ok) {
      setErrorMessage(
        switched.code === "rejected"
          ? "Ağ değişikliği reddedildi."
          : "Arc Testnet'e geçilemedi. Cüzdanı kontrol et.",
      );
      return;
    }
    const chainResult = await getChainId(selectedWalletUuid);
    setChainId(chainResult.ok ? chainResult.value : null);
    setEstimateKey(null);
  };

  /** Farklı kişiler olsa bile aynı adrese ödeme engellenir. */
  const isSelfTransfer =
    recipientAddress !== null &&
    debtorAddress !== null &&
    walletAddressesEqual(recipientAddress, debtorAddress);

  const onArc = isArcTestnet(chainId);
  const accountMatchesDebtor =
    account !== null && debtorAddress !== null
      ? walletAddressesEqual(account, debtorAddress)
      : false;

  const amountText =
    conversion !== null && conversion.ok ? conversion.amount : null;

  const canEstimate =
    isTry &&
    selectedDebt !== null &&
    parsedRate.ok &&
    amountText !== null &&
    recipientAddress !== null &&
    debtorAddress !== null &&
    selectedWalletUuid !== null &&
    account !== null &&
    onArc &&
    accountMatchesDebtor &&
    !isSelfTransfer &&
    !busy;

  /** Onaylanacak ödemenin değişmez kaydını üretir. */
  const buildSnapshot = (): ArcPaymentSnapshot | null => {
    if (
      selectedDebt === null ||
      !parsedRate.ok ||
      conversion === null ||
      !conversion.ok ||
      recipientAddress === null ||
      debtorAddress === null
    ) {
      return null;
    }
    return Object.freeze({
      debtKey: debtKey(selectedDebt),
      debtorParticipantId: selectedDebt.fromParticipantId,
      recipientParticipantId: selectedDebt.toParticipantId,
      debtorAddress,
      recipientAddress,
      tryMinor: selectedDebt.amountMinor,
      rateNumerator: parsedRate.rate.numerator.toString(),
      rateDenominator: parsedRate.rate.denominator.toString(),
      microUsdc: conversion.microUsdc.toString(),
      amount: conversion.amount,
      displayAmount: formatMicroUsdcForDisplay(conversion.microUsdc),
      chainId: ARC_TESTNET_CHAIN_ID,
    });
  };

  const estimate = async () => {
    if (!canEstimate || selectedWalletUuid === null) {
      return;
    }
    const snapshot = buildSnapshot();
    if (snapshot === null) {
      setErrorMessage("Ödeme bilgileri eksik.");
      return;
    }
    const invalid = validatePaymentSnapshot(snapshot);
    if (invalid !== null) {
      setErrorMessage(describeArcSendError(invalid));
      return;
    }

    setStatus("estimating");
    setErrorMessage(null);
    const outcome = await estimateArcSend(selectedWalletUuid, snapshot);
    if (!outcome.ok) {
      setErrorMessage(describeArcSendError(outcome.code));
      setStatus("idle");
      return;
    }
    setEstimateSummary(outcome.value.summary);
    setReviewedSnapshot(snapshot);
    setEstimateKey(paymentInputsKey(paymentInputs));
    setStatus("review");
  };

  const submit = async () => {
    if (
      effectiveStatus !== "review" ||
      !effectiveConfirmed ||
      selectedWalletUuid === null ||
      reviewedSnapshot === null
    ) {
      return;
    }
    // Gönderim, kullanıcının incelediği snapshot ile yapılır; güncel form
    // değerleriyle değil.
    setStatus("sending");
    setErrorMessage(null);
    const outcome = await sendArcUsdc(selectedWalletUuid, reviewedSnapshot);
    if (!outcome.ok) {
      setErrorMessage(describeArcSendError(outcome.code));
      setStatus("review");
      return;
    }
    setTransactions((current) => [...current, outcome.value]);
    setStatus("success");
  };

  const setAddress = (participantId: string, value: string) => {
    setAddresses((current) => ({ ...current, [participantId]: value }));
    setEstimateKey(null);
  };

  /**
   * Bir borç yalnızca kendi snapshot'ıyla birebir eşleşen başarılı bir işlem
   * varsa "ödendi" sayılır. Form sonradan değişse bile kayıt korunur ve başka
   * bir ödemenin kanıtı gibi gösterilmez.
   */
  const findTransactionFor = (debt: {
    fromParticipantId: string;
    toParticipantId: string;
    amountMinor: number;
  }) => findPaymentForDebt(transactions, debt);

  const currentTransaction =
    selectedDebt === null ? null : findTransactionFor(selectedDebt);

  const involvedIds = useMemo(() => {
    const ids = new Set<string>([result.payerId]);
    for (const debt of result.debts) {
      ids.add(debt.fromParticipantId);
    }
    return [...ids];
  }, [result]);

  return (
    <section
      aria-label="Arc Testnet ödemesi"
      className="flex flex-col gap-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-card sm:p-5"
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">
            Arc Testnet ile öde
          </h2>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
            TEST AĞI
          </span>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          Buradaki USDC <strong className="font-semibold">Arc Testnet test
          parasıdır ve gerçek bir değeri yoktur.</strong> Her ödeme kendi
          cüzdanında imzalanır.
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
          {/* 1) Cüzdan adresleri */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              1 · Cüzdan adresleri
            </h3>
            <ul className="flex flex-col gap-2">
              {involvedIds.map((participantId) => {
                const raw = addresses[participantId] ?? "";
                const valid = raw.trim() === "" ? null : normalizeWalletAddress(raw);
                const isPayer = participantId === result.payerId;
                return (
                  <li key={participantId} className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600">
                      {nameOf(participantId)}
                      {isPayer && (
                        <span className="ml-2 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                          alıcı
                        </span>
                      )}
                      <input
                        type="text"
                        value={raw}
                        placeholder="0x…"
                        spellCheck={false}
                        disabled={busy}
                        onChange={(event) =>
                          setAddress(participantId, event.target.value)
                        }
                        aria-invalid={raw.trim() !== "" && valid === null ? true : undefined}
                        className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 font-mono text-xs text-slate-900 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
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
          </div>

          {/* 2) Kur */}
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              2 · Kur (elle girilir)
            </h3>
            <label htmlFor={rateInputId} className="text-xs text-slate-600">
              1 USDC kaç TRY?
            </label>
            <input
              id={rateInputId}
              type="text"
              inputMode="decimal"
              value={rateInput}
              placeholder="örn. 34,25"
              disabled={busy}
              onChange={(event) => {
                setRateInput(event.target.value);
                setEstimateKey(null);
              }}
              aria-invalid={rateInput.trim() !== "" && !parsedRate.ok ? true : undefined}
              className={`w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 sm:w-48 ${
                rateInput.trim() !== "" && !parsedRate.ok
                  ? "border-red-300 bg-red-50/50"
                  : "border-slate-200 focus:border-violet-300"
              }`}
            />
            {rateInput.trim() !== "" && !parsedRate.ok && (
              <p className="text-[11px] leading-snug text-red-600">
                {describeRateFailure(parsedRate.reason)}
              </p>
            )}
            <p className="rounded-2xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
              Bu kur <strong className="font-semibold">senin elle girdiğin demo
              kurudur.</strong> Uygulama canlı kur çekmez.
            </p>
          </div>

          {/* 3) Borç seçimi */}
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              3 · Ödenecek borç
            </h3>
            {result.debts.length === 0 ? (
              <p className="text-xs text-slate-500">Ödenecek borç yok.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {result.debts.map((debt, index) => {
                  const paid = findTransactionFor(debt) !== null;
                  return (
                    <li key={debtKey(debt)}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2">
                        <input
                          type="radio"
                          name="arc-debt"
                          checked={selectedDebtIndex === index}
                          disabled={paid || busy}
                          onChange={() => {
                            setSelectedDebtIndex(index);
                            setEstimateKey(null);
                          }}
                          className="accent-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                        />
                        <span className="min-w-0 flex-1 text-xs text-slate-700">
                          <strong className="font-semibold text-slate-900">
                            {nameOf(debt.fromParticipantId)}
                          </strong>
                          , {toDativeName(nameOf(debt.toParticipantId))}{" "}
                          {formatMinorForDisplay(debt.amountMinor, receipt.currency)}{" "}
                          borçlu
                        </span>
                        {paid && (
                          <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                            ödendi
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 4-5) Cüzdan ve ağ */}
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              4 · Cüzdan ve ağ
            </h3>

            {!walletsScanned ? (
              <button
                type="button"
                onClick={scanWallets}
                disabled={busy}
                className="self-start rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
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
                        name="arc-wallet"
                        checked={selectedWalletUuid === wallet.uuid}
                        disabled={busy}
                        onChange={() => {
                          setSelectedWalletUuid(wallet.uuid);
                          setAccount(null);
                          setChainId(null);
                          setEstimateKey(null);
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
                    disabled={selectedWalletUuid === null || busy}
                    className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Hesabı bağla
                  </button>
                  {account !== null && !onArc && (
                    <button
                      type="button"
                      onClick={switchNetwork}
                      disabled={busy}
                      className="rounded-full bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                    >
                      Arc Testnet&apos;e geç
                    </button>
                  )}
                </div>

                {account !== null && (
                  <p className="text-[11px] text-slate-500">
                    Bağlı hesap:{" "}
                    <span className="font-mono">{shortenWalletAddress(account)}</span>
                    {" · "}
                    {onArc ? (
                      <span className="text-violet-700">Arc Testnet</span>
                    ) : (
                      <span className="text-amber-700">
                        Arc Testnet değil (zincir {chainId ?? "bilinmiyor"})
                      </span>
                    )}
                  </p>
                )}

                {isSelfTransfer && (
                  <p
                    role="alert"
                    className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-700"
                  >
                    Gönderen ve alıcı aynı cüzdan adresi. Kendine ödeme
                    yapılamaz; adreslerden birini düzelt.
                  </p>
                )}

                {account !== null && debtorAddress !== null && !accountMatchesDebtor && (
                  <p
                    role="alert"
                    className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900"
                  >
                    Bağlı hesap, seçilen borçlunun adresiyle aynı değil. Borcu
                    ödeyecek kişinin cüzdanıyla bağlan.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 6-7) Önizleme, tahmin ve onay */}
          {selectedDebt !== null && conversion !== null && (
            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                5 · Önizleme
              </h3>
              {!conversion.ok ? (
                <p role="alert" className="text-xs text-red-600">
                  Bu borç için USDC tutarı hesaplanamadı.
                </p>
              ) : (
                <dl className="flex flex-col gap-1 rounded-2xl border border-slate-200 p-3 text-xs">
                  <Row
                    label="Borç (TRY)"
                    value={formatMinorForDisplay(
                      selectedDebt.amountMinor,
                      receipt.currency,
                    )}
                  />
                  <Row label="Girilen kur" value={`1 USDC = ${rateInput} TRY`} />
                  <Row
                    label="Gönderilecek"
                    value={`${formatMicroUsdcForDisplay(conversion.microUsdc)} USDC`}
                    strong
                  />
                  <Row label="Alıcı" value={nameOf(selectedDebt.toParticipantId)} />
                  <Row
                    label="Alıcı adresi"
                    value={
                      recipientAddress === null
                        ? "Girilmedi"
                        : shortenWalletAddress(recipientAddress)
                    }
                  />
                  <Row label="Ağ" value="Arc Testnet" />
                </dl>
              )}

              {effectiveEstimateSummary !== null && (
                <p className="text-[11px] text-slate-500">
                  Tahmini ağ ücreti (gas, ayrı hesaplanır ve borçtan düşülmez):{" "}
                  {effectiveEstimateSummary}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={estimate}
                  disabled={!canEstimate}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {effectiveStatus === "estimating" ? "Tahmin alınıyor…" : "İşlemi tahmin et"}
                </button>
              </div>

              {effectiveStatus === "review" && (
                <div className="flex flex-col gap-2 rounded-2xl border border-violet-200 bg-violet-50 p-3">
                  <label
                    htmlFor={confirmId}
                    className="flex items-start gap-2 text-[11px] leading-relaxed text-violet-900"
                  >
                    <input
                      id={confirmId}
                      type="checkbox"
                      checked={effectiveConfirmed}
                      disabled={busy}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      className="mt-0.5 accent-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                    />
                    <span>
                      Kurun elle girdiğim demo kuru olduğunu ve gönderilecek
                      tutarın Arc Testnet test USDC&apos;si olduğunu anlıyorum.
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!effectiveConfirmed || effectiveStatus !== "review"}
                    className="self-start rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:bg-violet-300"
                  >
                    Cüzdanda onayla
                  </button>
                </div>
              )}

              {effectiveStatus === "sending" && (
                <p className="rounded-2xl bg-violet-50 px-3 py-2.5 text-xs text-violet-800">
                  İşlem cüzdanda bekleniyor…
                </p>
              )}
            </div>
          )}

          {currentTransaction !== null && (
            <div className="flex flex-col gap-1 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
              <p className="font-semibold">
                Bu borç için ödeme gönderildi ({currentTransaction.snapshot.displayAmount}{" "}
                USDC).
              </p>
              <p className="break-all font-mono text-[11px]">
                {currentTransaction.txHash}
              </p>
              {currentTransaction.explorerUrl !== null && (
                <a
                  href={currentTransaction.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={LINK_CLASS}
                >
                  ArcScan&apos;de görüntüle
                </a>
              )}
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
        {effectiveStatus === "estimating"
          ? "İşlem tahmini alınıyor."
          : effectiveStatus === "sending"
            ? "İşlem cüzdanda bekleniyor."
            : effectiveStatus === "success"
              ? "Ödeme gönderildi."
              : errorMessage !== null
                ? errorMessage
                : ""}
      </p>

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="self-start rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
        >
          Paylara dön
        </button>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Test USDC için{" "}
          <a href={ARC_TESTNET_FAUCET_URL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            Circle Faucet
          </a>
          , işlemler için{" "}
          <a href={ARC_TESTNET_EXPLORER_URL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            ArcScan
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
