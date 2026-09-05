"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { shortenWalletAddress, walletAddressesEqual } from "@/lib/arc/address";
import { formatMicroUsdcAmount, formatMicroUsdcForDisplay } from "@/lib/arc/conversion";
import type { Locale } from "@/lib/i18n/locale";
import {
  ARC_TESTNET_DOCS_URL,
  ARC_TESTNET_FAUCET_URL,
  isArcTestnet,
} from "@/lib/arc/network";
import {
  extractQuoteFromPayload,
  type SignedPaymentRequest,
} from "@/lib/arc/payment-request";
import { useTranslator } from "@/lib/i18n/context";
import { formatDateTime, formatUsdcAmount } from "@/lib/i18n/format";
import {
  messageKey,
  messageRate,
  resolveMessage,
  type MessageDescriptor,
} from "@/lib/i18n/messages";
import { formatQuoteRate, type RateQuote } from "@/lib/rates/quote";
import { verifyQuoteWithServer } from "@/lib/rates/client";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import {
  REQUEST_QUERY_PARAM,
  codecProblemKey,
  decodeSignedRequest,
  type CodecProblem,
} from "@/lib/arc/request-codec";
import { verifyPaymentRequestSignature } from "@/lib/arc/request-signing";
import { createSingleFlight } from "@/lib/arc/single-flight";
import {
  clearReservation,
  readSubmissionView,
  recordSubmission,
  runExclusiveSubmission,
  subscribeToSubmissions,
  type SubmissionOutcome,
} from "@/lib/arc/submission-log";
import {
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
import { WalletConnectPanel } from "./WalletConnectPanel";
import {
  needsManualNetwork,
  switchFailureMessage,
} from "@/lib/arc/wallet-messages";
import { ArcNetworkParameters } from "./ArcNetworkParameters";

/**
 * Ödeme talebi ödeme sayfası — BORÇLU (gönderen) tarafı.
 *
 * Talep önce çözülür, şeması katı biçimde doğrulanır ve EIP-712 imzası
 * kontrol edilir. Doğrulama geçmeden hiçbir cüzdan veya ödeme kontrolü
 * gösterilmez. Gönderim anlık görüntüsü YALNIZCA imzalı talepten kurulur;
 * URL parametreleri veya form durumu kullanılmaz.
 */

/* Metinler durumda TARIF olarak tutulur; dil degisince cumle de degisir. */
type VerifyState =
  | { status: "loading" }
  | { status: "invalid"; message: MessageDescriptor }
  | { status: "valid"; request: SignedPaymentRequest; quote: RateQuote };

type FlowStatus =
  | "idle"
  | "estimating"
  | "review"
  | "verifying"
  | "sending"
  | "done";

const LINK_CLASS =
  "underline underline-offset-2 hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Çözücü sorununu ertelenmiş mesaja çevirir. */
function codecMessage(problem: CodecProblem): MessageDescriptor {
  return messageKey(codecProblemKey(problem));
}

/**
 * Dış kabuk: sorgu parametresini okur ve talebe ÖZEL oturumu `key` ile
 * bağlar.
 *
 * `key` değişince React iç bileşeni tamamen söker ve yeniden kurar. Böylece
 * A talebine ait durum, ref, kilit ve jetonların B talebine sızması yapısal
 * olarak imkânsızdır: geç dönen A sonuçları sökülmüş bir örneğe yazar ve
 * hiçbir etkisi olmaz.
 */
export function PaymentRequestPayer() {
  const searchParams = useSearchParams();
  const encoded = searchParams.get(REQUEST_QUERY_PARAM);
  return <RequestSession key={encoded ?? "__yok__"} encoded={encoded} />;
}

function RequestSession({ encoded }: { encoded: string | null }) {
  const { t, locale } = useTranslator();

  const [verifyState, setVerifyState] = useState<VerifyState>({ status: "loading" });

  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [walletsScanned, setWalletsScanned] = useState(false);
  const [selectedWalletUuid, setSelectedWalletUuid] = useState<string | null>(null);
  const [manualNetwork, setManualNetwork] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const [status, setStatus] = useState<FlowStatus>("idle");
  const [estimateSummary, setEstimateSummary] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMessage, setErrorMessage] =
    useState<MessageDescriptor | null>(null);
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
  /*
   * Zincire ulaşmış OLABİLECEK işlemin hash'i ve ArcScan bağlantısı.
   * Revert ve belirsiz sonucun İKİSİNDE de tutulur: mutabakatın tek ipucu.
   */
  /** Bazı hatalara "yeni bağlantı iste" ipucu eklenir. */
  const [needsNewLinkHint, setNeedsNewLinkHint] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);
  const [pendingTxUrl, setPendingTxUrl] = useState<string | null>(null);

  // Çöz + doğrula. Cüzdan kontrolleri ancak bu geçerse gösterilir.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (encoded === null || encoded === "") {
        if (!cancelled) {
          setVerifyState({
            status: "invalid",
            message: messageKey("payer.noRequestInLink"),
          });
        }
        return;
      }

      const decoded = decodeSignedRequest(encoded, Date.now());
      if (!decoded.ok) {
        if (!cancelled) {
          setVerifyState({
            status: "invalid",
            message: codecMessage(decoded.problem),
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
          message: messageKey(
            verified.reason === "signerMismatch"
              ? "payer.signerMismatch"
              : "payer.signatureUnverified",
          ),
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
        fetch,
        locale,
      );
      if (cancelled) {
        return;
      }
      if (!quoteCheck.ok) {
        setVerifyState({
          status: "invalid",
          message: messageRate(quoteCheck.code),
        });
        return;
      }
      setVerifyState({ status: "valid", request: decoded.request, quote });
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [encoded, locale]);

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
      // İmzalı gövde zaten KANONİK ondalık metin taşır; `number`a indirilmez.
      tryMinor: request.payload.tryMinor,
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
   *
   * Sayfa yenilendiğinde veya bileşen yeniden kurulduğunda mutabakat için
   * gereken işlem hash'i de DEPODAN geri yüklenir; aksi hâlde ArcScan
   * bağlantısı yalnızca gönderimin yapıldığı sekme ömrü boyunca görünürdü.
   */
  useEffect(() => {
    if (snapshot === null) {
      return;
    }
    let cancelled = false;
    const sync = () => {
      // Kayıt YOKSA da açıkça temizlenir: eski talebin izi kalmaz.
      const view = readSubmissionView(snapshot.chainId, snapshot.requestId);
      const prior = view?.outcome ?? null;
      if (!cancelled) {
        setPriorSubmission(prior);
        setPendingTxHash(view?.txHash ?? null);
        setPendingTxUrl(view?.explorerUrl ?? null);
      }
    };
    const run = async () => sync();
    void run();
    // Başka bir sekmede aynı talep gönderilirse burada da kilitlenir.
    const unsubscribe = subscribeToSubmissions(sync);
    return () => {
      cancelled = true;
      unsubscribe();
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
    setStatus("idle");
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
  const dropReview = (message: MessageDescriptor) => {
    setNeedsNewLinkHint(false);
    setErrorMessage(message);
    setEstimateSummary(null);
    setConfirmed(false);
    setStatus("idle");
  };

  /** Yeniden denenebilir hatada incelemeye dönülür. */
  const backToReview = (message: MessageDescriptor) => {
    setNeedsNewLinkHint(false);
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
          dropReview(codecMessage(fresh.problem));
          setNeedsNewLinkHint(true);
          return;
        }
      }
      // Sayfa açıkken süresi dolan bir kur tahmine giremez.
      const quoteBeforeEstimate = await verifyQuoteWithServer(
        extractQuoteFromPayload(request.payload),
        request.payload.quoteTag,
        fetch,
        locale,
      );
      if (isStale()) {
        return;
      }
      if (!quoteBeforeEstimate.ok) {
        dropReview(messageRate(quoteBeforeEstimate.code));
        return;
      }

      const outcome = await estimateArcSend(selectedWalletUuid, snapshot);
      if (isStale()) {
        // Geç dönen sonuç daha YENİ durumun üzerine yazılmaz.
        return;
      }
      if (!outcome.ok) {
        setErrorMessage(messageKey(`errors.send.${outcome.code}`));
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
        dropReview(messageKey("payer.noRequestInLink"));
        return;
      }
      const fresh = decodeSignedRequest(encoded, Date.now());
      if (!fresh.ok) {
        dropReview(codecMessage(fresh.problem));
        setNeedsNewLinkHint(true);
        return;
      }
      const reverified = await verifyPaymentRequestSignature(fresh.request);
      if (!reverified.ok) {
        dropReview(messageKey("payer.reverifyFailed"));
        return;
      }
      if (fresh.request.payload.requestId !== snapshot.requestId) {
        dropReview(messageKey("payer.differentRequest"));
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
        fetch,
        locale,
      );
      if (!quoteBeforeSend.ok) {
        dropReview(messageRate(quoteBeforeSend.code));
        return;
      }

      setStatus("sending");

      /*
       * Rezervasyon ve `kit.send` TEK BİR exclusive Web Lock içinde çalışır.
       * `localStorage` tek başına atomik değildir: iki sekme aynı anda okuyup
       * aynı anda yazabilir. Kilit yoksa, kilit doluysa veya rezervasyon
       * yazılamıyorsa gönderim HİÇ başlatılmaz (fail-closed).
       */
      const guarded = await runExclusiveSubmission(
        snapshot.chainId,
        snapshot.requestId,
        () => sendArcUsdc(selectedWalletUuid, snapshot),
      );
      if (!guarded.ok) {
        keepLocked = true;
        if (guarded.reason === "unavailable") {
          // Tarayıcı güvenli gönderimi sağlayamıyor: hiçbir şey gönderilmedi.
          dropReview(messageKey("errors.submissionUnavailable"));
          return;
        }
        if (guarded.reason === "busy") {
          dropReview(messageKey("payer.otherTabSending"));
          return;
        }
        setPriorSubmission(guarded.existing);
        dropReview(
          messageKey(
            guarded.existing === "pending"
              ? "payer.otherTabSending"
              : guarded.existing === "success"
                ? "payer.alreadySucceeded"
                : "payer.unverifiedSubmission",
          ),
        );
        return;
      }
      setPriorSubmission("pending");
      const outcome = guarded.value;
      if (!outcome.ok) {
        const message = messageKey(`errors.send.${outcome.code}`);
        if (keepsSubmissionLocked(outcome.code)) {
          /*
           * kit.send ÇAĞRILDI ve sonuç belirsiz veya işlem revert etti.
           * Rezervasyon KORUNUR ve kilit AÇILMAZ; kullanıcı önce cüzdanını ve
           * ArcScan'i kontrol etmelidir.
           */
          /*
           * Revert ve belirsizlik AYRI kaydedilir: revert zincire ulaşıp
           * başarısız oldu, belirsizlikte sonuç hiç bilinmiyor. İkisi de
           * "ödendi" DEĞİLDİR ve ikisi de gönderimi kilitli tutar.
           */
          const persisted: SubmissionOutcome =
            outcome.code === "reverted" ? "reverted" : "unknown";
          // Hash hem revert hem belirsizlikte KALICI olarak saklanır.
          recordSubmission(snapshot.chainId, snapshot.requestId, persisted, {
            txHash: outcome.txHash ?? null,
          });
          setPriorSubmission(persisted);
          setPendingTxHash(outcome.txHash ?? null);
          setPendingTxUrl(outcome.explorerUrl ?? null);
          keepLocked = true;
          dropReview(message);
          return;
        }

        /*
         * Buraya düşen hatalar yayın ÖNCESİ olduğu kanıtlanmış olanlardır
         * (doğrulama, preflight, süre, cüzdan reddi). Rezervasyon serbest
         * bırakılır ki kullanıcı düzeltip tekrar deneyebilsin.
         */
        clearReservation(snapshot.chainId, snapshot.requestId);
        setPriorSubmission(null);
        setPendingTxHash(null);
        setPendingTxUrl(null);

        // Geçerlilik penceresi kapandıysa aynı talep bir daha gönderilemez:
        // kurulu bir onay düğmesi ekranda bırakılmaz.
        if (reviewStateAfterSendFailure(outcome.code) === "leaveReview") {
          dropReview(message);
          return;
        }
        backToReview(message);
        return;
      }
      // Başarı hash'i de saklanır: yenilemeden sonra ArcScan bağlantısı kalır.
      recordSubmission(snapshot.chainId, snapshot.requestId, "success", {
        txHash: outcome.value.txHash,
      });
      setPriorSubmission("success");
      setPendingTxHash(outcome.value.txHash);
      setPendingTxUrl(outcome.value.explorerUrl);
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
      <section aria-label={t("payer.sectionLabel")} className={cardClass}>
        <p className="text-sm text-ink-faint">{t("payer.verifying")}</p>
      </section>
    );
  }

  if (verifyState.status === "invalid") {
    return (
      <section aria-label={t("payer.sectionLabel")} className={cardClass}>
        <h2 className="text-base font-semibold tracking-tight text-ink">
          {t("payer.invalidTitle")}
        </h2>
        <p
          role="alert"
          className="rounded-2xl border border-danger-line bg-danger-surface px-3 py-2.5 text-xs leading-relaxed text-danger-ink"
        >
          {resolveMessage(locale, verifyState.message)}
        </p>
        <p className="text-xs leading-relaxed text-ink-faint">
          {t("payer.invalidNotice")}
        </p>
      </section>
    );
  }

  const payload = verifyState.request.payload;
  const expiresText = formatDateTime(payload.expiresAt, locale);

  return (
    <section aria-label={t("payer.sectionLabel")} className={cardClass}>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-ink">
            {t("payer.title")}
          </h2>
          <span className="rounded-full bg-warn-surface-strong px-2 py-0.5 text-[10px] font-semibold text-warn-ink">
            {t("common.testNetworkBadge")}
          </span>
          <span className="rounded-full bg-brand-soft-strong px-2 py-0.5 text-[10px] font-semibold text-brand-ink">
            {t("payer.signatureVerifiedBadge")}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-ink-faint">
          {t("payer.signedByPrefix")}
          <span className="font-mono">
            {shortenWalletAddress(payload.recipient)}
          </span>
          {t("payer.signedBySuffix")}
          <strong className="font-semibold">
            {t("payer.signedByYouConfirm")}
          </strong>
          {t("payer.signedByEnd")}
        </p>
        <p className="rounded-2xl border border-warn-line bg-warn-surface px-3 py-2.5 text-[11px] leading-relaxed text-warn-ink">
          <strong className="font-semibold">
            {t("payer.labelsWarningStrong")}
          </strong>
          {/*
            Etiketler KULLANICI VERISIDIR ve cevrilmez; sablona yalnizca metin
            olarak yerlestirilir.
          */}
          {t("payer.labelsWarningMiddle", {
            recipient: payload.recipientLabel,
            debtor: payload.debtorLabel,
          })}
          <strong className="font-semibold">
            {t("payer.labelsWarningAddress")}
          </strong>
          {t("payer.labelsWarningAfterAddress")}
          <strong className="font-semibold">
            {t("payer.labelsWarningChannel")}
          </strong>
          {t("payer.labelsWarningEnd")}
        </p>
      </header>

      {/* Değiştirilemez inceleme */}
      <dl className="flex flex-col gap-1 rounded-2xl border border-line p-3 text-xs">
        <Row label={t("payer.rowDebtor")} value={payload.debtorLabel} />
        <Row
          label={t("payer.rowSenderAddress")}
          value={shortenWalletAddress(payload.debtor)}
        />
        <Row label={t("payer.rowPayer")} value={payload.recipientLabel} />
        <Row
          label={t("payer.rowRecipientAddress")}
          value={shortenWalletAddress(payload.recipient)}
        />
        <Row
          label={t("payer.rowDebtTry")}
          value={formatTry(payload.tryMinor, locale)}
        />
        <Row
          label={t("payer.rowRate")}
          value={`1 USDC = ${formatQuoteRate(verifyState.quote)} TRY`}
        />
        <Row label={t("payer.rowRateSource")} value={payload.quoteSource} />
        <Row
          label={t("payer.rowRateObservedAt")}
          value={formatDateTime(payload.quoteObservedAt, locale)}
        />
        <Row
          label={t("payer.rowRateValidity")}
          value={formatDateTime(payload.quoteExpiresAt, locale)}
        />
        <Row
          label={t("payer.rowToSend")}
          /* Gosterim kanonik tam sayidan turer; protokol metni degismez. */
          value={`${formatUsdcAmount(BigInt(payload.microUsdc), locale)} USDC`}
          strong
        />
        <Row
          label={t("payer.rowNetwork")}
          value={ACTIVE_NETWORK_PROFILE.displayName}
        />
        <Row label={t("payer.rowValidity")} value={expiresText} />
      </dl>
      <div className="flex flex-col gap-2">
        <AddressDisclosure
          title={t("payer.recipientDisclosure")}
          address={payload.recipient}
        />
        <AddressDisclosure
          title={t("payer.senderDisclosure")}
          address={payload.debtor}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-ink-faint">
        {t("payer.immutablePrefix")}
        <strong className="font-semibold">{t("payer.immutableStrong")}</strong>
        {t("payer.immutableSuffix")}
      </p>

      {/* Cüzdan */}
      <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {t("payer.connectHeading")}
        </h3>
        {!walletsScanned ? (
          <button
            type="button"
            onClick={scanWallets}
            disabled={busy}
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
                disabled={selectedWalletUuid === null || busy}
                className="rounded-full border border-line bg-card px-3.5 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 min-h-11"
              >
                {t("wallet.connectAccount")}
              </button>
              {account !== null && !onArc && (
                <button
                  type="button"
                  onClick={switchNetwork}
                  disabled={busy}
                  className="rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60 min-h-11"
                >
                  {t("wallet.switchToArc")}
                </button>
              )}
            </div>
            {manualNetwork && <ArcNetworkParameters />}
            {account !== null && (
              <p className="text-[11px] text-ink-faint">
                {t("wallet.connectedAccount")}{" "}
                <span className="font-mono">{shortenWalletAddress(account)}</span>
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
            {account !== null && !accountMatchesDebtor && (
              <p
                role="alert"
                className="rounded-2xl border border-warn-line bg-warn-surface px-3 py-2 text-[11px] leading-relaxed text-warn-ink"
              >
                {t("payer.debtorMismatch", { debtor: payload.debtorLabel })}
              </p>
            )}
          </div>
        )}
        {account === null && (
          <WalletConnectPanel onConnected={adoptWalletConnect} />
        )}
      </div>

      {priorSubmission !== null && transaction === null && (
        <p
          role="alert"
          className="rounded-2xl border border-warn-line bg-warn-surface px-3 py-2.5 text-xs leading-relaxed text-warn-ink"
        >
          {priorSubmission === "success"
            ? t("payer.priorSuccess")
            : priorSubmission === "pending"
              ? t("payer.priorPending")
              : priorSubmission === "reverted"
                ? t("payer.priorReverted")
                : t("payer.priorUnknown")}{" "}
          <strong className="font-semibold">{t("payer.priorLocalOnly")}</strong>
          {pendingTxHash !== null && (
            <>
              {" "}
              <span className="block pt-1 break-all font-mono text-[11px]">
                {pendingTxHash}
              </span>
            </>
          )}
          {pendingTxUrl !== null && (
            <>
              {" "}
              <a
                href={pendingTxUrl}
                target="_blank"
                rel="noreferrer"
                className={LINK_CLASS}
              >
                {t("common.openOnArcScan")}
              </a>
            </>
          )}
        </p>
      )}

      {/* Tahmin ve onay */}
      {!alreadyPaid && (
        <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
          <button
            type="button"
            onClick={estimate}
            disabled={!canEstimate}
            className="self-start rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 min-h-11"
          >
            {status === "estimating" ? t("payer.estimating") : t("payer.estimate")}
          </button>

          {estimateSummary !== null && status === "review" && (
            <p className="text-[11px] text-ink-faint">
              {t("payer.estimatedFee", { fee: estimateSummary })}
            </p>
          )}

          {status === "review" && (
            <div className="flex flex-col gap-2 rounded-2xl border border-brand-line-soft bg-brand-soft p-3">
              <label className="flex items-start gap-2 text-[11px] leading-relaxed text-brand-ink">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5 accent-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                />
                <span>{t("payer.confirmCheckbox")}</span>
              </label>
              <button
                type="button"
                onClick={submit}
                disabled={!confirmed || busy}
                className="self-start rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-disabled min-h-11"
              >
                {t("payer.confirmInWallet")}
              </button>
            </div>
          )}

          {status === "verifying" && (
            <p className="rounded-2xl bg-brand-soft px-3 py-2.5 text-xs text-brand-ink">
              {t("payer.reverifying")}
            </p>
          )}

          {status === "sending" && (
            <p className="rounded-2xl bg-brand-soft px-3 py-2.5 text-xs text-brand-ink">
              {t("payer.waitingWallet")}
            </p>
          )}
        </div>
      )}

      {transaction !== null && (
        <div className="flex flex-col gap-1 rounded-2xl border border-brand-line-soft bg-brand-soft p-3 text-xs text-brand-ink">
          <p className="font-semibold">
            {t("payer.sentAmount", {
              amount: formatUsdcAmount(
                BigInt(transaction.snapshot.microUsdc),
                locale,
              ),
            })}
          </p>
          <p className="break-all font-mono text-[11px]">{transaction.txHash}</p>
          {transaction.explorerUrl !== null && (
            <a
              href={transaction.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className={LINK_CLASS}
            >
              {t("common.showOnArcScan")}
            </a>
          )}
          <p className="mt-1 text-[11px] leading-relaxed text-brand-ink">
            {t("payer.sentNotice")}
          </p>
        </div>
      )}

      {errorMessage !== null && (
        <p
          role="alert"
          className="rounded-2xl border border-danger-line bg-danger-surface px-3 py-2.5 text-xs leading-relaxed text-danger-ink"
        >
          {resolveMessage(locale, errorMessage)}
          {needsNewLinkHint ? ` ${t("payer.askForNewLink")}` : ""}
        </p>
      )}

      <p aria-live="polite" className="sr-only">
        {status === "estimating"
          ? t("payer.liveEstimating")
          : status === "verifying"
            ? t("payer.liveVerifying")
            : status === "sending"
              ? t("payer.liveSending")
              : transaction !== null
                ? t("payer.liveSent")
                : errorMessage !== null
                  ? resolveMessage(locale, errorMessage)
                  : ""}
      </p>

      <p className="border-t border-line-soft pt-4 text-[11px] leading-relaxed text-ink-faint">
        {t("payer.footnotePrefix")}
        <a href={ARC_TESTNET_FAUCET_URL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
          {t("common.faucet")}
        </a>
        {t("payer.footnoteMiddle")}
        <a href={ARC_TESTNET_DOCS_URL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
          {t("common.arcDocs")}
        </a>
        {t("payer.footnoteSuffix")}
      </p>
    </section>
  );
}

const cardClass =
  "flex flex-col gap-4 rounded-3xl border border-line bg-card p-4 shadow-card sm:p-5";

/**
 * TRY gosterimi. Girdi KANONIK metindir ve `BigInt` ile islenir: kayan
 * noktaya HIC dusulmez. Yalnizca ondalik ayraci dile gore degisir; tutarin
 * kendisi degismez.
 */
function formatTry(minor: string, locale: Locale): string {
  const value = BigInt(minor);
  const whole = value / BigInt(100);
  const fraction = (value % BigInt(100)).toString().padStart(2, "0");
  const decimal = locale === "en" ? "." : ",";
  return `₺${whole.toString()}${decimal}${fraction}`;
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
  const { t } = useTranslator();
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
    <details className="rounded-2xl border border-line px-3 py-2 text-xs">
      <summary className="cursor-pointer text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        {title}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <code className="block overflow-x-auto break-all rounded-xl bg-muted px-2 py-1.5 font-mono text-[11px] text-ink">
          {address}
        </code>
        <button
          type="button"
          onClick={copy}
          className="self-start rounded-full border border-line bg-card px-3 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:border-brand-line hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-h-11"
        >
          {copyState === "copied" ? t("common.copied") : t("common.copyAddress")}
        </button>
        <p aria-live="polite" className="text-[11px] text-ink-faint">
          {copyState === "copied"
            ? t("common.addressCopied")
            : copyState === "failed"
              ? t("common.addressCopyFailed")
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
