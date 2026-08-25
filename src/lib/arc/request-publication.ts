import {
  describePaymentRequestProblem,
  extractQuoteFromPayload,
  validatePaymentRequestPayload,
  type PaymentRequestProblem,
  type SignedPaymentRequest,
} from "./payment-request";
import type { RateQuote } from "@/lib/rates/quote";
import { translate } from "../i18n/dictionary";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";

/**
 * İmzalı talebin YAYIMLANMADAN önceki son kapısı.
 *
 * Kullanıcı cüzdanda onaylarken zaman geçer; teklifin süresi bu arada dolmuş
 * olabilir. Bağlantı veya QR üretilmeden önce imzalanan gövde güncel saatle
 * yeniden doğrulanır ve teklif sunucuya yeniden doğrulatılır. Ayrı bir kısmi
 * kontrol yazılmaz: üretimde ve tüketimde kullanılan AYNI katı doğrulayıcı
 * çağrılır.
 *
 * Doğrulama İKİ kez yapılır: sunucuya sorulmadan önce ve yanıt geldikten
 * sonra. Aradaki gidiş-dönüş boyunca teklif sona erebilir.
 *
 * Saat ve sunucu doğrulaması dışarıdan verilir; böylece bu kapı React'ten
 * bağımsız ve belirlenimci biçimde test edilebilir.
 */

export type QuoteVerifier = (
  quote: RateQuote,
  tag: string,
) => Promise<{ ok: true } | { ok: false; message: string; code?: string }>;

/**
 * `problem` / `quoteCode` KARARLI kodlardır: arayüz cümleyi bunlardan ve
 * ETKİN DİLDEN kurar. `message` varsayılan/verilen dildeki hazır metindir ve
 * geriye dönük uyumluluk için korunur.
 */
export type PublicationCheck =
  | { ok: true }
  | {
      ok: false;
      message: string;
      problem?: PaymentRequestProblem;
      quoteCode?: string;
    };

/**
 * Dil, çağıranın etkin dilidir; verilmezse Türkçedir. Yalnızca GÖSTERİLECEK
 * metni etkiler — hangi kontrolün düştüğünü ve fail-closed davranışı
 * değiştirmez.
 */
export async function ensureSignedRequestPublishable(
  request: SignedPaymentRequest,
  verifyQuote: QuoteVerifier,
  now: () => number = Date.now,
  locale: Locale = DEFAULT_LOCALE,
): Promise<PublicationCheck> {
  const refreshHint = translate(locale, "request.refreshHint");
  const revalidated = validatePaymentRequestPayload(request.payload, now());
  if (!revalidated.ok) {
    return {
      ok: false,
      message: `${describePaymentRequestProblem(revalidated.problem, locale)} ${refreshHint}`,
      problem: revalidated.problem,
    };
  }

  const quoteCheck = await verifyQuote(
    extractQuoteFromPayload(request.payload),
    request.payload.quoteTag,
  );
  if (!quoteCheck.ok) {
    return {
      ok: false,
      message: `${quoteCheck.message} ${refreshHint}`,
      quoteCode: quoteCheck.code,
    };
  }

  /*
   * Sunucu doğrulaması bir ağ gidiş-dönüşü kadar sürer; teklif TAM O SIRADA
   * sona ermiş olabilir. Bağlantı açığa çıkmadan önce TAZE saatle son bir kez
   * doğrulanır: "doğrulama başladığında geçerliydi" yeterli değildir.
   */
  const stillValid = validatePaymentRequestPayload(request.payload, now());
  if (!stillValid.ok) {
    return {
      ok: false,
      message: `${describePaymentRequestProblem(stillValid.problem, locale)} ${refreshHint}`,
      problem: stillValid.problem,
    };
  }

  return { ok: true };
}
