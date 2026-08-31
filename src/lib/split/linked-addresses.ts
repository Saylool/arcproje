import type { Participant } from "./participants";

/**
 * KİŞİ ADIMINDA BAĞLANAN CÜZDAN ADRESLERİ.
 *
 * Eşleştirme isimle yapılır çünkü insanları isimle tanırız. Ama isim
 * DEĞİŞKENDİR; bağ ise bir adrese, yani paranın gideceği yere işaret eder.
 * Bu modül o ikisinin arasındaki tek kuralı taşır ve saf olduğu için
 * doğrudan test edilir.
 */

export type LinkedAddresses = Readonly<Record<string, string>>;

/**
 * Artık geçerli olmayan bağları düşürür.
 *
 * İKİ DURUMDA BAĞ DÜŞER:
 *
 *   1. Kişinin ADI DEĞİŞTİ. "bugra" için adres bağlanıp isim "ayşe" yapılırsa,
 *      ödeme adımı ayşe'nin satırında bugra'nın adresini gösterirdi. Yanlış
 *      adrese giden transfer geri alınamaz; sessiz bir eşleşme bırakılmaz.
 *   2. Kişi SİLİNDİ. Bağın işaret ettiği satır artık yok.
 *
 * Adı değişmeyen kişilerin bağı KORUNUR: kullanıcı onu bilerek seçmişti.
 */
export function dropStaleLinks(
  links: LinkedAddresses,
  before: readonly Participant[],
  after: readonly Participant[],
): LinkedAddresses {
  const survivingNames = new Map(
    after.map((person) => [person.id, person.name]),
  );

  const stale = new Set(
    before
      .filter((person) => {
        const name = survivingNames.get(person.id);
        return name === undefined || name !== person.name;
      })
      .map((person) => person.id),
  );

  if (stale.size === 0) {
    return links;
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(links).filter(([id]) => !stale.has(id)),
    ),
  );
}
