import { describe, expect, it } from "vitest";

import { ADDRESS_BODY_LENGTH, describeAddressShape } from "./address-shape";

/**
 * ADRES BICIMININ INSANA ANLATILMASI.
 *
 * "Gecersiz" demek kullaniciya ne yapacagini SOYLEMEZ. En sik hata karakter
 * sayisidir; fark sayiyla anlatilir.
 */
const BODY = "a".repeat(ADDRESS_BODY_LENGTH);

describe("dogru bicim", () => {
  it("tam uzunluk kabul edilir", () => {
    expect(describeAddressShape(`0x${BODY}`)).toEqual({ kind: "ok" });
    expect(describeAddressShape(`  0x${BODY}  `)).toEqual({ kind: "ok" });
    // Buyuk/kucuk harf karisik da onaltiliktir.
    expect(describeAddressShape("0x742d35Cc6634C0532925a3b844Bc454e4438f44e"))
      .toEqual({ kind: "ok" });
  });
});

describe("eksik karakter", () => {
  it("kac karakter eksik oldugunu SOYLER", () => {
    expect(describeAddressShape(`0x${"a".repeat(37)}`)).toEqual({
      kind: "short",
      missing: 3,
    });
    expect(describeAddressShape("0x")).toEqual({
      kind: "short",
      missing: ADDRESS_BODY_LENGTH,
    });
  });
});

describe("fazla karakter", () => {
  it("kac karakter fazla oldugunu SOYLER", () => {
    expect(describeAddressShape(`0x${BODY}bb`)).toEqual({
      kind: "long",
      extra: 2,
    });
  });
});

describe("bicimsiz", () => {
  it("0x ile baslamayan reddedilir", () => {
    expect(describeAddressShape(BODY).kind).toBe("malformed");
    expect(describeAddressShape(`1x${BODY}`).kind).toBe("malformed");
  });

  it("onaltilik OLMAYAN karakter uzunluk yorumunu BASTIRIR", () => {
    /*
     * "3 karakter eksik" demek, yanlis harfleri silmesi gerektigini gizlerdi.
     */
    expect(describeAddressShape(`0x${"z".repeat(40)}`).kind).toBe("malformed");
    expect(describeAddressShape(`0x${"z".repeat(20)}`).kind).toBe("malformed");
    expect(describeAddressShape(`0x${BODY}zz`).kind).toBe("malformed");
  });

  it("bos deger ayri bir haldir", () => {
    expect(describeAddressShape("").kind).toBe("empty");
    expect(describeAddressShape("   ").kind).toBe("empty");
  });
});
