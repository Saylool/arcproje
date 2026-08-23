import { describe, expect, it, vi } from "vitest";

import {
  SUBMISSION_UNAVAILABLE_MESSAGE,
  clearReservation,
  readSubmission,
  readSubmissionView,
  recordSubmission,
  runExclusiveSubmission,
  submissionKey,
  type LockManagerLike,
  type StorageLike,
} from "./submission-log";

/** Bellek içi sahte depo: talep başına anahtar tutar. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

/**
 * Web Locks taklidi.
 *
 * `ifAvailable: true` sözleşmesi: kilit BAŞKASINDAYSA geri çağırma `null` ile
 * HEMEN çalışır. Tek bir yönetici tüm sekmeleri temsil eder (aynı köken).
 */
function fakeLocks(): LockManagerLike & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    request: async (name, options, callback) => {
      if (held.has(name)) {
        await callback(null);
        return;
      }
      held.add(name);
      try {
        await callback({ name, mode: options.mode ?? "exclusive" });
      } finally {
        held.delete(name);
      }
    },
  };
}

const CHAIN = 5042002;
const REQUEST = `0x${"11".repeat(32)}`;
const OTHER = `0x${"22".repeat(32)}`;
const THIRD = `0x${"33".repeat(32)}`;
const TX_HASH = `0x${"ab".repeat(32)}`;
const OTHER_HASH = `0x${"cd".repeat(32)}`;

const keyOf = (chainId: number, requestId: string) =>
  `hesabi-bol.submission.v2.${submissionKey(chainId, requestId)}`;

const bodyOf = (storage: { getItem: (k: string) => string | null }, req: string) =>
  JSON.parse(storage.getItem(keyOf(CHAIN, req)) as string) as Record<
    string,
    unknown
  >;

describe("talep başına anahtar şeması", () => {
  it("her talep KENDİ anahtarına yazılır", () => {
    const storage = memoryStorage();
    expect(recordSubmission(CHAIN, REQUEST, "success", { storage })).toBe(true);
    expect(recordSubmission(CHAIN, OTHER, "unknown", { storage })).toBe(true);

    expect([...storage.map.keys()].sort()).toEqual(
      [keyOf(CHAIN, REQUEST), keyOf(CHAIN, OTHER)].sort(),
    );
    expect(readSubmission(CHAIN, REQUEST, storage)).toBe("success");
    expect(readSubmission(CHAIN, OTHER, storage)).toBe("unknown");
  });

  it("kayıt yoksa null döner", () => {
    expect(readSubmission(CHAIN, REQUEST, memoryStorage())).toBeNull();
    expect(readSubmissionView(CHAIN, REQUEST, memoryStorage())).toBeNull();
  });

  it("farklı zincirdeki aynı talep ayrı anahtardır", () => {
    const storage = memoryStorage();
    recordSubmission(CHAIN, REQUEST, "success", { storage });
    expect(readSubmission(1, REQUEST, storage)).toBeNull();
  });

  it("HİÇBİR gizli veya kişisel alan saklanmaz", () => {
    const storage = memoryStorage();
    recordSubmission(CHAIN, REQUEST, "success", { storage, txHash: TX_HASH });
    expect(Object.keys(bodyOf(storage, REQUEST)).sort()).toEqual([
      "at",
      "chainId",
      "outcome",
      "owner",
      "requestId",
      "txHash",
      "v",
    ]);
    const raw = storage.getItem(keyOf(CHAIN, REQUEST)) as string;
    expect(raw).not.toContain("0x742d");
    expect(raw).not.toContain("microUsdc");
  });

  it("geçersiz kimlikler yazılmaz (fail-closed)", () => {
    const storage = memoryStorage();
    expect(recordSubmission(CHAIN, "0xkısa", "pending", { storage })).toBe(false);
    expect(recordSubmission(0, REQUEST, "pending", { storage })).toBe(false);
    expect(recordSubmission(1.5, REQUEST, "pending", { storage })).toBe(false);
    expect(storage.map.size).toBe(0);
  });

  it("depo yoksa yazma BAŞARI SAYILMAZ", () => {
    expect(recordSubmission(CHAIN, REQUEST, "success", { storage: null })).toBe(
      false,
    );
    expect(readSubmission(CHAIN, REQUEST, null)).toBeNull();
    expect(() => clearReservation(CHAIN, REQUEST, null)).not.toThrow();
  });
});

describe("KAYIP GÜNCELLEME yarışı yok", () => {
  it("araya giren başka talep yazması SİLİNMEZ", () => {
    /*
     * Ortak dizi şemasında sıra şuydu: A diziyi okur, B kendi kaydını yazar,
     * A eski diziyi geri yazar ve B'nin kaydını SİLER. Burada A'nın yazma
     * anında B araya sokulur; talep başına anahtarda B hayatta kalmalıdır.
     */
    const storage = memoryStorage();
    let injected = false;
    const racing: StorageLike = {
      getItem: storage.getItem,
      removeItem: storage.removeItem,
      setItem: (k, v) => {
        if (!injected) {
          injected = true;
          // "Başka sekme" tam bu anda kendi kaydını yazar.
          recordSubmission(CHAIN, OTHER, "success", { storage });
        }
        storage.setItem(k, v);
      },
    };

    expect(recordSubmission(CHAIN, REQUEST, "pending", { storage: racing })).toBe(
      true,
    );
    expect(readSubmission(CHAIN, REQUEST, storage)).toBe("pending");
    expect(readSubmission(CHAIN, OTHER, storage)).toBe("success");
  });

  it("EŞZAMANLI farklı talepler hepsi kalıcı olur", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();
    const requests = [REQUEST, OTHER, THIRD];

    const results = await Promise.all(
      requests.map((requestId) =>
        runExclusiveSubmission(
          CHAIN,
          requestId,
          async () =>
            new Promise((resolve) => setTimeout(() => resolve(requestId), 5)),
          { storage, locks },
        ),
      ),
    );

    // Farklı talepler birbirini engellemez ve birbirinin kaydını silmez.
    expect(results.every((r) => r.ok)).toBe(true);
    for (const requestId of requests) {
      expect(readSubmission(CHAIN, requestId, storage), requestId).toBe("pending");
    }
    expect(storage.map.size).toBe(requests.length);
  });
});

describe("yazma TAM geri okuma ile doğrulanır", () => {
  it("başarılı rezervasyonda her alan birebir yazılır", () => {
    const storage = memoryStorage();
    expect(
      recordSubmission(CHAIN, REQUEST, "pending", {
        storage,
        nowMs: 1_700_000_000_000,
        owner: "sahip-1",
      }),
    ).toBe(true);
    expect(bodyOf(storage, REQUEST)).toEqual({
      v: 2,
      chainId: CHAIN,
      requestId: REQUEST,
      outcome: "pending",
      owner: "sahip-1",
      at: 1_700_000_000_000,
    });
  });

  it("SESSİZCE yok sayılan yazma başarı sayılmaz", () => {
    const silent: StorageLike = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(recordSubmission(CHAIN, REQUEST, "pending", { storage: silent })).toBe(
      false,
    );
  });

  it("atan yazma başarı sayılmaz", () => {
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("kota dolu");
      },
      removeItem: () => undefined,
    };
    expect(() =>
      recordSubmission(CHAIN, REQUEST, "pending", { storage: failing }),
    ).not.toThrow();
    expect(recordSubmission(CHAIN, REQUEST, "pending", { storage: failing })).toBe(
      false,
    );
  });

  it("ÜZERİNE YAZILAN değer başarı sayılmaz", () => {
    // Yazdıktan hemen sonra başka bir yazar aynı anahtarı değiştiriyor.
    const storage = memoryStorage();
    const overwritten: StorageLike = {
      getItem: storage.getItem,
      removeItem: storage.removeItem,
      setItem: (k) => {
        storage.setItem(
          k,
          JSON.stringify({
            v: 2,
            chainId: CHAIN,
            requestId: REQUEST,
            outcome: "pending",
            owner: "baska-sekme",
            at: 1_700_000_000_000,
          }),
        );
      },
    };
    expect(
      recordSubmission(CHAIN, REQUEST, "pending", {
        storage: overwritten,
        owner: "bizim",
        nowMs: 1_700_000_000_000,
      }),
    ).toBe(false);
  });

  it("geri okunan HER alan uyuşmazlığı reddedilir", () => {
    for (const tamper of [
      { outcome: "success" },
      { owner: "baskasi" },
      { at: 1 },
      { chainId: 1 },
      { requestId: OTHER },
      { v: 1 },
      { txHash: OTHER_HASH },
    ] as Record<string, unknown>[]) {
      const storage = memoryStorage();
      const mangling: StorageLike = {
        getItem: storage.getItem,
        removeItem: storage.removeItem,
        setItem: (k, v) => {
          storage.setItem(
            k,
            JSON.stringify({ ...JSON.parse(v), ...tamper }),
          );
        },
      };
      expect(
        recordSubmission(CHAIN, REQUEST, "pending", {
          storage: mangling,
          owner: "bizim",
          nowMs: 1_700_000_000_000,
          txHash: TX_HASH,
        }),
        JSON.stringify(tamper),
      ).toBe(false);
    }
  });

  it("yazılan hash düşürülürse de başarı sayılmaz", () => {
    const storage = memoryStorage();
    const dropping: StorageLike = {
      getItem: storage.getItem,
      removeItem: storage.removeItem,
      setItem: (k, v) => {
        const body = JSON.parse(v) as Record<string, unknown>;
        delete body.txHash;
        storage.setItem(k, JSON.stringify(body));
      },
    };
    expect(
      recordSubmission(CHAIN, REQUEST, "success", {
        storage: dropping,
        txHash: TX_HASH,
      }),
    ).toBe(false);
  });
});

describe("mutabakat hash'i kalıcıdır", () => {
  it("terminal ve belirsiz sonuçlarda geçerli hash saklanır", () => {
    for (const outcome of ["success", "reverted", "unknown"] as const) {
      const storage = memoryStorage();
      expect(
        recordSubmission(CHAIN, REQUEST, outcome, { storage, txHash: TX_HASH }),
        outcome,
      ).toBe(true);
      expect(readSubmissionView(CHAIN, REQUEST, storage), outcome).toEqual({
        outcome,
        txHash: TX_HASH,
        explorerUrl: `https://testnet.arcscan.app/tx/${TX_HASH}`,
      });
    }
  });

  it("BOZUK hash ASLA yazılmaz ama kayıt yine de tutulur", () => {
    for (const bad of ["0xdead", "", "abc", null, 42, `0x${"zz".repeat(32)}`]) {
      const storage = memoryStorage();
      expect(
        recordSubmission(CHAIN, REQUEST, "unknown", {
          storage,
          txHash: bad as string | null,
        }),
        String(bad),
      ).toBe(true);
      expect(bodyOf(storage, REQUEST).txHash, String(bad)).toBeUndefined();
      // Kayıt durmalı: gönderim engellemesi hash'e bağlı değildir.
      expect(readSubmission(CHAIN, REQUEST, storage), String(bad)).toBe("unknown");
      expect(readSubmissionView(CHAIN, REQUEST, storage)?.txHash).toBeNull();
    }
  });

  it("DEPODA bozulan hash sonucu düşürmez, yalnızca hash düşer", () => {
    const storage = memoryStorage();
    recordSubmission(CHAIN, REQUEST, "reverted", { storage, txHash: TX_HASH });
    // Depodaki hash bozuluyor.
    const body = bodyOf(storage, REQUEST);
    body.txHash = "0xbozuk";
    storage.setItem(keyOf(CHAIN, REQUEST), JSON.stringify(body));

    expect(readSubmissionView(CHAIN, REQUEST, storage)).toEqual({
      outcome: "reverted",
      txHash: null,
      explorerUrl: null,
    });
  });

  it("YENİLEME/yeniden kurulum sonrası hash ve sonuç geri gelir", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();
    // Gönderim yapılır ve belirsiz sonuçla kapanır.
    await runExclusiveSubmission(CHAIN, REQUEST, async () => "tx", {
      storage,
      locks,
    });
    recordSubmission(CHAIN, REQUEST, "unknown", { storage, txHash: TX_HASH });

    // "Sayfa yenilendi": bellekteki durum yok, yalnızca depo var.
    const hydrated = readSubmissionView(CHAIN, REQUEST, storage);
    expect(hydrated).toEqual({
      outcome: "unknown",
      txHash: TX_HASH,
      explorerUrl: `https://testnet.arcscan.app/tx/${TX_HASH}`,
    });

    // Yenilemeden sonra da gönderim ENGELLİ kalır.
    const send = vi.fn(async () => "tx2");
    expect(
      await runExclusiveSubmission(CHAIN, REQUEST, send, { storage, locks }),
    ).toEqual({ ok: false, reason: "recorded", existing: "unknown" });
    expect(send).not.toHaveBeenCalled();
  });

  it("bozuk gövde 'unknown' görünür ve başarı/başarısızlık İDDİA ETMEZ", () => {
    const storage = memoryStorage();
    storage.setItem(keyOf(CHAIN, REQUEST), "{bozuk");
    expect(readSubmissionView(CHAIN, REQUEST, storage)).toEqual({
      outcome: "unknown",
      txHash: null,
      explorerUrl: null,
    });
  });
});

describe("atomik gönderim kilidi", () => {
  it("kilit alınırsa rezervasyon yazılır ve iş çalışır", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();
    const send = vi.fn(async () => "gönderildi");

    const result = await runExclusiveSubmission(CHAIN, REQUEST, send, {
      storage,
      locks,
      nowMs: 1_700_000_000_000,
      owner: "sahip-1",
    });

    expect(result).toEqual({ ok: true, value: "gönderildi" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(bodyOf(storage, REQUEST)).toEqual({
      v: 2,
      chainId: CHAIN,
      requestId: REQUEST,
      outcome: "pending",
      owner: "sahip-1",
      at: 1_700_000_000_000,
    });
    expect(locks.held.size).toBe(0);
  });

  it("EŞZAMANLI iki sekmede en fazla BİR kit.send olur", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();
    const send = vi.fn(
      async () => new Promise((resolve) => setTimeout(() => resolve("tx"), 5)),
    );

    const [first, second] = await Promise.all([
      runExclusiveSubmission(CHAIN, REQUEST, send, { storage, locks }),
      runExclusiveSubmission(CHAIN, REQUEST, send, { storage, locks }),
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    const results = [first, second];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "busy" }]);
  });

  it("ÜÇ sekme yarışsa bile tek gönderim olur", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();
    const send = vi.fn(
      async () => new Promise((resolve) => setTimeout(() => resolve("tx"), 5)),
    );

    const results = await Promise.all(
      [0, 1, 2].map(() =>
        runExclusiveSubmission(CHAIN, REQUEST, send, { storage, locks }),
      ),
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("kilit BAŞKA sekmedeyse gönderim yapılmaz", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();
    locks.held.add(`hesabi-bol.send.${submissionKey(CHAIN, REQUEST)}`);
    const send = vi.fn(async () => "tx");

    expect(
      await runExclusiveSubmission(CHAIN, REQUEST, send, { storage, locks }),
    ).toEqual({ ok: false, reason: "busy" });
    expect(send).not.toHaveBeenCalled();
    expect(storage.map.size).toBe(0);
  });

  it("Web Locks YOKSA fail-closed: gönderim yapılmaz", async () => {
    const storage = memoryStorage();
    const send = vi.fn(async () => "tx");

    expect(
      await runExclusiveSubmission(CHAIN, REQUEST, send, {
        storage,
        locks: null,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
    expect(storage.map.size).toBe(0);
  });

  it("kilit isteği hata atarsa fail-closed olur", async () => {
    const send = vi.fn(async () => "tx");
    const throwing: LockManagerLike = {
      request: async () => {
        throw new Error("SecurityError");
      },
    };

    expect(
      await runExclusiveSubmission(CHAIN, REQUEST, send, {
        storage: memoryStorage(),
        locks: throwing,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("DEPO yoksa fail-closed: gönderim yapılmaz", async () => {
    const send = vi.fn(async () => "tx");
    expect(
      await runExclusiveSubmission(CHAIN, REQUEST, send, {
        storage: null,
        locks: fakeLocks(),
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("depo OKUNAMIYORSA fail-closed olur", async () => {
    const send = vi.fn(async () => "tx");
    const unreadable: StorageLike = {
      getItem: () => {
        throw new Error("erişim engellendi");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(
      await runExclusiveSubmission(CHAIN, REQUEST, send, {
        storage: unreadable,
        locks: fakeLocks(),
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("geçersiz kimliklerde fail-closed olur", async () => {
    const send = vi.fn(async () => "tx");
    expect(
      await runExclusiveSubmission(CHAIN, "0xkısa", send, {
        storage: memoryStorage(),
        locks: fakeLocks(),
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("rezervasyon YAZILAMAZSA gönderime geçilmez", async () => {
    const send = vi.fn(async () => "tx");
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("kota dolu");
      },
      removeItem: () => undefined,
    };
    expect(
      await runExclusiveSubmission(CHAIN, REQUEST, send, {
        storage: failing,
        locks: fakeLocks(),
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("SESSİZCE yutulan yazma hatasından sonra da gönderim yapılmaz", async () => {
    const send = vi.fn(async () => "tx");
    const silent: StorageLike = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(
      await runExclusiveSubmission(CHAIN, REQUEST, send, {
        storage: silent,
        locks: fakeLocks(),
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("var olan HER kayıt gönderimi engeller", async () => {
    for (const existing of [
      "pending",
      "success",
      "reverted",
      "unknown",
    ] as const) {
      const storage = memoryStorage();
      recordSubmission(CHAIN, REQUEST, existing, { storage });
      const send = vi.fn(async () => "tx");

      expect(
        await runExclusiveSubmission(CHAIN, REQUEST, send, {
          storage,
          locks: fakeLocks(),
        }),
        existing,
      ).toEqual({ ok: false, reason: "recorded", existing });
      expect(send, existing).not.toHaveBeenCalled();
    }
  });

  it("BOZUK kayıt da gönderimi engeller", async () => {
    const storage = memoryStorage();
    storage.setItem(keyOf(CHAIN, REQUEST), '{"v":1,"eski":true}');
    const send = vi.fn(async () => "tx");

    expect(
      await runExclusiveSubmission(CHAIN, REQUEST, send, {
        storage,
        locks: fakeLocks(),
      }),
    ).toEqual({ ok: false, reason: "recorded", existing: "unknown" });
    expect(send).not.toHaveBeenCalled();
  });

  it("iş fırlatırsa hata aktarılır ve rezervasyon KORUNUR", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();

    await expect(
      runExclusiveSubmission(
        CHAIN,
        REQUEST,
        async () => {
          throw new Error("kit.send patladı");
        },
        { storage, locks },
      ),
    ).rejects.toThrow("kit.send patladı");

    expect(readSubmission(CHAIN, REQUEST, storage)).toBe("pending");
    expect(locks.held.size).toBe(0);
  });
});

describe("rezervasyonun bırakılması", () => {
  it("yalnızca pending kaydı temizlenir", () => {
    const storage = memoryStorage();
    recordSubmission(CHAIN, REQUEST, "pending", { storage });
    clearReservation(CHAIN, REQUEST, storage);
    expect(readSubmission(CHAIN, REQUEST, storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it("terminal ve belirsiz kayıtlar temizlenmez", () => {
    for (const outcome of ["success", "reverted", "unknown"] as const) {
      const storage = memoryStorage();
      recordSubmission(CHAIN, REQUEST, outcome, { storage, txHash: TX_HASH });
      clearReservation(CHAIN, REQUEST, storage);
      expect(readSubmission(CHAIN, REQUEST, storage), outcome).toBe(outcome);
    }
  });

  it("bırakıldıktan sonra yeniden denenebilir", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();
    await runExclusiveSubmission(CHAIN, REQUEST, async () => "rejected", {
      storage,
      locks,
    });
    clearReservation(CHAIN, REQUEST, storage);

    const send = vi.fn(async () => "tx2");
    expect(
      await runExclusiveSubmission(CHAIN, REQUEST, send, { storage, locks }),
    ).toEqual({ ok: true, value: "tx2" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("silme başarısız olursa kayıt KALIR (güvenli yön)", () => {
    const storage = memoryStorage();
    recordSubmission(CHAIN, REQUEST, "pending", { storage });
    const stubborn: StorageLike = {
      getItem: storage.getItem,
      setItem: storage.setItem,
      removeItem: () => {
        throw new Error("silinemedi");
      },
    };
    expect(() => clearReservation(CHAIN, REQUEST, stubborn)).not.toThrow();
    expect(readSubmission(CHAIN, REQUEST, storage)).toBe("pending");
  });
});

describe("tarayıcı güvenlik uyarısı", () => {
  it("Türkçedir ve gönderimin YAPILMADIĞINI söyler", () => {
    expect(SUBMISSION_UNAVAILABLE_MESSAGE).toMatch(/Web Locks/);
    expect(SUBMISSION_UNAVAILABLE_MESSAGE).toMatch(/BAŞLATILMADI/);
    expect(SUBMISSION_UNAVAILABLE_MESSAGE).toMatch(/iki kez/);
  });
});
