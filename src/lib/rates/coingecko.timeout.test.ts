import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_PROVIDER_RESPONSE_BYTES,
  fetchUsdcTryObservation,
  parseRetryAfter,
} from "./coingecko";
import { getUsdcTryObservation, resetRateQuoteCache } from "./quote-service";

/**
 * Zaman aşımı, YALNIZCA başlıkları değil gövdenin tamamının okunmasını da
 * kapsamalıdır. Aksi hâlde sunucu başlıkları gönderip gövdeyi damlatarak bu
 * süreçteki paylaşılan isteği süresiz kilitleyebilir.
 */

const ENV = { COINGECKO_DEMO_API_KEY: "test-key" };

/** Başlıkları hemen gönderen ama gövdeyi hiç akıtmayan yanıt. */
function stalledBodyResponse(signal: AbortSignal | null | undefined) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => {
        controller.error(
          Object.assign(new Error("aborted"), { name: "AbortError" }),
        );
      });
    },
  });
  return new Response(body, { status: 200 });
}

/** Sınırı aşana kadar yavaşça parça gönderen yanıt. */
function drippingOversizedResponse() {
  const chunk = new TextEncoder().encode("x".repeat(512));
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent > MAX_PROVIDER_RESPONSE_BYTES + 4096) {
        controller.close();
        return;
      }
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return new Response(body, { status: 200 });
}

afterEach(() => {
  resetRateQuoteCache();
  vi.restoreAllMocks();
});

describe("zaman aşımı gövde okumasını da kapsar", () => {
  it("fetch'in kendisi zaman aşımına uğrarsa timeout döner", async () => {
    const result = await fetchUsdcTryObservation({
      env: ENV,
      timeoutMs: 10,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        })) as never,
    });
    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });

  it("başlıklar gelip gövde takılırsa timeout döner (malformed DEĞİL)", async () => {
    const result = await fetchUsdcTryObservation({
      env: ENV,
      timeoutMs: 20,
      fetchImpl: ((_url: string, init: RequestInit) =>
        Promise.resolve(stalledBodyResponse(init.signal))) as never,
    });
    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });

  it("yavaş akan aşırı büyük gövde boyut sınırında kesilir", async () => {
    const result = await fetchUsdcTryObservation({
      env: ENV,
      timeoutMs: 5000,
      fetchImpl: (async () => drippingOversizedResponse()) as never,
    });
    expect(result).toMatchObject({ ok: false, code: "responseTooLarge" });
  });

  it("başarıdan sonra zamanlayıcı temizlenir", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const ok = new Response(
      JSON.stringify({
        "usd-coin": { try: 42.123456, last_updated_at: 1_700_000_000 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    const result = await fetchUsdcTryObservation({
      env: ENV,
      fetchImpl: (async () => ok) as never,
    });
    expect(result.ok).toBe(true);
    expect(clearSpy).toHaveBeenCalled();
  });

  it("zaman aşımından sonra paylaşılan istek temizlenir ve sonraki istek toparlanır", async () => {
    const NOW = 1_700_000_000_000;
    const stalling = ((_url: string, init: RequestInit) =>
      Promise.resolve(stalledBodyResponse(init.signal))) as never;

    const first = await getUsdcTryObservation(NOW, {
      env: ENV,
      timeoutMs: 20,
      fetchImpl: stalling,
      clock: () => NOW,
    });
    expect(first).toMatchObject({ ok: false, code: "timeout" });

    // Soğuma bitince yeni bir istek başlatılabilmeli: kilit kalmadı.
    const ok = new Response(
      JSON.stringify({
        "usd-coin": { try: 42.123456, last_updated_at: 1_700_000_000 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    const recoveredAt = NOW + 10 * 60 * 1000;
    const second = await getUsdcTryObservation(recoveredAt, {
      env: ENV,
      fetchImpl: (async () => ok) as never,
      clock: () => recoveredAt,
    });
    expect(second.ok).toBe(true);
  });
});

describe("Retry-After ayrıştırma", () => {
  it("geçerli saniye değerini kabul eder", () => {
    expect(parseRetryAfter("30")).toBe(30);
  });

  it("aşırı büyük değeri kırpar", () => {
    expect(parseRetryAfter("999999")).toBe(300);
  });

  it("geçersiz biçimleri yok sayar", () => {
    for (const bad of [null, "", "abc", "-5", "0", "Wed, 21 Oct 2015 07:28:00 GMT"]) {
      expect(parseRetryAfter(bad), String(bad)).toBeNull();
    }
  });
});
