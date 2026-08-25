import {
  describeQuoteProblem,
  validateRateQuote,
  isValidQuoteTagFormat,
  type QuoteProblem,
  type RateQuote,
  type SignedRateQuote,
} from "./quote";
import { isKnownApiErrorCode, localizeApiError, readApiErrorCode } from "../i18n/api-errors";
import { translate } from "../i18n/dictionary";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";
import { tr } from "../i18n/tr";

/**
 * Tarayıcı tarafının kur servisi istemcisi.
 *
 * Burada hiçbir sır yoktur: istemci HMAC'i doğrulayamaz, yalnızca sunucuya
 * doğrulatır. Sunucudan gelen her teklif ayrıca yerelde katı şema
 * doğrulamasından geçer; sunucu yanıtına körü körüne güvenilmez.
 */

const networkError = (locale: Locale) => translate(locale, "errors.rateService");
const malformedError = (locale: Locale) =>
  translate(locale, "errors.rateMalformed");

/** `/api/rates/*` bir kur sorununu KOD olarak dondurur. */
const QUOTE_PROBLEMS: ReadonlySet<string> = new Set(Object.keys(tr.errors.quote));

/**
 * Sunucu hatasinin GOSTERILECEK karsiligini secer.
 *
 * Sunucunun hazir metni KULLANILMAZ: yalnizca KARARLI KOD okunur ve cumle
 * sozlukten, etkin dilde alinir. Taninmayan kod guvenli genel karsiliga duser.
 */
function failureFromPayload(
  body: unknown,
  locale: Locale,
): { ok: false; message: string; code?: string } {
  const code = readApiErrorCode(body);
  const message = messageForPayload(body, locale);
  return code === null ? { ok: false, message } : { ok: false, message, code };
}

function messageForPayload(body: unknown, locale: Locale): string {
  const code = readApiErrorCode(body);
  if (code !== null && QUOTE_PROBLEMS.has(code)) {
    return describeQuoteProblem(code as QuoteProblem, locale);
  }
  if (isKnownApiErrorCode(code)) {
    return localizeApiError(locale, code);
  }
  return malformedError(locale);
}

/**
 * `code` KARARLI sunucu kodudur (kur sorunu veya genel API kodu). Arayüz
 * gösterilecek cümleyi ondan seçer; `message` yalnızca geriye dönük
 * uyumluluk içindir.
 */
export type QuoteFetchResult =
  | { ok: true; signed: SignedRateQuote }
  | { ok: false; message: string; code?: string };

/** Sunucudan taze, kimliklendirilmiş bir teklif ister. */
export async function fetchQuoteFromServer(
  nowMs: number = Date.now(),
  fetchImpl: typeof fetch = fetch,
  locale: Locale = DEFAULT_LOCALE,
): Promise<QuoteFetchResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/rates/usdc-try", {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: networkError(locale) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: malformedError(locale) };
  }

  if (!response.ok) {
    return failureFromPayload(body, locale);
  }
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: malformedError(locale) };
  }

  const { quote, tag } = body as { quote?: unknown; tag?: unknown };
  if (!isValidQuoteTagFormat(tag)) {
    return { ok: false, message: malformedError(locale) };
  }
  // Sunucudan gelse bile teklif yerelde katı biçimde doğrulanır.
  const validated = validateRateQuote(quote, nowMs);
  if (!validated.ok) {
    return {
      ok: false,
      message: describeQuoteProblem(validated.problem, locale),
      code: validated.problem,
    };
  }

  return { ok: true, signed: { quote: validated.quote, tag } };
}

export type QuoteVerifyResult =
  | { ok: true }
  | { ok: false; message: string; code?: string };

/** Teklifin sunucu kimliklendirmesini ve güncel geçerliliğini doğrulatır. */
export async function verifyQuoteWithServer(
  quote: RateQuote,
  tag: string,
  fetchImpl: typeof fetch = fetch,
  locale: Locale = DEFAULT_LOCALE,
): Promise<QuoteVerifyResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/rates/verify", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ quote, tag }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: networkError(locale) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: malformedError(locale) };
  }

  if (!response.ok) {
    return failureFromPayload(body, locale);
  }
  if (
    typeof body !== "object" ||
    body === null ||
    (body as { valid?: unknown }).valid !== true
  ) {
    return failureFromPayload(body, locale);
  }
  return { ok: true };
}
