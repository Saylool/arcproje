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
  if (/^[a-z-]+$/.test(blocked)) {
    return blocked;
  }
  try {
    return new URL(blocked).origin;
  } catch {
    return null;
  }
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

  if (directive === null || origin === null) {
    return null;
  }

  const disposition = asString(body.disposition);
  return {
    /* Uzun bir dizge günlüğü şişirmesin. */
    directive: directive.slice(0, 64),
    origin: origin.slice(0, 128),
    disposition:
      disposition === "enforce" || disposition === "report"
        ? disposition
        : null,
  };
}
