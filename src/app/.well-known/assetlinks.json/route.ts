import { assetLinksFromEnv } from "@/lib/android/assetlinks";

/**
 * `/.well-known/assetlinks.json`
 *
 * Android'in TWA doğrulaması bu adresi okur. Ortam değişkenleri
 * tanımlanmadan 404 döner; yarım bir beyan servis etmek doğrulama hatasını
 * gizlerdi.
 *
 * Değerler SIR DEĞİLDİR — dosyanın kendisi zaten herkese açıktır — ama yine
 * de sunucuda okunurlar, bu yüzden `NEXT_PUBLIC_` öneki KULLANILMAZ.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const statements = assetLinksFromEnv({
    ANDROID_PACKAGE_NAME: process.env.ANDROID_PACKAGE_NAME,
    ANDROID_APP_FINGERPRINTS: process.env.ANDROID_APP_FINGERPRINTS,
  });

  if (statements === null) {
    return new Response(null, { status: 404 });
  }

  return new Response(JSON.stringify(statements), {
    status: 200,
    headers: {
      "content-type": "application/json",
      /* Doğrulama sırasında birkaç kez okunur; kısa bir önbellek yeter. */
      "cache-control": "public, max-age=300",
    },
  });
}
