import { describe, expect, it } from "vitest";

import {
  clearReservation,
  readSubmission,
  recordSubmission,
  reserveSubmission,
  submissionKey,
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
    expect(readSubmission(CHAIN, REQUEST, null)).toBeNull();
  });

  it("bozuk depo içeriği yok sayılır", () => {
    const broken: StorageLike = {
      getItem: () => "{bozuk",
      setItem: () => undefined,
    };
    expect(readSubmission(CHAIN, REQUEST, broken)).toBeNull();
  });

  it("yazma hatası atmaz", () => {
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("kota dolu");
      },
    };
    expect(() => recordSubmission(CHAIN, REQUEST, "success", failing)).not.toThrow();
  });
});

describe("gönderim rezervasyonu", () => {
  it("boş kayıtta rezervasyon alınır ve pending yazılır", () => {
    const storage = memoryStorage();
    expect(reserveSubmission(CHAIN, REQUEST, storage)).toEqual({ ok: true });
    expect(readSubmission(CHAIN, REQUEST, storage)).toBe("pending");
  });

  it("mevcut kayıt varsa rezervasyon REDDEDİLİR", () => {
    for (const existing of ["pending", "success", "unknown"] as const) {
      const storage = memoryStorage();
      recordSubmission(CHAIN, REQUEST, existing, storage);
      expect(reserveSubmission(CHAIN, REQUEST, storage), existing).toEqual({
        ok: false,
        existing,
      });
    }
  });

  it("ikinci rezervasyon denemesi kazara ikinci gönderimi engeller", () => {
    const storage = memoryStorage();
    expect(reserveSubmission(CHAIN, REQUEST, storage).ok).toBe(true);
    // Başka bir sekme aynı anda denerse aynı depoyu görür.
    expect(reserveSubmission(CHAIN, REQUEST, storage)).toEqual({
      ok: false,
      existing: "pending",
    });
  });

  it("farklı talep engellenmez", () => {
    const storage = memoryStorage();
    reserveSubmission(CHAIN, REQUEST, storage);
    expect(reserveSubmission(CHAIN, OTHER, storage).ok).toBe(true);
  });

  it("rezervasyon yalnızca pending kaydı için temizlenir", () => {
    const storage = memoryStorage();
    reserveSubmission(CHAIN, REQUEST, storage);
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

  it("depo yoksa rezervasyon engellemez (koruma yetkili değildir)", () => {
    expect(reserveSubmission(CHAIN, REQUEST, null)).toEqual({ ok: true });
    expect(() => clearReservation(CHAIN, REQUEST, null)).not.toThrow();
  });

  it("pending kaydı da gizli veri içermez", () => {
    const storage = memoryStorage();
    reserveSubmission(CHAIN, REQUEST, storage);
    const parsed = JSON.parse(storage.dump() as string) as Record<string, unknown>[];
    expect(Object.keys(parsed[0]).sort()).toEqual(["at", "key", "outcome"]);
  });
});
