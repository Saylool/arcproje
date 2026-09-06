import {
  BUDGET_CALLS_PER_WINDOW,
  COINGECKO_PROVIDER_KEY,
  budgetWindowStart,
  type ProviderBudgetOutcome,
} from "@/lib/rates/provider-budget";

import { createNeonSharedBillRepository } from "./neon-shared-bill-repository";

/**
 * PAYLAŞILAN SAĞLAYICI BÜTÇESİNİN VARSAYILAN SÜRÜCÜSÜ. YALNIZCA SUNUCU.
 *
 * `quote-service.ts` saf kalsın diye veritabanı buraya toplanmıştır: kur
 * servisi bir işlev alır, Postgres'i tanımaz.
 *
 * YAPILANDIRMA YOKSA ENGEL DE YOK. `DATABASE_URL` tanımlı değilse depo
 * `null` döner ve burada `unavailable` üretilir. Bu bilinçlidir: yerel
 * geliştirme ve testler veritabanı olmadan çalışmaya devam eder ve kur
 * servisi bugünkü süreç içi korumasına düşer — bugünkünden KÖTÜ değildir.
 *
 * Bu, sınırın açıkça YAZILMASI gereken yerdir: kesinti sırasında örnekler
 * arası koruma YOKTUR. Sessiz kalmasın diye çağıran tarafta günlüğe düşer.
 */
export async function reserveCoinGeckoCall(
  nowMs: number,
  limit: number = BUDGET_CALLS_PER_WINDOW,
): Promise<ProviderBudgetOutcome> {
  const repository = await createNeonSharedBillRepository();
  if (repository === null) {
    /*
     * Yapılandırma yok — bu bir HATA DEĞİLDİR. Yerelde ve testlerde normal
     * durumdur, bu yüzden çağıran tarafta günlüğe düşmez.
     */
    return { ok: false, reason: "unconfigured" };
  }

  const outcome = await repository.reserveProviderCall({
    providerKey: COINGECKO_PROVIDER_KEY,
    windowStart: budgetWindowStart(nowMs),
    limit,
  });

  /*
   * Depo sözleşmesi ile politika sözleşmesi AYNI şekle sahiptir; yine de
   * elle eşlenir. Depo tarafına yeni bir sebep eklenirse burada derleme
   * hatası çıksın istiyoruz, sessizce "erişilemiyor"a düşmesin.
   */
  if (outcome.ok) {
    return { ok: true, used: outcome.used };
  }
  return outcome.reason === "exhausted"
    ? { ok: false, reason: "exhausted" }
    : { ok: false, reason: "unavailable" };
}
