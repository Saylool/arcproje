import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/rates/usdc-try/route";
import { POST } from "@/app/api/rates/verify/route";
import { COINGECKO_COIN_ID, COINGECKO_VS_CURRENCY } from "./coingecko";
import { TEST_QUOTE_SECRET } from "./quote-fixture";
import { resetRateQuoteCache } from "./quote-service";

/**
 * Rotalar taklit fetch ile çalıştırılır; canlı CoinGecko'ya gidilmez.
 * Asıl iddia: istemciye giden yanıtta sağlayıcı gövdesi, API anahtarı veya
 * HMAC sırrı ASLA bulunmaz.
 */

const API_KEY = "test-demo-key-should-never-leak";

function providerResponse(rate = 42.123456) {
  return new Response(
    JSON.stringify({
      [COINGECKO_COIN_ID]: {
        [COINGECKO_VS_CURRENCY]: rate,
        last_updated_at: Math.floor(Date.now() / 1000) - 5,
        gizli_saglayici_alani: "sizmamali",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function jsonRequest(body: unknown, contentType = "application/json") {
  return new Request("http://localhost/api/rates/verify", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  resetRateQuoteCache();
  vi.stubEnv("COINGECKO_DEMO_API_KEY", API_KEY);
  vi.stubEnv("RATE_QUOTE_SECRET", TEST_QUOTE_SECRET);
  vi.stubGlobal("fetch", vi.fn(async () => providerResponse()));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/rates/usdc-try", () => {
  it("teklif ve etiket döner, önbelleklenmez", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");

    const body = (await response.json()) as {
      quote: Record<string, unknown>;
      tag: string;
      display: { rate: string };
    };
    expect(body.quote.source).toBe("coingecko");
    expect(body.quote.baseCurrency).toBe("USDC");
    expect(body.quote.quoteCurrency).toBe("TRY");
    expect(body.quote.rateDenominator).toBe("1000000");
    expect(body.tag).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.display.rate).toBe("42.123456");
  });

  it("yanıtta anahtar, sır veya sağlayıcı gövdesi yoktur", async () => {
    const text = await (await GET()).text();
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain(TEST_QUOTE_SECRET);
    expect(text).not.toContain("gizli_saglayici_alani");
    expect(text).not.toContain("sizmamali");
  });

  it("anahtar yoksa 503 döner ve sağlayıcıya gidilmez", async () => {
    vi.stubEnv("COINGECKO_DEMO_API_KEY", "");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("sır yoksa 503 döner", async () => {
    vi.stubEnv("RATE_QUOTE_SECRET", "");
    const response = await GET();
    expect(response.status).toBe(503);
  });

  it("sağlayıcı hatasında manuel kura düşmez", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const response = await GET();
    expect(response.status).toBe(502);
    const body = (await response.json()) as { quote?: unknown };
    expect(body.quote).toBeUndefined();
  });
});

describe("POST /api/rates/verify", () => {
  async function mintedQuote() {
    const body = (await (await GET()).json()) as {
      quote: Record<string, unknown>;
      tag: string;
    };
    return body;
  }

  it("geçerli teklifi doğrular", async () => {
    const { quote, tag } = await mintedQuote();
    const response = await POST(jsonRequest({ quote, tag }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { valid: boolean; source: string };
    expect(body.valid).toBe(true);
    expect(body.source).toBe("coingecko");
  });

  it("kurcalanmış kuru reddeder", async () => {
    const { quote, tag } = await mintedQuote();
    const response = await POST(
      jsonRequest({ quote: { ...quote, rateNumerator: "10000000" }, tag }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });

  it("kurcalanmış etiketi reddeder", async () => {
    const { quote } = await mintedQuote();
    const response = await POST(
      jsonRequest({ quote, tag: `0x${"ab".repeat(32)}` }),
    );
    expect(response.status).toBe(400);
  });

  it("beklenmeyen alanı reddeder", async () => {
    const { quote, tag } = await mintedQuote();
    const response = await POST(jsonRequest({ quote, tag, fazladan: 1 }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNEXPECTED_FIELD");
  });

  it("eksik alanı reddeder", async () => {
    const { quote } = await mintedQuote();
    const response = await POST(jsonRequest({ quote }));
    expect(response.status).toBe(400);
  });

  it("yanlış içerik türünü reddeder", async () => {
    const response = await POST(jsonRequest({}, "text/plain"));
    expect(response.status).toBe(400);
  });

  it("bozuk JSON'u reddeder", async () => {
    const response = await POST(jsonRequest("{bozuk"));
    expect(response.status).toBe(400);
  });

  it("yanıtta sır görünmez", async () => {
    const { quote, tag } = await mintedQuote();
    const text = await (await POST(jsonRequest({ quote, tag }))).text();
    expect(text).not.toContain(TEST_QUOTE_SECRET);
    expect(text).not.toContain(API_KEY);
  });
});
