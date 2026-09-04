/**
 * UYGULAMA İKONLARINI ÜRETİR.
 *
 * TEK SEFERLİK bir yazım aracıdır, `npm run build`'in parçası DEĞİLDİR:
 * ürettiği dosyalar depoya işlenir, çalışma zamanında hiçbir şey yeniden
 * çizmez. Bu yüzden `sharp` bir bağımlılık olarak TANIMLI DEĞİLDİR; Next ile
 * birlikte geldiği için burada bulunur, bulunmazsa betik açıkça söyler.
 *
 * Geometri `src/lib/brand/mark.ts` içindedir ve başlıktaki işaretle AYNI
 * kaynaktır; burada yalnızca ölçeklenip rasterleştirilir.
 *
 *   node scripts/generate-icons.mjs
 */
import { writeFileSync } from "node:fs";

import { BRAND_COLOR, MARK_ACCENT, markSvg } from "../src/lib/brand/mark.ts";

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error(
    "sharp bulunamadı. İkonlar depoya işlenmiştir; yalnızca yeniden üretmek\n" +
      "istiyorsan gerekir:  npm i --no-save sharp",
  );
  process.exit(1);
}

/** Manifest'in gösterdiği boyutlar. İkisi de hem `any` hem `maskable`. */
const PNG_SIZES = [192, 512];

async function png(size, path) {
  const svg = markSvg({ size, background: BRAND_COLOR, accent: MARK_ACCENT });
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path);
  console.log(`${path}  ${size}x${size}`);
}

for (const size of PNG_SIZES) {
  await png(size, `public/icon-${size}.png`);
}

/* Apple "ana ekrana ekle" ikonu: 180 piksel, saydamlık yok. */
await png(180, "src/app/apple-icon.png");

/* Tarayıcı sekmesi: vektör kalır, yollar fonta bağlı olmadığı için güvenli. */
writeFileSync(
  "src/app/icon.svg",
  markSvg({ size: 512, background: BRAND_COLOR, accent: MARK_ACCENT }) + "\n",
);
console.log("src/app/icon.svg");
