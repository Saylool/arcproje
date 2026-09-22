/**
 * GÜVENLİK BAŞLIKLARI.
 *
 * Üretimde ölçüldü: yalnızca `strict-transport-security` vardı (onu Vercel
 * koyuyor). CSP, çerçeveleme koruması, MIME koklama koruması ve yönlendiren
 * politikası yoktu.
 *
 * Başlıklar burada VERİ olarak durur; `next.config.ts` yalnızca listeyi
 * okur. Böylece testler gerçek değerleri okuyabilir.
 *
 * CSP bu listede DEĞİLDİR: her isteğe özgü bir nonce taşıdığı için statik
 * bir başlık olamaz. `src/proxy.ts` her istekte `buildContentSecurityPolicies`
 * ile üretip basar.
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
  /*
   * İKİNCİ Arc RPC sunucusu ve bu bir varsayım değil, ÖLÇÜM.
   *
   * CSP'nin rapor kipi üretimde gerçek bir ödeme akışında yakaladı: Circle
   * App Kit viem'in gömülü `arcTestnet` tanımını kullanıyor ve o tanımın
   * varsayılan RPC'si `.network`. Bizim kendi istemcimiz `.io` kullanır.
   *
   * Kaynak taraması bunu bulamazdı; adres bağımlılığın içinde.
   *
   * APP KIT KALDIRILDI ve `transfer-client.ts` yalnızca profildeki BİRİNCİL
   * adrese bağlanır (bir test bunu zorlar), yani bu adrese artık ulaşılmıyor
   * OLMALI. Yine de LİSTEDE BIRAKILDI: bunu söyleyen şey şu an bir çıkarım,
   * ölçüm değil. Mobil akış rapor kipiyle bir kez koşturulup `.network` için
   * tek bir ihlal bile gelmediği görülünce buradan ve `DISCLOSED_HOSTS`tan
   * BİRLİKTE çıkarılır. Fazladan bir adresin listede durması zararsızdır;
   * eksik bir adres parayı göndermeyi kırar.
   */
  "https://rpc.testnet.arc.network",
  /* WalletConnect röle ve RPC'si. */
  "https://relay.walletconnect.org",
  "wss://relay.walletconnect.org",
  "https://rpc.walletconnect.org",
];

/** Google profil görselleri. Alt alan adı değişebildiği için joker. */
const AVATAR_HOSTS = ["https://*.googleusercontent.com"] as const;

/**
 * `script-src` NONCE İLE KATIDIR.
 *
 * Saklamasız bir cüzdan uygulamasında tek gerçek saldırı yüzeyi ön yüzdür:
 * sayfaya sızan bir satır içi script alıcı adresini değiştirir ve kullanıcı
 * cüzdanda onaylar; her doğrulama geçer çünkü doğrulamayı yapan kod da ele
 * geçmiştir. `'unsafe-inline'` bu yüzden burada YOKTUR.
 *
 * Nonce her istekte `src/proxy.ts` tarafından üretilir ve iki yere taşınır:
 * isteğin `content-security-policy` başlığına (Next kendi önyükleme
 * script'lerini oradan okuyup damgalar) ve `x-nonce` başlığına (düzen, tema
 * script'ini oradan damgalar). Sayfalar zaten `no-store`; her isteğin ayrı
 * çizilmesi yeni bir maliyet değil.
 *
 * `'strict-dynamic'`: nonce'lu bir script'in yüklediği script'lere de izin
 * verir — Next'in parça (chunk) yükleyicisi böyle çalışır. Onu anlamayan
 * eski tarayıcılar `'self'`e düşer.
 */
export const CSP_NONCE_REQUEST_HEADER = "x-nonce";

/** Next'in kendi çözümleyicisiyle aynı biçim (`get-script-nonce-from-header`). */
const NONCE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;
/** 16 bayt rastgele = 24 karakter base64; daha kısası tahmin edilebilir sayılır. */
const NONCE_MIN_LENGTH = 22;

export function isValidCspNonce(value: string): boolean {
  return value.length >= NONCE_MIN_LENGTH && NONCE_PATTERN.test(value);
}

/**
 * Web Crypto ile 16 bayt; Node ve Edge çalışma zamanlarının ikisinde de var.
 * `Math.random` KULLANILMAZ: nonce tahmin edilirse CSP hiç yokmuş gibi olur.
 */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function scriptSrc(nonce: string): string {
  /* Bozuk bir nonce ile üretilen politika HER script'i engellerdi; erken dur. */
  if (!isValidCspNonce(nonce)) {
    throw new Error("Geçersiz CSP nonce'u");
  }
  return `'self' 'nonce-${nonce}' 'strict-dynamic'`;
}

/** Aynı gerekçe: Tailwind ve Next satır içi stil üretiyor. */
const STYLE_SRC = "'self' 'unsafe-inline'";

/**
 * ŞİMDİLİK SERBEST BIRAKILAN `connect-src`.
 *
 * `*` ağ şemalarını kapsar ama `data:`/`blob:` şemalarını kapsamaz; onlar
 * ayrıca yazılır. Bugünkü durumdan kötü DEĞİLDİR: kalan yönergeler zaten
 * zorlayıcı.
 *
 * NEDEN HÂLÂ KAPATILMADI — ÖLÇÜLDÜ, TAHMİN DEĞİL.
 *
 * Derlenmiş istemci paketi (`.next/static/chunks`) tarandı. Aşağıdaki cüzdan
 * altyapısı adresleri pakette VAR ama `BROWSER_CONNECT_HOSTS` listesinde YOK:
 *
 *   WalletConnect: verify (kaynak doğrulama), pulse (telemetri),
 *                  echo (anlık bildirim)
 *   Circle:        api (App Kit), iris-api (CCTP attestation),
 *                  gateway-api (Circle gateway)
 *
 * Alan adları BİLEREK açık yazılmadı: `privacy.test.ts` kaynakta geçen her
 * dış alan adının gizlilik metninde bildirilmesini şart koşuyor ve bu doğru
 * bir kural. Bunlar bildirilecek servisler değil, paketten çıkan adaylar.
 *
 * Pakette BULUNMAK ile ÇAĞRILMAK aynı şey değildir; bu liste ihtiyaç değil
 * ADAY listesidir. Hangisinin gerçekten çağrıldığını yalnızca rapor kipinin
 * üretimde topladığı ihlaller söyleyebilir — ve bunlar Vercel günlüklerinde.
 *
 * KAPATMA KOŞULU: mobil WalletConnect eşleşmesi ve hesap OLUŞTURMA akışı
 * üretimde birer kez çalıştırıldıktan sonra `[csp]` satırları okunur; listeye
 * yalnızca gerçekten rapor edilenler eklenir. Eksik bir liste parayı
 * göndermeyi kırar, bu yüzden tahminle kapatılmaz.
 *
 * CoinGecko bu listede DEĞİLDİR ve olmamalıdır: kur sunucudan çekilir,
 * tarayıcı yalnızca `'self'`e gider. Bu da ölçüldü.
 */
const OPEN_CONNECT_SRC = "* data: blob:";

/** Raporların gönderildiği uç. Testler gerçek rotayla eşliğini zorlar. */
export const CSP_REPORT_PATH = "/api/csp-report";

function directives(scriptSrc: string, connectSrc: string): string {
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${STYLE_SRC}`,
    /* data: QR ve ikonlar, blob: seçilen fişin önizlemesi. */
    `img-src 'self' data: blob: ${AVATAR_HOSTS.join(" ")}`,
    "font-src 'self'",
    `connect-src ${connectSrc}`,
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
    /*
     * İhlaller sunucuya BİLDİRİLİR. Konsola bakmak masaüstünde kolay ama
     * telefonda neredeyse imkânsız; `connect-src`'yi engelleyici yapabilmek
     * için mobil yolun ne yaptığını da bilmemiz gerekiyor.
     *
     * Uç yalnızca yönergeyi ve engellenen adresin KÖKENİNİ günlüğe yazar;
     * sayfanın adresi yazılmaz.
     */
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

export type ContentSecurityPolicies = Readonly<{
  /**
   * UYGULANAN politika.
   *
   * Kapsamı KANIT belirledi. Üretimde tam bir ödeme akışı rapor kipiyle
   * çalıştırıldı; `connect-src` DIŞINDA hiçbir yönerge tek bir ihlal bile
   * üretmedi — `frame-src`, `img-src`, `style-src`, `worker-src` dâhil.
   * `script-src`'nin nonce'lu hâli bu ölçümden SONRA geldi ve tarayıcı
   * panelinde canlı doğrulandı.
   */
  enforced: string;
  /**
   * ÖLÇMEYE DEVAM EDEN politika.
   *
   * Yalnızca `connect-src` burada katıdır. Ölçüm masaüstü/eklenti borçlu
   * akışını kapsadı; mobil WalletConnect ve hesabı oluşturan akış henüz
   * çalıştırılmadı. Onlar da temiz çıktığında `connect-src` uygulanana taşınır.
   */
  reportOnly: string;
}>;

/** İki politika aynı nonce'u taşır; bir test bunu ve `connect-src` dışında birebir aynı olmalarını zorlar. */
export function buildContentSecurityPolicies(
  nonce: string,
): ContentSecurityPolicies {
  const script = scriptSrc(nonce);
  return {
    enforced: directives(script, OPEN_CONNECT_SRC),
    reportOnly: directives(script, `'self' ${BROWSER_CONNECT_HOSTS.join(" ")}`),
  };
}

export type SecurityHeader = Readonly<{ key: string; value: string }>;

/** İsteğe bağlı OLMAYAN başlıklar; CSP `src/proxy.ts`'ten gelir. */
export const SECURITY_HEADERS: readonly SecurityHeader[] = [
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
