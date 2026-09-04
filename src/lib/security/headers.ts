/**
 * GÜVENLİK BAŞLIKLARI.
 *
 * Üretimde ölçüldü: yalnızca `strict-transport-security` vardı (onu Vercel
 * koyuyor). CSP, çerçeveleme koruması, MIME koklama koruması ve yönlendiren
 * politikası yoktu.
 *
 * Başlıklar burada VERİ olarak durur; `next.config.ts` yalnızca listeyi
 * okur. Böylece testler gerçek değerleri okuyabilir.
 */

/**
 * Tarayıcının BAĞLANDIĞI adresler.
 *
 * Yalnızca istemci tarafı. `api.openai.com` ve veritabanı burada YOKTUR:
 * onlara sunucu bağlanır, tarayıcı değil. Gizlilik politikasındaki
 * `DISCLOSED_HOSTS` listesi daha geniştir çünkü sunucu tarafını ve yalnızca
 * bağlantı olarak geçen adresleri de sayar.
 */
export const BROWSER_CONNECT_HOSTS: readonly string[] = [
  /* Arc Testnet RPC: cüzdansız okumalar ve tahminler buradan gider. */
  "https://rpc.testnet.arc.io",
  /* WalletConnect röle ve RPC'si. */
  "https://relay.walletconnect.org",
  "wss://relay.walletconnect.org",
  "https://rpc.walletconnect.org",
];

/** Google profil görselleri. Alt alan adı değişebildiği için joker. */
const AVATAR_HOSTS = ["https://*.googleusercontent.com"] as const;

/**
 * `script-src` BİLEREK gevşektir ve bu bir eksiktir, gizlenmez.
 *
 * Ölçüldü: sayfa 10 satır içi script taşıyor (Next.js'in kendi önyükleme
 * script'leri ve temanın "yanıp sönmeyi" önleyen script'i) ve HİÇBİRİNDE
 * nonce yok. `'unsafe-inline'` kaldırılırsa uygulama açılmaz.
 *
 * Sıkılaştırmak, her istekte nonce üreten bir middleware ister — ayrı ve
 * açıkça istenmesi gereken bir iş. O gelene kadar `script-src`, bugünkü
 * durumdan DAHA KÖTÜ değildir; politikanın geri kalanı ise bugün hiç
 * olmayan korumaları getirir.
 */
const SCRIPT_SRC = "'self' 'unsafe-inline'";

/** Aynı gerekçe: Tailwind ve Next satır içi stil üretiyor. */
const STYLE_SRC = "'self' 'unsafe-inline'";

function directives(scriptSrc: string): string {
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${STYLE_SRC}`,
    /* data: QR ve ikonlar, blob: seçilen fişin önizlemesi. */
    `img-src 'self' data: blob: ${AVATAR_HOSTS.join(" ")}`,
    "font-src 'self'",
    `connect-src 'self' ${BROWSER_CONNECT_HOSTS.join(" ")}`,
    /* Eklenti yok, taban etiketi enjeksiyonu yok. */
    "object-src 'none'",
    "base-uri 'none'",
    /* Form hedefi yalnızca kendimiz: gönderim başka yere kaçırılamaz. */
    "form-action 'self'",
    /*
     * TIKLAMA HIRSIZLIĞINA KARŞI. Ödeme sayfası birinin sitesinde iframe'e
     * alınabiliyordu; artık alınamaz. TWA bir iframe DEĞİLDİR, etkilenmez.
     */
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Uygulanan politika. */
export const CONTENT_SECURITY_POLICY = directives(SCRIPT_SRC);

/**
 * YALNIZCA RAPORLAYAN katı politika.
 *
 * Uygulanmaz; ihlalleri tarayıcı konsoluna yazar. Amacı, nonce'lu bir
 * `script-src`'ye geçmeden önce neyin kırılacağını ÖLÇMEK — silme işinde
 * olduğu gibi, önce ölç sonra uygula.
 */
export const CONTENT_SECURITY_POLICY_REPORT_ONLY = directives("'self'");

export type SecurityHeader = Readonly<{ key: string; value: string }>;

export const SECURITY_HEADERS: readonly SecurityHeader[] = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  {
    key: "Content-Security-Policy-Report-Only",
    value: CONTENT_SECURITY_POLICY_REPORT_ONLY,
  },
  /* Sunucunun söylediği tür bağlayıcıdır; tarayıcı tahmin etmez. */
  { key: "X-Content-Type-Options", value: "nosniff" },
  /*
   * CSP'yi anlamayan eski tarayıcılar için `frame-ancestors`ın karşılığı.
   */
  { key: "X-Frame-Options", value: "DENY" },
  /*
   * Dış sitelere YOL gönderilmez. Ortak hesap adresleri `billId` taşıyor;
   * tam adresin yönlendiren başlığında sızması, bağlantıyı sızdırmak olurdu.
   */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  /*
   * Kullanılmayan güçlü yetenekler kapatılır. Fiş fotoğrafı dosya seçiciyle
   * alınır, `getUserMedia` ile DEĞİL; kamerayı kapatmak akışı bozmaz.
   */
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "interest-cohort=()",
    ].join(", "),
  },
];
