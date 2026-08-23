import {
  describeQuoteProblem,
  validateRateQuote,
  isValidQuoteTagFormat,
  type RateQuote,
  type SignedRateQuote,
} from "./quote";

/**
 * Tarayıcı tarafının kur servisi istemcisi.
 *
 * Burada hiçbir sır yoktur: istemci HMAC'i doğrulayamaz, yalnızca sunucuya
 * doğrulatır. Sunucudan gelen her teklif ayrıca yerelde katı şema
 * doğrulamasından geçer; sunucu yanıtına körü körüne güvenilmez.
 */

const NETWORK_ERROR =
  "Kur servisine ulaşılamadı. Bağlantını kontrol edip tekrar dene.";
const MALFORMED_ERROR = "Kur servisinden beklenmeyen bir yanıt geldi.";

export type QuoteFetchResult =
  | { ok: true; signed: SignedRateQuote }
  | { ok: false; message: string };

function readErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() !== "" ? message : null;
}

/** Sunucudan taze, kimliklendirilmiş bir teklif ister. */
export async function fetchQuoteFromServer(
  nowMs: number = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<QuoteFetchResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/rates/usdc-try", {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: NETWORK_ERROR };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: MALFORMED_ERROR };
  }

  if (!response.ok) {
    return { ok: false, message: readErrorMessage(body) ?? MALFORMED_ERROR };
  }
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: MALFORMED_ERROR };
  }

  const { quote, tag } = body as { quote?: unknown; tag?: unknown };
  if (!isValidQuoteTagFormat(tag)) {
    return { ok: false, message: MALFORMED_ERROR };
  }
  // Sunucudan gelse bile teklif yerelde katı biçimde doğrulanır.
  const validated = validateRateQuote(quote, nowMs);
  if (!validated.ok) {
    return { ok: false, message: describeQuoteProblem(validated.problem) };
  }

  return { ok: true, signed: { quote: validated.quote, tag } };
}

export type QuoteVerifyResult = { ok: true } | { ok: false; message: string };

/** Teklifin sunucu kimliklendirmesini ve güncel geçerliliğini doğrulatır. */
export async function verifyQuoteWithServer(
  quote: RateQuote,
  tag: string,
  fetchImpl: typeof fetch = fetch,
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
    return { ok: false, message: NETWORK_ERROR };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: MALFORMED_ERROR };
  }

  if (!response.ok) {
    return { ok: false, message: readErrorMessage(body) ?? MALFORMED_ERROR };
  }
  if (
    typeof body !== "object" ||
    body === null ||
    (body as { valid?: unknown }).valid !== true
  ) {
    return { ok: false, message: readErrorMessage(body) ?? MALFORMED_ERROR };
  }
  return { ok: true };
}
