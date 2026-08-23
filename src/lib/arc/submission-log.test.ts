import { describe, expect, it, vi } from "vitest";

import {
  SUBMISSION_UNAVAILABLE_MESSAGE,
  clearReservation,
  readSubmission,
  recordSubmission,
  runExclusiveSubmission,
  submissionKey,
  type LockManagerLike,
  type StorageLike,
} from "./submission-log";

/** Bellek içi sahte depo. */
function memoryStorage(): StorageLike & { dump: () => string | null } {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_k, v) => {
      value = v;
    },
    dump: () => value,
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

describe("yerel gönderim işaretçisi", () => {
  it("anahtar yalnızca zincir ve talep kimliğinden oluşur", () => {
    expect(submissionKey(CHAIN, REQUEST)).toBe(`${CHAIN}:${REQUEST}`);
    // Büyük/küçük harf farkı aynı talebi gösterir.
    expect(submissionKey(CHAIN, REQUEST.toUpperCase())).toBe(
      submissionKey(CHAIN, REQUEST),
    );
  });

  it("kayıt yoksa null döner", () => {
    expect(readSubmission(CHAIN, REQUEST, memoryStorage())).toBeNull();
  });

  it("başarı ve belirsizlik kaydedilip okunur", () => {
    const storage = memoryStorage();
    recordSubmission(CHAIN, REQUEST, "success", storage);
    expect(readSubmission(CHAIN, REQUEST, storage)).toBe("success");

    recordSubmission(CHAIN, OTHER, "unknown", storage);
    expect(readSubmission(CHAIN, OTHER, storage)).toBe("unknown");
    // Diğer kayıt bozulmaz.
    expect(readSubmission(CHAIN, REQUEST, storage)).toBe("success");
  });

  it("farklı zincirdeki aynı talep ayrı sayılır", () => {
    const storage = memoryStorage();
    recordSubmission(CHAIN, REQUEST, "success", storage);
    expect(readSubmission(1, REQUEST, storage)).toBeNull();
  });

  it("aynı talep tekrar kaydedilince kopyalanmaz", () => {
    const storage = memoryStorage();
    recordSubmission(CHAIN, REQUEST, "unknown", storage);
    recordSubmission(CHAIN, REQUEST, "success", storage);
    const parsed = JSON.parse(storage.dump() as string) as unknown[];
    expect(parsed).toHaveLength(1);
    expect(readSubmission(CHAIN, REQUEST, storage)).toBe("success");
  });

  it("HİÇBİR gizli veya kişisel alan saklanmaz", () => {
    const storage = memoryStorage();
    recordSubmission(CHAIN, REQUEST, "success", storage);
    const raw = storage.dump() as string;
    // Yalnızca anahtar, sonuç ve zaman damgası bulunur.
    const parsed = JSON.parse(raw) as Record<string, unknown>[];
    expect(Object.keys(parsed[0]).sort()).toEqual(["at", "key", "outcome"]);
    expect(raw).not.toContain("0x742d");
    expect(raw).not.toContain("microUsdc");
  });

  it("depo yoksa sessizce çalışır", () => {
    expect(() => recordSubmission(CHAIN, REQUEST, "success", null)).not.toThrow();
    expect(recordSubmission(CHAIN, REQUEST, "success", null)).toBe(false);
    expect(readSubmission(CHAIN, REQUEST, null)).toBeNull();
  });

  it("bozuk depo içeriği yok sayılır", () => {
    const broken: StorageLike = {
      getItem: () => "{bozuk",
      setItem: () => undefined,
    };
    expect(readSubmission(CHAIN, REQUEST, broken)).toBeNull();
  });

  it("yazma hatası atmaz ama BAŞARI SAYILMAZ", () => {
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("kota dolu");
      },
    };
    expect(() => recordSubmission(CHAIN, REQUEST, "success", failing)).not.toThrow();
    expect(recordSubmission(CHAIN, REQUEST, "success", failing)).toBe(false);
  });

  it("sessizce yok sayılan yazma da başarısız sayılır", () => {
    // `setItem` hata atmıyor ama içerik kalıcı olmuyor (bazı gizli modlar).
    const silent: StorageLike = { getItem: () => null, setItem: () => undefined };
    expect(recordSubmission(CHAIN, REQUEST, "success", silent)).toBe(false);
  });

  it("rezervasyon yalnızca pending kaydı için temizlenir", () => {
    const storage = memoryStorage();
    recordSubmission(CHAIN, REQUEST, "pending", storage);
    clearReservation(CHAIN, REQUEST, storage);
    expect(readSubmission(CHAIN, REQUEST, storage)).toBeNull();
  });

  it("başarı veya belirsizlik kaydı temizlenmez", () => {
    for (const outcome of ["success", "unknown"] as const) {
      const storage = memoryStorage();
      recordSubmission(CHAIN, REQUEST, outcome, storage);
      clearReservation(CHAIN, REQUEST, storage);
      expect(readSubmission(CHAIN, REQUEST, storage), outcome).toBe(outcome);
    }
  });

  it("depo yoksa temizleme atmaz", () => {
    expect(() => clearReservation(CHAIN, REQUEST, null)).not.toThrow();
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
    });

    expect(result).toEqual({ ok: true, value: "gönderildi" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(readSubmission(CHAIN, REQUEST, storage)).toBe("pending");
    // Kilit iş bitince bırakılır.
    expect(locks.held.size).toBe(0);
  });

  it("pending kaydı da gizli veri içermez", async () => {
    const storage = memoryStorage();
    await runExclusiveSubmission(CHAIN, REQUEST, async () => 1, {
      storage,
      locks: fakeLocks(),
    });
    const parsed = JSON.parse(storage.dump() as string) as Record<string, unknown>[];
    expect(Object.keys(parsed[0]).sort()).toEqual(["at", "key", "outcome"]);
  });

  it("EŞZAMANLI iki sekmede en fazla BİR kit.send olur", async () => {
    // Tek depo + tek kilit yöneticisi = aynı tarayıcıdaki iki sekme.
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
    // Başka bir sekme kilidi tutuyor.
    locks.held.add(`hesabi-bol.send.${submissionKey(CHAIN, REQUEST)}`);
    const send = vi.fn(async () => "tx");

    const result = await runExclusiveSubmission(CHAIN, REQUEST, send, {
      storage,
      locks,
    });

    expect(result).toEqual({ ok: false, reason: "busy" });
    expect(send).not.toHaveBeenCalled();
    // Kilit alınamadığı için rezervasyon da yazılmaz.
    expect(readSubmission(CHAIN, REQUEST, storage)).toBeNull();
  });

  it("Web Locks YOKSA fail-closed: gönderim yapılmaz", async () => {
    const storage = memoryStorage();
    const send = vi.fn(async () => "tx");

    const result = await runExclusiveSubmission(CHAIN, REQUEST, send, {
      storage,
      locks: null,
    });

    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
    expect(readSubmission(CHAIN, REQUEST, storage)).toBeNull();
  });

  it("kilit isteği hata atarsa fail-closed olur", async () => {
    const storage = memoryStorage();
    const send = vi.fn(async () => "tx");
    const throwing: LockManagerLike = {
      request: async () => {
        // Güvenli olmayan bağlamda Web Locks erişimi hata atabilir.
        throw new Error("SecurityError");
      },
    };

    const result = await runExclusiveSubmission(CHAIN, REQUEST, send, {
      storage,
      locks: throwing,
    });

    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("DEPO yoksa fail-closed: gönderim yapılmaz", async () => {
    const send = vi.fn(async () => "tx");

    const result = await runExclusiveSubmission(CHAIN, REQUEST, send, {
      storage: null,
      locks: fakeLocks(),
    });

    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("rezervasyon YAZILAMAZSA gönderime geçilmez", async () => {
    const send = vi.fn(async () => "tx");
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("kota dolu");
      },
    };

    const result = await runExclusiveSubmission(CHAIN, REQUEST, send, {
      storage: failing,
      locks: fakeLocks(),
    });

    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("SESSİZCE yutulan yazma hatasından sonra da gönderim yapılmaz", async () => {
    const send = vi.fn(async () => "tx");
    // `setItem` hata atmaz ama kalıcı olmaz: kilit gibi güvenilemez.
    const silent: StorageLike = { getItem: () => null, setItem: () => undefined };

    const result = await runExclusiveSubmission(CHAIN, REQUEST, send, {
      storage: silent,
      locks: fakeLocks(),
    });

    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("var olan her kayıt gönderimi engeller", async () => {
    for (const existing of ["pending", "success", "unknown"] as const) {
      const storage = memoryStorage();
      recordSubmission(CHAIN, REQUEST, existing, storage);
      const send = vi.fn(async () => "tx");

      const result = await runExclusiveSubmission(CHAIN, REQUEST, send, {
        storage,
        locks: fakeLocks(),
      });

      expect(result, existing).toEqual({ ok: false, reason: "recorded", existing });
      expect(send, existing).not.toHaveBeenCalled();
    }
  });

  it("farklı talep engellenmez", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();
    await runExclusiveSubmission(CHAIN, REQUEST, async () => 1, { storage, locks });
    const send = vi.fn(async () => 2);
    const result = await runExclusiveSubmission(CHAIN, OTHER, send, {
      storage,
      locks,
    });
    expect(result).toEqual({ ok: true, value: 2 });
    expect(send).toHaveBeenCalledTimes(1);
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

    // Yayın olmuş OLABİLİR: kayıt silinmez, ikinci deneme engellenir.
    expect(readSubmission(CHAIN, REQUEST, storage)).toBe("pending");
    expect(locks.held.size).toBe(0);
  });

  it("başarı sonrası kayıt success'e yükseltilir ve tekrar engellenir", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();
    await runExclusiveSubmission(CHAIN, REQUEST, async () => "tx", {
      storage,
      locks,
    });
    recordSubmission(CHAIN, REQUEST, "success", storage);

    const send = vi.fn(async () => "tx2");
    const again = await runExclusiveSubmission(CHAIN, REQUEST, send, {
      storage,
      locks,
    });
    expect(again).toEqual({ ok: false, reason: "recorded", existing: "success" });
    expect(send).not.toHaveBeenCalled();
  });

  it("belirsiz sonuçtan sonra tekrar denenemez", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();
    await runExclusiveSubmission(CHAIN, REQUEST, async () => "tx", {
      storage,
      locks,
    });
    recordSubmission(CHAIN, REQUEST, "unknown", storage);

    const send = vi.fn(async () => "tx2");
    const again = await runExclusiveSubmission(CHAIN, REQUEST, send, {
      storage,
      locks,
    });
    expect(again).toEqual({ ok: false, reason: "recorded", existing: "unknown" });
    expect(send).not.toHaveBeenCalled();
  });

  it("revert sonrası kayıt korunduğu için tekrar denenemez", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();
    // Revert de kalıcıdır: rezervasyon "unknown" olarak korunur.
    await runExclusiveSubmission(CHAIN, REQUEST, async () => "revert", {
      storage,
      locks,
    });
    recordSubmission(CHAIN, REQUEST, "unknown", storage);

    const send = vi.fn(async () => "tx2");
    expect(
      await runExclusiveSubmission(CHAIN, REQUEST, send, { storage, locks }),
    ).toEqual({ ok: false, reason: "recorded", existing: "unknown" });
    expect(send).not.toHaveBeenCalled();
  });

  it("yayın ÖNCESİ ret sonrası rezervasyon bırakılır ve yeniden denenebilir", async () => {
    const storage = memoryStorage();
    const locks = fakeLocks();

    await runExclusiveSubmission(CHAIN, REQUEST, async () => "rejected", {
      storage,
      locks,
    });
    // Cüzdan reddi kanıtlanmış yayın öncesi hatadır: kayıt silinir.
    clearReservation(CHAIN, REQUEST, storage);
    expect(readSubmission(CHAIN, REQUEST, storage)).toBeNull();

    const send = vi.fn(async () => "tx2");
    const retry = await runExclusiveSubmission(CHAIN, REQUEST, send, {
      storage,
      locks,
    });
    expect(retry).toEqual({ ok: true, value: "tx2" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("tarayıcı güvenlik uyarısı", () => {
  it("Türkçedir ve gönderimin YAPILMADIĞINI söyler", () => {
    expect(SUBMISSION_UNAVAILABLE_MESSAGE).toMatch(/Web Locks/);
    expect(SUBMISSION_UNAVAILABLE_MESSAGE).toMatch(/BAŞLATILMADI/);
    expect(SUBMISSION_UNAVAILABLE_MESSAGE).toMatch(/iki kez/);
  });
});
