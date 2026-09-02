/**
 * MARKA İŞARETİ — ₺.
 *
 * YALNIZCA GEOMETRİ, hiçbir fonta bağlı değil. Nedeni pratik: başlıktaki
 * işaret bugüne kadar bir metin düğümüydü, yani her cihazda o cihazın
 * fontuyla çiziliyordu ve uygulamanın sabit bir marka varlığı hiç yoktu.
 * Buradaki yollar her makinede aynı çıkar, gözden geçirilebilir ve hem
 * başlıkta hem uygulama ikonlarında AYNI kaynaktan kullanılır.
 *
 * Kurgu: dikey bir sap, sapı kesen iki paralel çapraz bar ve sapın dibinde
 * merkezi sapın sağ kenarında olan bir çeyrek halka (kanca).
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

const STEM_X = 180;
const STEM_W = 52;
const STEM_TOP = 105;

const HOOK_CX = STEM_X + STEM_W;
const HOOK_CY = 275;
const HOOK_R = 132;
/** Kanca kalınlığı sap kalınlığına EŞİTTİR; aksi hâlde birleşim yerinde kırılır. */
const HOOK_T = STEM_W;
const STEM_BOTTOM = HOOK_CY + HOOK_R;

const BAR_T = 40;
const BAR_X1 = 146;
const BAR_X2 = 360;
const BAR_RISE = 58;
const BAR_Y_TOP = 219;
const BAR_GAP = 80;

function bar(yLeft: number): string {
  const yRight = yLeft - BAR_RISE;
  return `M${BAR_X1} ${yLeft}L${BAR_X2} ${yRight}v${BAR_T}L${BAR_X1} ${yLeft + BAR_T}Z`;
}

const rIn = HOOK_R - HOOK_T;

/** İşareti oluşturan dört yol. Sıra önemsizdir; hepsi aynı renkle doldurulur. */
export const MARK_PATHS: readonly string[] = [
  `M${STEM_X} ${STEM_TOP}h${STEM_W}v${STEM_BOTTOM - STEM_TOP}h-${STEM_W}Z`,
  `M${HOOK_CX + HOOK_R} ${HOOK_CY}A${HOOK_R} ${HOOK_R} 0 0 1 ${HOOK_CX} ${HOOK_CY + HOOK_R}v-${HOOK_T}A${rIn} ${rIn} 0 0 0 ${HOOK_CX + rIn} ${HOOK_CY}Z`,
  bar(BAR_Y_TOP),
  bar(BAR_Y_TOP + BAR_GAP),
];

/**
 * İşaretin kapladığı dikdörtgen. Yollardan değil, onları üreten SABİTLERDEN
 * türetilir; geometri değişirse birlikte değişir.
 */
export const MARK_BOUNDS = {
  minX: BAR_X1,
  minY: STEM_TOP,
  maxX: HOOK_CX + HOOK_R,
  maxY: STEM_BOTTOM,
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

/** İşaretin bir kutu içindeki SVG'si. Ölçek ve konum çağıran tarafındadır. */
export function markSvg(options: {
  size: number;
  background: string | null;
  ink?: string;
  scale?: number;
}): string {
  const { size, background, ink = MARK_INK, scale = 1 } = options;
  const offset = ((1 - scale) * MARK_SIZE) / 2;
  const fill =
    background === null
      ? ""
      : `<rect width="${MARK_SIZE}" height="${MARK_SIZE}" fill="${background}"/>`;
  const paths = MARK_PATHS.map((d) => `<path d="${d}"/>`).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" width="${size}" height="${size}">`,
    fill,
    `<g fill="${ink}" transform="translate(${offset} ${offset}) scale(${scale})">${paths}</g>`,
    `</svg>`,
  ].join("");
}
