/**
 * MARKA İŞARETİ — ikiye ayrılmış bir hesap fişi.
 *
 * YALNIZCA GEOMETRİ, hiçbir fonta bağlı değil. Buradaki yollar her makinede
 * aynı çıkar, gözden geçirilebilir ve hem başlıkta hem uygulama ikonlarında
 * AYNI kaynaktan kullanılır.
 *
 * NEDEN ARTIK LİRA SİMGESİ DEĞİL: eski işaret Türk lirasının simgesiydi ve
 * uygulamayı tek bir ülkeye bağlıyordu. Üstelik yanlıştı da — bu uygulama
 * lirayla değil, Arc Testnet üzerindeki test USDC'siyle ödeme yapıyor. Bu
 * dosyanın hiçbir yerinde para birimi simgesi geçmez; test de bunu ölçer.
 *
 * Yerine geçen işaret bir harf ya da para birimi taşımaz: yan yana duran,
 * biri diğerinden kısa iki fiş. Hangi dili konuşursa konuşsun herkes aynı
 * şeyi okur — bir hesap, iki pay.
 *
 * Kurgu: her fiş üstten yuvarlatılmış, altı yırtık kenarlı bir dikdörtgen.
 * İçindeki tutar satırları BOYA DEĞİL DELİKTİR; ters yönde sarılmış alt
 * yollar oldukları için işaret hangi zemine basılırsa basılsın satırlar o
 * zemini gösterir.
 */

export const MARK_SIZE = 512;
export const MARK_VIEWBOX = `0 0 ${MARK_SIZE} ${MARK_SIZE}`;

/**
 * Marka rengi ve iki tema zemini.
 *
 * CSS değişkenleri çalışma zamanında okunamadığı için burada da yazılırlar;
 * `globals.css` ile AYNI kaldıkları testle güvenceye alınır.
 */
export const BRAND_COLOR = "#7c3aed";
export const SURFACE_LIGHT = "#ffffff";
export const SURFACE_DARK = "#0b1120";
export const MARK_INK = "#ffffff";

/**
 * İkinci fişin rengi.
 *
 * `globals.css`te KARŞILIĞI YOKTUR ve olmamalıdır: bu renk arayüzde hiçbir
 * anlam taşımaz, yalnızca işaretin iki payını birbirinden ayırır. Bir uyarı
 * ya da durum rengine bağlansaydı, o palet ayarlandığında marka sessizce
 * değişirdi.
 */
export const MARK_ACCENT = "#fcd34d";

/* Fişlerin ölçüleri. MARK_BOUNDS bunlardan TÜRETİLİR, elle yazılmaz. */
const SLIP_W = 120;
const SLIP_GAP = 34;
const LEFT_X = (MARK_SIZE - (SLIP_W * 2 + SLIP_GAP)) / 2;
const RIGHT_X = LEFT_X + SLIP_W + SLIP_GAP;

/** İki fiş de aynı hizada yırtılmıştır; farklı olan üst kenarları. */
const BOTTOM = 404;
const TALL_TOP = 108;
const SHORT_TOP = 152;

const CORNER_R = 22;
/** Yırtık kenardaki diş sayısı. SLIP_W buna tam bölünür; ondalık koordinat çıkmaz. */
const TEETH = 3;
const TOOTH_DIP = 28;

const LINE_INSET = 22;
const LINE_H = 18;
const LINE_LONG = SLIP_W - LINE_INSET * 2;
const LINE_SHORT = 46;
/** İlk satırın fişin üst kenarına uzaklığı; iki fişte de aynıdır. */
const LINE_TOP = 48;
const LINE_GAP = 66;

function lineYs(top: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => top + LINE_TOP + i * LINE_GAP);
}

/**
 * Bir fiş: dış hat SAAT YÖNÜNDE, tutar satırları TERS yönde.
 *
 * Ters sarım, varsayılan `nonzero` doldurma kuralıyla satırları delik yapar.
 * Boyanmış olsalardı işaretin zemini bilmesi gerekirdi; başlıkta zemin mor,
 * ikonda mor, koyu temada başka bir şey olurdu.
 */
function slip(x: number, top: number, lineCount: number): string {
  const right = x + SLIP_W;
  const step = SLIP_W / TEETH;

  let d = `M${x + CORNER_R} ${top}H${right - CORNER_R}A${CORNER_R} ${CORNER_R} 0 0 1 ${right} ${top + CORNER_R}V${BOTTOM}`;
  for (let i = 0; i < TEETH; i += 1) {
    d += `L${right - step * (i + 0.5)} ${BOTTOM - TOOTH_DIP}L${right - step * (i + 1)} ${BOTTOM}`;
  }
  d += `V${top + CORNER_R}A${CORNER_R} ${CORNER_R} 0 0 1 ${x + CORNER_R} ${top}Z`;

  const ys = lineYs(top, lineCount);
  for (const [index, y] of ys.entries()) {
    /* Son satır kısa: bir fişin toplam satırı diğerlerinden kısadır. */
    const width = index === ys.length - 1 ? LINE_SHORT : LINE_LONG;
    d += `M${x + LINE_INSET} ${y}v${LINE_H}h${width}v-${LINE_H}Z`;
  }
  return d;
}

/** İşaretin iki parçası. `ink` her yerde, `accent` yalnızca istendiğinde ayrı renk alır. */
export type MarkTone = "ink" | "accent";

export const MARK_SHAPES: readonly { d: string; tone: MarkTone }[] = [
  { d: slip(LEFT_X, TALL_TOP, 3), tone: "ink" },
  { d: slip(RIGHT_X, SHORT_TOP, 2), tone: "accent" },
];

/** Tek renkli kullanım için yollar. Başlıktaki işaret bunu okur. */
export const MARK_PATHS: readonly string[] = MARK_SHAPES.map((shape) => shape.d);

/**
 * İşaretin kapladığı dikdörtgen. Yollardan değil, onları üreten SABİTLERDEN
 * türetilir; geometri değişirse birlikte değişir.
 */
export const MARK_BOUNDS = {
  minX: LEFT_X,
  minY: TALL_TOP,
  maxX: RIGHT_X + SLIP_W,
  maxY: BOTTOM,
} as const;

/**
 * MASKELENEBİLİR İKONUN GÜVENLİ ALANI.
 *
 * Android ikonu daire, damla ya da kare gibi KESER; kenarın %10'u
 * kırpılabildiği için güvenli alan merkezi %80 çaplı dairedir. İşaretin
 * merkeze en uzak köşesi bu dairenin içinde kalıyorsa AYNI görsel hem
 * `any` hem `maskable` olarak kullanılabilir ve ikinci bir dosya gerekmez.
 * Test bunu ölçer; geometri büyürse kırmızıya döner.
 */
export const MASKABLE_SAFE_RADIUS = MARK_SIZE * 0.4;

/** İşaretin merkeze en uzak köşesinin uzaklığı. */
export function markCornerRadius(): number {
  const centre = MARK_SIZE / 2;
  const dx = Math.max(centre - MARK_BOUNDS.minX, MARK_BOUNDS.maxX - centre);
  const dy = Math.max(centre - MARK_BOUNDS.minY, MARK_BOUNDS.maxY - centre);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * İşaretin bir kutu içindeki SVG'si. Ölçek ve konum çağıran tarafındadır.
 *
 * `accent` verilmezse iki parça da `ink` ile çizilir; tek renkli kullanım
 * varsayılandır, ikinci renk açıkça istenir.
 */
export function markSvg(options: {
  size: number;
  background: string | null;
  ink?: string;
  accent?: string;
  scale?: number;
}): string {
  const { size, background, ink = MARK_INK, accent, scale = 1 } = options;
  const offset = ((1 - scale) * MARK_SIZE) / 2;
  const fill =
    background === null
      ? ""
      : `<rect width="${MARK_SIZE}" height="${MARK_SIZE}" fill="${background}"/>`;
  const group = (tone: MarkTone, colour: string) => {
    const paths = MARK_SHAPES.filter((shape) => shape.tone === tone)
      .map((shape) => `<path d="${shape.d}"/>`)
      .join("");
    return paths === ""
      ? ""
      : `<g fill="${colour}" transform="translate(${offset} ${offset}) scale(${scale})">${paths}</g>`;
  };
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" width="${size}" height="${size}">`,
    fill,
    group("ink", ink),
    group("accent", accent ?? ink),
    `</svg>`,
  ].join("");
}
