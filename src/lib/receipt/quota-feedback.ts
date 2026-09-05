/**
 * 429 GELDİĞİNDE KALAN HAK NE OLUR?
 *
 * HTTP durumu tek başına yetmez. Sunucu iki farklı sebeple 429 döner ve
 * ikisi kullanıcıya BAŞKA şey söyler:
 *
 *   DAILY_LIMIT_REACHED — kişinin KENDİ günlük hakkı doldu. Kalan sıfırdır.
 *   SERVICE_BUSY        — uygulamanın GENEL tavanı doldu. Kişinin hakkına
 *                         dokunulmamıştır; sıfır göstermek yanlış olurdu.
 *
 * Eskiden her 429'da sıfır yazılıyordu. Genel tavan dolduğunda kullanıcı,
 * hiç harcamadığı hakkını bitmiş sanıyor ve "yarın gel" mesajını kendi
 * kotasına bağlıyordu.
 *
 * KURAL: istemci kalan hakkı ASLA hesaplamaz. Yalnızca sunucunun açıkça
 * söylediğini yansıtır; söylemediği yerde bilinen son değeri korur.
 */

/** Kişinin kendi günlük hakkının bittiğini bildiren tek kod. */
export const PERSONAL_LIMIT_CODE = "DAILY_LIMIT_REACHED";

/** Genel tavanın dolduğunu bildiren kod. Kişisel hakla ilgisi yoktur. */
export const SERVICE_BUSY_CODE = "SERVICE_BUSY";

export type QuotaDisplayAction =
  /** Kalan hak sıfıra çekilir; sunucu kişisel tükenmeyi doğruladı. */
  | { kind: "showExhausted" }
  /** Bilinen değer KORUNUR; sunucu kişisel hak hakkında bir şey söylemedi. */
  | { kind: "keepKnown" };

/**
 * Başarısız bir analiz yanıtından sonra kalan hak göstergesine ne yapılacağı.
 *
 * Saf fonksiyondur: aynı girdi her zaman aynı kararı verir ve bileşenden
 * bağımsız ölçülebilir.
 */
export function quotaDisplayAfterFailure(
  status: number,
  code: string | null,
): QuotaDisplayAction {
  if (status === 429 && code === PERSONAL_LIMIT_CODE) {
    return { kind: "showExhausted" };
  }
  /*
   * Tanınmayan bir kod da dahil her şey burada biter. Bilinmeyeni "sıfır"
   * saymak, uydurmanın en sessiz biçimidir.
   */
  return { kind: "keepKnown" };
}
