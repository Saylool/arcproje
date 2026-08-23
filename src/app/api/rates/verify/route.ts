import { NextResponse } from "next/server";

import {
  describeQuoteProblem,
  isValidQuoteTagFormat,
  type QuoteProblem,
} from "@/lib/rates/quote";
import { readQuoteSecret, verifyRateQuote } from "@/lib/rates/quote-auth";

/**
 * Bir kur teklifinin sunucu kimliklendirmesini ve güncel geçerliliğini
 * doğrular.
 *
 * Borçlu sayfası, cüzdan kontrollerini göstermeden önce buraya sorar: ödeme
 * talebini imzalayan kişinin cüzdan imzası kurun piyasadan geldiğini
 * KANITLAMAZ; bunu yalnızca sunucunun HMAC etiketi kanıtlar.
 *
 * Yanıt asgaridir: sır, sağlayıcı gövdesi veya iç ayrıntı dönmez.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
/**
 * Gövde akışı için toplam son teslim süresi.
 *
 * Boyut sınırı tek başına yetmez: istemci sınırın altında kalıp baytları
 * saniyede bir damlatarak isteği açık tutabilir. Bu süre tüm okumayı kapsar.
 */
const BODY_READ_DEADLINE_MS = 5000;

const NO_STORE_HEADERS = {
  "cache-control": "no-store, private, max-age=0",
} as const;

type BoundedBody =
  | { status: "ok"; text: string }
  | { status: "tooLarge" }
  | { status: "invalidEncoding" }
  | { status: "timeout" }
  | { status: "unreadable" };

/**
 * Gövdeyi BAYT sayarak sınırlı okur.
 *
 * `request.text()` tüm gövdeyi önce belleğe alır ve sonuçtaki `length` UTF-16
 * kod birimi sayar — çok baytlı UTF-8 içerikte gerçek bayt sayısından sapar.
 * Burada alınan baytlar sayılır, sınır aşılır aşılmaz akış iptal edilir ve
 * çözümleme yalnızca sınır içinde kalan veri üzerinde, katı UTF-8 ile yapılır.
 */
async function readBoundedBody(request: Request): Promise<BoundedBody> {
  const stream = request.body;
  if (stream === null) {
    return { status: "ok", text: "" };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, BODY_READ_DEADLINE_MS);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (timedOut) {
        return { status: "timeout" };
      }
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { status: "tooLarge" };
      }
      chunks.push(value);
    }
  } catch {
    return timedOut ? { status: "timeout" } : { status: "unreadable" };
  } finally {
    // Zamanlayıcı her yolda temizlenir; sızdırılan timer bırakılmaz.
    clearTimeout(deadline);
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      status: "ok",
      text: new TextDecoder("utf-8", { fatal: true }).decode(merged),
    };
  } catch {
    return { status: "invalidEncoding" };
  }
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { valid: false, error: { code, message } },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return errorResponse(
      400,
      "INVALID_CONTENT_TYPE",
      "İstek application/json biçiminde olmalı.",
    );
  }

  /*
   * Content-Length yalnızca UCUZ bir ön elemedir; tek sınır olarak ona
   * güvenilmez. Parçalı (chunked) bir istek onu hiç göndermeyebilir.
   */
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return errorResponse(413, "BODY_TOO_LARGE", "İstek gövdesi çok büyük.");
  }

  const bounded = await readBoundedBody(request);
  if (bounded.status === "tooLarge") {
    return errorResponse(413, "BODY_TOO_LARGE", "İstek gövdesi çok büyük.");
  }
  if (bounded.status === "invalidEncoding") {
    return errorResponse(400, "INVALID_ENCODING", "İstek gövdesi geçerli UTF-8 değil.");
  }
  if (bounded.status === "timeout") {
    return errorResponse(
      408,
      "BODY_READ_TIMEOUT",
      "İstek gövdesi zamanında okunamadı.",
    );
  }
  if (bounded.status === "unreadable") {
    return errorResponse(400, "INVALID_REQUEST", "İstek okunamadı.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bounded.text);
  } catch {
    return errorResponse(400, "MALFORMED_JSON", "İstek gövdesi okunamadı.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return errorResponse(400, "INVALID_BODY", "İstek gövdesi beklenen biçimde değil.");
  }

  const body = parsed as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (key !== "quote" && key !== "tag") {
      return errorResponse(
        400,
        "UNEXPECTED_FIELD",
        "İstek gövdesinde beklenmeyen alan var.",
      );
    }
  }
  if (!("quote" in body) || !("tag" in body)) {
    return errorResponse(400, "MISSING_FIELD", "İstek gövdesinde eksik alan var.");
  }
  if (!isValidQuoteTagFormat(body.tag)) {
    return errorResponse(
      400,
      "INVALID_TAG_FORMAT",
      describeQuoteProblem("invalidTag"),
    );
  }

  const secret = readQuoteSecret();
  if (!secret.ok) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Kur doğrulaması yapılandırılmamış. Sunucuda RATE_QUOTE_SECRET tanımlı değil.",
    );
  }

  const verified = verifyRateQuote(body.quote, body.tag, secret.secret, Date.now());
  if (!verified.ok) {
    const problem: QuoteProblem = verified.problem;
    return NextResponse.json(
      { valid: false, error: { code: problem, message: describeQuoteProblem(problem) } },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      valid: true,
      quoteId: verified.quote.quoteId,
      source: verified.quote.source,
      expiresAt: verified.quote.expiresAt,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
