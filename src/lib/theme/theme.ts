/**
 * TEMA MANTIGI — saf ve test edilebilir.
 *
 * Bu modul SUNUCUDA ice aktarilabilir: yuklenirken `window`, `document`,
 * `localStorage` veya `matchMedia`ya DOKUNMAZ. Tarayici API'leri yalnizca
 * acikca cagrilan fonksiyonlarin icinde ve her zaman korumali okunur.
 *
 * ONCELIK SIRASI:
 *   1. Kullanicinin KAYITLI secimi (gecerliyse) — sistem tercihini YENER,
 *   2. Isletim sistemi tercihi (`prefers-color-scheme`),
 *   3. Aydinlik (guvenli varsayilan).
 *
 * Depolama okunamiyorsa (gizli sekme, devre disi cerezler, kota hatasi) hata
 * YUTULUR ve sistem tercihine dusulur; tema hicbir kosulda uygulamayi
 * dusurmez.
 *
 * Tercih SUNUCUYA VEYA VERITABANINA GONDERILMEZ; yalnizca tarayicida yasar.
 */

export type Theme = "light" | "dark";

/** `localStorage` anahtari. Tek yerde tanimlidir; betik de bunu kullanir. */
export const THEME_STORAGE_KEY = "hb-theme";

/** `<html>` uzerindeki kararli oznitelik. CSS secicileri buna bakar. */
export const THEME_ATTRIBUTE = "data-theme";

export const DEFAULT_THEME: Theme = "light";

/** Ancak bu iki deger gecerlidir; baska her sey bozuk sayilir. */
export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function oppositeTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/*
 * ---------------------------------------------------------------------------
 * ERISIM YARDIMCILARI — hepsi korumali
 * ---------------------------------------------------------------------------
 */

/**
 * Kayitli tercihi okur.
 *
 * Bozuk deger ("Dark", "1", "") ve erisilemez depolama AYNI sonucu verir:
 * `null`, yani "kayitli tercih yok" -> sistem tercihine dusulur.
 */
export function readStoredTheme(storage?: Pick<Storage, "getItem">): Theme | null {
  try {
    const store = storage ?? globalThis.localStorage;
    if (store === undefined || store === null) {
      return null;
    }
    const raw = store.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    // Gizli sekme / devre disi depolama / kota hatasi: sessizce yok sayilir.
    return null;
  }
}

/** Tercihi kaydeder. Basarisiz olursa tema yine de uygulanir. */
export function writeStoredTheme(
  theme: Theme,
  storage?: Pick<Storage, "setItem">,
): boolean {
  try {
    const store = storage ?? globalThis.localStorage;
    if (store === undefined || store === null) {
      return false;
    }
    store.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/** Isletim sistemi tercihi. `matchMedia` yoksa aydinlik varsayilir. */
export function readSystemTheme(
  matcher?: (query: string) => { matches: boolean },
): Theme {
  try {
    const match = matcher ?? globalThis.matchMedia?.bind(globalThis);
    if (typeof match !== "function") {
      return DEFAULT_THEME;
    }
    return match("(prefers-color-scheme: dark)").matches ? "dark" : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Etkin temayi ONCELIK SIRASINA gore cozer.
 *
 * Bagimliliklar disaridan verilebildigi icin bu fonksiyon tarayicisiz ve
 * belirlenimci bicimde test edilir.
 */
export function resolveTheme(input: {
  stored?: Theme | null;
  system?: Theme;
}): Theme {
  if (isTheme(input.stored)) {
    return input.stored;
  }
  return input.system ?? DEFAULT_THEME;
}

/**
 * Temayi belgeye uygular.
 *
 * `data-theme` ozniteligi CSS secicilerini surer; `color-scheme` ise yerel
 * denetimlerin (kaydirma cubugu, form alanlari) dogru cizilmesini saglar.
 * Erken baslatma betigi ile AYNI iki alani yazar, boylece React durumu ile
 * betigin sonucu ayrisamaz.
 */
export function applyTheme(theme: Theme, root?: HTMLElement): void {
  try {
    const element = root ?? globalThis.document?.documentElement;
    if (element === undefined || element === null) {
      return;
    }
    element.setAttribute(THEME_ATTRIBUTE, theme);
    element.style.colorScheme = theme;
  } catch {
    // DOM erisilemiyorsa tema CSS medya sorgusuyla yine de dogru kalir.
  }
}

/** Belgeye halihazirda uygulanmis temayi okur (betigin yazdigi deger). */
export function readAppliedTheme(root?: HTMLElement): Theme | null {
  try {
    const element = root ?? globalThis.document?.documentElement;
    if (element === undefined || element === null) {
      return null;
    }
    const value = element.getAttribute(THEME_ATTRIBUTE);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/*
 * ---------------------------------------------------------------------------
 * ERKEN BASLATMA BETIGI
 * ---------------------------------------------------------------------------
 */

/**
 * Ilk boyamadan ONCE calisan, engelleyici (blocking) betik.
 *
 * NEDEN GEREKLI: tema React hidrasyonundan sonra uygulanirsa sayfa bir an
 * yanlis temada gorunur ("theme flash"). Bu betik `<head>` icinde, govde
 * cizilmeden calisir ve `<html>` uzerine dogru degerleri yazar.
 *
 * GUVENLIK: tamamen SABIT bir metindir. Kullanici verisi, sunucu verisi veya
 * herhangi bir enterpolasyon ICERMEZ; bu yuzden XSS yuzeyi yoktur ve CSP
 * altinda bir nonce ile birlikte guvenle sunulabilir. Mantigi bu modulun
 * `resolveTheme` onceligiyle BIREBIR aynidir ve testle karsilastirilir.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var t=null;try{var s=localStorage.getItem("hb-theme");if(s==="dark"||s==="light"){t=s}}catch(e){}if(t===null){try{t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){t="light"}}d.setAttribute("data-theme",t);d.style.colorScheme=t}catch(e){}})();`;
