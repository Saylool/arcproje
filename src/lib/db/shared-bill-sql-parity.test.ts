import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { claimSharedBillPayment } from "./shared-bill-claim-service";
import {
  PAYMENT_BILL_ID,
  PAYMENT_NOW,
  fakeMint,
  seedPaidBill,
} from "./shared-bill-payment.fixture";
import { prepareSharedBillPaymentOffer } from "./shared-bill-payment-service";

/**
 * DEPO UYGULAMALARININ EŞLEŞMESİ (SQL ↔ bellek içi).
 *
 * İki uygulama vardır: üretimdeki Neon SQL'i ve testlerin kullandığı bellek
 * içi sahte depo. İkisi AYNI durum makinesini uygulamak zorundadır; aksi
 * hâlde testler yeşil kalırken üretim farklı davranır.
 *
 * SINIR: bu depoda çalışan bir Postgres YOKTUR, bu yüzden SQL burada
 * ÇALIŞTIRILAMAZ. Aşağıdaki eşleşme testleri, SQL metninin doğru semantiği
 * KODLADIĞINI ölçer; gerçek yürütme doğrulaması geçiş uygulandıktan sonra
 * yapılır.
 */

const neon = readFileSync(
  "src/lib/db/neon-shared-bill-repository.ts",
  "utf8",
);

function settleSql(): string {
  const start = neon.indexOf("const SETTLE_ATTEMPT = `");
  const end = neon.indexOf("`;", start);
  expect(start).toBeGreaterThan(-1);
  return neon.slice(start, end);
}

describe("hesap kapanışı: SQL ile bellek içi depo AYNI davranmalı", () => {
  /**
   * PostgreSQL'de `WITH` alt deyimleri BİRBİRİNİN etkisini GÖREMEZ: hepsi
   * deyim öncesi anlık görüntüyü okur.
   *
   * Bu yüzden borcu `paid` yapan CTE ile "başka ödenmemiş borç kaldı mı?"
   * diye bakan CTE aynı deyimdeyse, İKİNCİSİ birincinin yazdığını GÖRMEZ ve
   * son borç onaylandığında hesap ASLA kapanmaz. Kapanış koşulu bu yüzden
   * o anda yerleşen satırı AÇIKÇA hariç tutmak zorundadır.
   */
  it("kapanış koşulu, AYNI deyimde yerleşen borcu HARİÇ TUTAR", () => {
    const sql = settleSql();
    const notExists = sql.slice(sql.indexOf("NOT EXISTS"));

    // Yerleşen satır, anlık görüntüde hâlâ eski durumda göründüğü için
    // "ödenmemiş" sayılırdı; açıkça dışarıda bırakılmalıdır.
    expect(
      notExists,
      "kapanış NOT EXISTS koşulu yerleşen borçluyu hariç tutmuyor",
    ).toContain("debtor_address");

    // Kapanış YALNIZCA yerleşim `paid` olduğunda denenmelidir.
    expect(
      sql,
      "kapanış, yerleşimin `paid` olmasına bağlanmamış",
    ).toMatch(/\$5\s*=\s*'paid'/);
  });

  it("kapanış hâlâ TÜM borçların ödenmiş olmasını arar", () => {
    const sql = settleSql();
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("payment_status <> 'paid'");
  });
});

describe("bellek içi depo: hesap TÜM borçlar onaylanınca kapanır", () => {
  /** Teklif bas → rezerve et → onaylı makbuzla yerleştir. */
  async function payDebt(
    seeded: Awaited<ReturnType<typeof seedPaidBill>>,
    index: number,
  ): Promise<{ billClosed: boolean }> {
    const offerId = `0x${String(index + 10).repeat(32).slice(0, 64)}`;
    const attemptId = `0x${String(index + 20).repeat(32).slice(0, 64)}`;

    const prepared = await prepareSharedBillPaymentOffer({
      sessionToken: seeded.sessionTokens[index],
      pathBillId: PAYMENT_BILL_ID,
      repository: seeded.repository,
      nowMs: PAYMENT_NOW,
      mintQuote: fakeMint(),
      offerId,
    });
    if (!prepared.ok) throw new Error(`teklif: ${prepared.code}`);

    const claim = await claimSharedBillPayment({
      bodyText: JSON.stringify({ offerId }),
      sessionToken: seeded.sessionTokens[index],
      pathBillId: PAYMENT_BILL_ID,
      repository: seeded.repository,
      nowMs: PAYMENT_NOW,
      attemptId,
    });
    if (!claim.ok) throw new Error(`rezervasyon: ${claim.code}`);

    const settled = await seeded.repository.settleAttempt({
      attemptId,
      billId: PAYMENT_BILL_ID,
      debtor: claim.claim.snapshot.debtorAddress,
      settlement: "confirmed",
      txHash: `0x${String(index + 30).repeat(32).slice(0, 64)}`,
      nowMs: PAYMENT_NOW,
    });
    if (!settled.ok) throw new Error(`yerlesim: ${settled.reason}`);
    return { billClosed: settled.billClosed };
  }

  it("son borç onaylanana kadar hesap AÇIK, sonra KAPALI", async () => {
    const seeded = await seedPaidBill({ amounts: ["1000", "2000"] });

    const first = await payDebt(seeded, 0);
    expect(first.billClosed, "ilk borçta hesap kapanmamalı").toBe(false);
    expect(
      seeded.repository.bills.get(PAYMENT_BILL_ID.toLowerCase())?.status,
    ).toBe("open");

    const second = await payDebt(seeded, 1);
    expect(second.billClosed, "son borçta hesap KAPANMALI").toBe(true);
    expect(
      seeded.repository.bills.get(PAYMENT_BILL_ID.toLowerCase())?.status,
    ).toBe("closed");
  });
});

describe("sahiplik SQL'i", () => {
  it("hesap yazimi sahiplik sutununu tasir", () => {
    const start = neon.indexOf("const INSERT_BILL");
    const query = neon.slice(start, neon.indexOf("`;", start));
    expect(query).toContain("created_by_user_id");
  });

  it("yabanci anahtar reddederse hesap ATIFSIZ yeniden yazilir", () => {
    /*
     * Kullanici satiri oturum ile yazim arasinda silinmisse hesap
     * KAYBEDILMEZ. Dal, YALNIZCA sahiplik kisitina bagli olmalidir: baska bir
     * yabanci anahtar ihlalini sessizce yutmak, gercek bir veri hatasini
     * gizlerdi.
     */
    expect(neon).toContain(
      'const OWNER_FOREIGN_KEY_CONSTRAINT = "shared_bills_created_by_app_user";',
    );
    const start = neon.indexOf("code === FOREIGN_KEY_VIOLATION");
    expect(start).toBeGreaterThan(-1);
    const branch = neon.slice(start, start + 500);
    expect(branch).toContain("OWNER_FOREIGN_KEY_CONSTRAINT");
    expect(branch).toContain("attribution.createdByUserId !== null");
    expect(branch).toContain("await insert(null)");
  });

  it("yeniden deneme TEK seferliktir; dongu yoktur", () => {
    const start = neon.indexOf("code === FOREIGN_KEY_VIOLATION");
    const branch = neon.slice(start, start + 500);
    expect(branch).not.toMatch(/\bwhile\b|\bfor\b|createSharedBill\(/);
    // Atif zaten null iken dal calismaz: sonsuz yeniden deneme imkansizdir.
    expect(branch).toContain("attribution.createdByUserId !== null");
  });

  it("sahip listesi sorgusu borclu verisini SECMEZ", () => {
    const start = neon.indexOf("const SELECT_BILLS_CREATED_BY");
    expect(start).toBeGreaterThan(-1);
    const query = neon.slice(start, neon.indexOf("`;", start));
    expect(query).toContain("WHERE b.created_by_user_id = $1");
    expect(query).toContain("LIMIT $2");
    for (const forbidden of [
      "debtor_address",
      "debtor_label",
      "debt_key",
      "recipient_signature",
      "recipient_address",
      "debts_root",
    ]) {
      expect(query, forbidden).not.toContain(forbidden);
    }
  });
});

describe("rehber SQL'i", () => {
  it("YAS SINIRI sorgunun kendisindedir", () => {
    /*
     * Bu, sahte deponun gizleyebilecegi tek boslugtur: bellek ici depo yasi
     * suzse bile SQL suzmezse uretim yillar oncesini onerir. Sinir SORGUDA
     * olmalidir.
     */
    const start = neon.indexOf("const SELECT_RECENT_DEBTORS");
    expect(start).toBeGreaterThan(-1);
    const query = neon.slice(start, neon.indexOf("`;", start));
    expect(query).toContain("b.created_at > to_timestamp($3)");
    expect(query).toContain("WHERE b.created_by_user_id = $1");
    expect(query).toContain("LIMIT $2");
  });

  it("kesim ani CAGIRANDAN gelir, sorguya gomulmez", () => {
    // Sabit bir `interval` gomulseydi sinir tek yerden yonetilemezdi.
    const start = neon.indexOf("const SELECT_RECENT_DEBTORS");
    const query = neon.slice(start, neon.indexOf("`;", start));
    expect(query).not.toMatch(/interval\s*'/i);

    const call = neon.indexOf("SELECT_RECENT_DEBTORS, [");
    expect(call).toBeGreaterThan(-1);
    expect(neon.slice(call, call + 220)).toContain("input.notUsedBefore");
  });

  it("adres basina TEK satir birakilir", () => {
    const start = neon.indexOf("const SELECT_RECENT_DEBTORS");
    const query = neon.slice(start, neon.indexOf("`;", start));
    expect(query).toContain("DISTINCT ON (lower(d.debtor_address))");
  });
});
