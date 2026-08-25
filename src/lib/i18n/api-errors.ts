import { translate, type TranslationKey } from "./dictionary";
import { tr } from "./tr";
import { type Locale } from "./locale";

/**
 * SUNUCU HATALARININ SUNUM SINIRI.
 *
 * API sözleşmesi DEĞİŞMEZ: rotalar aynı `error.code` değerlerini ve aynı HTTP
 * durum kodlarını döndürmeye devam eder. Kodlar MAKİNE OKUNURDUR; çevrilmez,
 * yeniden adlandırılmaz.
 *
 * Kullanıcıya gösterilecek metin BURADA, istemci tarafında seçilir. Sunucunun
 * gövdesindeki hazır metin EKRANA BASILMAZ; böylece dil değiştiğinde mesaj da
 * değişir ve sunucudan gelen ham bir metin (sağlayıcı hatası, beklenmeyen
 * gövde) kullanıcı arayüzüne sızamaz.
 *
 * BİLİNMEYEN KOD: güvenli, genel ve DİLE UYGUN bir karşılık gösterilir. Kodun
 * kendisi, sunucunun metni veya HTTP gövdesi gösterilmez.
 *
 * AÇIĞA VURMA EŞİTLİĞİ: Türkçe ve İngilizce karşılıklar aynı bilgiyi verir.
 * Bir hesabın var olup olmadığı, bir cüzdanın o hesaba dâhil olup olmadığı ya
 * da hangi doğrulamanın düştüğü İngilizcede Türkçeden FAZLA anlatılmaz; iki
 * dil de sunucunun fail-closed davranışını aynı ölçüde korur.
 */

/** Sözlükte karşılığı olan kodlar. Anahtarlar sunucunun kod adlarıdır. */
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(tr.errors.api));

export function isKnownApiErrorCode(code: unknown): code is string {
  return typeof code === "string" && KNOWN_CODES.has(code);
}

/**
 * Bir sunucu hata kodunu kullanıcıya gösterilecek metne çevirir.
 *
 * `code` yoksa, tanınmıyorsa veya metin değilse genel karşılığa düşülür.
 */
export function localizeApiError(locale: Locale, code: unknown): string {
  if (isKnownApiErrorCode(code)) {
    return translate(locale, `errors.api.${code}` as TranslationKey);
  }
  return translate(locale, "errors.generic");
}

/**
 * Sunucu yanıtından KODU okur.
 *
 * Yalnızca `{ error: { code: string } }` biçimi kabul edilir. Mesaj alanı
 * BİLEREK okunmaz: gösterilecek metin her zaman sözlükten gelir.
 */
export function readApiErrorCode(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("error" in payload)) {
    return null;
  }
  const { error } = payload as { error: unknown };
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const { code } = error as { code: unknown };
  return typeof code === "string" && code !== "" ? code : null;
}
