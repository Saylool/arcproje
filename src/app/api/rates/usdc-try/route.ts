import { NextResponse } from "next/server";

import { formatQuoteRate } from "@/lib/rates/quote";
import {
  mintUsdcTryQuote,
  type QuoteMintFailure,
} from "@/lib/rates/quote-service";

/**
 * Taze, sunucu tarafından kimliklendirilmiş USDC/TRY kur teklifi.
 *
 * Dışarıya yalnızca teklifin herkese açık alanları ve kimlik etiketi çıkar.
 * CoinGecko anahtarı, HMAC sırrı ve sağlayıcının ham yanıtı asla dönmez.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURES: Record<QuoteMintFailure, { status: number; message: string }> = {
  notConfigured: {
    status: 503,
    message:
      "Kur servisi yapılandırılmamış. Sunucuda COINGECKO_DEMO_API_KEY tanımlı değil.",
  },
  secretMissing: {
    status: 503,
    message:
      "Kur servisi yapılandırılmamış. Sunucuda RATE_QUOTE_SECRET tanımlı değil.",
  },
  timeout: {
    status: 504,
    message: "Kur servisi zaman aşımına uğradı. Lütfen tekrar dene.",
  },
  providerUnavailable: {
    status: 502,
    message: "Kur sağlayıcısına şu anda ulaşılamıyor. Lütfen birazdan tekrar dene.",
  },
  responseTooLarge: {
    status: 502,
    message: "Kur sağlayıcısından beklenmeyen boyutta yanıt geldi.",
  },
  malformedResponse: {
    status: 502,
    message: "Kur sağlayıcısının yanıtı okunamadı.",
  },
  invalidRate: {
    status: 502,
    message: "Kur sağlayıcısından makul olmayan bir kur geldi.",
  },
  invalidObservation: {
    status: 502,
    message: "Kur sağlayıcısının zaman bilgisi okunamadı.",
  },
  invalidQuote: {
    status: 500,
    message: "Kur teklifi üretilemedi. Lütfen tekrar dene.",
  },
};

/** Basılan teklif kişiye özeldir ve önbelleklenmez. */
const NO_STORE_HEADERS = {
  "cache-control": "no-store, private, max-age=0",
} as const;

export async function GET() {
  const minted = await mintUsdcTryQuote();

  if (!minted.ok) {
    const failure = FAILURES[minted.code];
    return NextResponse.json(
      { error: { code: minted.code, message: failure.message } },
      { status: failure.status, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      quote: minted.signed.quote,
      tag: minted.signed.tag,
      // Gösterim kolaylığı; doğrulama her zaman quote alanlarından yapılır.
      display: { rate: formatQuoteRate(minted.signed.quote) },
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
