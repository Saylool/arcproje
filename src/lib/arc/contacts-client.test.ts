import { describe, expect, it, vi } from "vitest";

import { listContactsFromServer } from "./contacts-client";

/**
 * Rehber istemcisi.
 *
 * SUNUCUNUN ADRESINE GUVENILMEZ: donen her adres yeniden dogrulanir ve
 * checksum'li hale getirilir. Gecmeyen satir SESSIZCE ATILIR — eksik bir oneri
 * zararsizdir, gecersiz bir adres degildir.
 */

const CHECKSUMMED = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

function validRow(over: Record<string, unknown> = {}) {
  return { address: CHECKSUMMED, label: "Ada", lastUsedAt: 1_700_000_000, ...over };
}

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
    const fetchImpl = respondWith({ contacts: [] });
    await listContactsFromServer(fetchImpl);

    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    if (call === undefined) return;
    const [url, init] = call;
    expect(url).toBe("/api/contacts");
    expect(String(url)).not.toContain("?");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.cache).toBe("no-store");
  });
});

describe("adres YENIDEN dogrulanir", () => {
  it("gecerli kayit kabul edilir", async () => {
    const result = await listContactsFromServer(
      respondWith({ contacts: [validRow()] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.address).toBe(CHECKSUMMED);
  });

  it("sunucu kucuk harf gonderse bile checksum'a cevrilir", async () => {
    const result = await listContactsFromServer(
      respondWith({ contacts: [validRow({ address: CHECKSUMMED.toLowerCase() })] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contacts[0]?.address).toBe(CHECKSUMMED);
  });

  it("gecersiz adres tasiyan satir ATILIR, liste ayakta kalir", async () => {
    for (const bad of ["0xkisa", "", "0x", `${CHECKSUMMED}00`, "merhaba"]) {
      const result = await listContactsFromServer(
        respondWith({ contacts: [validRow(), validRow({ address: bad })] }),
      );
      expect(result.ok, bad).toBe(true);
      if (!result.ok) continue;
      // Saglam satir kaldi, bozuk olan dusuruldu.
      expect(result.contacts, bad).toHaveLength(1);
    }
  });

  it("gecersiz etiket veya zaman tasiyan satir ATILIR", async () => {
    const bad = [
      { label: "" },
      { label: "a".repeat(41) },
      { label: 5 },
      { lastUsedAt: 0 },
      { lastUsedAt: -1 },
      { lastUsedAt: "1700000000" },
    ];
    for (const over of bad) {
      const result = await listContactsFromServer(
        respondWith({ contacts: [validRow(over)] }),
      );
      expect(result.ok, JSON.stringify(over)).toBe(true);
      if (!result.ok) continue;
      expect(result.contacts, JSON.stringify(over)).toHaveLength(0);
    }
  });
});

describe("hata yollari", () => {
  it("liste alani dizi degilse reddedilir", async () => {
    for (const payload of [{}, { contacts: null }, { contacts: "yok" }, []]) {
      const result = await listContactsFromServer(respondWith(payload));
      expect(result.ok, JSON.stringify(payload)).toBe(false);
    }
  });

  it("ag hatasi ve JSON olmayan yanit sessizce yutulur", async () => {
    const network = await listContactsFromServer(
      vi.fn<typeof fetch>(async () => {
        throw new Error("ag yok");
      }),
    );
    expect(network.ok).toBe(false);

    const html = await listContactsFromServer(
      vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 })),
    );
    expect(html.ok).toBe(false);
  });

  it("hata KODU tasinir, sunucunun METNI degil", async () => {
    const result = await listContactsFromServer(
      respondWith({ error: { code: "AUTH_REQUIRED", message: "sunucu metni" } }, 401),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AUTH_REQUIRED");
    expect(result.message).not.toContain("sunucu metni");
  });
});
