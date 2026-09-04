import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { localizeApiError } from "@/lib/i18n/api-errors";

import {
  PERSONAL_LIMIT_CODE,
  SERVICE_BUSY_CODE,
  quotaDisplayAfterFailure,
} from "./quota-feedback";

/**
 * AYNI DURUM KODU, FARKLI SONUÇ.
 *
 * Bulgu şuydu: bileşen her 429'da kalan hakkı sıfıra çekiyordu. Oysa 429 iki
 * ayrı sebeple gelir ve yalnızca biri kişisel hakkın bittiğini söyler.
 *
 * Bu testler kararı doğrudan ölçer — kaynak metnine bakarak değil.
 */

describe("429 ayrımı", () => {
  it("KİŞİSEL sınır sıfır gösterir", () => {
    expect(quotaDisplayAfterFailure(429, PERSONAL_LIMIT_CODE)).toEqual({
      kind: "showExhausted",
    });
  });

  it("GENEL tavan bilinen değeri KORUR", () => {
    /*
     * Asıl kusur buydu: genel tavan dolduğunda kullanıcıya, hiç harcamadığı
     * hakkı bitmiş gibi gösteriliyordu.
     */
    expect(quotaDisplayAfterFailure(429, SERVICE_BUSY_CODE)).toEqual({
      kind: "keepKnown",
    });
  });

  it("AYNI durum kodu iki farklı sonuç verir", () => {
    // Durumun tek başına karar veremeyeceğini sabitler.
    expect(quotaDisplayAfterFailure(429, PERSONAL_LIMIT_CODE)).not.toEqual(
      quotaDisplayAfterFailure(429, SERVICE_BUSY_CODE),
    );
  });

  it("TANINMAYAN kod sıfır SAYILMAZ", () => {
    for (const code of ["", "WAT", "daily_limit_reached", null]) {
      expect(quotaDisplayAfterFailure(429, code), String(code)).toEqual({
        kind: "keepKnown",
      });
    }
  });

  it("429 DIŞINDAKİ hiçbir durum kalan hakkı sıfırlamaz", () => {
    // 413 platformdan gelir ve kod taşımaz; 401/503 kotayla ilgili değildir.
    for (const status of [400, 401, 413, 415, 422, 500, 502, 503, 504]) {
      expect(
        quotaDisplayAfterFailure(status, PERSONAL_LIMIT_CODE),
        String(status),
      ).toEqual({ kind: "keepKnown" });
    }
  });
});

describe("bileşen kararı KENDİ vermez", () => {
  const source = readFileSync("src/components/ReceiptFlow.tsx", "utf8");

  it("sıfırlama yalnızca saf fonksiyonun kararıyla olur", () => {
    expect(source).toContain("quotaDisplayAfterFailure(response.status");
    // Durumu tek başına okuyan bir dal geri sızmamalı.
    expect(source).not.toContain("response.status === 429 &&");
    expect(source.split("setRemainingAnalyses(0)").length - 1).toBe(1);
  });
});

describe("iki dilde de anlaşılır", () => {
  it("kişisel ve genel sınır AYNI cümleyi kullanmaz", () => {
    /*
     * İkisi aynı metni gösterseydi kullanıcı beklemesi mi yoksa yarını mı
     * beklemesi gerektiğini ayırt edemezdi.
     */
    for (const locale of ["tr", "en"] as const) {
      const personal = localizeApiError(locale, PERSONAL_LIMIT_CODE);
      const busy = localizeApiError(locale, SERVICE_BUSY_CODE);
      expect(personal, locale).not.toBe("");
      expect(busy, locale).not.toBe("");
      expect(personal, locale).not.toBe(busy);
    }
  });
});
