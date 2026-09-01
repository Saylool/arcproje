/**
 * DIGITAL ASSET LINKS — Android uygulamasını bu alan adına bağlayan beyan.
 *
 * `/.well-known/assetlinks.json` doğrulanamazsa TWA açıldığında Chrome adres
 * çubuğunu GÖSTERİR ve uygulama bir tarayıcı sekmesi gibi görünür. Beyanın
 * biçimi bu yüzden gevşek tutulamaz: bozuk tek bir satır sessizce doğrulamayı
 * düşürür ve hata mesajı vermez.
 *
 * İKİ PARMAK İZİ GEREKİR, BİR DEĞİL. Play App Signing kullanıldığında ortada
 * iki sertifika vardır: geliştiricinin YÜKLEME anahtarı ve Google'ın UYGULAMA
 * İMZALAMA anahtarı. Kullanıcıya ulaşan sürüm ikincisiyle imzalanır, yerel ve
 * dâhili test kurulumları ise birincisiyle. İkisi de listede olmazsa bazı
 * kurulum yollarında doğrulama düşer. TWA'da en sık yapılan hata budur.
 */

/**
 * SHA-256 sertifika parmak izi: iki basamaklı 32 onaltılık bayt, aralarında
 * iki nokta. Küçük harf de kabul edilir ve büyük harfe çevrilir; Google'ın
 * araçları büyük harfle üretir ama elle kopyalarken harf durumu kolayca
 * kayar ve bu tek başına doğrulamayı düşürmemelidir.
 */
const FINGERPRINT = /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){31}$/;

/**
 * Android paket adı: ters DNS. En az iki parça olmalıdır ve her parça bir
 * harfle başlar; Android'in kendi kuralı da budur.
 */
const PACKAGE_NAME = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

export function isValidPackageName(value: string): boolean {
  return PACKAGE_NAME.test(value.trim());
}

/**
 * Virgülle ayrılmış parmak izlerini ayrıştırır.
 *
 * Tek bir geçersiz giriş bile TÜM listeyi reddeder: yarısı doğru bir beyan,
 * hiç beyan olmamasından daha zor teşhis edilir.
 */
export function parseFingerprints(raw: string): string[] | null {
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  if (parts.length === 0) {
    return null;
  }
  if (!parts.every((part) => FINGERPRINT.test(part))) {
    return null;
  }

  const normalized = parts.map((part) => part.toUpperCase());
  return [...new Set(normalized)];
}

export type AssetLinkStatement = {
  relation: readonly string[];
  target: {
    namespace: "android_app";
    package_name: string;
    sha256_cert_fingerprints: readonly string[];
  };
};

/** Chrome'un TWA doğrulaması için beklediği tek ilişki. */
export const HANDLE_ALL_URLS = "delegate_permission/common.handle_all_urls";

export function buildAssetLinks(
  packageName: string,
  fingerprints: readonly string[],
): AssetLinkStatement[] {
  return [
    {
      relation: [HANDLE_ALL_URLS],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: [...fingerprints],
      },
    },
  ];
}

export type AssetLinksEnv = {
  ANDROID_PACKAGE_NAME?: string;
  ANDROID_APP_FINGERPRINTS?: string;
};

/**
 * Ortamdan beyanı üretir. Yapılandırma eksik ya da bozuksa `null` döner ve
 * çağıran taraf 404 verir: BOŞ BİR DİZİ SERVİS EDİLMEZ, çünkü o "kurulmuş
 * ama bozuk" görüntüsü verir ve doğrulama hatasını teşhis edilemez kılar.
 */
export function assetLinksFromEnv(env: AssetLinksEnv): AssetLinkStatement[] | null {
  const packageName = env.ANDROID_PACKAGE_NAME?.trim() ?? "";
  const raw = env.ANDROID_APP_FINGERPRINTS ?? "";

  if (!isValidPackageName(packageName)) {
    return null;
  }
  const fingerprints = parseFingerprints(raw);
  if (fingerprints === null) {
    return null;
  }
  return buildAssetLinks(packageName, fingerprints);
}
