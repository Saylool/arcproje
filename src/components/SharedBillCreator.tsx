"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { renderSVG } from "uqr";

import {
  normalizeWalletAddress,
  shortenWalletAddress,
} from "@/lib/arc/address";
import {
  ARC_TESTNET_DOCS_URL,
  ARC_TESTNET_FAUCET_URL,
  isArcTestnet,
} from "@/lib/arc/network";
import {
  SHARED_BILL_UNKNOWN_PARTICIPANT_LABEL,
  prepareLabel,
} from "@/lib/arc/labels";
import { MAX_LABEL_LENGTH } from "@/lib/arc/payment-request";
import { debtIdentityKey } from "@/lib/arc/payment-state";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import {
  SHARED_BILL_MAX_LIFETIME_MS,
  createSharedBill,
} from "@/lib/arc/shared-bill";
import { createSharedBillOnServer } from "@/lib/arc/shared-bill-client";
import {
  describeSharedBillDraftProblem,
  sharedBillDraftKey,
  validateSharedBillDraft,
  type SharedBillDraftRow,
} from "@/lib/arc/shared-bill-draft";
import { signSharedBillManifest } from "@/lib/arc/shared-bill-signing";
import {
  discoverWallets,
  getChainId,
  requestAccounts,
  subscribeToWallet,
  switchToArcTestnet,
  type WalletInfo,
} from "@/lib/arc/wallet";
import { useTranslator } from "@/lib/i18n/context";
import {
  messageApi,
  messageKey,
  resolveMessage,
  type MessageDescriptor,
} from "@/lib/i18n/messages";
import { formatMinorForDisplay } from "@/lib/receipt/money";
import type { Receipt } from "@/lib/receipt/schema";
import type { DebtCalculationSuccess } from "@/lib/split/debts";
import type { Participant } from "@/lib/split/participants";
import { WalletConnectPanel } from "./WalletConnectPanel";
import {
  needsManualNetwork,
  switchFailureMessage,
} from "@/lib/arc/wallet-messages";
import { ArcNetworkParameters } from "./ArcNetworkParameters";

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
  /**
   * KİŞİ ADIMINDA bağlanan adresler: katılımcı kimliği → adres.
   *
   * Eşleştirme orada yapıldı; burada YENİDEN öneri gösterilmez. Bu adımda
   * kullanıcı büyük ihtimalle tanımadığımız yeni bir adres girer.
   */
  initialAddresses?: Readonly<Record<string, string>>;
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
  initialAddresses,
  onBack,
}: Props) {
  const { t, locale } = useTranslator();
  const headingId = useId();

  /*
   * Kişi adımında bağlanan adresler HAZIR gelir; kullanıcı burada yalnızca
   * eksik kalanları doldurur. Alan yine düzenlenebilir.
   */
  const [addresses, setAddresses] = useState<Record<string, string>>(
    () => ({ ...initialAddresses }),
  );
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [walletsScanned, setWalletsScanned] = useState(false);
  const [selectedWalletUuid, setSelectedWalletUuid] = useState<string | null>(null);
  const [manualNetwork, setManualNetwork] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  /* Durumda METIN degil TARIF tutulur; dil degisince cumle de degisir. */
  const [errorMessage, setErrorMessage] =
    useState<MessageDescriptor | null>(null);
  const [generated, setGenerated] = useState<GeneratedLink | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * Kisi adi VERIDIR ve cevrilmez.
   *
   * Bu ekranda ad hem GORUNUR hem de `debtorLabel` / `recipientLabel` olarak
   * IMZALANIR. Bu yuzden bulunamama durumundaki yedek ad DILDEN BAGIMSIZDIR:
   * imzalanan manifest hicbir kosulda arayuz diline gore degisemez.
   */
  const signingNameOf = useCallback(
    (id: string) =>
      participants.find((participant) => participant.id === id)?.name ??
      SHARED_BILL_UNKNOWN_PARTICIPANT_LABEL,
    [participants],
  );

  const isTry = receipt.currency === "TRY";
  const onArc = isArcTestnet(chainId);

  /*
   * Her borc bir satirdir: kim, ne kadar, hangi adrese odeyecek.
   *
   * `name` hem ekranda gosterilir HEM DE `debtorLabel` olarak IMZALANIR
   * (bkz. `shared-bill-draft.ts`). Bu yuzden yedek ad dilden bagimsiz
   * olanidir: imzalanan manifest arayuz diline gore degisemez.
   */
  const rows: readonly SharedBillDraftRow[] = useMemo(
    () =>
      result.debts.map((debt) => ({
        participantId: debt.fromParticipantId,
        name: signingNameOf(debt.fromParticipantId),
        debtKey: debtIdentityKey(debt),
        amountMinor: debt.amountMinor,
        address: addresses[debt.fromParticipantId] ?? "",
      })),
    [result.debts, addresses, signingNameOf],
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
          signingNameOf(result.payerId),
          MAX_LABEL_LENGTH,
        ),
        debts: draft.debts,
      });
      if (!built.ok) {
        setErrorMessage(messageKey(`errors.sharedBill.${built.problem}`));
        return;
      }

      // TEK imza. Gecerli degilse cuzdana hicbir sey gonderilmez.
      const signed = await signSharedBillManifest(
        selectedWalletUuid,
        built.manifest,
      );
      if (!signed.ok) {
        setErrorMessage(messageKey(`errors.billSigning.${signed.code}`));
        return;
      }

      const created = await createSharedBillOnServer({
        manifest: signed.manifest,
        debts: built.debts,
        signature: signed.signature,
      });
      if (!created.ok) {
        /*
         * Sunucunun hazir metni GOSTERILMEZ: cumle KARARLI KODA gore
         * sozlukten, etkin dilde secilir.
         */
        setErrorMessage(messageApi(created.code));
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
      setErrorMessage(messageKey("common.linkCopyFailed"));
    }
  };

  const shareLink = async () => {
    if (activeLink === null) return;
    try {
      await navigator.share({
        title: t("sharedBill.shareTitle"),
        text: t("sharedBill.shareText"),
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
          {t("sharedBill.titleOnlyTry")}
        </h2>
        <p className="text-sm text-ink-soft">{t("sharedBill.onlyTry")}</p>
        <button type="button" onClick={onBack} className={LINK_CLASS}>
          {t("common.back")}
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className={CARD_CLASS}>
      <h2 id={headingId} className="text-base font-semibold text-ink">
        {t("sharedBill.title")}
      </h2>

      <p className="text-sm leading-relaxed text-ink-soft">
        {t("sharedBill.introPrefix")}
        <strong>{t("sharedBill.introSignature")}</strong>
        {t("sharedBill.introMiddle")}
        <strong>{t("sharedBill.introAllSame")}</strong>
      </p>

      <p className="rounded-2xl border border-brand-line-soft bg-brand-soft px-3 py-2.5 text-xs leading-relaxed text-brand-ink">
        {t("sharedBill.noticePrefix")}
        <strong>{t("sharedBill.noticeRequest")}</strong>
        {t("sharedBill.noticeSuffix", {
          network: ACTIVE_NETWORK_PROFILE.displayName,
        })}
      </p>

      {/* Cuzdan */}
      <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <h3 className="text-sm font-semibold text-ink">
          {t("sharedBill.stepWallet")}
        </h3>
        {!walletsScanned && (
          <button
            type="button"
            onClick={scanWallets}
            className="self-start rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
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
            {t("wallet.recipientIs")}{" "}
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
        {manualNetwork && <ArcNetworkParameters />}
      </div>

      {/* Borclu adresleri */}
      <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
        <h3 className="text-sm font-semibold text-ink">
          {t("sharedBill.stepAddresses")}
        </h3>
        {rows.length === 0 && (
          <p className="text-xs text-ink-faint">{t("sharedBill.noDebts")}</p>
        )}
        {rows.map((row) => {
          const invalid =
            !draft.ok && draft.participantId === row.participantId;
          return (
            <label key={row.participantId} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-soft">
                {row.name} —{" "}
                {formatMinorForDisplay(row.amountMinor, receipt.currency, locale)}
              </span>
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("common.addressPlaceholder")}
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
              {/*
                TAM ADRES OKUNABİLİR OLMALI.

                Girdi kutusu dar ekranda adresin sonunu görsel olarak keser.
                Kullanıcı bir öneriye tıkladığında ETİKETE güvenerek seçim
                yapar; doğrulayabileceği tek yerin kırpık olması kabul
                edilemez. Bu yüzden geçerli adres, checksum'lı hâliyle ve
                satır kaydırılarak ayrıca basılır. Elle yazan da faydalanır.
              */}
              {normalizeWalletAddress(row.address) !== null && (
                <span className="break-all font-mono text-[11px] text-ink-faint">
                  <span className="font-sans">{t("contacts.fullAddress")}: </span>
                  {normalizeWalletAddress(row.address)}
                </span>
              )}
            </label>
          );
        })}
        {/*
          Öneri YOKTUR ama uyarı KALIR: adres ister elle yazılmış ister kişi
          adımında bağlanmış olsun, gönderilmeden önce doğrulanmalıdır.
        */}
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {t("contacts.verifyNotice")}
        </p>
        {!draft.ok && rows.length > 0 && (
          <p role="alert" className="text-xs text-danger-ink">
            {describeSharedBillDraftProblem(draft.problem, locale)}
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
          {busy ? t("sharedBill.signing") : t("sharedBill.signAndCreate")}
        </button>
        {errorMessage !== null && (
          <p role="alert" className="text-xs leading-relaxed text-danger-ink">
            {resolveMessage(locale, errorMessage)}
          </p>
        )}
        {linkIsStale && (
          <p role="alert" className="text-xs leading-relaxed text-warn-ink-soft">
            {t("sharedBill.stale")}
          </p>
        )}
      </div>

      {/* Tek baglanti */}
      {activeLink !== null && (
        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <h3 className="text-sm font-semibold text-ink">
            {t("sharedBill.stepLink")}
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
              {copied ? t("common.copied") : t("common.copy")}
            </button>
            <button
              type="button"
              onClick={shareLink}
              className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-ink-soft"
            >
              {t("common.share")}
            </button>
          </div>
          {qrSvg !== null && (
            <div
              aria-label={t("sharedBill.qrLabel")}
              className="w-40 self-start [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          )}
          <p className="text-xs leading-relaxed text-ink-faint">
            {t("sharedBill.linkNotice", {
              days: SHARED_BILL_MAX_LIFETIME_MS / (24 * 60 * 60 * 1000),
            })}
          </p>
          <p className="text-xs leading-relaxed text-ink-faint">
            {t("sharedBill.faucetPrefix")}
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

      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs text-ink-faint underline underline-offset-2"
      >
        {t("common.back")}
      </button>
    </section>
  );
}
