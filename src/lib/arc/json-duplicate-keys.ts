/**
 * Yinelenen JSON anahtarı taraması.
 *
 * `JSON.parse` yinelenen bir anahtarda hata vermez, sessizce SON değeri alır.
 * Bu, aynı zarfın iki farklı okuyucuda farklı yorumlanabilmesi demektir; imzalı
 * bir gövdede bu tür bir belirsizlik hiç doğmamalıdır.
 *
 * Tarayıcı `JSON.parse`'tan ÖNCE çalışır ve metni tek geçişte, metin/kaçış
 * durumuna duyarlı biçimde okur:
 *
 *   - her nesne kapsamı kendi anahtar kümesini tutar; farklı nesnelerde aynı
 *     anahtar adı serbesttir
 *   - yalnızca anahtar konumundaki metinler anahtar sayılır, değer konumundaki
 *     metinler sayılmaz
 *   - metin içindeki `"anahtar":` benzeri içerik anahtar sanılmaz
 *   - kaçışlı tırnak ve ters bölü doğru tüketilir
 *   - anahtarlar çözülmüş hâlleriyle karşılaştırılır ("a" ile "a" aynıdır)
 *
 * Girdi zaten MAX_DECODED_JSON_LENGTH ile sınırlıdır; ayrıca özyineleme yerine
 * açık bir yığın ve derinlik sınırı kullanılır. Ek bağımlılık gerekmez.
 *
 * Bu tarama imza doğrulamasının yerine geçmez; katı ayrıştırmadan sonra EIP-712
 * doğrulaması her hâlükârda zorunludur.
 */

/** İmzalı zarf iki seviyeliktir; bu sınır fazlasıyla geniştir. */
export const MAX_JSON_SCAN_DEPTH = 16;

export type DuplicateKeyScan = "ok" | "duplicate" | "malformed";

/** Nesne kapsamı için görülen anahtarlar; dizi kapsamı için null. */
type Scope = Set<string> | null;

export function scanForDuplicateKeys(json: string): DuplicateKeyScan {
  const stack: Scope[] = [];
  let expectKey = false;
  let index = 0;

  while (index < json.length) {
    const character = json[index];

    if (character === '"') {
      const end = findStringEnd(json, index);
      if (end === null) {
        return "malformed";
      }
      if (expectKey) {
        const scope = stack[stack.length - 1];
        if (scope === undefined || scope === null) {
          return "malformed";
        }
        let key: unknown;
        try {
          key = JSON.parse(json.slice(index, end + 1));
        } catch {
          return "malformed";
        }
        if (typeof key !== "string") {
          return "malformed";
        }
        if (scope.has(key)) {
          return "duplicate";
        }
        scope.add(key);
        expectKey = false;
      }
      index = end + 1;
      continue;
    }

    if (character === "{" || character === "[") {
      if (stack.length >= MAX_JSON_SCAN_DEPTH) {
        return "malformed";
      }
      stack.push(character === "{" ? new Set<string>() : null);
      expectKey = character === "{";
      index += 1;
      continue;
    }

    if (character === "}" || character === "]") {
      if (stack.length === 0) {
        return "malformed";
      }
      stack.pop();
      expectKey = false;
      index += 1;
      continue;
    }

    if (character === ",") {
      // Virgülden sonra anahtar beklenip beklenmediği içinde bulunulan
      // kapsama bağlıdır: nesnede evet, dizide hayır.
      const scope = stack[stack.length - 1];
      expectKey = scope !== undefined && scope !== null;
      index += 1;
      continue;
    }

    if (character === ":") {
      expectKey = false;
      index += 1;
      continue;
    }

    index += 1;
  }

  return stack.length === 0 ? "ok" : "malformed";
}

/** Kapanış tırnağının konumu; kapanmamışsa null. Kaçışlara duyarlıdır. */
function findStringEnd(json: string, start: number): number | null {
  let escaped = false;
  for (let index = start + 1; index < json.length; index += 1) {
    const character = json[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      return index;
    }
  }
  return null;
}
