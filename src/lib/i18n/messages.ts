import { translate, type TranslationKey, type TranslationParams } from "./dictionary";
import { isKnownApiErrorCode, localizeApiError } from "./api-errors";
import { type Locale } from "./locale";
import { tr } from "./tr";

/** `/api/rates/*` bir kur sorununu KOD olarak döndürür. */
const QUOTE_PROBLEMS: ReadonlySet<string> = new Set(Object.keys(tr.errors.quote));

/**
 * ERTELENMİŞ MESAJ.
 *
 * NEDEN GEREKLİ: bir hata ya da adım metni React durumunda ÇÖZÜLMÜŞ METİN
 * olarak saklanırsa, kullanıcı dili sonradan değiştirdiğinde o metin eski
 * dilde kalır. Bu yüzden durumda METİN DEĞİL, metnin TARİFİ saklanır ve
 * cümle her render'da ETKİN DİLDE kurulur.
 *
 * İki biçim vardır:
 *   - `key`: sözlükte doğrudan karşılığı olan bir metin (gerekirse
 *     değişkenlerle);
 *   - `api`: sunucunun KARARLI hata kodu — cümle koddan seçilir, sunucunun
 *     hazır metni hiçbir zaman gösterilmez.
 */
export type MessageDescriptor =
  | { kind: "key"; key: TranslationKey; params?: TranslationParams }
  | { kind: "api"; code?: string }
  /** Kur servisi: kod ya bir kur sorunu ya da genel bir sunucu kodudur. */
  | { kind: "rate"; code?: string };

export function messageKey(
  key: TranslationKey,
  params?: TranslationParams,
): MessageDescriptor {
  return params === undefined ? { kind: "key", key } : { kind: "key", key, params };
}

export function messageApi(code?: string): MessageDescriptor {
  return { kind: "api", code };
}

export function messageRate(code?: string): MessageDescriptor {
  return { kind: "rate", code };
}

/** Tarifi etkin dilde metne çevirir. */
export function resolveMessage(
  locale: Locale,
  descriptor: MessageDescriptor,
): string {
  if (descriptor.kind === "key") {
    return translate(locale, descriptor.key, descriptor.params);
  }
  if (descriptor.kind === "rate") {
    const { code } = descriptor;
    if (code !== undefined && QUOTE_PROBLEMS.has(code)) {
      return translate(locale, `errors.quote.${code}` as TranslationKey);
    }
    return isKnownApiErrorCode(code)
      ? localizeApiError(locale, code)
      : translate(locale, "errors.rateMalformed");
  }
  return localizeApiError(locale, descriptor.code);
}
