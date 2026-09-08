import { existsSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { onRequestError, register } from "@/instrumentation";

import { scrubEvent } from "./scrub";
import {
  buildSentryOptions,
  isSentryConfigured,
  readEnvironment,
  readSentryDsn,
} from "./sentry-config";

/**
 * SENTRY YAPILANDIRMASI — kapsam ve varsayılanlar.
 *
 * Buradaki testlerin işi, hata takibinin nereye KADAR uzandığını sabitlemek:
 * sunucuda çalışır, tarayıcıya inmez, kişisel veri göndermez ve
 * yapılandırılmamış bir kurulumu bozmaz.
 */

const DSN = "https://ornek@o0.ingest.sentry.io/0";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("yapilandirma yoksa hicbir sey olmaz", () => {
  it("DSN tanimsiz ya da BOSLUK ise kurulu sayilmaz", () => {
    /*
     * Yerel geliştirme ve testler hata takibi olmadan çalışmaya devam
     * etmeli; bu bir hata değil, beklenen durumdur.
     */
    expect(isSentryConfigured({})).toBe(false);
    expect(isSentryConfigured({ SENTRY_DSN: "   " })).toBe(false);
    expect(readSentryDsn({ SENTRY_DSN: "" })).toBeNull();
    expect(buildSentryOptions({})).toBeNull();
  });

  it("kanca islevleri DSN yokken sessizce doner", async () => {
    /*
     * `register` ve `onRequestError` Next tarafından HER ZAMAN çağrılır.
     * Yapılandırma yokken atmaları, hata takibi kurulmamış bir dağıtımı
     * tümüyle düşürürdü.
     */
    vi.stubEnv("SENTRY_DSN", "");
    await expect(register()).resolves.toBeUndefined();
    await expect(
      onRequestError(new Error("x"), { path: "/", method: "GET", headers: {} }, {
        routerKind: "App Router",
        routePath: "/",
        routeType: "route",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("varsayilanlar", () => {
  const options = buildSentryOptions({ SENTRY_DSN: DSN, VERCEL_ENV: "production" });

  it("DSN ve ortam tasinir", () => {
    expect(options?.dsn).toBe(DSN);
    expect(options?.environment).toBe("production");
  });

  it("BASARIM IZLEME kapalidir", () => {
    /*
     * İşlem adları URL'den türer ve URL'de hesap kimliği vardır — temizlik
     * onu yakalar, ama göndermemek daha iyidir. Ayrıca izleme hacmi hata
     * hacminden kat kat büyüktür. Aranan şey "ne kırıldı".
     */
    expect(options?.tracesSampleRate).toBe(0);
  });

  it("KISISEL VERI acikca kapatilir", () => {
    /*
     * Varsayılan zaten budur; satırın kendisi, varsayılan bir gün değişirse
     * sınırın kod tarafından korunmasını sağlar.
     */
    expect(options?.sendDefaultPii).toBe(false);
  });

  it("gonderim oncesi TEMIZLEYICI baglidir", () => {
    /*
     * Bağlanmazsa hiçbir test düşmez ama her olay ham gider. Bu yüzden bağ
     * ayrıca ölçülür.
     */
    expect(options?.beforeSend).toBe(scrubEvent);
    expect(options?.beforeSendTransaction).toBe(scrubEvent);
  });
});

describe("ortam ayrimi", () => {
  it("Vercel'in kendi degiskeni oncelikli, sonra NODE_ENV", () => {
    /*
     * Ayrım olmadan önizleme dağıtımlarının gürültüsü üretim hatalarına
     * karışır ve alarm anlamını yitirir.
     */
    expect(readEnvironment({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(
      "preview",
    );
    expect(readEnvironment({ NODE_ENV: "production" })).toBe("production");
    expect(readEnvironment({})).toBe("development");
  });
});

describe("KAPSAM: tarayiciya inmez", () => {
  it("DSN yalnizca sunucu degiskeninden okunur", () => {
    /*
     * `NEXT_PUBLIC_` öneki istemci paketine kapı açardı. Kapsamı sunucuda
     * tutmanın en basit yolu değişkeni oraya hiç vermemek.
     */
    expect(
      isSentryConfigured({ NEXT_PUBLIC_SENTRY_DSN: DSN } as Record<
        string,
        string | undefined
      >),
    ).toBe(false);
  });

  it("istemci olcum dosyasi YOKTUR", () => {
    /*
     * `instrumentation-client.ts` var olsaydı Next onu KENDILIGINDEN
     * çalıştırır ve tarayıcı SDK'sı devreye girerdi: kullanıcıya paket
     * ağırlığı, ve `connect-src`'ye kalıcı bir üçüncü taraf hedefi — o
     * yönerge hâlâ kapatılmayı bekliyor.
     *
     * Dosya bir gün bilerek eklenirse bu test düşer ve CSP kararı yeniden
     * sorulur.
     */
    for (const path of [
      "src/instrumentation-client.ts",
      "instrumentation-client.ts",
      "sentry.client.config.ts",
    ]) {
      expect(existsSync(path), path).toBe(false);
    }
  });
});
