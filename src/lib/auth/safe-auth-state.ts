import type { SafeAuthState } from "@/components/AuthControl";

import { authenticateRequest, type AuthenticateRequest } from "./session";

/**
 * Sunucu oturumunu ARAYÜZE GÜVENLİ biçimde indirger.
 *
 * Tek yerde durmasının nedeni, "istemciye hangi alanlar geçer" kuralının
 * sayfadan sayfaya kopyalanmamasıdır: yalnızca görünen ad ve avatar geçer.
 * Uygulama kullanıcı kimliği, e-posta ve sağlayıcı hesap kimliği SUNUCUDA
 * kalır.
 *
 * BU BİR KAPI DEĞİLDİR. Yalnızca gösterilecek durumu üretir; hiçbir çağıran
 * bunun sonucuna bakarak erişim reddetmez. Yetkilendirme, ilgili API
 * rotalarında ve borçlu akışında cüzdan imzasıyla yapılır.
 */
export async function readSafeAuthState(
  authenticate: AuthenticateRequest = authenticateRequest,
): Promise<SafeAuthState> {
  const authentication = await authenticate();
  if (authentication.status !== "authenticated") {
    return authentication;
  }
  return {
    status: "authenticated",
    user: {
      name: authentication.user.name,
      image: authentication.user.image,
    },
  };
}
