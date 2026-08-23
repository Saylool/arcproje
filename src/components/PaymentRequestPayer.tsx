"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { shortenWalletAddress, walletAddressesEqual } from "@/lib/arc/address";
import { formatMicroUsdcAmount, formatMicroUsdcForDisplay } from "@/lib/arc/conversion";
import {
  ARC_TESTNET_DOCS_URL,
  ARC_TESTNET_FAUCET_URL,
  isArcTestnet,
} from "@/lib/arc/network";
import {
  extractQuoteFromPayload,
  type SignedPaymentRequest,
} from "@/lib/arc/payment-request";
import { formatQuoteRate, type RateQuote } from "@/lib/rates/quote";
import { verifyQuoteWithServer } from "@/lib/rates/client";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import {
  REQUEST_QUERY_PARAM,
  decodeSignedRequest,
  describeCodecProblem,
} from "@/lib/arc/request-codec";
import { verifyPaymentRequestSignature } from "@/lib/arc/request-signing";
import { createSingleFlight } from "@/lib/arc/single-flight";
import {
  readSubmission,
  recordSubmission,
  type SubmissionOutcome,
} from "@/lib/arc/submission-log";
import {
  describeArcSendError,
  keepsSubmissionLocked,
  estimateArcSend,
  reviewStateAfterSendFailure,
  sendArcUsdc,
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

/**
 * Ödeme talebi ödeme sayfası — BORÇLU (gönderen) tarafı.
 *
 * Talep önce çözülür, şeması katı biçimde doğrulanır ve EIP-712 imzası
 * kontrol edilir. Doğrulama geçmeden hiçbir cüzdan veya ödeme kontrolü
 * gösterilmez. Gönderim anlık görüntüsü YALNIZCA imzalı talepten kurulur;
 * URL parametreleri veya form durumu kullanılmaz.
 */

type VerifyState =
  | { status: "loading" }
  | { status: "invalid"; message: string }
  | { status: "valid"; request: SignedPaymentRequest; quote: RateQuote };

type FlowStatus =
  | "idle"
  | "estimating"
  | "review"
  | "verifying"
  | "sending"
  | "done";

const LINK_CLASS =
  "underline underline-offset-2 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500";

export function PaymentRequestPayer() {
  const searchParams = useSearchParams();
  const encoded = searchParams.get(REQUEST_QUERY_PARAM);

  const [verifyState, setVerifyState] = useState<VerifyState>({ status: "loading" });

  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [walletsScanned, setWalletsScanned] = useState(false);
  const [selectedWalletUuid, setSelectedWalletUuid] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const [status, setStatus] = useState<FlowStatus>("idle");
  const [estimateSummary, setEstimateSummary] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<ArcSendSuccess | null>(null);
  /*
   * Yeniden girişe karşı EŞZAMANLI kilit. React durumu asenkron güncellendiği
   * için iki hızlı tık, ikisi de `status === "review"` görürken submit()'i iki
   * kez başlatabilirdi. useRef anında yazılır ve ikinci çağrı hemen döner.
   */
  const submitGuard = useRef(createSingleFlight());
  /** Tahmin için AYRI kilit: çift tık iki tahmin boru hattı başlatamaz. */
  const estimateGuard = useRef(createSingleFlight());
  /*
   * Bayatlık jetonu. Hesap/ağ değiştiğinde artar; devam eden bir tahminin geç
   * dönen sonucu daha YENİ durumun üzerine yazamaz.
   */
  const runToken = useRef(0);
  const [priorSubmission, setPriorSubmission] =
    useState<SubmissionOutcome | null>(null);

  // Çöz + doğrula. Cüzdan kontrolleri ancak bu geçerse gösterilir.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (encoded === null || encoded === "") {
        if (!cancelled) {
          setVerifyState({
            status: "invalid",
            message: "Bağlantıda ödeme talebi bulunamadı.",
          });
        }
        return;
      }

      const decoded = decodeSignedRequest(encoded, Date.now());
      if (!decoded.ok) {
        if (!cancelled) {
          setVerifyState({
            status: "invalid",
            message: describeCodecProblem(decoded.problem),
          });
        }
        return;
      }

      const verified = await verifyPaymentRequestSignature(decoded.request);
      if (cancelled) {
        return;
      }
      if (!verified.ok) {
        setVerifyState({
          status: "invalid",
          message:
            verified.reason === "signerMismatch"
              ? "Talebi imzalayan hesap, talepteki alıcı değil. Bu bağlantıya güvenme."
              : "Ödeme talebinin imzası doğrulanamadı. Bu bağlantıya güvenme.",
        });
        return;
      }
      /*
       * Cüzdan imzası kurun PİYASADAN geldiğini kanıtlamaz; onu yalnızca
       * sunucunun HMAC etiketi kanıtlar. Bu yüzden teklif ayrıca sunucuya
       * doğrulatılır ve geçmeden hiçbir cüzdan kontrolü gösterilmez.
       */
      const quote = extractQuoteFromPayload(decoded.request.payload);
      const quoteCheck = await verifyQuoteWithServer(
        quote,
        decoded.request.payload.quoteTag,
      );
      if (cancelled) {
        return;
      }
      if (!quoteCheck.ok) {
        setVerifyState({ status: "invalid", message: quoteCheck.message });
        return;
      }
      setVerifyState({ status: "valid", request: decoded.request, quote });
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [encoded]);

  const request = verifyState.status === "valid" ? verifyState.request : null;

  useEffect(() => {
    if (selectedWalletUuid === null) {
      return;
    }
    return subscribeToWallet(selectedWalletUuid, {
      onAccountsChanged: (accounts) => {
        // Devam eden tahminin sonucu artık geçersizdir.
        runToken.current += 1;
        setAccount(accounts[0] ?? null);
        setStatus("idle");
        setConfirmed(false);
      },
      onChainChanged: (next) => {
        runToken.current += 1;
        setChainId(next);
        setStatus("idle");
        setConfirmed(false);
      },
    });
  }, [selectedWalletUuid]);

  /** Anlık görüntü YALNIZCA imzalı talepten kurulur. */
  const snapshot: ArcPaymentSnapshot | null = useMemo(() => {
    if (request === null) {
      return null;
    }
    const micro = BigInt(request.payload.microUsdc);
    return Object.freeze({
      debtKey: request.payload.debtKey,
      debtorParticipantId: request.payload.debtorLabel,
      recipientParticipantId: request.payload.recipientLabel,
      debtorAddress: request.payload.debtor,
      recipientAddress: request.payload.recipient,
      tryMinor: Number(request.payload.tryMinor),
      rateNumerator: request.payload.rateNumerator,
      rateDenominator: request.payload.rateDenominator,
      microUsdc: request.payload.microUsdc,
      amount: formatMicroUsdcAmount(micro),
      displayAmount: formatMicroUsdcForDisplay(micro),
      chainId: request.payload.chainId,
      // Kimlik ve süre alanları gönderim sınırına taşınır; süre orada
      // React'ten bağımsız olarak yeniden ölçülür.
      requestId: request.payload.requestId,
      issuedAt: request.payload.issuedAt,
      expiresAt: request.payload.expiresAt,
      quoteId: request.payload.quoteId,
      quoteExpiresAt: request.payload.quoteExpiresAt,
    });
  }, [request]);

  /*
   * Bu tarayıcıda bu talep için daha önce bir gönderim yapılmış mı? YETKİLİ
   * bir kontrol değildir (cihaz başına localStorage); yalnızca aynı tarayıcıda
   * kazara ikinci gönderimi azaltır.
   */
  useEffect(() => {
    if (snapshot === null) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      const prior = readSubmission(snapshot.chainId, snapshot.requestId);
      if (!cancelled && prior !== null) {
        setPriorSubmission(prior);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [snapshot]);

  const onArc = isArcTestnet(chainId);
  const accountMatchesDebtor =
    account !== null && request !== null
      ? walletAddressesEqual(account, request.payload.debtor)
      : false;
  const busy =
    status === "estimating" || status === "verifying" || status === "sending";
  const alreadyPaid = transaction !== null;

  const scanWallets = useCallback(async () => {
    const found = await discoverWallets();
    setWallets(found);
    setWalletsScanned(true);
    if (found.length === 1) {
      setSelectedWalletUuid(found[0].uuid);
    }
  }, []);

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
    setStatus("idle");
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
    setStatus("idle");
  };

  const canEstimate =
    snapshot !== null &&
    selectedWalletUuid !== null &&
    account !== null &&
    onArc &&
    accountMatchesDebtor &&
    !busy &&
    !alreadyPaid &&
    priorSubmission === null;

  /** İncelemeyi düşürür: onay kutusu ve gönder düğmesi ekrandan kalkar. */
  const dropReview = (message: string) => {
    setErrorMessage(message);
    setEstimateSummary(null);
    setConfirmed(false);
    setStatus("idle");
  };

  /** Yeniden denenebilir hatada incelemeye dönülür. */
  const backToReview = (message: string) => {
    setErrorMessage(message);
    setStatus("review");
  };

  const estimate = async () => {
    /*
     * Tahmin için de EŞZAMANLI kilit, ilk `await`ten ÖNCE. Aksi hâlde iki
     * hızlı tık iki tahmin boru hattı başlatır ve geç dönen sonuç, erken
     * dönenin üzerine yazabilirdi.
     */
    if (!estimateGuard.current.tryEnter()) {
      return;
    }
    if (
      !canEstimate ||
      snapshot === null ||
      selectedWalletUuid === null ||
      request === null
    ) {
      estimateGuard.current.release();
      return;
    }

    // Görünür durum hemen değişir: tahmin düğmesi bu andan itibaren pasiftir.
    const token = (runToken.current += 1);
    setStatus("estimating");
    setErrorMessage(null);

    /** Hesap/ağ değiştiyse veya yeni bir çalışma başladıysa sonuç bayattır. */
    const isStale = () => token !== runToken.current;

    try {
      // Talebin süresi bu arada dolmuş olabilir.
      if (encoded !== null) {
        const fresh = decodeSignedRequest(encoded, Date.now());
        if (!fresh.ok) {
          dropReview(
            `${describeCodecProblem(fresh.problem)} Talebi oluşturan kişiden yeni bir bağlantı iste.`,
          );
          return;
        }
      }
      // Sayfa açıkken süresi dolan bir kur tahmine giremez.
      const quoteBeforeEstimate = await verifyQuoteWithServer(
        extractQuoteFromPayload(request.payload),
        request.payload.quoteTag,
      );
      if (isStale()) {
        return;
      }
      if (!quoteBeforeEstimate.ok) {
        dropReview(quoteBeforeEstimate.message);
        return;
      }

      const outcome = await estimateArcSend(selectedWalletUuid, snapshot);
      if (isStale()) {
        // Geç dönen sonuç daha YENİ durumun üzerine yazılmaz.
        return;
      }
      if (!outcome.ok) {
        setErrorMessage(describeArcSendError(outcome.code));
        setStatus("idle");
        return;
      }
      setEstimateSummary(outcome.value.summary);
      setStatus("review");
    } finally {
      estimateGuard.current.release();
    }
  };

  const submit = async () => {
    /*
     * EŞZAMANLI kilit, ilk `await`ten ÖNCE. React durumu asenkron
     * güncellendiği için iki hızlı tık aynı `status === "review"` değerini
     * görüp iki submit başlatabilirdi; bu kontrol ikinciyi anında keser.
     */
    if (!submitGuard.current.tryEnter()) {
      return;
    }
    if (
      status !== "review" ||
      !confirmed ||
      snapshot === null ||
      selectedWalletUuid === null ||
      alreadyPaid
    ) {
      submitGuard.current.release();
      return;
    }

    // Görünür durum hemen değişir: onay düğmesi bu andan itibaren pasiftir.
    setStatus("verifying");
    setErrorMessage(null);
    let keepLocked = false;

    try {
      /*
       * İnceleme ile onay arasında zaman geçti. Bağlantı yeniden çözülür,
       * imzası yeniden doğrulanır ve çözülen talebin incelenen talebin AYNISI
       * olduğu talep kimliğiyle kanıtlanır. Bu kontroller React tarafındaki
       * ilk savunma katmanıdır; gönderim sınırı aynı süreyi kendisi de ölçer.
       */
      if (encoded === null) {
        dropReview("Bağlantıda ödeme talebi bulunamadı.");
        return;
      }
      const fresh = decodeSignedRequest(encoded, Date.now());
      if (!fresh.ok) {
        dropReview(
          `${describeCodecProblem(fresh.problem)} Talebi oluşturan kişiden yeni bir bağlantı iste.`,
        );
        return;
      }
      const reverified = await verifyPaymentRequestSignature(fresh.request);
      if (!reverified.ok) {
        dropReview(
          "Ödeme talebinin cüzdan imzası artık doğrulanamıyor. Gönderim yapılmadı.",
        );
        return;
      }
      if (fresh.request.payload.requestId !== snapshot.requestId) {
        dropReview(
          "Bağlantıdaki talep, incelediğin talep değil. Gönderim yapılmadı; sayfayı yenileyip yeniden incele.",
        );
        return;
      }
      /*
       * Kur teklifi gönderimden HEMEN ÖNCE yeniden doğrulanır. Süresi dolmuş
       * bir kurla kit.send'e gidilmez; gönderim sınırı ayrıca kendi ölçümünü
       * yapar.
       */
      const quoteBeforeSend = await verifyQuoteWithServer(
        extractQuoteFromPayload(fresh.request.payload),
        fresh.request.payload.quoteTag,
      );
      if (!quoteBeforeSend.ok) {
        dropReview(quoteBeforeSend.message);
        return;
      }

      setStatus("sending");
      const outcome = await sendArcUsdc(selectedWalletUuid, snapshot);
      if (!outcome.ok) {
        const message = describeArcSendError(outcome.code);
        if (keepsSubmissionLocked(outcome.code)) {
          /*
           * kit.send ÇAĞRILDI ve sonuç belirsiz. İşlem zincire düşmüş
           * olabileceği için kilit AÇILMAZ; kullanıcı önce cüzdanını ve
           * ArcScan'i kontrol etmelidir.
           */
          recordSubmission(snapshot.chainId, snapshot.requestId, "unknown");
          setPriorSubmission("unknown");
          keepLocked = true;
          dropReview(message);
          return;
        }
        // Geçerlilik penceresi kapandıysa aynı talep bir daha gönderilemez:
        // kurulu bir onay düğmesi ekranda bırakılmaz.
        if (reviewStateAfterSendFailure(outcome.code) === "leaveReview") {
          dropReview(message);
          return;
        }
        backToReview(message);
        return;
      }
      recordSubmission(snapshot.chainId, snapshot.requestId, "success");
      setPriorSubmission("success");
      setTransaction(outcome.value);
      setStatus("done");
      // Başarıdan sonra kilit AÇILMAZ: aynı talep ikinci kez gönderilemez.
      keepLocked = true;
    } finally {
      if (!keepLocked) {
        submitGuard.current.release();
      }
    }
  };

  if (verifyState.status === "loading") {
    return (
      <section aria-label="Ödeme talebi" className={cardClass}>
        <p className="text-sm text-slate-500">Ödeme talebi doğrulanıyor…</p>
      </section>
    );
  }

  if (verifyState.status === "invalid") {
    return (
      <section aria-label="Ödeme talebi" className={cardClass}>
        <h2 className="text-base font-semibold tracking-tight text-slate-900">
          Bu ödeme talebi geçersiz
        </h2>
        <p
          role="alert"
          className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700"
        >
          {verifyState.message}
        </p>
        <p className="text-xs leading-relaxed text-slate-500">
          Güvenlik gereği geçersiz bir talep için cüzdan bağlama veya ödeme
          seçenekleri gösterilmez. Bağlantıyı sana gönderen kişiden yeni bir
          talep iste.
        </p>
      </section>
    );
  }

  const payload = verifyState.request.payload;
  const expiresText = new Date(payload.expiresAt * 1000).toLocaleString("tr-TR");

  return (
    <section aria-label="Ödeme talebi" className={cardClass}>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">
            Ödeme talebi
          </h2>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
            TEST AĞI
          </span>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
            cüzdan imzası doğrulandı
          </span>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          Bu talep,{" "}
          <span className="font-mono">
            {shortenWalletAddress(payload.recipient)}
          </span>{" "}
          adresli cüzdan tarafından imzalandı. Ödemeyi{" "}
          <strong className="font-semibold">kendi cüzdanında sen onaylarsın</strong>;
          kimse senin cüzdanından para çekemez.
        </p>
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
          <strong className="font-semibold">İsimler kimlik kanıtı değildir.</strong>{" "}
          &quot;{payload.recipientLabel}&quot; ve &quot;{payload.debtorLabel}&quot;
          bu talebi oluşturan kişinin yazdığı etiketlerdir. İmza yalnızca{" "}
          <strong className="font-semibold">cüzdan adresinin</strong> bu talebi
          imzaladığını kanıtlar; kişinin gerçek veya yasal kimliğini kanıtlamaz.
          Ödemeden önce aşağıdaki tam alıcı adresini, fişi ödeyen kişiyle{" "}
          <strong className="font-semibold">
            güvendiğin bir iletişim kanalından
          </strong>{" "}
          (yüz yüze, telefon) karşılaştır.
        </p>
      </header>

      {/* Değiştirilemez inceleme */}
      <dl className="flex flex-col gap-1 rounded-2xl border border-slate-200 p-3 text-xs">
        <Row label="Borçlu / gönderen" value={payload.debtorLabel} />
        <Row label="Gönderen adresi" value={shortenWalletAddress(payload.debtor)} />
        <Row label="Fişi ödeyen / alıcı" value={payload.recipientLabel} />
        <Row label="Alıcı adresi" value={shortenWalletAddress(payload.recipient)} />
        <Row label="Borç (TRY)" value={formatTry(payload.tryMinor)} />
        <Row
          label="Kur"
          value={`1 USDC = ${formatQuoteRate(verifyState.quote)} TRY`}
        />
        <Row label="Kur kaynağı" value={payload.quoteSource} />
        <Row
          label="Kur gözlem zamanı"
          value={new Date(payload.quoteObservedAt * 1000).toLocaleString("tr-TR")}
        />
        <Row
          label="Kur geçerliliği"
          value={new Date(payload.quoteExpiresAt * 1000).toLocaleString("tr-TR")}
        />
        <Row
          label="Gönderilecek"
          value={`${formatMicroUsdcForDisplay(BigInt(payload.microUsdc))} USDC`}
          strong
        />
        <Row label="Ağ" value={ACTIVE_NETWORK_PROFILE.displayName} />
        <Row label="Geçerlilik" value={expiresText} />
      </dl>
      <div className="flex flex-col gap-2">
        <AddressDisclosure
          title="Alıcı (fişi ödeyen) adresinin tamamı"
          address={payload.recipient}
        />
        <AddressDisclosure
          title="Gönderen (senin) adresinin tamamı"
          address={payload.debtor}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">
        Bu alanlar imzalıdır ve değiştirilemez. Tutar, adresler ve ağ talebi
        imzalayan kişi tarafından belirlenmiştir.{" "}
        <strong className="font-semibold">
          Cüzdan imzası tek başına kurun piyasa değeri olduğunu kanıtlamaz.
        </strong>{" "}
        Kur, sunucu tarafından CoinGecko&apos;dan alınıp imzalanmıştır ve bu
        sayfa açılırken sunucuya ayrıca doğrulatılmıştır.
      </p>

      {/* Cüzdan */}
      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Kendi cüzdanını bağla
        </h3>
        {!walletsScanned ? (
          <button
            type="button"
            onClick={scanWallets}
            disabled={busy}
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
                    name="payer-wallet"
                    checked={selectedWalletUuid === wallet.uuid}
                    disabled={busy}
                    onChange={() => {
                      setSelectedWalletUuid(wallet.uuid);
                      setAccount(null);
                      setChainId(null);
                      setStatus("idle");
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
                  className="rounded-full bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
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
            {account !== null && !accountMatchesDebtor && (
              <p
                role="alert"
                className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900"
              >
                Bağlı hesap, talepteki borçlu adresiyle aynı değil. Bu talebi
                yalnızca {payload.debtorLabel} ödeyebilir.
              </p>
            )}
          </div>
        )}
      </div>

      {priorSubmission !== null && transaction === null && (
        <p
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900"
        >
          {priorSubmission === "success"
            ? "Bu talep için bu tarayıcıdan zaten başarılı bir gönderim yapılmış görünüyor. Tekrar göndermeden önce ArcScan'de kontrol et."
            : "Bu talep için bu tarayıcıdan bir gönderim başlatılmış ama sonucu doğrulanamamış. Tekrar göndermeden önce MetaMask işlem geçmişini ve ArcScan'i kontrol et."}{" "}
          <strong className="font-semibold">
            Bu kayıt yalnızca bu tarayıcıda tutulur; başka bir cihazdan veya
            gizli sekmeden yapılan gönderimi bilemez.
          </strong>
        </p>
      )}

      {/* Tahmin ve onay */}
      {!alreadyPaid && (
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={estimate}
            disabled={!canEstimate}
            className="self-start rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "estimating" ? "Tahmin alınıyor…" : "İşlemi tahmin et"}
          </button>

          {estimateSummary !== null && status === "review" && (
            <p className="text-[11px] text-slate-500">
              Tahmini ağ ücreti (gas, ayrı hesaplanır ve tutardan düşülmez):{" "}
              {estimateSummary}
            </p>
          )}

          {status === "review" && (
            <div className="flex flex-col gap-2 rounded-2xl border border-violet-200 bg-violet-50 p-3">
              <label className="flex items-start gap-2 text-[11px] leading-relaxed text-violet-900">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5 accent-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                />
                <span>
                  Yukarıdaki imzalı talebi okudum. Kurun sunucu tarafından
                  CoinGecko&apos;dan alınıp doğrulandığını ve gönderilecek
                  tutarın Arc Testnet test USDC&apos;si olduğunu anlıyorum.
                </span>
              </label>
              <button
                type="button"
                onClick={submit}
                disabled={!confirmed || busy}
                className="self-start rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:bg-violet-300"
              >
                Cüzdanda onayla
              </button>
            </div>
          )}

          {status === "verifying" && (
            <p className="rounded-2xl bg-violet-50 px-3 py-2.5 text-xs text-violet-800">
              Talep ve kur yeniden doğrulanıyor…
            </p>
          )}

          {status === "sending" && (
            <p className="rounded-2xl bg-violet-50 px-3 py-2.5 text-xs text-violet-800">
              İşlem cüzdanda bekleniyor…
            </p>
          )}
        </div>
      )}

      {transaction !== null && (
        <div className="flex flex-col gap-1 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
          <p className="font-semibold">
            Ödeme gönderildi ({transaction.snapshot.displayAmount} USDC).
          </p>
          <p className="break-all font-mono text-[11px]">{transaction.txHash}</p>
          {transaction.explorerUrl !== null && (
            <a
              href={transaction.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className={LINK_CLASS}
            >
              ArcScan&apos;de görüntüle
            </a>
          )}
          <p className="mt-1 text-[11px] leading-relaxed text-violet-800">
            Bu sayfada aynı talep için tekrar gönderim kapatıldı. Ödeyen kişinin
            sayfası bu ödemeyi otomatik olarak öğrenmez; ona bilgi vermen
            gerekir.
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

      <p aria-live="polite" className="sr-only">
        {status === "estimating"
          ? "İşlem tahmini alınıyor."
          : status === "verifying"
            ? "Talep ve kur yeniden doğrulanıyor."
            : status === "sending"
              ? "İşlem cüzdanda bekleniyor."
              : transaction !== null
                ? "Ödeme gönderildi."
                : errorMessage !== null
                  ? errorMessage
                  : ""}
      </p>

      <p className="border-t border-slate-100 pt-4 text-[11px] leading-relaxed text-slate-400">
        Test USDC için{" "}
        <a href={ARC_TESTNET_FAUCET_URL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
          Circle Faucet
        </a>
        , ağ kurulumu için{" "}
        <a href={ARC_TESTNET_DOCS_URL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
          Arc dokümanı
        </a>
        . Bu bağlantı teknik olarak tekrar açılabilir; aynı borcun ikinci kez
        ödenmesini engelleyen bir sunucu veya zincir üstü kayıt yoktur.
      </p>
    </section>
  );
}

const cardClass =
  "flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-card sm:p-5";

function formatTry(minor: string): string {
  const value = BigInt(minor);
  const whole = value / BigInt(100);
  const fraction = (value % BigInt(100)).toString().padStart(2, "0");
  return `₺${whole.toString()},${fraction}`;
}


/**
 * Adresin TAMAMINI inceleme ve kopyalama. Kısaltılmış gösterim baştaki ve
 * sondaki birkaç karakteri eşleştiren sahte adresleri ayırt etmeye yetmez;
 * karşılaştırma her zaman tam adres üzerinden yapılabilmelidir.
 */
function AddressDisclosure({
  title,
  address,
}: {
  title: string;
  address: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      /*
       * Pano yazma güvensiz bağlamda veya izin politikası altında reddedilebilir.
       * Kullanıcı hiçbir şey olmayan bir düğmeyle baş başa bırakılmaz: adres
       * zaten seçilebilir metin olarak ekranda duruyor, bunu söyleriz.
       */
      setCopyState("failed");
    }
  };

  return (
    <details className="rounded-2xl border border-slate-200 px-3 py-2 text-xs">
      <summary className="cursor-pointer text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500">
        {title}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <code className="block overflow-x-auto break-all rounded-xl bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-800">
          {address}
        </code>
        <button
          type="button"
          onClick={copy}
          className="self-start rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
        >
          {copyState === "copied" ? "Kopyalandı" : "Adresi kopyala"}
        </button>
        <p aria-live="polite" className="text-[11px] text-slate-500">
          {copyState === "copied"
            ? "Adres panoya kopyalandı."
            : copyState === "failed"
              ? "Tarayıcı pano erişimine izin vermedi. Adresi yukarıdan seçip elle kopyalayabilirsin."
              : ""}
        </p>
      </div>
    </details>
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
