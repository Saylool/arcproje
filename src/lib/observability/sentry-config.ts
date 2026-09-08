import { scrubEvent } from "./scrub";

/**
 * SENTRY YAPILANDIRMASI — saf. YALNIZCA SUNUCU.
 *
 * Bu modül Sentry'yi BAŞLATMAZ ve `@sentry/nextjs` import ETMEZ; yalnızca
 * "hangi ayarlarla başlatılmalı" sorusunu yanıtlar. Böylece ayarların
 * tamamı gerçek bir SDK olmadan test edilebilir.
 *
 * KAPSAM: SUNUCU VE EDGE. Tarayıcıya hiçbir şey gönderilmez ve bu bilinçli:
 *
 *  - `connect-src` hâlâ ölçülüyor ve kapatılmayı bekliyor. Tarayıcı tarafı
 *    bir SDK, oraya kalıcı bir üçüncü taraf hedefi ekler ve o işi zorlaştırır.
 *  - Uygulama mobil öncelikli; kullanıcıya paket ağırlığı bindirmenin bedeli
 *    var, karşılığı ise sunucuda zaten yakalanan hatalar.
 *
 * DSN `NEXT_PUBLIC_` DEĞİLDİR. Teknik olarak DSN gizli bir değer değildir,
 * ama önek eklemek istemci paketine kapı açardı; kapsamı sunucuda tutmanın
 * en basit yolu değişkeni oraya hiç vermemektir.
 */

export type SentryEnv = Record<string, string | undefined>;

/** Yapılandırılmışsa DSN, değilse `null`. Boşluk = tanımsız sayılır. */
export function readSentryDsn(env: SentryEnv = process.env): string | null {
  const dsn = env.SENTRY_DSN?.trim();
  return dsn === undefined || dsn === "" ? null : dsn;
}

/**
 * Yalnızca VARLIK kontrolü.
 *
 * DSN yoksa hiçbir şey başlatılmaz ve bu bir hata DEĞİLDİR: yerel geliştirme
 * ve testler hata takibi olmadan çalışmaya devam eder.
 */
export function isSentryConfigured(env: SentryEnv = process.env): boolean {
  return readSentryDsn(env) !== null;
}

/**
 * Olayın hangi ortamdan geldiği.
 *
 * Vercel kendi değişkenini verir (`production` / `preview` / `development`);
 * yoksa Node'un kendi ortamına düşülür. Ayrım olmadan önizleme dağıtımlarının
 * gürültüsü üretim hatalarına karışır.
 */
export function readEnvironment(env: SentryEnv = process.env): string {
  return env.VERCEL_ENV?.trim() || env.NODE_ENV?.trim() || "development";
}

export type SentryOptions = Readonly<{
  dsn: string;
  environment: string;
  tracesSampleRate: number;
  sendDefaultPii: false;
  beforeSend: typeof scrubEvent;
  beforeSendTransaction: typeof scrubEvent;
}>;

/**
 * Başlatma ayarları; DSN yoksa `null`.
 *
 * `tracesSampleRate: 0` — başarım izleme KAPALI. İki nedenle: işlem adları
 * URL'den türer ve URL'de hesap kimliği vardır (temizlik onu yakalar ama
 * göndermemek daha iyidir), ve izleme hacmi hata hacminden kat kat büyüktür.
 * Aranan şey "ne kırıldı", "ne kadar sürdü" değil.
 *
 * `sendDefaultPii: false` AÇIKÇA yazılır. Varsayılan zaten budur; ama bu
 * satır, varsayılanın bir gün değişmesi durumunda sınırın kod tarafından
 * korunmasını sağlar.
 */
export function buildSentryOptions(
  env: SentryEnv = process.env,
): SentryOptions | null {
  const dsn = readSentryDsn(env);
  if (dsn === null) {
    return null;
  }
  return {
    dsn,
    environment: readEnvironment(env),
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  };
}
