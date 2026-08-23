import { describe, expect, it } from "vitest";

import {
  readSubmission,
  recordSubmission,
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
