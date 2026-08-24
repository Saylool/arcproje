"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ARC_TESTNET_FAUCET_URL,
  buildArcExplorerTxUrl,
  isArcTestnet,
} from "@/lib/arc/network";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import {
  describeArcSendError,
  estimateArcSend,
  sendArcUsdc,
} from "@/lib/arc/send";
import {
  RECONCILE_MAX_ATTEMPTS,
  RECONCILE_POLL_INTERVAL_MS,
  buildOfferSnapshot,
  claimPayment,
  describeClaimProblem,
  describeOfferProblem,
  finalizePayment,
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

type Phase =
  | { status: "idle" }
  | { status: "working"; step: string }
  /** Teklif alındı ve doğrulandı; tahmin henüz yok. */
  | { status: "offered"; offer: VerifiedOffer }
  /** Tahmin alındı; kullanıcının AÇIK onayı bekleniyor. */
  | { status: "reviewed"; offer: VerifiedOffer; fee: string | null }
  /** İşlem cüzdana gitti; SUNUCU mutabakatı sürüyor. */
  | {
      status: "confirming";
      txHash: string | null;
      explorerUrl: string | null;
      note: string;
    }
  /** SUNUCU makbuzu doğruladı. */
  | { status: "paid"; txHash: string | null; explorerUrl: string | null }
  /** Elle mutabakat gerekiyor; OTOMATİK TEKRAR YOK. */
  | {
      status: "blocked";
      message: string;
      txHash: string | null;
      explorerUrl: string | null;
    }
  | { status: "error"; message: string };

const CARD = "flex flex-col gap-3 border-t border-slate-100 pt-4";
const LINK =
  "underline underline-offset-2 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500";
const NOTE =
  "rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900";

export function SharedBillPaymentPanel({
  billId,
  view,
  walletUuid,
  account,
  chainId,
}: Props) {
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

  /*
   * -------------------------------------------------------------------------
   * 1) TAZE TEKLİF
   * -------------------------------------------------------------------------
   */
  const requestOffer = async () => {
    commit({ status: "working", step: "Güncel kur alınıyor…" });
    const fetched = await requestPaymentOffer(billId);
    if (!fetched.ok) {
      commit({ status: "error", message: fetched.message });
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
        message: describeOfferProblem(verified.problem),
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
    commit({ status: "working", step: "İşlem tahmini alınıyor…" });
    const snapshot = buildOfferSnapshot(offer, labels);
    const result = await estimateArcSend(walletUuid, snapshot);
    if (!result.ok) {
      commit({
        status: "error",
        message: describeArcSendError(result.code),
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
            message: response.message,
            txHash,
            explorerUrl,
          });
          return;
        }
        const report = readFinalizeReport(response.value);
        if (report === null) {
          commit({
            status: "blocked",
            message:
              "Sunucudan beklenmeyen bir mutabakat yanıtı geldi. İşlemi ArcScan'de kontrol et.",
            txHash,
            explorerUrl,
          });
          return;
        }

        if (report.state === "confirmed") {
          // ÖDENDİ ancak BURADA söylenir: sunucu makbuzu doğruladı.
          commit({
            status: "paid",
            txHash: report.txHash ?? txHash,
            explorerUrl: report.explorerUrl ?? explorerUrl,
          });
          return;
        }
        if (report.state === "reverted") {
          commit({
            status: "blocked",
            message:
              "İşlem zincire ulaştı ama BAŞARISIZ oldu (revert). Ödeme yapılmadı; gas harcanmış olabilir. Ayrıntıyı ArcScan'de gör.",
            txHash: report.txHash ?? txHash,
            explorerUrl: report.explorerUrl ?? explorerUrl,
          });
          return;
        }
        if (report.state === "review_required") {
          commit({
            status: "blocked",
            message:
              "İşlem doğrulandı ama BEKLENEN transferi kanıtlamıyor (tutar, taraf veya token uyuşmuyor). Borç ödenmiş SAYILMADI ve otomatik tekrar KAPALIDIR. ArcScan'den kontrol edip hesabı oluşturan kişiyle görüş.",
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
              ? "Ağ yanıtı alınamadı; yeniden deneniyor…"
              : `Zincirde onay bekleniyor (${report.confirmations ?? 0}/${report.requiredConfirmations})…`,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, RECONCILE_POLL_INTERVAL_MS),
        );
      }

      // YOKLAMA SINIRI DOLDU. Ödendi denmez; kilit korunur.
      commit({
        status: "blocked",
        message:
          "İşlemin sonucu ayrılan sürede doğrulanamadı. TEKRAR DENEME: aynı ödeme iki kez gidebilir. Aşağıdaki bağlantıdan ArcScan'de kontrol et; daha sonra bu sayfayı yenileyip durumu yeniden sorgulayabilirsin.",
        txHash,
        explorerUrl,
      });
    },
    [billId, commit],
  );

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
        message: "Cüzdan Arc Testnet'te değil. Gönderim başlatılmadı.",
      });
      return;
    }

    commit({ status: "working", step: "Ödeme rezerve ediliyor…" });
    const claimed = await claimPayment(billId, offer.offerId);
    if (!claimed.ok) {
      // Rezervasyon yapılamadı: CÜZDAN HİÇ AÇILMADI.
      commit({ status: "error", message: claimed.message });
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
        message: describeClaimProblem(checked.problem),
      });
      return;
    }
    const { attemptId, snapshot } = checked.claim;

    commit({ status: "working", step: "Cüzdanda onay bekleniyor…" });
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
        note: "İşlem gönderildi; sunucu zincirden doğruluyor…",
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
        note: "Sonuç belirsiz; sunucu zincirden doğruluyor…",
      });
      await reconcile(attemptId, decision.txHash);
      return;
    }
    if (decision.outcome === "ambiguous") {
      commit({
        status: "blocked",
        message: describeArcSendError(sent.code),
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
    commit({ status: "error", message: describeArcSendError(sent.code) });
  };

  /*
   * -------------------------------------------------------------------------
   * GÖRÜNÜM
   * -------------------------------------------------------------------------
   */

  const testnetWarning = (
    <p className="text-xs leading-relaxed text-slate-500">
      Ağ: <strong>{ACTIVE_NETWORK_PROFILE.displayName}</strong>. Test
      USDC&apos;sinin <strong>gerçek parasal değeri yoktur</strong>. Test parası
      için{" "}
      <a
        href={ARC_TESTNET_FAUCET_URL}
        target="_blank"
        rel="noreferrer"
        className={LINK}
      >
        Circle Faucet
      </a>
      .
    </p>
  );

  if (!onArc) {
    return (
      <div className={CARD}>
        <p className={NOTE}>
          Ödeme için cüzdanın <strong>Arc Testnet</strong> ağında olmalı.
        </p>
      </div>
    );
  }

  return (
    <div className={CARD}>
      <h2 className="text-sm font-semibold text-slate-800">Borcunu öde</h2>

      {(phase.status === "idle" || phase.status === "error") && (
        <>
          {phase.status === "error" && (
            <p
              role="alert"
              className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700"
            >
              {phase.message}
            </p>
          )}
          <button
            type="button"
            onClick={requestOffer}
            className="self-start rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white"
          >
            Güncel kuru al
          </button>
          {testnetWarning}
        </>
      )}

      {phase.status === "working" && (
        <p className="text-xs text-slate-600">{phase.step}</p>
      )}

      {(phase.status === "offered" || phase.status === "reviewed") && (
        <>
          <dl className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
            <Row
              label="Borç (TRY)"
              // Gösterim de TAM SAYIDAN türer; `Number` kullanılmaz.
              value={formatMinorUnitsAsTry(phase.offer.tryMinor) ?? "—"}
            />
            <Row
              label="Kur (1 USDC)"
              value={`${phase.offer.rateDisplay} TRY`}
            />
            <Row
              label="Gönderilecek"
              value={`${phase.offer.displayAmount} USDC`}
            />
            <Row
              label="Kur teklifi biter"
              value={new Date(phase.offer.expiresAt * 1000).toLocaleTimeString(
                "tr-TR",
              )}
            />
            {phase.status === "reviewed" && phase.fee !== null && (
              <Row label="Tahmini ücret" value={phase.fee} />
            )}
          </dl>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-700">
              Alıcı cüzdan adresi (tam)
            </span>
            <p className="break-all rounded-2xl border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-700">
              {phase.offer.recipient}
            </p>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            Kur kaynağı: <strong>CoinGecko</strong> (sunucu tarafından
            doğrulanmış teklif). Tutar, borcun ve bu kurun tam sayı
            aritmetiğiyle türetilmiştir.
          </p>

          {phase.status === "offered" ? (
            <button
              type="button"
              onClick={() => estimate(phase.offer)}
              className="self-start rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-800"
            >
              İşlemi tahmin et
            </button>
          ) : (
            <>
              <p className={NOTE}>
                Gönderen, alıcı, tutar ve ağı yukarıdan <strong>tek tek</strong>{" "}
                kontrol et. Onaya bastığında cüzdanın açılacak ve transferi{" "}
                <strong>yalnızca sen</strong> imzalayacaksın.
              </p>
              <button
                type="button"
                onClick={() => pay(phase.offer)}
                className="self-start rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white"
              >
                Arc Testnet ile öde
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
            className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs leading-relaxed text-sky-900"
          >
            <strong>Doğrulanıyor.</strong> {phase.note} Ödeme, sunucu zincirden
            makbuzu doğrulayana kadar <strong>tamamlanmış sayılmaz</strong>.
          </p>
          <ExplorerLink explorerUrl={phase.explorerUrl} txHash={phase.txHash} />
        </>
      )}

      {phase.status === "paid" && (
        <>
          <p
            role="status"
            className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs leading-relaxed text-emerald-900"
          >
            <strong>Ödendi.</strong> Sunucu işlemi Arc Testnet üzerinde
            doğruladı: gönderen, alıcı ve tutar birebir eşleşti.
          </p>
          <ExplorerLink explorerUrl={phase.explorerUrl} txHash={phase.txHash} />
          {testnetWarning}
        </>
      )}

      {phase.status === "blocked" && (
        <>
          <p
            role="alert"
            className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900"
          >
            {phase.message}
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
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
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
  if (txHash === null) {
    return null;
  }
  const url = explorerUrl ?? buildArcExplorerTxUrl(txHash);
  return (
    <p className="break-all text-[11px] text-slate-500">
      İşlem:{" "}
      {url === null ? (
        <span className="font-mono">{txHash}</span>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className={LINK}>
          ArcScan&apos;de gör
        </a>
      )}
    </p>
  );
}
