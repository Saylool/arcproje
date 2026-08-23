import {
  describePaymentRequestProblem,
  extractQuoteFromPayload,
  validatePaymentRequestPayload,
  type SignedPaymentRequest,
} from "./payment-request";
import type { RateQuote } from "@/lib/rates/quote";

/**
 * İmzalı talebin YAYIMLANMADAN önceki son kapısı.
 *
 * Kullanıcı cüzdanda onaylarken zaman geçer; teklifin süresi bu arada dolmuş
 * olabilir. Bağlantı veya QR üretilmeden önce imzalanan gövde güncel saatle
 * yeniden doğrulanır ve teklif sunucuya yeniden doğrulatılır. Ayrı bir kısmi
 * kontrol yazılmaz: üretimde ve tüketimde kullanılan AYNI katı doğrulayıcı
 * çağrılır.
 *
 * Saat ve sunucu doğrulaması dışarıdan verilir; böylece bu kapı React'ten
 * bağımsız ve belirlenimci biçimde test edilebilir.
 */

export type QuoteVerifier = (
  quote: RateQuote,
  tag: string,
) => Promise<{ ok: true } | { ok: false; message: string }>;

export type PublicationCheck =
  | { ok: true }
  | { ok: false; message: string };

const REFRESH_HINT = "Kuru yenileyip talebi yeniden imzala.";

export async function ensureSignedRequestPublishable(
  request: SignedPaymentRequest,
  verifyQuote: QuoteVerifier,
  now: () => number = Date.now,
): Promise<PublicationCheck> {
  const revalidated = validatePaymentRequestPayload(request.payload, now());
  if (!revalidated.ok) {
    return {
      ok: false,
      message: `${describePaymentRequestProblem(revalidated.problem)} ${REFRESH_HINT}`,
    };
  }

  const quoteCheck = await verifyQuote(
    extractQuoteFromPayload(request.payload),
    request.payload.quoteTag,
  );
  if (!quoteCheck.ok) {
    return { ok: false, message: `${quoteCheck.message} ${REFRESH_HINT}` };
  }

  return { ok: true };
}
