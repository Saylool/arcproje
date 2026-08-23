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

const NO_STORE_HEADERS = {
  "cache-control": "no-store, private, max-age=0",
} as const;

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

  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return errorResponse(413, "BODY_TOO_LARGE", "İstek gövdesi çok büyük.");
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return errorResponse(413, "BODY_TOO_LARGE", "İstek gövdesi çok büyük.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
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
