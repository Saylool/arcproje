import { MARK_PATHS, MARK_VIEWBOX } from "@/lib/brand/mark";

/**
 * Marka işareti.
 *
 * Rengi `currentColor`'dan alır, böylece kapsayan öge neyi diyorsa onu çizer
 * ve iki temada da doğru görünür. Kendi başına ANLAM TAŞIMAZ — yanında her
 * zaman uygulamanın adı yazılı olduğu için erişilebilirlik ağacından çıkarılır.
 *
 * Uygulama ikonlarıyla AYNI geometriyi kullanır: `src/lib/brand/mark.ts`.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {MARK_PATHS.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}
