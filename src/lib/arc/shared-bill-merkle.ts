import { encodeAbiParameters, keccak256, stringToBytes } from "viem";

/**
 * Paylasilan hesabin GIZLILIK KORUYAN borc taahhudu (Merkle agaci).
 *
 * NEDEN AGREGAT HASH DEGIL: Part 1'de taahhut tum yapraklarin tek bir
 * `keccak256(abi.encode(..., leaves[]))` ozetiydi. Bu, bir borclunun KENDI
 * satirini bagimsiz dogrulayabilmesi icin ona TUM borc satirlarini vermeyi
 * gerektirirdi — yani her borclu herkesin adresini, adini ve tutarini
 * gorurdu. Bu, tek baglantinin gizlilik hedefiyle dogrudan celisiyordu.
 *
 * Merkle agaci ile bir borclu YALNIZCA kendi satirini ve log2(n) kardes
 * ozetini alir; kardes ozetlerden baska bir satirin adresi, etiketi, borc
 * kimligi veya tutari TURETILEMEZ.
 *
 * TASARIM KARARLARI
 *
 * 1. KONUMSAL (positional) dugumler. Kardesler siralanmaz; sol/sag ayrimi
 *    korunur. Siralanmis cift kullanan agaclarda ayni koke goturen farkli
 *    kanitlar uretilebilir; burada yon, kanittan degil INDEKSTEN turetilir.
 *
 * 2. YON TASINMAZ, TURETILIR. Kanit yalnizca yaprak indeksini ve kardes
 *    ozetlerini tasir. Her seviyedeki yon ve o seviyede kardes olup olmadigi,
 *    `leafIndex` ile `debtCount`tan yeniden hesaplanir. Saldirgan yon bayragi
 *    cevirerek baska bir koke ulasamaz.
 *
 * 3. TEK SAYIDA DUGUM: son dugum bir ust seviyeye OLDUGU GIBI TASINIR
 *    (promotion). Son dugumu kendisiyle eslestirmek (duplication) klasik bir
 *    zafiyettir: ayni yaprak iki kez sayilabilir. Tasima bu belirsizligi
 *    yaratmaz.
 *
 * 4. ALAN AYRIMI: yaprak, ic dugum ve kok icin AYRI etiketler kullanilir.
 *    Boylece bir yaprak ozeti hicbir zaman gecerli bir ic dugum ozeti olarak
 *    yorumlanamaz.
 *
 * 5. KOK, borc SAYISINI da baglar. Satir eklemek/cikarmak koku bozar.
 *
 * `JSON.stringify` hicbir asamada taahhut olarak kullanilmaz; kayan nokta
 * aritmetigi yoktur.
 */

/** Agac surumu; sema surumu ile birlikte etiketlere girer. */
export const SHARED_BILL_MERKLE_VERSION = 2;

/** Yaprak, ic dugum ve kok icin ayri alan etiketleri. */
export const SHARED_BILL_LEAF_TAG = keccak256(
  stringToBytes(`HesabiBolSharedBillLeaf(${SHARED_BILL_MERKLE_VERSION})`),
);
export const SHARED_BILL_NODE_TAG = keccak256(
  stringToBytes(`HesabiBolSharedBillNode(${SHARED_BILL_MERKLE_VERSION})`),
);
export const SHARED_BILL_ROOT_TAG = keccak256(
  stringToBytes(`HesabiBolSharedBillRoot(${SHARED_BILL_MERKLE_VERSION})`),
);

/**
 * Kanit uzunlugu icin sert tavan.
 *
 * En fazla 50 borc icin derinlik 6'dir; 32 fazlasiyla genistir ve hazirlanmis
 * devasa bir kanitin islenmesini engeller.
 */
export const MAX_SHARED_BILL_PROOF_LENGTH = 32;

const BYTES32 = /^0x[0-9a-f]{64}$/i;

export type SharedBillLeafInput = Readonly<{
  schemaVersion: number;
  chainId: number;
  billId: string;
  debtor: string;
  debtorLabel: string;
  debtKey: string;
  tryMinor: string;
}>;

/**
 * Tek bir borc satirinin yaprak ozeti.
 *
 * Yaprak, satirin TUM taahhut edilen alanlarini VE icinde bulundugu baglami
 * (sema surumu, zincir, hesap kimligi) baglar. Boylece bir yaprak baska bir
 * hesaba veya baska bir zincire tasinamaz.
 */
export function computeSharedBillLeaf(input: SharedBillLeafInput): string {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint16" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
      ],
      [
        SHARED_BILL_LEAF_TAG as `0x${string}`,
        input.schemaVersion,
        BigInt(input.chainId),
        input.billId as `0x${string}`,
        input.debtor as `0x${string}`,
        keccak256(stringToBytes(input.debtorLabel)),
        keccak256(stringToBytes(input.debtKey)),
        BigInt(input.tryMinor),
      ],
    ),
  );
}

/** Ic dugum: KONUMSAL birlestirme (sol, sag). Siralama yapilmaz. */
export function combineSharedBillNodes(left: string, right: string): string {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [
        SHARED_BILL_NODE_TAG as `0x${string}`,
        left as `0x${string}`,
        right as `0x${string}`,
      ],
    ),
  );
}

/**
 * Yapraklardan agac kokunu hesaplar.
 *
 * Tek yaprakta kok yapragin kendisidir. Tek sayida dugum kalan her seviyede
 * SON dugum bir ust seviyeye oldugu gibi tasinir.
 */
export function computeSharedBillTreeRoot(
  leaves: readonly string[],
): string | null {
  if (leaves.length === 0) {
    return null;
  }
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      if (index + 1 < level.length) {
        next.push(combineSharedBillNodes(level[index], level[index + 1]));
      } else {
        // Tek kalan son dugum oldugu gibi tasinir (duplication YAPILMAZ).
        next.push(level[index]);
      }
    }
    level = next;
  }
  return level[0];
}

export type SharedBillRootInput = Readonly<{
  schemaVersion: number;
  chainId: number;
  billId: string;
  debtCount: number;
  treeRoot: string;
}>;

/**
 * Imzalanan KOK.
 *
 * Agac kokunu sema surumu, zincir, hesap kimligi ve borc SAYISI ile birlikte
 * alan ayrilmis biçimde baglar. Satir eklemek veya cikarmak koku bozar.
 */
export function computeSharedBillDebtsRoot(input: SharedBillRootInput): string {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint16" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint16" },
        { type: "bytes32" },
      ],
      [
        SHARED_BILL_ROOT_TAG as `0x${string}`,
        input.schemaVersion,
        BigInt(input.chainId),
        input.billId as `0x${string}`,
        input.debtCount,
        input.treeRoot as `0x${string}`,
      ],
    ),
  );
}

/**
 * Bir seviyede bu indeksin kardesi VAR MI?
 *
 * Tek sayida dugum kalan seviyede SON dugumun kardesi yoktur; oldugu gibi
 * tasinir.
 */
function hasSiblingAt(index: number, levelSize: number): boolean {
  return !(index === levelSize - 1 && levelSize % 2 === 1);
}

/**
 * Verilen yaprak indeksi ve borc sayisi icin kanitin TAM uzunlugu.
 *
 * Uzunluk kanittan degil bu iki degerden turetilir; bu yuzden kisa, uzun veya
 * doldurulmus bir kanit sessizce kabul edilemez.
 */
export function expectedSharedBillProofLength(
  leafIndex: number,
  debtCount: number,
): number | null {
  if (
    !Number.isSafeInteger(leafIndex) ||
    !Number.isSafeInteger(debtCount) ||
    debtCount <= 0 ||
    leafIndex < 0 ||
    leafIndex >= debtCount
  ) {
    return null;
  }
  let length = 0;
  let index = leafIndex;
  let size = debtCount;
  while (size > 1) {
    if (hasSiblingAt(index, size)) {
      length += 1;
    }
    index = Math.floor(index / 2);
    size = Math.ceil(size / 2);
  }
  return length;
}

export type SharedBillProof = Readonly<{
  leafIndex: number;
  /** Kok yolundaki kardes ozetleri, YAPRAKTAN KOKE dogru sirali. */
  siblings: readonly string[];
}>;

/**
 * Tek bir yaprak icin kanit uretir.
 *
 * Kanit YALNIZCA kardes ozetlerini tasir; hicbir kardes SATIRINI (adres,
 * etiket, borc kimligi, tutar) icermez.
 */
export function generateSharedBillProof(
  leaves: readonly string[],
  leafIndex: number,
): SharedBillProof | null {
  if (
    !Number.isSafeInteger(leafIndex) ||
    leafIndex < 0 ||
    leafIndex >= leaves.length
  ) {
    return null;
  }
  const siblings: string[] = [];
  let level = [...leaves];
  let index = leafIndex;

  while (level.length > 1) {
    if (hasSiblingAt(index, level.length)) {
      // Cift indekste kardes sagda, tek indekste solda.
      siblings.push(index % 2 === 0 ? level[index + 1] : level[index - 1]);
    }
    const next: string[] = [];
    for (let position = 0; position < level.length; position += 2) {
      next.push(
        position + 1 < level.length
          ? combineSharedBillNodes(level[position], level[position + 1])
          : level[position],
      );
    }
    level = next;
    index = Math.floor(index / 2);
  }

  return Object.freeze({ leafIndex, siblings: Object.freeze(siblings) });
}

export type ProofProblem =
  | "invalidIndex"
  | "invalidCount"
  | "invalidLeaf"
  | "malformedSibling"
  | "proofTooLong"
  | "wrongProofLength"
  | "rootMismatch";

export type ProofVerification =
  | { ok: true; treeRoot: string }
  | { ok: false; problem: ProofProblem };

export type ProofRootResult =
  | { ok: true; treeRoot: string }
  | { ok: false; problem: Exclude<ProofProblem, "rootMismatch"> };

/**
 * Kanittan ADAY agac kokunu kurar.
 *
 * Yalnizca YAPISAL dogrulama yapar (indeks, uzunluk, kardes bicimi); hangi
 * kokun dogru oldugunu bilmez. Cagiran, adayi imzalanan kokle karsilastirir.
 *
 * Yon ve kardes varligi `leafIndex` ile `debtCount`tan TURETILIR; kanit bunu
 * degistiremez.
 */
export function computeSharedBillProofRoot(input: {
  leaf: string;
  proof: SharedBillProof;
  debtCount: number;
}): ProofRootResult {
  const { leaf, proof, debtCount } = input;

  if (typeof leaf !== "string" || !BYTES32.test(leaf)) {
    return { ok: false, problem: "invalidLeaf" };
  }
  if (!Number.isSafeInteger(debtCount) || debtCount <= 0) {
    return { ok: false, problem: "invalidCount" };
  }
  if (
    typeof proof !== "object" ||
    proof === null ||
    !Number.isSafeInteger(proof.leafIndex) ||
    proof.leafIndex < 0 ||
    proof.leafIndex >= debtCount
  ) {
    return { ok: false, problem: "invalidIndex" };
  }
  if (!Array.isArray(proof.siblings)) {
    return { ok: false, problem: "malformedSibling" };
  }
  if (proof.siblings.length > MAX_SHARED_BILL_PROOF_LENGTH) {
    return { ok: false, problem: "proofTooLong" };
  }
  for (const sibling of proof.siblings) {
    if (typeof sibling !== "string" || !BYTES32.test(sibling)) {
      return { ok: false, problem: "malformedSibling" };
    }
  }

  const expectedLength = expectedSharedBillProofLength(
    proof.leafIndex,
    debtCount,
  );
  if (expectedLength === null || proof.siblings.length !== expectedLength) {
    return { ok: false, problem: "wrongProofLength" };
  }

  let node = leaf;
  let index = proof.leafIndex;
  let size = debtCount;
  let cursor = 0;

  while (size > 1) {
    if (hasSiblingAt(index, size)) {
      const sibling = proof.siblings[cursor];
      cursor += 1;
      // Yon INDEKSTEN turetilir; kanit bunu degistiremez.
      node =
        index % 2 === 0
          ? combineSharedBillNodes(node, sibling)
          : combineSharedBillNodes(sibling, node);
    }
    index = Math.floor(index / 2);
    size = Math.ceil(size / 2);
  }

  return { ok: true, treeRoot: node };
}

/**
 * Kanitin YAPISAL dogrulamasi VE beklenen agac koku ile karsilastirilmasi.
 */
export function verifySharedBillProof(input: {
  leaf: string;
  proof: SharedBillProof;
  debtCount: number;
  expectedTreeRoot: string;
}): ProofVerification {
  const rebuilt = computeSharedBillProofRoot({
    leaf: input.leaf,
    proof: input.proof,
    debtCount: input.debtCount,
  });
  if (!rebuilt.ok) {
    return { ok: false, problem: rebuilt.problem };
  }
  return rebuilt.treeRoot.toLowerCase() ===
    input.expectedTreeRoot.toLowerCase()
    ? { ok: true, treeRoot: rebuilt.treeRoot }
    : { ok: false, problem: "rootMismatch" };
}
