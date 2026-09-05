import { describe, expect, it } from "vitest";

import { translate } from "@/lib/i18n/dictionary";
import type { Receipt } from "@/lib/receipt/schema";

import {
  DISCOUNT_AMOUNT_FIELD,
  SERVICE_AMOUNT_FIELD,
  TAX_AMOUNT_FIELD,
  TOTAL_AMOUNT_FIELD,
  amountFieldDomId,
  amountFieldIds,
  blockingAmountFields,
  checkAmountsReadable,
  itemAmountField,
  updateInvalidAmountFields,
  type AmountFieldId,
} from "./amount-fields";

/**
 * OKUNAMAYAN TUTARLA İLERLEME.
 *
 * Kusur şuydu: `999,999` yazan biri kırmızı bir alan görüyor, "devam"a
 * basıyor ve borçlar EKRANDA GÖRDÜĞÜNDEN başka bir tutardan — son geçerli
 * değerden — hesaplanıyordu. Fiş doğrulaması bunu göremez, çünkü okunamayan
 * metin fişe hiç işlenmez; fiş kendi başına kusursuz görünür.
 *
 * Karar burada saf tutuluyor. Depoda bileşen testi altyapısı yok, ve bunu
 * "kaynakta şu satır geçiyor mu" diye ölçmek bugün tam olarak bir üretim
 * hatasını gizlemişti. Bileşende kalan bağlantı ise DERLEYİCİYE bırakıldı:
 * `onValidityChange` zorunlu bir prop ve alan kimliği MARKALI bir tip.
 */

function buildReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    merchantName: "Test Kafe",
    currency: "TRY",
    items: [
      { id: "a", name: "Çay", totalMinor: 2500 },
      { id: "b", name: "Kek", totalMinor: 4000 },
    ],
    taxMinor: 450,
    taxTreatment: "included_in_items",
    serviceChargeMinor: 0,
    serviceChargeTreatment: "included_in_items",
    discountMinor: 0,
    discountTreatment: "included_in_items",
    totalMinor: 6950,
    warnings: [],
    ...overrides,
  };
}

describe("hangi alanlar ilerlemeyi engeller", () => {
  it("okunamayan alan varsa ILERLENMEZ", () => {
    const receipt = buildReceipt();
    expect(
      checkAmountsReadable([itemAmountField("a")], receipt),
    ).toEqual({ ok: false, focusField: itemAmountField("a") });
  });

  it("hicbir alan bozuk degilse ILERLENIR", () => {
    expect(checkAmountsReadable([], buildReceipt())).toEqual({ ok: true });
  });

  it("SILINEN urunun bozuk tutari artik ENGELLEMEZ", () => {
    /*
     * Asıl incelik bu. Kullanıcı bozuk tutarlı ürünü silerse alan ekrandan
     * kalkar; kimliği sadece biriktirseydik düzeltilemeyen, GÖRÜNMEZ bir
     * engel kalırdı ve akış kalıcı olarak kilitlenirdi.
     */
    const invalid = [itemAmountField("a")];
    const withoutA = buildReceipt({
      items: [{ id: "b", name: "Kek", totalMinor: 4000 }],
    });
    expect(checkAmountsReadable(invalid, withoutA)).toEqual({ ok: true });
  });

  it("BASKA bir urunun bozuk alani engellemeye devam eder", () => {
    // Eleme fazla genis olsaydi bu da sessizce gecerdi.
    const invalid = [itemAmountField("a"), itemAmountField("b")];
    const withoutA = buildReceipt({
      items: [{ id: "b", name: "Kek", totalMinor: 4000 }],
    });
    expect(checkAmountsReadable(invalid, withoutA)).toEqual({
      ok: false,
      focusField: itemAmountField("b"),
    });
  });

  it("odak EN USTTEKI bozuk alana gider", () => {
    /*
     * Sıra rastgele olsaydı kullanıcı ekranın altına atlar, yukarıdaki
     * hatayı görmezdi. Küme sırası değil, EKRAN sırası belirler.
     */
    const receipt = buildReceipt();
    const invalid = [TOTAL_AMOUNT_FIELD, itemAmountField("b"), TAX_AMOUNT_FIELD];
    expect(checkAmountsReadable(invalid, receipt)).toEqual({
      ok: false,
      focusField: itemAmountField("b"),
    });
  });

  it("ozet alanlari da ENGELLER, urunlerle sinirli degil", () => {
    const receipt = buildReceipt();
    for (const summary of [
      TAX_AMOUNT_FIELD,
      SERVICE_AMOUNT_FIELD,
      DISCOUNT_AMOUNT_FIELD,
      TOTAL_AMOUNT_FIELD,
    ]) {
      expect(checkAmountsReadable([summary], receipt), summary).toEqual({
        ok: false,
        focusField: summary,
      });
    }
  });
});

describe("alan kimlikleri", () => {
  it("HER para alani kayitli", () => {
    /*
     * KAPSAM KANITI. Şemaya beşinci bir tutar eklenirse (`tipMinor` gibi) ve
     * kaydedilmezse o alan sessizce engellenemez hale gelirdi — kusur tam
     * olarak geri gelir, hiçbir test kırılmadan. Beklenen sayı şemadan
     * TÜRETİLİR, elle yazılmaz.
     */
    const receipt = buildReceipt();
    const receiptLevelAmounts = Object.keys(receipt).filter((key) =>
      key.endsWith("Minor"),
    );
    expect(amountFieldIds(receipt)).toHaveLength(
      receipt.items.length + receiptLevelAmounts.length,
    );
  });

  it("urun kimligi ozet alanlariyla CAKISAMAZ", () => {
    // `tax` adinda bir urun kimligi ozet alanini golgeleyebilirdi.
    expect(itemAmountField("tax")).not.toBe(TAX_AMOUNT_FIELD);
    expect(amountFieldDomId(itemAmountField("tax"))).not.toBe(
      amountFieldDomId(TAX_AMOUNT_FIELD),
    );
  });

  it("DOM kimligi TEK yerden uretilir", () => {
    /*
     * Alanın `id`si ve odaklanırken aranan `id` aynı fonksiyondan gelir;
     * ayrı yazılsalardı biri değişince odak sessizce boşa düşerdi.
     */
    expect(amountFieldDomId(TOTAL_AMOUNT_FIELD)).toBe("amount-total");
    expect(amountFieldDomId(itemAmountField("a"))).toBe("amount-item:a");
  });

  it("bozuk alanlar EKRAN sirasinda dizilir", () => {
    const receipt = buildReceipt();
    const invalid = [TOTAL_AMOUNT_FIELD, TAX_AMOUNT_FIELD, itemAmountField("b")];
    expect(blockingAmountFields(invalid, receipt)).toEqual([
      itemAmountField("b"),
      TAX_AMOUNT_FIELD,
      TOTAL_AMOUNT_FIELD,
    ]);
  });
});

describe("gecersizlik kumesi", () => {
  const empty: ReadonlySet<AmountFieldId> = new Set();

  it("bozuk alan EKLENIR", () => {
    const next = updateInvalidAmountFields(empty, TAX_AMOUNT_FIELD, false);
    expect([...next]).toEqual([TAX_AMOUNT_FIELD]);
  });

  it("duzelen alan CIKARILIR", () => {
    const withTax = updateInvalidAmountFields(empty, TAX_AMOUNT_FIELD, false);
    expect([...updateInvalidAmountFields(withTax, TAX_AMOUNT_FIELD, true)]).toEqual(
      [],
    );
  });

  it("degisiklik yoksa AYNI kume doner", () => {
    /*
     * Her tuş vuruşunda yeni bir küme üretmek gereksiz render zinciri
     * başlatırdı. Kimlik korunumu davranışın parçasıdır, süsleme değil.
     */
    expect(updateInvalidAmountFields(empty, TAX_AMOUNT_FIELD, true)).toBe(empty);
    const withTax = updateInvalidAmountFields(empty, TAX_AMOUNT_FIELD, false);
    expect(updateInvalidAmountFields(withTax, TAX_AMOUNT_FIELD, false)).toBe(
      withTax,
    );
  });

  it("bir alanin durumu digerini ETKILEMEZ", () => {
    let state = updateInvalidAmountFields(empty, TAX_AMOUNT_FIELD, false);
    state = updateInvalidAmountFields(state, TOTAL_AMOUNT_FIELD, false);
    state = updateInvalidAmountFields(state, TAX_AMOUNT_FIELD, true);
    expect([...state]).toEqual([TOTAL_AMOUNT_FIELD]);
  });
});

describe("engel mesaji iki dilde de VAR ve ayirt edici", () => {
  it("bos degil ve diger engel mesajlariyla AYNI degil", () => {
    /*
     * Mesaj eksik ya da başka bir engelle aynı olsaydı kullanıcı neyi
     * düzelteceğini bilemezdi: "ürün adı boş" ile "tutar okunamıyor" farklı
     * iki iştir.
     */
    for (const locale of ["tr", "en"] as const) {
      const message = translate(locale, "participants.receiptInvalidAmount");
      expect(message, locale).not.toBe("");
      for (const other of [
        "participants.receiptInvalid",
        "participants.receiptNoItems",
        "participants.receiptEmptyNames",
      ] as const) {
        expect(message, `${locale}/${other}`).not.toBe(translate(locale, other));
      }
    }
  });

  it("iki dil AYNI cumleyi kullanmaz", () => {
    // Ceviri unutulmus olsaydi iki dilde ayni metin kalirdi.
    expect(translate("tr", "participants.receiptInvalidAmount")).not.toBe(
      translate("en", "participants.receiptInvalidAmount"),
    );
  });
});
