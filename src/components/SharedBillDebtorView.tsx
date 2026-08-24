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
import {
  describeAccessSigningError,
  signSharedBillAccessChallenge,
} from "@/lib/arc/shared-bill-access";
import {
  describeViewProblem,
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
import { formatMinorForDisplay } from "@/lib/receipt/money";

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
 * PART 2 SINIRI: burada ÖDEME YOKTUR. Kur çekilmez, tahmin alınmaz, App Kit
 * çağrılmaz ve hiçbir işlem gönderilmez. Ödeme Part 3'tedir.
 */

type Props = { billId: string };

type Stage =
  | { status: "idle" }
  | { status: "working"; step: string }
  | { status: "ready"; view: VerifiedView }
  | { status: "error"; message: string };

const CARD_CLASS =
  "flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm";
const LINK_CLASS =
  "underline underline-offset-2 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500";

export function SharedBillDebtorView({ billId }: Props) {
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

  const connect = async () => {
    if (selectedWalletUuid === null) return;
    setStage({ status: "idle" });
    const accounts = await requestAccounts(selectedWalletUuid);
    if (!accounts.ok) {
      setStage({
        status: "error",
        message:
          accounts.code === "rejected"
            ? "Cüzdan bağlantısı reddedildi."
            : "Cüzdana bağlanılamadı.",
      });
      return;
    }
    setAccount(accounts.value[0] ?? null);
    const chain = await getChainId(selectedWalletUuid);
    setChainId(chain.ok ? chain.value : null);
  };

  const switchNetwork = async () => {
    if (selectedWalletUuid === null) return;
    const switched = await switchToArcTestnet(selectedWalletUuid);
    if (!switched.ok) {
      setStage({
        status: "error",
        message: "Ağ değiştirilemedi. Cüzdandan Arc Testnet'i seç.",
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

    setStage({ status: "working", step: "Erişim isteği alınıyor…" });
    const challenge = await requestAccessChallenge(billId, account);
    if (!challenge.ok) {
      setStage({ status: "error", message: challenge.message });
      return;
    }

    setStage({ status: "working", step: "Cüzdanda imza bekleniyor…" });
    const signed = await signSharedBillAccessChallenge(
      selectedWalletUuid,
      challenge.value.challenge,
      challenge.value.challenge.audience,
    );
    if (!signed.ok) {
      setStage({
        status: "error",
        message: describeAccessSigningError(signed.code),
      });
      return;
    }

    setStage({ status: "working", step: "Borç aranıyor…" });
    const resolved = await submitAccessResolution(billId, {
      challenge: challenge.value.challenge,
      tag: challenge.value.tag,
      signature: signed.signature,
    });
    if (!resolved.ok) {
      setStage({ status: "error", message: resolved.message });
      return;
    }

    const fetched = await fetchAuthenticatedDebt(billId);
    if (!fetched.ok) {
      setStage({ status: "error", message: fetched.message });
      return;
    }

    setStage({ status: "working", step: "İmza ve kanıt doğrulanıyor…" });
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
        message: describeViewProblem(verified.problem),
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
    return new Date(stage.view.billExpiresAt * 1000).toLocaleString("tr-TR");
  }, [stage]);

  return (
    <section aria-label="Ortak hesap" className={CARD_CLASS}>
      <h1 className="text-base font-semibold tracking-tight text-slate-900">
        Ortak hesap — kendi borcun
      </h1>

      {/*
        Hesabın VAR OLUP OLMADIĞI burada açıklanmaz: cüzdan doğrulamasından
        önce hiçbir hesap verisi gösterilmez.
      */}
      <p className="text-sm leading-relaxed text-slate-600">
        Bu bağlantı gruptaki <strong>herkese aynı</strong> gönderildi. Kendi
        borcunu görmek için cüzdanını bağlayıp bir <strong>kimlik doğrulama
        mesajı</strong> imzalaman gerekiyor.
      </p>

      <p className="rounded-2xl border border-violet-100 bg-violet-50 px-3 py-2.5 text-xs leading-relaxed text-violet-900">
        Bu imza bir <strong>işlem değildir</strong>: hiçbir token onaylamaz,
        hiçbir transfer yetkisi vermez ve cüzdanından para çekmez. Yalnızca bu
        adresi kontrol ettiğini kanıtlar. Kimlik doğrulaması değil, yalnızca
        adres sahipliği kanıtıdır. Geçerlilik:{" "}
        {SHARED_BILL_ACCESS_MAX_LIFETIME_MS / 60000} dakika.
      </p>

      {/* Cüzdan */}
      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
        {!walletsScanned && (
          <button
            type="button"
            onClick={scanWallets}
            className="self-start rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Cüzdanı bağla
          </button>
        )}
        {walletsScanned && wallets.length === 0 && (
          <p className="text-xs text-slate-500">
            Tarayıcıda cüzdan bulunamadı.{" "}
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
              className="rounded-full border border-slate-200 px-3 py-1.5 text-sm"
            >
              <option value="">Cüzdan seç</option>
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
              className="rounded-full bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Bağla
            </button>
          </div>
        )}
        {account !== null && (
          <p className="text-xs text-slate-600">
            Bağlı cüzdan:{" "}
            <span className="font-mono">{shortenWalletAddress(account)}</span>
          </p>
        )}
        {account !== null && !onArc && (
          <button
            type="button"
            onClick={switchNetwork}
            className="self-start rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900"
          >
            {ACTIVE_NETWORK_PROFILE.displayName} ağına geç
          </button>
        )}
        {account !== null && onArc && stage.status !== "ready" && (
          <button
            type="button"
            onClick={authenticate}
            disabled={stage.status === "working"}
            className="self-start rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {stage.status === "working" ? stage.step : "İmzala ve borcumu gör"}
          </button>
        )}
      </div>

      {stage.status === "error" && (
        <p
          role="alert"
          className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700"
        >
          {stage.message}
        </p>
      )}

      {/* Yalnızca KENDİ borcu */}
      {stage.status === "ready" && (
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4">
          <h2 className="text-sm font-semibold text-slate-800">Senin borcun</h2>
          <p className="text-2xl font-semibold tracking-tight text-slate-900">
            {formatMinorForDisplay(Number(stage.view.debt.tryMinor), "TRY")}
          </p>
          <p className="text-xs text-slate-600">
            {stage.view.debt.debtorLabel} →{" "}
            <strong>{stage.view.recipient.label}</strong> (fişi ödeyen)
          </p>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-700">
              Alıcı cüzdan adresi
            </span>
            <p className="break-all rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700">
              {stage.view.recipient.address}
            </p>
            <button
              type="button"
              onClick={copyRecipient}
              className="self-start rounded-full border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-700"
            >
              {copied ? "Kopyalandı" : "Adresi kopyala"}
            </button>
          </div>

          {expiryText !== null && (
            <p className="text-xs text-slate-500">
              Bu bağlantı {expiryText} tarihine kadar geçerli.
            </p>
          )}

          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
            <strong>Ödeme bu adımda henüz açık değil.</strong> Bu sürümde
            yalnızca kendi borcunu görebilirsin; kur çevrimi ve USDC gönderimi
            sonraki adımda eklenecek.
          </p>

          <p className="text-xs leading-relaxed text-slate-500">
            Ağ: {ACTIVE_NETWORK_PROFILE.displayName}. Test USDC&apos;sinin{" "}
            <strong>gerçek parasal değeri yoktur</strong>. Test parası için{" "}
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
    </section>
  );
}
