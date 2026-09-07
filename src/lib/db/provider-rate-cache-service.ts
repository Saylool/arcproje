import { COINGECKO_PROVIDER_KEY } from "@/lib/rates/provider-budget";

import { createNeonSharedBillRepository } from "./neon-shared-bill-repository";
import type { StoredProviderObservation } from "./shared-bill-repository";

/**
 * PAYLAŞILAN KUR ÖNBELLEĞİNİN VARSAYILAN SÜRÜCÜSÜ. YALNIZCA SUNUCU.
 *
 * `provider-budget-service.ts` ile aynı kalıp: `quote-service.ts` saf kalsın
 * diye veritabanı buraya toplanmıştır. Kur servisi iki işlev alır, Postgres'i
 * tanımaz.
 *
 * NEDEN VAR: 0006 ile CoinGecko çağrılarının SAYISI bütün örnekler adına
 * sınırlandı, ama sonucu paylaşılmıyordu. Sonuç paylaşılmayınca limitin
 * bedelini önbellek isabeti değil KULLANICI ödüyordu: penceredeki krediyi
 * kapan örnekler kuru alıp kendi belleklerine yazarken, aynı anda çalışan
 * diğer örnekler `exhausted` görüp "kur alınamadı" döndürüyordu — taze kur
 * yan taraftaki örneğin belleğinde dururken.
 *
 * YAPILANDIRMA YOKSA ENGEL DE YOK. `DATABASE_URL` tanımlı değilse ya da geçiş
 * henüz uygulanmamışsa depo katmanı `unconfigured`/`unavailable` döner ve kur
 * servisi bugünkü süreç içi davranışına düşer — bugünkünden KÖTÜ değildir.
 * Bu, dağıtım sırasının serbest olmasını sağlar: kod geçişten önce de sonra
 * da doğru çalışır.
 */

export type SharedRateCacheReadOutcome =
  | { ok: true; observation: StoredProviderObservation }
  /** Henüz kimse yazmamış. Soğuk bir dağıtımda NORMALDİR. */
  | { ok: false; reason: "missing" }
  /** `DATABASE_URL` yok. Bilinen bir dağıtım durumu, olay değil. */
  | { ok: false; reason: "unconfigured" }
  /** Depo kurulu ama o an ulaşılamadı — ya da tablo henüz oluşmamış. */
  | { ok: false; reason: "unavailable" };

export async function readCoinGeckoRateCache(): Promise<SharedRateCacheReadOutcome> {
  const repository = await createNeonSharedBillRepository();
  if (repository === null) {
    return { ok: false, reason: "unconfigured" };
  }

  const outcome = await repository.readProviderRateCache({
    providerKey: COINGECKO_PROVIDER_KEY,
  });

  /*
   * Depo sözleşmesi ile bu sözleşme benzer şekilli; yine de ELLE eşlenir.
   * Depo tarafına yeni bir sebep eklenirse burada derleme hatası çıksın
   * istiyoruz, sessizce "erişilemiyor"a düşmesin.
   */
  if (outcome.ok) {
    return { ok: true, observation: outcome.observation };
  }
  return outcome.reason === "missing"
    ? { ok: false, reason: "missing" }
    : { ok: false, reason: "unavailable" };
}

/**
 * Gözlemi paylaşılan önbelleğe yazar.
 *
 * DÖNÜŞ DEĞERİ YOK ve hata YUTULUR. Bilinçli: yazma, kullanıcının o anki
 * isteğinin başarısını etkilememelidir. Kur zaten elde edilmiştir; onu
 * paylaşamamak bir sonraki isteği pahalılaştırır, bu isteği bozmaz.
 *
 * Yazma MONOTONDUR ve bunu SQL zorlar: depoda daha yeni bir gözlem varsa
 * üzerine yazılmaz. Bu yüzden burada okuma-karşılaştırma-yazma yapılmaz —
 * o sıra iki örnek arasında yarış açardı.
 */
export async function writeCoinGeckoRateCache(input: {
  rateText: string;
  observedAt: number;
  storedAtMs: number;
}): Promise<void> {
  const repository = await createNeonSharedBillRepository();
  if (repository === null) {
    return;
  }
  await repository
    .writeProviderRateCache({
      providerKey: COINGECKO_PROVIDER_KEY,
      rateText: input.rateText,
      observedAt: input.observedAt,
      storedAtMs: input.storedAtMs,
    })
    .catch(() => undefined);
}
