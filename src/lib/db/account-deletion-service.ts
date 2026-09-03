import { isAppUserId } from "./shared-bill-listing-service";
import type { SharedBillRepository } from "./shared-bill-repository";

/**
 * HESAP SİLME.
 *
 * Google Play, hesap açtıran uygulamalardan hem uygulama İÇİNDE bir silme
 * yolu hem de silme talebi için bir web adresi ister. `/account` sayfası
 * ikisini birden karşılar.
 *
 * KİMLİK OTURUMDAN GELİR. İstemci hangi hesabın silineceğini SÖYLEYEMEZ;
 * `userId` her zaman sunucudaki oturumdan okunur.
 *
 * NE GİDER: `app_users` satırı — doğrulanmış e-posta, görünen ad, avatar
 * adresi — ve kayıtlı kişiler.
 *
 * NE KALIR: kişinin oluşturduğu ortak hesaplar. Onların içinde BAŞKA
 * insanların borcu vardır ve hesabını silen kişi başkalarının ödeme yolunu
 * kapatamaz. Kayıt sahipsiz kalır; ödemeye gereken her şey (alıcı adresi,
 * imza, borç satırları) kaydın kendi içindedir.
 *
 * ZİNCİR SİLİNEMEZ. Yapılmış transferler herkese açık ve kalıcıdır; silme
 * hakkı oraya ulaşmaz. Bu sınır kullanıcıya onay ekranında SÖYLENİR.
 */

export type DeleteAccountResult =
  | {
      ok: true;
      /**
       * Gerçekten bir satır gitti mi?
       *
       * `false`, silinecek bir şey KALMAMASI demektir (aynı isteğin ikinci
       * kez gelmesi gibi) ve bir hata değildir: sonuç aynı, hesap yok.
       */
      deleted: boolean;
    }
  | { ok: false; status: number; code: string; message: string };

const UNAVAILABLE = {
  ok: false as const,
  status: 503,
  code: "SERVICE_UNAVAILABLE",
  message: "Hesap şu anda silinemiyor. Lütfen birazdan tekrar dene.",
};

export async function deleteAccount(input: {
  userId: string;
  repository: SharedBillRepository;
}): Promise<DeleteAccountResult> {
  if (!isAppUserId(input.userId)) {
    return UNAVAILABLE;
  }
  const outcome = await input.repository.deleteAppUser({
    userId: input.userId,
  });
  return outcome.ok ? { ok: true, deleted: outcome.deleted } : UNAVAILABLE;
}
