"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { renderSVG } from "uqr";

import { shortenWalletAddress } from "@/lib/arc/address";
import {
  ARC_TESTNET_DOCS_URL,
  ARC_TESTNET_FAUCET_URL,
  isArcTestnet,
} from "@/lib/arc/network";
import { prepareLabel } from "@/lib/arc/labels";
import { MAX_LABEL_LENGTH } from "@/lib/arc/payment-request";
import { debtIdentityKey } from "@/lib/arc/payment-state";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import {
  SHARED_BILL_MAX_LIFETIME_MS,
  createSharedBill,
  describeSharedBillProblem,
} from "@/lib/arc/shared-bill";
import { createSharedBillOnServer } from "@/lib/arc/shared-bill-client";
import {
  describeSharedBillDraftProblem,
  sharedBillDraftKey,
  validateSharedBillDraft,
  type SharedBillDraftRow,
} from "@/lib/arc/shared-bill-draft";
import {
  describeSharedBillSigningError,
  signSharedBillManifest,
} from "@/lib/arc/shared-bill-signing";
import {
  discoverWallets,
  getChainId,
  requestAccounts,
  subscribeToWallet,
  switchToArcTestnet,
  type WalletInfo,
} from "@/lib/arc/wallet";
import { formatMinorForDisplay } from "@/lib/receipt/money";
import type { Receipt } from "@/lib/receipt/schema";
import type { DebtCalculationSuccess } from "@/lib/split/debts";
import type { Participant } from "@/lib/split/participants";

/**
 * TEK BAGLANTILI paylasilan hesap olusturucu — fisi odeyen (ALICI) tarafi.
 *
 * Odeyen cuzdanini BIR KEZ baglar, her borclu icin bir adres girer ve TEK bir
 * EIP-712 manifest imzalar. Sunucu manifesti dogrulayip saklar; herkes AYNI
 * kisa baglantiyi alir.
 *
 * Imza yalnizca TALEBI olusturur: borclunun cuzdanindan para cekemez ve
 * hicbir transfer yetkisi vermez. Transferi her zaman borclu kendi cuzdaninda
 * imzalar.
 *
 * Baglanti borc listesini TASIMAZ; yalnizca tahmin edilemez bir kimlik icerir.
 *
 * KAPI ACIK: `SHARED_BILL_FLOW_ENABLED` artik `true` (bkz.
 * `shared-bill-feature.ts`), yani bu bilesen olusturma ekraninda GOSTERILIR.
 * Borclu tarafi `/pay/<billId>` yolunda calisir: cuzdanla kimlik dogrulama,
 * yalnizca kendi borcunu gorme ve Arc Testnet uzerinde odeme.
 */

type Props = {
  receipt: Receipt;
  participants: readonly Participant[];
  result: DebtCalculationSuccess;
  onBack: () => void;
};

type GeneratedLink = {
  url: string;
  billId: string;
  expiresAt: number;
  /** Uretildigi andaki girdi imzasi; girdi degisirse baglanti gecersiz sayilir. */
  inputsKey: string;
};

const LINK_CLASS =
  "underline underline-offset-2 hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const CARD_CLASS =
  "flex flex-col gap-4 rounded-3xl border border-line bg-card p-5 shadow-sm";

export function SharedBillCreator({
  receipt,
  participants,
  result,
  onBack,
}: Props) {
  const headingId = useId();

  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [walletsScanned, setWalletsScanned] = useState(false);
  const [selectedWalletUuid, setSelectedWalletUuid] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedLink | null>(null);
  const [copied, setCopied] = useState(false);

  const nameOf = useCallback(
    (id: string) =>
      participants.find((participant) => participant.id === id)?.name ??
      "Bilinmeyen kisi",
    [participants],
  );

  const isTry = receipt.currency === "TRY";
  const onArc = isArcTestnet(chainId);

  /** Her borc bir satirdir: kim, ne kadar, hangi adrese odeyecek. */
  const rows: readonly SharedBillDraftRow[] = useMemo(
    () =>
      result.debts.map((debt) => ({
        participantId: debt.fromParticipantId,
        name: nameOf(debt.fromParticipantId),
        debtKey: debtIdentityKey(debt),
        amountMinor: debt.amountMinor,
        address: addresses[debt.fromParticipantId] ?? "",
      })),
    [result.debts, addresses, nameOf],
  );

  const draft = useMemo(
    () => validateSharedBillDraft({ recipient: account, rows }),
    [account, rows],
  );

  /*
   * Kaynak girdilerden herhangi biri degisirse uretilmis baglanti GECERSIZ
   * sayilir: kullanici artik gecerli olmayan bir listeye ait bir baglantiyi
   * paylasamaz.
   */
  const inputsKey = useMemo(
    () => sharedBillDraftKey({ recipient: account, rows }),
    [account, rows],
  );
  const linkIsStale = generated !== null && generated.inputsKey !== inputsKey;
  const activeLink = generated !== null && !linkIsStale ? generated : null;

  const qrSvg = useMemo(
    () => (activeLink === null ? null : renderSVG(activeLink.url)),
    [activeLink],
  );

  /*
   * Cuzdan taramasi KULLANICI eylemiyle baslar (mevcut olusturucu ile ayni
   * desen). Efekt icinde senkron setState cagrilmaz.
   */
  const scanWallets = async () => {
    const found = await discoverWallets();
    setWallets(found);
    setWalletsScanned(true);
    if (found.length === 1) {
      setSelectedWalletUuid(found[0].uuid);
    }
  };

  useEffect(() => {
    if (selectedWalletUuid === null) {
      return;
    }
    return subscribeToWallet(selectedWalletUuid, {
      onAccountsChanged: (next) => setAccount(next[0] ?? null),
      onChainChanged: (next) => setChainId(next),
    });
  }, [selectedWalletUuid]);

  const connect = async () => {
    if (selectedWalletUuid === null) return;
    setErrorMessage(null);
    const accounts = await requestAccounts(selectedWalletUuid);
    if (!accounts.ok) {
      setErrorMessage(
        accounts.code === "rejected"
          ? "Cuzdan baglantisi reddedildi."
          : "Cuzdana baglanilamadi.",
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
      setErrorMessage("Ag degistirilemedi. Cuzdandan Arc Testnet'i sec.");
      return;
    }
    const chain = await getChainId(selectedWalletUuid);
    setChainId(chain.ok ? chain.value : null);
  };

  const canCreate =
    isTry &&
    !busy &&
    onArc &&
    account !== null &&
    selectedWalletUuid !== null &&
    draft.ok;

  const createLink = async () => {
    if (!canCreate || selectedWalletUuid === null || account === null) {
      return;
    }
    if (!draft.ok) {
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    setCopied(false);
    // Onceki baglanti hemen gizlenir; yenisi dogrulanana kadar hicbir sey yok.
    setGenerated(null);

    try {
      const built = createSharedBill({
        recipient: account,
        recipientLabel: prepareLabel(
          nameOf(result.payerId),
          MAX_LABEL_LENGTH,
        ),
        debts: draft.debts,
      });
      if (!built.ok) {
        setErrorMessage(describeSharedBillProblem(built.problem));
        return;
      }

      // TEK imza. Gecerli degilse cuzdana hicbir sey gonderilmez.
      const signed = await signSharedBillManifest(
        selectedWalletUuid,
        built.manifest,
      );
      if (!signed.ok) {
        setErrorMessage(describeSharedBillSigningError(signed.code));
        return;
      }

      const created = await createSharedBillOnServer({
        manifest: signed.manifest,
        debts: built.debts,
        signature: signed.signature,
      });
      if (!created.ok) {
        setErrorMessage(created.message);
        return;
      }

      setGenerated({
        url: `${window.location.origin}${created.path}`,
        billId: created.billId,
        expiresAt: created.expiresAt,
        inputsKey,
      });
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (activeLink === null) return;
    try {
      await navigator.clipboard.writeText(activeLink.url);
      setCopied(true);
    } catch {
      setErrorMessage("Baglanti kopyalanamadi. Elle secip kopyalayabilirsin.");
    }
  };

  const shareLink = async () => {
    if (activeLink === null) return;
    try {
      await navigator.share({
        title: "Hesabi Bol",
        text: "Ortak hesap odeme baglantisi",
        url: activeLink.url,
      });
    } catch {
      // Kullanici vazgectiyse veya paylasim desteklenmiyorsa sessiz kalinir.
    }
  };

  if (!isTry) {
    return (
      <section aria-labelledby={headingId} className={CARD_CLASS}>
        <h2 id={headingId} className="text-base font-semibold text-ink">
          Ortak odeme baglantisi
        </h2>
        <p className="text-sm text-ink-soft">
          Bu adim yalnizca TRY fisleri icin kullanilabilir.
        </p>
        <button type="button" onClick={onBack} className={LINK_CLASS}>
          Geri don
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className={CARD_CLASS}>
      <h2 id={headingId} className="text-base font-semibold text-ink">
        Tek baglanti olustur
      </h2>

      <p className="text-sm leading-relaxed text-ink-soft">
        Fisi odeyen cuzdanini bir kez baglarsin, her borclu icin bir adres
        girersin ve <strong>tek bir imza</strong> atarsin.{" "}
        <strong>Butun borclular ayni baglantiyi alir.</strong>
      </p>

      <p className="rounded-2xl border border-brand-line-soft bg-brand-soft px-3 py-2.5 text-xs leading-relaxed text-brand-ink">
        Bu imza yalnizca bir <strong>talep olusturur</strong>. Kimsenin
        cuzdanindan para cekemez ve hicbir transfer yetkisi vermez. Transferi
        her borclu kendi cuzdaninda imzalar. Ag:{" "}
        {ACTIVE_NETWORK_PROFILE.displayName} — test USDC&apos;sinin gercek
        parasal degeri yoktur.
      </p>

      {/* Cuzdan */}
      <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <h3 className="text-sm font-semibold text-ink">
          1. Fisi odeyen cuzdan
        </h3>
        {!walletsScanned && (
          <button
            type="button"
            onClick={scanWallets}
            className="self-start rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Cuzdani bagla
          </button>
        )}
        {walletsScanned && wallets.length === 0 && (
          <p className="text-xs text-ink-faint">
            Tarayicida cuzdan bulunamadi.{" "}
            <a
              href={ARC_TESTNET_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className={LINK_CLASS}
            >
              Arc Testnet kurulumu
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
              <option value="">Cuzdan sec</option>
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
              Bagla
            </button>
          </div>
        )}
        {account !== null && (
          <p className="text-xs text-ink-soft">
            Alici: <span className="font-mono">{shortenWalletAddress(account)}</span>
          </p>
        )}
        {account !== null && !onArc && (
          <button
            type="button"
            onClick={switchNetwork}
            className="self-start rounded-full border border-warn-line-strong bg-warn-surface px-3 py-1.5 text-xs font-semibold text-warn-ink"
          >
            {ACTIVE_NETWORK_PROFILE.displayName} agina gec
          </button>
        )}
      </div>

      {/* Borclu adresleri */}
      <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
        <h3 className="text-sm font-semibold text-ink">
          2. Her borclu icin bir cuzdan adresi
        </h3>
        {rows.length === 0 && (
          <p className="text-xs text-ink-faint">Paylasilacak bir borc yok.</p>
        )}
        {rows.map((row) => {
          const invalid =
            !draft.ok && draft.participantId === row.participantId;
          return (
            <label key={row.participantId} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-soft">
                {row.name} — {formatMinorForDisplay(row.amountMinor, receipt.currency)}
              </span>
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="0x…"
                value={row.address}
                onChange={(event) =>
                  setAddresses((previous) => ({
                    ...previous,
                    [row.participantId]: event.target.value,
                  }))
                }
                aria-invalid={invalid}
                className={`rounded-2xl border px-3 py-2 font-mono text-xs ${
                  invalid ? "border-danger-line-strong bg-danger-surface" : "border-line"
                }`}
              />
            </label>
          );
        })}
        {!draft.ok && rows.length > 0 && (
          <p role="alert" className="text-xs text-danger-ink">
            {describeSharedBillDraftProblem(draft.problem)}
          </p>
        )}
      </div>

      {/* Olustur */}
      <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <button
          type="button"
          onClick={createLink}
          disabled={!canCreate}
          className="self-start rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Imzalaniyor…" : "Imzala ve tek baglanti olustur"}
        </button>
        {errorMessage !== null && (
          <p role="alert" className="text-xs leading-relaxed text-danger-ink">
            {errorMessage}
          </p>
        )}
        {linkIsStale && (
          <p role="alert" className="text-xs leading-relaxed text-warn-ink-soft">
            Girdiler degisti; onceki baglanti artik gecerli degil. Yeniden
            imzalayip yeni bir baglanti olustur.
          </p>
        )}
      </div>

      {/* Tek baglanti */}
      {activeLink !== null && (
        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <h3 className="text-sm font-semibold text-ink">
            3. Tek baglanti — herkese ayni
          </h3>
          <p className="break-all rounded-2xl border border-line bg-muted px-3 py-2 font-mono text-[11px] text-ink-soft">
            {activeLink.url}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyLink}
              className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-ink-soft"
            >
              {copied ? "Kopyalandi" : "Kopyala"}
            </button>
            <button
              type="button"
              onClick={shareLink}
              className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-ink-soft"
            >
              Paylas
            </button>
          </div>
          {qrSvg !== null && (
            <div
              aria-label="Ortak odeme baglantisinin QR kodu"
              className="w-40 self-start [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          )}
          <p className="text-xs leading-relaxed text-ink-faint">
            Baglanti borc listesini, adresleri veya isimleri TASIMAZ; yalnizca
            tahmin edilemez bir kimlik icerir. Baglantiyi acan herkes hesabi
            gorebilir, bu yuzden yalnizca ilgili kisilerle paylas. En fazla{" "}
            {SHARED_BILL_MAX_LIFETIME_MS / (24 * 60 * 60 * 1000)} gun gecerlidir.
          </p>
          <p className="text-xs leading-relaxed text-ink-faint">
            Test USDC&apos;si icin{" "}
            <a
              href={ARC_TESTNET_FAUCET_URL}
              target="_blank"
              rel="noreferrer"
              className={LINK_CLASS}
            >
              Circle Faucet
            </a>
            .
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs text-ink-faint underline underline-offset-2"
      >
        Geri don
      </button>
    </section>
  );
}
