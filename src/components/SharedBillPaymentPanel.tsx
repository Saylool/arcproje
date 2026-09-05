"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ARC_TESTNET_FAUCET_URL,
  buildArcExplorerTxUrl,
  isArcTestnet,
} from "@/lib/arc/network";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import { estimateArcSend, sendArcUsdc } from "@/lib/arc/send";
import {
  RECONCILE_MAX_ATTEMPTS,
  RECONCILE_POLL_INTERVAL_MS,
  buildOfferSnapshot,
  claimPayment,
  decidePaymentResume,
  finalizePayment,
  readPaymentStatus,
  readPaymentStatusReport,
  outcomeForSendFailure,
  readFinalizeReport,
  reportOutcome,
  requestPaymentOffer,
  verifyClaimedSnapshot,
  verifyPaymentOffer,
  type ClientOutcome,
  type VerifiedOffer,
} from "@/lib/arc/shared-bill-payment-client";
import type { VerifiedView } from "@/lib/arc/shared-bill-access-client";
import { formatMinorUnitsAsTry } from "@/lib/arc/minor-units";
import { useTranslator } from "@/lib/i18n/context";
import { formatTime, formatUsdcAmount } from "@/lib/i18n/format";
import {
  messageApi,
  messageKey,
  resolveMessage,
  type MessageDescriptor,
} from "@/lib/i18n/messages";

/**
 * ORTAK HESAP — BORÇLUNUN ÖDEME PANELİ.
 *
 * SIRA DEĞİŞMEZ: taze teklif → BAĞIMSIZ doğrulama → tahmin → İNCELEME →
 * KULLANICININ AÇIK TIKLAMASI → sunucu rezervasyonu → rezervasyonun
 * incelenenle BİREBİR karşılaştırılması → gönderim sınırı → "doğrulanıyor" →
 * SUNUCU MUTABAKATI → ancak o zaman "ödendi".
 *
 * CÜZDAN YALNIZCA KULLANICININ TIKLAMASIYLA AÇILIR. Alıcı, borçlunun
 * transferini ne başlatabilir ne onaylayabilir; erişim imzası bir ÖDEME ONAYI
 * DEĞİLDİR ve hiçbir token yetkisi vermez.
 *
 * "ÖDENDİ" ETİKETİ YALNIZCA SUNUCU MAKBUZU DOĞRULADIKTAN SONRA görünür.
 * Tarayıcının ya da App Kit'in başarı bildirmesi tek başına yeterli değildir.
 *
 * `localStorage` YETKİLİ DURUM OLARAK KULLANILMAZ: ortak hesapta tek doğru
 * kaynak sunucudur.
 */

type Props = {
  billId: string;
  view: VerifiedView;
  walletUuid: string;
  account: string;
  chainId: number | null;
};

/*
 * Adim, not ve hata metinleri durumda TARIF olarak tutulur (bkz.
 * `@/lib/i18n/messages`): dil degistiginde ekrandaki cumle de degisir.
 */
type Phase =
  | { status: "idle" }
  | { status: "working"; step: MessageDescriptor }
  /** Teklif alındı ve doğrulandı; tahmin henüz yok. */
  | { status: "offered"; offer: VerifiedOffer }
  /** Tahmin alındı; kullanıcının AÇIK onayı bekleniyor. */
  | { status: "reviewed"; offer: VerifiedOffer; fee: string | null }
  /** İşlem cüzdana gitti; SUNUCU mutabakatı sürüyor. */
  | {
      status: "confirming";
      txHash: string | null;
      explorerUrl: string | null;
      note: MessageDescriptor;
    }
  /** SUNUCU makbuzu doğruladı. */
  | { status: "paid"; txHash: string | null; explorerUrl: string | null }
  /** Elle mutabakat gerekiyor; OTOMATİK TEKRAR YOK. */
  | {
      status: "blocked";
      message: MessageDescriptor;
      txHash: string | null;
      explorerUrl: string | null;
    }
  | { status: "error"; message: MessageDescriptor };

const CARD = "flex flex-col gap-3 border-t border-line-soft pt-4";
const LINK =
  "underline underline-offset-2 hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const NOTE =
  "rounded-2xl border border-warn-line bg-warn-surface px-3 py-2.5 text-xs leading-relaxed text-warn-ink";

export function SharedBillPaymentPanel({
  billId,
  view,
  walletUuid,
  account,
  chainId,
}: Props) {
  const { t, locale } = useTranslator();
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  /** Yoklama döngüsü bileşen sökülünce durur. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const onArc = isArcTestnet(chainId);

  /*
   * HESAP, AĞ veya BORÇ değişirse İNCELEME TAMAMEN ATILIR.
   *
   * Bu sıfırlama bir efektle değil, EBEVEYNİN verdiği `key` ile yapılır:
   * bağlam değişince bileşen SÖKÜLÜP yeniden kurulur ve içeride hiçbir eski
   * teklif, tahmin ya da rezervasyon izi kalmaz. Eski bir tahmin yeni bir
   * bağlam için onay sayılamaz.
   */

  const labels = useMemo(
    () => ({
      debtKey: view.debt.debtKey,
      debtorLabel: view.debt.debtorLabel,
      recipientLabel: view.recipient.label,
    }),
    [view],
  );

  /** Bileşen sökülmüşse hiçbir durum yazılmaz. */
  const commit = useCallback((next: Phase) => {
    if (alive.current) setPhase(next);
  }, []);

  /**
   * ÖDENDİ demenin TEK yeri.
   *
   * İki yol buraya çıkar: mutabakat makbuzu doğruladığında, ve sayfa yeniden
   * yüklendiğinde sunucu zaten ödendiğini bildirdiğinde. İkisi de SUNUCU
   * kaynaklıdır; istemci kendi başına "ödendi" diyemez. Tek kapı olması bunu
   * kaynakta da denetlenebilir kılar.
   */
  const markPaid = useCallback(
    (txHash: string | null, explorerUrl: string | null) => {
      commit({ status: "paid", txHash, explorerUrl });
    },
    [commit],
  );

  /*
   * -------------------------------------------------------------------------
   * 1) TAZE TEKLİF
   * -------------------------------------------------------------------------
   */
  const requestOffer = async () => {
    commit({ status: "working", step: messageKey("sharedPay.stepRate") });
    const fetched = await requestPaymentOffer(billId);
    if (!fetched.ok) {
      // Sunucunun hazir metni degil, KARARLI KODU gosterilir.
      commit({ status: "error", message: messageApi(fetched.code) });
      return;
    }
    // SUNUCUYA GÜVENİLMEZ: her ekonomik alan burada yeniden doğrulanır.
    const verified = verifyPaymentOffer({
      payload: fetched.value,
      connectedAddress: account,
      connectedChainId: chainId,
      billId,
      verifiedRecipient: view.recipient.address,
      verifiedTryMinor: view.debt.tryMinor,
      nowMs: Date.now(),
    });
    if (!verified.ok) {
      commit({
        status: "error",
        message: messageKey(`errors.offer.${verified.problem}`),
      });
      return;
    }
    commit({ status: "offered", offer: verified.offer });
  };

  /*
   * -------------------------------------------------------------------------
   * 2) TAHMİN — REZERVE ETMEZ, ÖDEME YAPMAZ
   * -------------------------------------------------------------------------
   */
  const estimate = async (offer: VerifiedOffer) => {
    commit({ status: "working", step: messageKey("sharedPay.stepEstimate") });
    const snapshot = buildOfferSnapshot(offer, labels);
    const result = await estimateArcSend(walletUuid, snapshot);
    if (!result.ok) {
      commit({
        status: "error",
        message: messageKey(`errors.send.${result.code}`),
      });
      return;
    }
    commit({ status: "reviewed", offer, fee: result.value.summary });
  };

  /*
   * -------------------------------------------------------------------------
   * 3) SUNUCU MUTABAKATI — SINIRLI yoklama
   * -------------------------------------------------------------------------
   */
  const reconcile = useCallback(
    async (attemptId: string, txHash: string) => {
      const explorerUrl = buildArcExplorerTxUrl(txHash);
      for (let attempt = 0; attempt < RECONCILE_MAX_ATTEMPTS; attempt += 1) {
        if (!alive.current) return;
        const response = await finalizePayment(billId, { attemptId, txHash });
        if (!response.ok) {
          commit({
            status: "blocked",
            message: messageApi(response.code),
            txHash,
            explorerUrl,
          });
          return;
        }
        const report = readFinalizeReport(response.value);
        if (report === null) {
          commit({
            status: "blocked",
            message: messageKey("sharedPay.unexpectedReconcile"),
            txHash,
            explorerUrl,
          });
          return;
        }

        if (report.state === "confirmed") {
          // Sunucu makbuzu doğruladı.
          markPaid(report.txHash ?? txHash, report.explorerUrl ?? explorerUrl);
          return;
        }
        if (report.state === "reverted") {
          commit({
            status: "blocked",
            message: messageKey("sharedPay.reverted"),
            txHash: report.txHash ?? txHash,
            explorerUrl: report.explorerUrl ?? explorerUrl,
          });
          return;
        }
        if (report.state === "review_required") {
          commit({
            status: "blocked",
            message: messageKey("sharedPay.reviewRequired"),
            txHash: report.txHash ?? txHash,
            explorerUrl: report.explorerUrl ?? explorerUrl,
          });
          return;
        }

        // 'pending' veya 'unavailable': beklemeye devam.
        commit({
          status: "confirming",
          txHash,
          explorerUrl,
          note:
            report.state === "unavailable"
              ? messageKey("sharedPay.noteNetworkRetry")
              : messageKey("sharedPay.noteWaitingConfirmations", {
                  seen: report.confirmations ?? 0,
                  required: report.requiredConfirmations,
                }),
        });
        await new Promise((resolve) =>
          setTimeout(resolve, RECONCILE_POLL_INTERVAL_MS),
        );
      }

      // YOKLAMA SINIRI DOLDU. Ödendi denmez; kilit korunur.
      commit({
        status: "blocked",
        message: messageKey("sharedPay.reconcileTimeout"),
        txHash,
        explorerUrl,
      });
    },
    [billId, commit, markPaid],
  );

  /*
   * -------------------------------------------------------------------------
   * AÇILIŞTA KURTARMA
   * -------------------------------------------------------------------------
   *
   * Transfer zincire yazıldıktan sonra sunucuya haber verme işi tarayıcıda
   * çalışır. Mobilde cüzdana geçildiğinde Android sayfayı bellekten ATABİLİR;
   * geri dönüldüğünde sayfa sıfırdan yüklenir ve o haber verme hiç tamamlanmaz.
   * Sonuç: PARA GİTMİŞ ama kayıt DÜŞMEMİŞ olur.
   *
   * Bu yüzden açılışta sunucuya durum sorulur. Ödendiği biliniyorsa öyle
   * gösterilir; zincire yazılmış ama doğrulanmamış bir deneme varsa mutabakat
   * KALDIĞI YERDEN sürdürülür.
   *
   * Yalnızca boştayken çalışır: kullanıcı bu sırada yeni bir ödemeye
   * başladıysa onun akışı bozulmaz.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await readPaymentStatus(billId);
      if (cancelled || !alive.current || !response.ok) {
        return;
      }
      const status = readPaymentStatusReport(response.value);
      if (status === null) {
        return;
      }
      const resume = decidePaymentResume(status);
      if (resume.kind === "none") {
        return;
      }
      /*
       * SÜREN bir ödemenin üstüne yazılmaz: kullanıcı bu sırada yeni bir
       * ödemeye başladıysa onun akışı bozulmamalı.
       */
      let idle = false;
      setPhase((current) => {
        idle = current.status === "idle";
        return current;
      });
      if (!idle) {
        return;
      }

      if (resume.kind === "paid") {
        markPaid(resume.txHash, resume.explorerUrl);
        return;
      }
      commit({
        status: "confirming",
        txHash: resume.txHash,
        explorerUrl: buildArcExplorerTxUrl(resume.txHash),
        note: messageKey("sharedPay.noteNetworkRetry"),
      });
      await reconcile(resume.attemptId, resume.txHash);
    })();
    return () => {
      cancelled = true;
    };
  }, [billId, commit, markPaid, reconcile]);

  /** Sonucu sunucuya bildirir; "başarılı" İDDİA EDİLEMEZ. */
  const report = useCallback(
    async (attemptId: string, outcome: ClientOutcome, txHash: string | null) => {
      await reportOutcome(billId, { attemptId, outcome, txHash });
    },
    [billId],
  );

  /*
   * -------------------------------------------------------------------------
   * 4) ÖDEME — YALNIZCA KULLANICININ AÇIK TIKLAMASIYLA
   * -------------------------------------------------------------------------
   */
  const pay = async (offer: VerifiedOffer) => {
    // Gönderimden HEMEN ÖNCE hesap ve ağ yeniden ölçülür.
    if (!onArc) {
      commit({
        status: "error",
        message: messageKey("sharedPay.notOnArcNotSent"),
      });
      return;
    }

    commit({ status: "working", step: messageKey("sharedPay.stepReserve") });
    const claimed = await claimPayment(billId, offer.offerId);
    if (!claimed.ok) {
      // Rezervasyon yapılamadı: CÜZDAN HİÇ AÇILMADI.
      commit({ status: "error", message: messageApi(claimed.code) });
      return;
    }

    /*
     * REZERVASYON İNCELENENLE BİREBİR EŞLEŞMELİ. Tek bir alan bile farklıysa
     * gönderim YAPILMAZ ve inceleme geçersiz kılınır.
     */
    const checked = verifyClaimedSnapshot({
      payload: claimed.value,
      reviewed: offer,
      connectedAddress: account,
      connectedChainId: chainId,
      nowMs: Date.now(),
    });
    if (!checked.ok) {
      const attemptId =
        typeof (claimed.value as { attemptId?: unknown })?.attemptId === "string"
          ? ((claimed.value as { attemptId: string }).attemptId)
          : null;
      if (attemptId !== null) {
        // `kit.send` HİÇ çağrılmadı: rezervasyon güvenle serbest bırakılır.
        await report(attemptId, "preflightFailed", null);
      }
      commit({
        status: "error",
        message: messageKey(`errors.claim.${checked.problem}`),
      });
      return;
    }
    const { attemptId, snapshot } = checked.claim;

    commit({ status: "working", step: messageKey("sharedPay.stepWalletConfirm") });
    const sent = await sendArcUsdc(walletUuid, snapshot);

    if (sent.ok) {
      /*
       * App Kit başarı dedi. BU BİR KANIT DEĞİLDİR: durum "doğrulanıyor"
       * olarak gösterilir ve gerçek karar sunucunun makbuz doğrulamasıdır.
       */
      commit({
        status: "confirming",
        txHash: sent.value.txHash,
        explorerUrl: sent.value.explorerUrl,
        note: messageKey("sharedPay.noteSubmitted"),
      });
      await report(attemptId, "submitted", sent.value.txHash);
      await reconcile(attemptId, sent.value.txHash);
      return;
    }

    /*
     * HATA. Karar mevcut sınıflandırıcıya bırakılır; burada serbest metin
     * eşleştirilmez ve hiçbir kural yeniden yazılmaz.
     */
    const decision = outcomeForSendFailure(sent.code, sent.txHash ?? null);
    await report(attemptId, decision.outcome, decision.txHash);

    if (decision.outcome === "submitted" && decision.txHash !== null) {
      commit({
        status: "confirming",
        txHash: decision.txHash,
        explorerUrl: sent.explorerUrl ?? buildArcExplorerTxUrl(decision.txHash),
        note: messageKey("sharedPay.noteAmbiguous"),
      });
      await reconcile(attemptId, decision.txHash);
      return;
    }
    if (decision.outcome === "ambiguous") {
      commit({
        status: "blocked",
        message: messageKey(`errors.send.${sent.code}`),
        txHash: sent.txHash ?? null,
        explorerUrl: sent.explorerUrl ?? null,
      });
      return;
    }

    /*
     * KANITLI yayın öncesi hata: rezervasyon serbest bırakıldı, kullanıcı
     * baştan başlayabilir. İnceleme, kalıcı hatalarda korunmaz.
     */
    /*
     * Her durumda İNCELEME BIRAKILIR: kullanıcı yeni bir TAZE kur teklifiyle
     * baştan başlar. Bayat bir teklifi elde tutup tekrar denemek, süresi
     * dolmuş bir kurla gönderim riski yaratırdı.
     */
    commit({ status: "error", message: messageKey(`errors.send.${sent.code}`) });
  };

  /*
   * -------------------------------------------------------------------------
   * GÖRÜNÜM
   * -------------------------------------------------------------------------
   */

  const testnetWarning = (
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
        className={LINK}
      >
        {t("common.faucet")}
      </a>
      .
    </p>
  );

  if (!onArc) {
    return (
      <div className={CARD}>
        <p className={NOTE}>
          {t("sharedPay.notOnArcPrefix")}
          <strong>{t("sharedPay.notOnArcNetwork")}</strong>
          {t("sharedPay.notOnArcSuffix")}
        </p>
      </div>
    );
  }

  return (
    <div className={CARD}>
      <h2 className="text-sm font-semibold text-ink">{t("sharedPay.payTitle")}</h2>

      {(phase.status === "idle" || phase.status === "error") && (
        <>
          {phase.status === "error" && (
            <p
              role="alert"
              className="rounded-2xl border border-danger-line bg-danger-surface px-3 py-2.5 text-xs leading-relaxed text-danger-ink"
            >
              {resolveMessage(locale, phase.message)}
            </p>
          )}
          <button
            type="button"
            onClick={requestOffer}
            className="self-start rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white min-h-11"
          >
            {t("sharedPay.getRate")}
          </button>
          {testnetWarning}
        </>
      )}

      {phase.status === "working" && (
        <p className="text-xs text-ink-soft">
          {resolveMessage(locale, phase.step)}
        </p>
      )}

      {(phase.status === "offered" || phase.status === "reviewed") && (
        <>
          <dl className="flex flex-col gap-1.5 rounded-2xl border border-line bg-muted px-3 py-2.5 text-xs text-ink-soft">
            <Row
              label={t("sharedPay.rowDebtTry")}
              // Gösterim de TAM SAYIDAN türer; `Number` kullanılmaz.
              value={
                formatMinorUnitsAsTry(phase.offer.tryMinor, locale) ??
                t("common.dash")
              }
            />
            <Row
              label={t("sharedPay.rowRate")}
              value={`${phase.offer.rateDisplay} TRY`}
            />
            <Row
              label={t("sharedPay.rowToSend")}
              /*
               * PROTOKOL metni (`displayAmount`) DEGISTIRILMEZ; gosterim
               * kanonik tam sayidan, dile gore yeniden turetilir. Turkcede
               * sonuc birebir aynidir.
               */
              value={`${formatUsdcAmount(BigInt(phase.offer.microUsdc), locale)} USDC`}
            />
            <Row
              label={t("sharedPay.rowRateExpires")}
              value={formatTime(phase.offer.expiresAt, locale)}
            />
            {phase.status === "reviewed" && phase.fee !== null && (
              <Row label={t("sharedPay.rowEstimatedFee")} value={phase.fee} />
            )}
          </dl>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-soft">
              {t("sharedPay.recipientAddressFull")}
            </span>
            <p className="break-all rounded-2xl border border-line bg-card px-3 py-2 font-mono text-[11px] text-ink-soft">
              {phase.offer.recipient}
            </p>
          </div>

          <p className="text-[11px] leading-relaxed text-ink-faint">
            {t("sharedPay.rateSourcePrefix")}
            <strong>{t("sharedPay.rateSourceName")}</strong>
            {t("sharedPay.rateSourceSuffix")}
          </p>

          {phase.status === "offered" ? (
            <button
              type="button"
              onClick={() => estimate(phase.offer)}
              className="self-start rounded-full border border-brand-line-soft bg-brand-soft px-4 py-2 text-sm font-semibold text-brand-ink min-h-11 inline-flex items-center"
            >
              {t("sharedPay.estimateButton")}
            </button>
          ) : (
            <>
              <p className={NOTE}>
                {t("sharedPay.reviewNoticePrefix")}
                <strong>{t("sharedPay.reviewNoticeOneByOne")}</strong>
                {t("sharedPay.reviewNoticeMiddle")}
                <strong>{t("sharedPay.reviewNoticeOnlyYou")}</strong>
                {t("sharedPay.reviewNoticeSuffix")}
              </p>
              <button
                type="button"
                onClick={() => pay(phase.offer)}
                className="self-start rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white min-h-11 inline-flex items-center"
              >
                {t("sharedPay.payWithArc")}
              </button>
            </>
          )}
          {testnetWarning}
        </>
      )}

      {phase.status === "confirming" && (
        <>
          <p
            role="status"
            className="rounded-2xl border border-info-line bg-info-surface px-3 py-2.5 text-xs leading-relaxed text-info-ink"
          >
            <strong>{t("sharedPay.confirmingStrong")}</strong>{" "}
            {resolveMessage(locale, phase.note)}
            {t("sharedPay.confirmingMiddle")}
            <strong>{t("sharedPay.confirmingNotDone")}</strong>.
          </p>
          <ExplorerLink explorerUrl={phase.explorerUrl} txHash={phase.txHash} />
        </>
      )}

      {phase.status === "paid" && (
        <>
          <p
            role="status"
            className="rounded-2xl border border-ok-line bg-ok-surface px-3 py-2.5 text-xs leading-relaxed text-ok-ink"
          >
            <strong>{t("sharedPay.paidStrong")}</strong>
            {t("sharedPay.paidRest")}
          </p>
          <ExplorerLink explorerUrl={phase.explorerUrl} txHash={phase.txHash} />
          {testnetWarning}
        </>
      )}

      {phase.status === "blocked" && (
        <>
          <p
            role="alert"
            className="rounded-2xl border border-warn-line-strong bg-warn-surface px-3 py-2.5 text-xs leading-relaxed text-warn-ink"
          >
            {resolveMessage(locale, phase.message)}
          </p>
          <ExplorerLink explorerUrl={phase.explorerUrl} txHash={phase.txHash} />
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

/** İşlem bağlantısı YALNIZCA doğrulanmış hash'ten kurulur. */
function ExplorerLink({
  explorerUrl,
  txHash,
}: {
  explorerUrl: string | null;
  txHash: string | null;
}) {
  const { t } = useTranslator();
  if (txHash === null) {
    return null;
  }
  const url = explorerUrl ?? buildArcExplorerTxUrl(txHash);
  return (
    <p className="break-all text-[11px] text-ink-faint">
      {t("common.transaction")}{" "}
      {url === null ? (
        <span className="font-mono">{txHash}</span>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className={LINK}>
          {t("common.viewOnArcScan")}
        </a>
      )}
    </p>
  );
}
