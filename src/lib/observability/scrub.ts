/**
 * HATA OLAYLARINDAN KİMLİK TAŞIYAN HER ŞEYİN TEMİZLENMESİ.
 *
 * NEDEN VAR: hata takibi, tanımı gereği uygulamanın iç durumunu ÜÇÜNCÜ BİR
 * TARAFA gönderir. Bu depoda gizlilik sınırı açıkça çizilmiş: gerçek cüzdan
 * adresleri, üretilmiş ödeme linkleri, requestId'ler ve işlem yükleri dışarı
 * yazılmaz. Sentry'yi varsayılan haliyle bağlamak o sınırı sessizce delerdi.
 *
 * EN SİNSİ YOL URL'DİR. `bill_id` bir yol parametresidir
 * (`/pay/0x…`, `/api/shared-bills/0x…/payment/prepare`), yani varsayılan bir
 * kurulumda HER olayla birlikte gider — istisna mesajında hiçbir şey olmasa
 * bile. Bu yüzden temizlik tek tek alanlara değil, olayın TAMAMINA uygulanır.
 *
 * YAKLAŞIM — ŞEKİL TANIMA, ALAN LİSTESİ DEĞİL. Hangi alanın kimlik taşıdığını
 * saymak, yeni bir alan eklendiği gün sessizce eksik kalır. Bunun yerine olay
 * ağacındaki HER dize taranır ve tanınan şekiller değiştirilir.
 *
 * DEĞER SİLİNMEZ, ŞEKLİ BIRAKILIR: `0x<hex:64>` gibi. Bir hata ayıklayan
 * kişi "burada bir hesap kimliği vardı" ile "burada bir adres vardı"yı ayırt
 * edebilmeli; değerin kendisine ihtiyacı yok.
 */

/**
 * `0x` + en az 20 onaltılık hane.
 *
 * Tek kural üç şekli birden kapsar: adres (40), hesap/işlem/nonce/oturum
 * özeti (64) ve imza (130). Ayrı ayrı yazılsaydı en uzunu önce denemek
 * gerekirdi; tek desen bu sıra hatasını imkânsız kılar.
 *
 * ALT SINIR NEDEN 20: chainId gibi kısa onaltılık sayılar (`0x2b74`) kimlik
 * DEĞİLDİR ve hata ayıklarken gerçekten gerekir. Yirmi hane, en kısa kimlik
 * olan adresin (40) yarısı; arada kalan bir şey yok.
 */
const HEX_IDENTIFIER = /0x[0-9a-fA-F]{20,}/g;

/** Uygulama kullanıcısı ve kayıtlı kişi kimlikleri. */
const UUID =
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

/** Google girişinden gelen e-posta. */
const EMAIL = /\b[^\s@<>()[\]{}]{1,64}@[^\s@<>()[\]{}]{1,255}\.[a-zA-Z]{2,24}\b/g;

/**
 * Olay ağacında inilecek EN FAZLA derinlik.
 *
 * Bir sınır olmadan, beklenmedik biçimde derin bir yapı temizlik sırasında
 * yığını tüketebilir. Sınıra ulaşan dal OLDUĞU GİBİ BIRAKILMAZ, atılır:
 * temizlenmemiş veri göndermektense o dalı kaybetmek yeğdir.
 */
export const MAX_SCRUB_DEPTH = 12;

/** Sınırı aşan dalın yerine konan işaret. */
export const TRUNCATED = "<derinlik-sınırı>";

/**
 * Tek bir dizeyi temizler.
 *
 * Sıra önemsizdir: üç desen birbiriyle çakışmaz — onaltılık kimlikte `-` ve
 * `@` yoktur, UUID `0x` ile başlamaz.
 */
export function scrubText(value: string): string {
  return value
    .replace(HEX_IDENTIFIER, (match) => `0x<hex:${match.length - 2}>`)
    .replace(UUID, "<uuid>")
    .replace(EMAIL, "<email>");
}

/**
 * Değerin ne olduğuna bakmaksızın ağacın tamamını temizler.
 *
 * NESNE ANAHTARLARI DA temizlenir: bir kimlik anahtar olarak da görünebilir
 * (ör. `{ "0x…": 3 }` biçiminde bir sayaç).
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH) {
    return TRUNCATED;
  }
  if (typeof value === "string") {
    return scrubText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[scrubText(key)] = scrubValue(entry, depth + 1);
    }
    return output;
  }
  /* Sayı, boolean, null, undefined: kimlik taşıyamaz, olduğu gibi geçer. */
  return value;
}

/**
 * TÜMÜYLE ATILAN alanlar.
 *
 * Bunlar şekil tanımayla korunamaz: bir çerez, bir yetkilendirme başlığı ya da
 * bir istek gövdesi, tanınacak hiçbir desene uymadan sır taşır. Temizlemek
 * yerine SİLİNİRLER — bir hatayı anlamak için gerekli değiller.
 */
export const DROPPED_REQUEST_FIELDS = [
  "cookies",
  "headers",
  "data",
  "env",
] as const;

/**
 * Sentry olayını gönderilmeden önce temizler.
 *
 * `beforeSend` ve `beforeSendTransaction` için tek giriş noktası. Saf: girdi
 * nesnesini DEĞİŞTİRMEZ, temizlenmiş bir kopya döndürür.
 */
export function scrubEvent<T extends object>(event: T): T {
  const scrubbed = scrubValue(event) as Record<string, unknown>;

  /*
   * KULLANICI HİÇ GÖNDERİLMEZ. Sentry varsayılan olarak IP ve kimlik
   * ekleyebilir; burada alan tümüyle kaldırılır. "Kim" bilgisi bir hatayı
   * anlamak için gerekli değil.
   */
  delete scrubbed.user;

  const request = scrubbed.request;
  if (request !== null && typeof request === "object") {
    const trimmed = { ...(request as Record<string, unknown>) };
    for (const field of DROPPED_REQUEST_FIELDS) {
      delete trimmed[field];
    }
    scrubbed.request = trimmed;
  }

  return scrubbed as T;
}
