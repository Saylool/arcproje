import { describe, expect, it } from "vitest";

import {
  MAX_JSON_SCAN_DEPTH,
  scanForDuplicateKeys,
} from "./json-duplicate-keys";

/**
 * Tarayıcı `JSON.parse`'tan önce çalışır ve metin/kaçış durumuna duyarlıdır.
 * Buradaki testler, eski regex yaklaşımının kaçırdığı ve yanlış yakaladığı
 * durumları kapsar.
 */

describe("yinelenen anahtarı yakalar", () => {
  it("zarf düzeyindeki yinelenen anahtarı yakalar", () => {
    expect(
      scanForDuplicateKeys('{"payload":{"a":1},"signature":"0x1","payload":{"a":2}}'),
    ).toBe("duplicate");
  });

  it("gövde içindeki yinelenen alanı yakalar", () => {
    expect(
      scanForDuplicateKeys('{"payload":{"microUsdc":"1","microUsdc":"9999"}}'),
    ).toBe("duplicate");
  });

  it("iç içe nesnedeki yinelenen alanı yakalar", () => {
    expect(
      scanForDuplicateKeys('{"a":{"b":{"c":1,"c":2}},"d":3}'),
    ).toBe("duplicate");
  });

  it("dizi içindeki nesnede de yakalar", () => {
    expect(scanForDuplicateKeys('{"list":[{"k":1,"k":2}]}')).toBe("duplicate");
  });

  it("kaçışla yazılmış aynı anahtarı aynı sayar", () => {
    // "a" ile "a" JSON.parse için aynı anahtardır.
    expect(scanForDuplicateKeys('{"a":1,"\\u0061":2}')).toBe("duplicate");
  });
});

describe("geçerli yapıları yanlışlıkla reddetmez", () => {
  it("farklı nesnelerde aynı anahtar adı serbesttir", () => {
    expect(scanForDuplicateKeys('{"a":{"k":1},"b":{"k":2}}')).toBe("ok");
    expect(scanForDuplicateKeys('{"l":[{"k":1},{"k":2}]}')).toBe("ok");
  });

  it("metin içindeki anahtar benzeri içerik anahtar sanılmaz", () => {
    expect(
      scanForDuplicateKeys('{"payload":{"debtorLabel":"\\"payload\\": 1"}}'),
    ).toBe("ok");
    expect(
      scanForDuplicateKeys('{"recipientLabel":"a\\":1,\\"recipientLabel"}'),
    ).toBe("ok");
  });

  it("kaçışlı tırnak ve ters bölü tarayıcıyı şaşırtmaz", () => {
    expect(scanForDuplicateKeys('{"a":"ters boelue: \\\\","b":1}')).toBe("ok");
    expect(scanForDuplicateKeys('{"a":"\\\\","a2":"\\""}')).toBe("ok");
    // Değer ters bölü ile bitiyor; kapanış tırnağı kaçırılırsa "a" iki kez
    // görülür ve yanlışlıkla yineleme sanılırdı.
    expect(scanForDuplicateKeys('{"a":"x\\\\","c":"a"}')).toBe("ok");
  });

  it("dizi ve iç içe yapıları doğru gezer", () => {
    expect(
      scanForDuplicateKeys('{"a":[1,2,{"b":[{"c":1}]}],"d":{"e":null}}'),
    ).toBe("ok");
  });

  it("gerçek imzalı zarf biçimini kabul eder", () => {
    const envelope = JSON.stringify({
      payload: {
        schemaVersion: 1,
        requestId: `0x${"33".repeat(32)}`,
        recipientLabel: "Ayşe",
        debtorLabel: "Sen",
      },
      signature: `0x${"ab".repeat(65)}`,
    });
    expect(scanForDuplicateKeys(envelope)).toBe("ok");
  });
});

describe("bozuk girdiyi bozuk sayar", () => {
  it("kapanmayan metni bozuk sayar", () => {
    expect(scanForDuplicateKeys('{"a":"kapanmadi')).toBe("malformed");
  });

  it("kapanmayan nesneyi bozuk sayar", () => {
    expect(scanForDuplicateKeys('{"a":1')).toBe("malformed");
  });

  it("fazladan kapanışı bozuk sayar", () => {
    expect(scanForDuplicateKeys('{"a":1}}')).toBe("malformed");
  });

  it("derinlik sınırını aşan yapıyı bozuk sayar", () => {
    const tooDeep = "[".repeat(MAX_JSON_SCAN_DEPTH + 1);
    expect(scanForDuplicateKeys(tooDeep)).toBe("malformed");
  });

  it("sınırın hemen altındaki derinliği kabul eder", () => {
    const deep =
      "[".repeat(MAX_JSON_SCAN_DEPTH) + "]".repeat(MAX_JSON_SCAN_DEPTH);
    expect(scanForDuplicateKeys(deep)).toBe("ok");
  });
});
