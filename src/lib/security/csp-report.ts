/**
 * CSP İHLAL RAPORLARININ OKUNMASI.
 *
 * Amaç, `connect-src`'yi engelleyici yapmadan önce tarayıcının GERÇEKTEN
 * nereye bağlandığını öğrenmek. Konsola bakmak masaüstünde kolay ama
 * TELEFONDA neredeyse imkânsız; rapor ucu bu yüzden var — cihaz kendisi
 * bildirir.
 *
 * NE KAYDEDİLİR: yalnızca ihlal edilen yönerge ve engellenen adresin
 * KÖKENİ (şema + alan adı).
 *
 * NE KAYDEDİLMEZ: sayfanın adresi. Ortak hesap adresleri `billId` taşır ve
 * o bağlantıyı bilen herkes hesabı açabilir; günlüğe yazmak onu sızdırmak
 * olurdu. Aynı sebeple engellenen adresin yolu ve sorgusu da atılır.
 */

export type CspReport = Readonly<{
  /** Örn. `connect-src`. */
  directive: string;
  /** Örn. `https://rpc.testnet.arc.network` ya da `inline` / `eval`. */
  origin: string;
  /** `enforce` ya da `report`; tarayıcı söylemezse `null`. */
  disposition: string | null;
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * GÜNLÜK ENJEKSİYONUNA KARŞI KAPALI DİLBİLGİSİ.
 *
 * Bu uçta kimlik doğrulaması YOKTUR ve olamaz — raporu tarayıcı, oturumdan
 * bağımsız gönderir. Yani gövdeyi HERKES yazabilir. Alanlar doğrudan bir
 * günlük satırına girdiği için, içinde satır sonu olan bir yönerge SAHTE BİR
 * SATIR uydurabilirdi:
 *
 *     [csp] connect-src
 *     [csp] script-src <- (saldirganin uydurdugu koken) (enforce)
 *
 * Çözüm kaçış karakteri DEĞİL: kaçış bir gün unutulur. Dilbilgisi kapatılır —
 * beklenen biçime uymayan her şey en baştan reddedilir.
 */

/** CSP yönerge adı: yalnızca küçük harf ve tire. */
const DIRECTIVE_GRAMMAR = /^[a-z][a-z-]{2,31}$/;

/**
 * Adres olmayan köken anahtarları (`inline`, `eval`, `data`, `blob`...).
 * Tarayıcılar bunları küçük harfle üretir.
 */
const KEYWORD_ORIGIN_GRAMMAR = /^[a-z][a-z-]{2,31}$/;

/** `şema://ana-makine[:port]` — `new URL().origin`in ürettiği biçim. */
const URL_ORIGIN_GRAMMAR = /^[a-z][a-z0-9+.-]*:\/\/[a-z0-9.-]+(:\d{1,5})?$/;

/**
 * Adresi KÖKENİNE indirger.
 *
 * `inline`, `eval`, `data` gibi anahtar kelimeler adres değildir ve kişisel
 * veri taşımazlar; oldukları gibi kalırlar. Ayrıştırılamayan her şey
 * atılır — tanımadığımız bir dizgeyi günlüğe yazmayız.
 */
export function toOrigin(blocked: string | null): string | null {
  if (blocked === null) {
    return null;
  }
  if (KEYWORD_ORIGIN_GRAMMAR.test(blocked)) {
    return blocked;
  }
  let origin: string;
  try {
    origin = new URL(blocked).origin;
  } catch {
    return null;
  }
  /*
   * `new URL()` çoğu şeyi güvenli hâle getirir ama `origin` bazı şemalarda
   * `"null"` döner ya da beklenmedik biçimde gelir. Çıktı da denetlenir.
   */
  return URL_ORIGIN_GRAMMAR.test(origin) ? origin : null;
}

/**
 * İki biçimi de anlar: eski `report-uri` gövdesi (`{"csp-report": {...}}`) ve
 * Reporting API dizisi (`[{ "type": "csp-violation", "body": {...} }]`).
 *
 * Tanımadığı ya da eksik her şey için `null` döner: uç, çöp veriyi günlüğe
 * yazmaz.
 */
export function parseCspReport(payload: unknown): CspReport | null {
  const first = Array.isArray(payload) ? payload[0] : payload;
  const outer = asRecord(first);
  if (outer === null) {
    return null;
  }

  const legacy = asRecord(outer["csp-report"]);
  const modern = asRecord(outer.body);
  const body = legacy ?? modern ?? outer;

  const directive =
    asString(body["violated-directive"]) ??
    asString(body["effective-directive"]) ??
    asString(body.effectiveDirective);
  const blocked =
    asString(body["blocked-uri"]) ?? asString(body.blockedURL);
  const origin = toOrigin(blocked);

  /*
   * Uzunluk sınırı TEK BAŞINA yetmez: kırpılmış bir dizge hâlâ satır sonu
   * taşıyabilir. Biçimin kendisi doğrulanır.
   */
  if (
    directive === null ||
    origin === null ||
    !DIRECTIVE_GRAMMAR.test(directive)
  ) {
    return null;
  }

  const disposition = asString(body.disposition);
  return {
    directive,
    origin: origin.slice(0, 128),
    disposition:
      disposition === "enforce" || disposition === "report"
        ? disposition
        : null,
  };
}

/**
 * GÜNLÜK TAŞIRMAYA KARŞI SINIR.
 *
 * Uç kimlik doğrulaması YAPAMAZ, yani gönderim sayısı sınırsızdır. Tek bir
 * ihlal gerçek bir oturumda onlarca kez tekrarlanır; kötü niyetli biri ise
 * bunu istediği kadar çoğaltabilir. Vercel'de günlük hacmi hem para hem de
 * gerçek sinyali gömme meselesidir.
 *
 * En küçük işe yarar çözüm: aynı `(yönerge, köken)` çifti pencere başına BİR
 * kez yazılır. Tekrarlar sayılır ve pencere kapanınca tek bir özet satırıyla
 * bildirilir. Böylece "bu ihlal 400 kez oldu" bilgisi de KAYBOLMAZ.
 *
 * Sayaç ÖRNEK BAŞINADIR. Sunucusuz ortamda birden çok örnek olabilir, yani
 * bu bir üst sınır değil; hacmi büyüklük mertebesinde düşürür ve bu, tanısal
 * bir uç için yeterlidir. Süreç durumu kalıcı değildir; kaybolması zararsızdır.
 */
export const REPORT_WINDOW_MS = 60_000;

/** Bir pencerede kaç FARKLI çift yazılır. Sözlüğün sınırsız büyümesini önler. */
export const REPORT_DISTINCT_LIMIT = 20;

type Throttle = {
  windowStartedAt: number;
  seen: Map<string, number>;
  dropped: number;
};

export function createReportThrottle(): Throttle {
  return { windowStartedAt: 0, seen: new Map(), dropped: 0 };
}

export type ThrottleDecision =
  /** Satır yazılır. */
  | { kind: "log" }
  /** Yazılmaz; yalnızca sayılır. */
  | { kind: "skip" }
  /** Pencere kapandı: önce özet, sonra bu satır. */
  | { kind: "summary"; suppressed: number; distinct: number };

/**
 * Bu raporun günlüğe yazılıp yazılmayacağı.
 *
 * Pencere kapandığında, bastırılmış sayı SIFIRDAN büyükse özet döner; sıfırsa
 * gereksiz bir satır yazılmaz.
 */
export function decideReportLogging(
  throttle: Throttle,
  report: CspReport,
  nowMs: number,
): ThrottleDecision {
  const key = `${report.directive}|${report.origin}`;

  if (nowMs - throttle.windowStartedAt >= REPORT_WINDOW_MS) {
    const suppressed = throttle.dropped;
    const distinct = throttle.seen.size;
    throttle.windowStartedAt = nowMs;
    throttle.seen = new Map([[key, 1]]);
    throttle.dropped = 0;
    return suppressed > 0
      ? { kind: "summary", suppressed, distinct }
      : { kind: "log" };
  }

  const count = throttle.seen.get(key);
  if (count !== undefined) {
    throttle.seen.set(key, count + 1);
    throttle.dropped += 1;
    return { kind: "skip" };
  }

  if (throttle.seen.size >= REPORT_DISTINCT_LIMIT) {
    throttle.dropped += 1;
    return { kind: "skip" };
  }

  throttle.seen.set(key, 1);
  return { kind: "log" };
}
