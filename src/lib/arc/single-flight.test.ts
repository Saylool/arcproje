import { describe, expect, it, vi } from "vitest";

import { createSingleFlight } from "./single-flight";

/**
 * Çift gönderim koruması.
 *
 * Aşağıdaki koşum, PaymentRequestPayer.submit ile AYNI denetim akışını
 * kullanır: kilit ilk `await`ten önce eşzamanlı alınır, hata yollarında
 * bırakılır, başarıdan sonra bırakılmaz.
 */

type Harness = {
  submit: () => Promise<void>;
  verify: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

function buildHarness(options: {
  verify: () => Promise<{ ok: boolean }>;
  send: () => Promise<{ ok: boolean }>;
}): Harness {
  const guard = createSingleFlight();
  const verify = vi.fn(options.verify);
  const send = vi.fn(options.send);

  const submit = async () => {
    if (!guard.tryEnter()) {
      return;
    }
    let keepLocked = false;
    try {
      const verified = await verify();
      if (!verified.ok) {
        return;
      }
      const sent = await send();
      if (!sent.ok) {
        return;
      }
      keepLocked = true;
    } finally {
      if (!keepLocked) {
        guard.release();
      }
    }
  };

  return { submit, verify, send };
}

describe("createSingleFlight", () => {
  it("ikinci giriş denemesi düşer", () => {
    const guard = createSingleFlight();
    expect(guard.tryEnter()).toBe(true);
    expect(guard.tryEnter()).toBe(false);
    expect(guard.active).toBe(true);
    guard.release();
    expect(guard.tryEnter()).toBe(true);
  });
});

describe("çift tık tek boru hattı üretir", () => {
  it("doğrulama askıdayken ikinci gönderim başlamaz", async () => {
    let resolveVerify: (value: { ok: boolean }) => void = () => undefined;
    const harness = buildHarness({
      verify: () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveVerify = resolve;
        }),
      send: async () => ({ ok: true }),
    });

    // İki hızlı tık: ikisi de aynı anda "hazır" durumu görüyor.
    const first = harness.submit();
    const second = harness.submit();

    // Doğrulama hâlâ askıda; hiçbir gönderim başlamadı.
    expect(harness.verify).toHaveBeenCalledTimes(1);
    expect(harness.send).not.toHaveBeenCalled();

    resolveVerify({ ok: true });
    await Promise.all([first, second]);

    expect(harness.verify).toHaveBeenCalledTimes(1);
    expect(harness.send).toHaveBeenCalledTimes(1);
  });

  it("başarıdan sonra üçüncü tık da gönderim başlatmaz", async () => {
    const harness = buildHarness({
      verify: async () => ({ ok: true }),
      send: async () => ({ ok: true }),
    });
    await harness.submit();
    await harness.submit();
    await harness.submit();
    expect(harness.send).toHaveBeenCalledTimes(1);
  });

  it("doğrulama başarısız olursa yeniden denenebilir", async () => {
    let ok = false;
    const harness = buildHarness({
      verify: async () => ({ ok }),
      send: async () => ({ ok: true }),
    });
    await harness.submit();
    expect(harness.send).not.toHaveBeenCalled();

    ok = true;
    await harness.submit();
    expect(harness.verify).toHaveBeenCalledTimes(2);
    expect(harness.send).toHaveBeenCalledTimes(1);
  });

  it("gönderim başarısız olursa yeniden denenebilir", async () => {
    let sendOk = false;
    const harness = buildHarness({
      verify: async () => ({ ok: true }),
      send: async () => ({ ok: sendOk }),
    });
    await harness.submit();
    sendOk = true;
    await harness.submit();
    expect(harness.send).toHaveBeenCalledTimes(2);

    // Başarıdan sonra kilit kalıcıdır.
    await harness.submit();
    expect(harness.send).toHaveBeenCalledTimes(2);
  });
});
