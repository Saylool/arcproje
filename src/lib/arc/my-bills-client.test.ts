import { describe, expect, it, vi } from "vitest";

import { listMyBillsFromServer } from "./shared-bill-client";

/**
 * Olusturulan hesap listesinin ISTEMCI tarafi.
 *
 * Sunucudan gelen hicbir metin dogrudan kullaniciya baglanti olarak
 * gosterilmez ve hicbir tutar oldugu gibi basilmaz. Liste TUMU-YA-DA-HICBIRI
 * kabul edilir: tek bir satir bile beklenen bicimde degilse liste hic
 * gosterilmez, cunku eksik bir liste "hesabim kaybolmus" yanilgisina yol acar.
 */

const BILL_ID = `0x${"5c".repeat(32)}`;

function validRow(over: Record<string, unknown> = {}) {
  return {
    billId: BILL_ID,
    path: `/pay/${BILL_ID}`,
    issuedAt: 1_700_000_000,
    expiresAt: 1_700_600_000,
    status: "open",
    debtCount: 2,
    paidCount: 1,
    totalTryMinor: "19134",
    paidTryMinor: "12345",
    ...over,
  };
}

/** `fetch` imzasini korur ki cagri argumanlari da denetlenebilsin. */
function respondWith(payload: unknown, status = 200) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("istek sekli", () => {
  it("hicbir kullanici kimligi TASIMAZ", async () => {
    const fetchImpl = respondWith({ bills: [], hasMore: false });
    await listMyBillsFromServer(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    if (call === undefined) return;
    const [url, init] = call;
    expect(typeof url).toBe("string");
    expect(init).toBeDefined();
    if (init === undefined) return;
    // Sorgu dizesi yok: suzme olcutu istemciden gonderilemez.
    expect(url).toBe("/api/shared-bills");
    expect(url).not.toContain("?");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe("no-store");
  });
});

describe("yanit dogrulamasi", () => {
  it("gecerli listeyi kabul eder", async () => {
    const result = await listMyBillsFromServer(
      respondWith({ bills: [validRow()], hasMore: false }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bills).toHaveLength(1);
    expect(result.bills[0]?.totalTryMinor).toBe("19134");
  });

  it("bos liste gecerlidir", async () => {
    const result = await listMyBillsFromServer(respondWith({ bills: [], hasMore: false }));
    expect(result.ok && result.bills).toEqual([]);
  });

  it("YOL sunucunun metninden degil, dogrulanmis kimlikten kurulur", async () => {
    const result = await listMyBillsFromServer(
      respondWith({
        bills: [validRow({ path: "https://kotucul.example/calinti" })],
        hasMore: false,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bills[0]?.path).toBe(`/pay/${BILL_ID}`);
  });

  it("tek satir bile bozuksa liste HIC gosterilmez", async () => {
    const result = await listMyBillsFromServer(
      respondWith({ bills: [validRow(), validRow({ billId: "0xkisa" })], hasMore: false }),
    );
    expect(result.ok).toBe(false);
  });

  it("kanonik olmayan tutar reddedilir", async () => {
    for (const bad of ["019134", "191.34", "-1", "1e5", "", " 19134"]) {
      const result = await listMyBillsFromServer(
        respondWith({ bills: [validRow({ totalTryMinor: bad })], hasMore: false }),
      );
      expect(result.ok, bad).toBe(false);
    }
  });

  it("tutarsiz sayimlar ve tutarlar reddedilir", async () => {
    const inconsistent = [
      { paidCount: 3 },
      { paidCount: -1 },
      { debtCount: 0 },
      { debtCount: 51 },
      { paidTryMinor: "99999" },
      { expiresAt: 1_700_000_000 },
      { status: "silindi" },
    ];
    for (const over of inconsistent) {
      const result = await listMyBillsFromServer(
        respondWith({ bills: [validRow(over)], hasMore: false }),
      );
      expect(result.ok, JSON.stringify(over)).toBe(false);
    }
  });

  it("liste alani dizi degilse reddedilir", async () => {
    for (const payload of [
      {},
      { bills: null, hasMore: false },
      { bills: "yok", hasMore: false },
      [],
    ]) {
      const result = await listMyBillsFromServer(respondWith(payload));
      expect(result.ok, JSON.stringify(payload)).toBe(false);
    }
  });
});

describe("hata yollari", () => {
  it("ag hatasi sessizce yutulur", async () => {
    const result = await listMyBillsFromServer(
      vi.fn(async () => {
        throw new Error("ag yok");
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("JSON olmayan yanit reddedilir", async () => {
    const result = await listMyBillsFromServer(
      vi.fn(async () => new Response("<html>", { status: 200 })),
    );
    expect(result.ok).toBe(false);
  });

  it("hata KODU tasinir, sunucunun METNI degil", async () => {
    const result = await listMyBillsFromServer(
      respondWith(
        { error: { code: "AUTH_REQUIRED", message: "sunucu metni" } },
        401,
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AUTH_REQUIRED");
    expect(result.message).not.toContain("sunucu metni");
  });
});

describe("kirpma bayragi", () => {
  it("hasMore tasinir", async () => {
    const result = await listMyBillsFromServer(
      respondWith({ bills: [validRow()], hasMore: true }),
    );
    expect(result.ok && result.hasMore).toBe(true);
  });

  it("hasMore eksik veya boolean degilse yanit reddedilir", async () => {
    for (const bad of [undefined, "true", 1, null]) {
      const payload =
        bad === undefined
          ? { bills: [validRow()] }
          : { bills: [validRow()], hasMore: bad };
      const result = await listMyBillsFromServer(respondWith(payload));
      expect(result.ok, JSON.stringify(payload)).toBe(false);
    }
  });
});
