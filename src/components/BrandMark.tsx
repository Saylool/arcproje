import { MARK_SHAPES, MARK_VIEWBOX } from "@/lib/brand/mark";

/**
 * Marka işareti.
 *
 * Rengini `currentColor`'dan alır, böylece kapsayan öge neyi diyorsa onu
 * çizer ve iki temada da doğru görünür. `accent` verilirse işaretin ikinci
 * parçası o rengi alır; verilmezse işaret TEK RENKLİDİR. Varsayılanın tek
 * renk olması bilinçli: işaret zemini bilmediği yerlerde de doğru görünmeli.
 *
 * Kendi başına ANLAM TAŞIMAZ — yanında her zaman uygulamanın adı yazılı
 * olduğu için erişilebilirlik ağacından çıkarılır.
 *
 * Uygulama ikonlarıyla AYNI geometriyi kullanır: `src/lib/brand/mark.ts`.
 */
export function BrandMark({
  className,
  accent,
}: {
  className?: string;
  accent?: string;
}) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {MARK_SHAPES.map((shape) => (
        <path
          key={shape.d}
          d={shape.d}
          fill={shape.tone === "accent" && accent !== undefined ? accent : "currentColor"}
        />
      ))}
    </svg>
  );
}
