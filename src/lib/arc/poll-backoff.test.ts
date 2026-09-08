import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  RECONCILE_MAX_ATTEMPTS,
  RECONCILE_POLL_DELAYS,
  RECONCILE_POLL_FACTOR,
  RECONCILE_POLL_INITIAL_MS,
  RECONCILE_POLL_MAX_MS,
  RECONCILE_POLL_WINDOW_MS,
} from "./shared-bill-payment-client";

/**
 * MUTABAKAT YOKLAMASINDA ÜSTEL GERİ ÇEKİLME.
 *
 * Önceki hâlde her 4 saniyede bir soruluyordu: 40 saniye süren bir onayda 10
 * istek, her biri iki veritabanı sorgusu. Onay ilk saniyelerde gelmediyse bir
 * sonraki saniyede de gelme ihtimali düşüktür.
 *
 * Buradaki testlerin ASIL işi kazancı değil, KAZANCIN BEDELSİZ olduğunu
 * sabitlemek: kullanıcının beklediği toplam süre ve ilk deneyim aynı kalmalı.
 */

describe("cizelge", () => {
  it("ILK bekleme degismedi", () => {
    /*
     * Erken deneyim aynen korunur: ilk saniyelerde davranış eskisiyle
     * birebir aynıdır ve kullanıcı bir fark görmez.
     */
    expect(RECONCILE_POLL_DELAYS[0]).toBe(RECONCILE_POLL_INITIAL_MS);
    expect(RECONCILE_POLL_INITIAL_MS).toBe(4000);
  });

  it("her adim bir oncekinden BUYUKTUR (son bekleme haric)", () => {
    /*
     * Son bekleme pencerenin KALANIDIR ve bir öncekinden kısa olabilir;
     * geri kalanı kesin olarak artar.
     */
    const growing = RECONCILE_POLL_DELAYS.slice(0, -1);
    for (let index = 1; index < growing.length; index += 1) {
      expect(growing[index], `adim ${index}`).toBeGreaterThan(
        growing[index - 1],
      );
    }
  });

  it("carpan uygulanir ve TAVANI asmaz", () => {
    for (let index = 1; index < RECONCILE_POLL_DELAYS.length - 1; index += 1) {
      const expected = Math.min(
        Math.round(RECONCILE_POLL_DELAYS[index - 1] * RECONCILE_POLL_FACTOR),
        RECONCILE_POLL_MAX_MS,
      );
      expect(RECONCILE_POLL_DELAYS[index], `adim ${index}`).toBe(expected);
    }
    for (const delay of RECONCILE_POLL_DELAYS) {
      expect(delay).toBeLessThanOrEqual(RECONCILE_POLL_MAX_MS);
      expect(delay).toBeGreaterThan(0);
    }
  });

  it("TAVAN gercekten devreye giriyor", () => {
    /*
     * Tavansız bir çarpan pencerenin sonunda tek bir uzun beklemeye
     * dönüşürdü: onay 21. saniyede gelse bile kullanıcı 40. saniyeye kadar
     * görmezdi. Çizelgede tavana ulaşan en az bir adım olmalı.
     */
    expect(RECONCILE_POLL_DELAYS).toContain(RECONCILE_POLL_MAX_MS);
  });
});

describe("TOPLAM PENCERE degismedi", () => {
  it("beklemelerin toplami pencereye TAM oturur", () => {
    /*
     * Kullanıcıya verilen söz "yaklaşık bir dakika izliyoruz". Geri çekilmeyi
     * pencereyi büyüterek uygulamak o sözü sessizce üç dakikaya çevirirdi —
     * ayrı ve açıkça alınması gereken bir ürün kararı.
     */
    const total = RECONCILE_POLL_DELAYS.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBe(RECONCILE_POLL_WINDOW_MS);
  });

  it("pencere ESKI davranisla ayni: 15 x 4 saniye", () => {
    expect(RECONCILE_POLL_WINDOW_MS).toBe(60_000);
    expect(15 * RECONCILE_POLL_INITIAL_MS).toBe(RECONCILE_POLL_WINDOW_MS);
  });
});

describe("KAZANC: ayni pencerede daha az istek", () => {
  it("deneme sayisi sabit araliktakinin YARISINDAN az", () => {
    /*
     * Asıl amaç buydu. Eski davranış pencereyi sabit aralığa bölüyordu;
     * yenisi aynı pencerede belirgin biçimde daha az soruyor.
     */
    const fixedIntervalAttempts =
      RECONCILE_POLL_WINDOW_MS / RECONCILE_POLL_INITIAL_MS;
    expect(RECONCILE_MAX_ATTEMPTS).toBeLessThan(fixedIntervalAttempts / 2);
  });

  it("deneme sayisi CIZELGEDEN turetilir, elle yazilmaz", () => {
    /*
     * Elle yazılsaydı çizelge değiştiğinde ikisi ayrışır ve döngü ya erken
     * biter ya da olmayan bir beklemeyi okumaya çalışırdı.
     */
    expect(RECONCILE_MAX_ATTEMPTS).toBe(RECONCILE_POLL_DELAYS.length + 1);
  });
});

describe("panel cizelgeyi KENDISI uretmez", () => {
  const panel = readFileSync(
    "src/components/SharedBillPaymentPanel.tsx",
    "utf8",
  );

  it("bekleme suresi cizelgeden okunur", () => {
    /*
     * Panelin içinde sabit bir sayı belirirse geri çekilme sessizce iptal
     * olur ve bu hiçbir testi düşürmezdi — o yüzden kaynakta aranıyor.
     */
    expect(panel).toContain("RECONCILE_POLL_DELAYS[attempt]");
    expect(panel).not.toMatch(/setTimeout\(resolve,\s*\d/);
  });

  it("cizelge bitince dongu DURUR", () => {
    /*
     * Son denemeden sonra beklenecek bir şey yoktur; `undefined` bir
     * beklemeyle `setTimeout` çağırmak sıfır milisaniyelik bir döngü
     * turuna dönerdi.
     */
    expect(panel).toContain("if (delay === undefined) break;");
  });
});
