/**
 * ADRES BİÇİMİNİN İNSANA ANLATILABİLİR HÂLİ.
 *
 * `normalizeWalletAddress` yalnızca "geçerli mi" der. Kullanıcı elle adres
 * yazarken en sık yaptığı hata karakter sayısını tutturamamaktır; "geçersiz"
 * demek ona ne yapacağını SÖYLEMEZ. Bu modül farkı sayıyla anlatır.
 *
 * SAF ve doğrulamanın YERİNE GEÇMEZ: gönderim sınırındaki checksum ve biçim
 * denetimi olduğu gibi kalır.
 */

/** `0x` sonrası beklenen karakter sayısı. */
export const ADDRESS_BODY_LENGTH = 40;

export type AddressShape =
  | { kind: "ok" }
  | { kind: "empty" }
  /** `0x` ile başlamıyor ya da onaltılık olmayan karakter var. */
  | { kind: "malformed" }
  | { kind: "short"; missing: number }
  | { kind: "long"; extra: number };

const HEX_BODY = /^[0-9a-fA-F]*$/;

export function describeAddressShape(value: string): AddressShape {
  const trimmed = value.trim();
  if (trimmed === "") {
    return { kind: "empty" };
  }
  if (!trimmed.startsWith("0x")) {
    return { kind: "malformed" };
  }

  const body = trimmed.slice(2);
  if (!HEX_BODY.test(body)) {
    /*
     * Onaltılık olmayan bir karakter varsa uzunluk yorumu YANILTICI olurdu:
     * "3 karakter eksik" demek, yanlış harfleri silmesi gerektiğini gizler.
     */
    return { kind: "malformed" };
  }
  if (body.length < ADDRESS_BODY_LENGTH) {
    return { kind: "short", missing: ADDRESS_BODY_LENGTH - body.length };
  }
  if (body.length > ADDRESS_BODY_LENGTH) {
    return { kind: "long", extra: body.length - ADDRESS_BODY_LENGTH };
  }
  return { kind: "ok" };
}
