/**
 * Sunucunun bildirdiği KALAN analiz hakkını okur.
 *
 * İstemci hakları SAYMAZ. Sayaç sunucudadır ve tek doğru odur; buradaki iş
 * yalnızca gelen sayıyı güvenle çıkarmak.
 */
export function readRemainingAnalyses(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const value = (payload as Record<string, unknown>).remainingAnalyses;
  /* Tam sayı olmayan ya da negatif bir değer gösterilmez. */
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}
