import type * as SentryTypes from "@sentry/nextjs";

import {
  buildSentryOptions,
  isSentryConfigured,
} from "@/lib/observability/sentry-config";

/**
 * Next.js ÖLÇÜM KANCASI — sunucu ve edge çalışma zamanları.
 *
 * `register()` her çalışma zamanı için bir kez çalışır; `onRequestError` ise
 * Next'in yakaladığı sunucu hatalarını verir. İkisi de burada, tek yerde.
 *
 * SDK TEMBEL YÜKLENİR. `@sentry/nextjs` yalnızca `SENTRY_DSN` tanımlıyken
 * içeri girer: yapılandırılmamış bir ortamda (yerel geliştirme, testler,
 * CI) modül hiç yüklenmez ve hiçbir maliyet doğurmaz. Tip import'u
 * `import type` olduğu için derlemeden sonra ORTADAN KALKAR.
 *
 * TARAYICI YOKTUR. `instrumentation-client.ts` bilerek eklenmedi; gerekçe
 * `sentry-config.ts` içinde.
 *
 * KAYNAK HARİTASI YÜKLENMEZ. `withSentryConfig` sarmalayıcısı bilerek
 * eklenmedi: tek getirisi kaynak haritası yüklemesi ve sürüm etiketlemedir,
 * ikisi de Sentry kimlik bilgileri ister; karşılığında derleme
 * yapılandırmasını değiştirir. Yığın izleri derlenmiş dosyaya işaret eder —
 * hangi rotanın neyle düştüğünü görmek için bu yeterlidir. Kimlik bilgileri
 * geldiğinde sarmalayıcı ayrı bir iş olarak eklenebilir.
 */

export async function register(): Promise<void> {
  if (!isSentryConfigured(process.env)) {
    return;
  }
  const options = buildSentryOptions(process.env);
  if (options === null) {
    return;
  }

  /*
   * Yalnızca sunucu ve edge. Başka bir çalışma zamanı gelirse sessizce
   * atlanır — tanımadığımız bir ortamda başlatmak, oradaki verinin ne
   * içerdiğini bilmeden göndermek olurdu.
   */
  const runtime = process.env.NEXT_RUNTIME;
  if (runtime !== "nodejs" && runtime !== "edge") {
    return;
  }

  const Sentry = await import("@sentry/nextjs");
  Sentry.init(options);
}

/**
 * Next'in sunucu tarafında yakaladığı hataları Sentry'ye iletir.
 *
 * Yapılandırma yoksa HİÇBİR ŞEY yapmaz ve SDK yüklenmez; sessizce geçmek
 * burada doğru davranıştır — hata takibi olmayan bir kurulum çalışmaya
 * devam etmeli.
 */
export const onRequestError: typeof SentryTypes.captureRequestError = async (
  ...args
) => {
  if (!isSentryConfigured(process.env)) {
    return;
  }
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
