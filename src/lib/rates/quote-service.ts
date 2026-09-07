import {
  MAX_RETRY_AFTER_SECONDS,
  fetchUsdcTryObservation,
  type FetchQuoteOptions,
  type ProviderFailureCode,
  type ProviderObservation,
} from "./coingecko";
import {
  QUOTE_BASE_CURRENCY,
  QUOTE_CURRENCY,
  QUOTE_LIFETIME_MS,
  QUOTE_MAX_CLOCK_SKEW_MS,
  QUOTE_MAX_OBSERVATION_AGE_MS,
  QUOTE_MIN_SEND_MARGIN_SECONDS,
  QUOTE_RATE_DECIMALS,
  QUOTE_RATE_DENOMINATOR,
  QUOTE_SOURCE,
  RATE_QUOTE_VERSION,
  validateRateQuote,
  type RateQuote,
  type SignedRateQuote,
} from "./quote";
import {
  budgetWindowStart,
  windowRetryAfterSeconds,
  type ProviderBudgetOutcome,
} from "./provider-budget";
import { createQuoteId, readQuoteSecret, signRateQuote } from "./quote-auth";

/**
 * Kur teklifi üretimi. YALNIZCA SUNUCU.
 *
 * Sağlayıcı sonucu süreç belleğinde ~60 sn önbelleklenir ve aynı yenileme
 * penceresindeki eşzamanlı istekler tek bir yukarı akış çağrısında birleşir.
 * Amaç, her bileşen render'ı veya her kullanıcı için bir CoinGecko kredisi
 * harcamamaktır.
 *
 * ÖRNEKLER ARASI DURUM İKİ TABLODADIR ve ikisi de PAYLAŞILIR:
 *
 *   `provider_call_budget` (0006)  yukarı akış çağrılarının SAYISINI sınırlar
 *   `provider_rate_cache`  (0007)  o çağrıların SONUCUNU paylaşır
 *
 * İkincisi olmadan birincisi kendi başına ZARARLIDIR: limit paylaşılıp sonuç
 * paylaşılmayınca, korumanın bedelini önbellek isabeti değil KULLANICI öder.
 * Penceredeki krediyi kapamayan eşzamanlı örnekler, taze kur yan taraftaki
 * örneğin belleğinde dururken `exhausted` görüp hata döndürürdü.
 *
 * SOĞUMA hâlâ SÜREÇ İÇİDİR ve öyle kalması yeterlidir: görevi bu örneğin
 * yukarı akışı dövmesini engellemektir, küresel bir garanti vermek değil.
 *
 * YAPILANDIRMA YOKSA ENGEL DE YOK: `DATABASE_URL` tanımlı değilse ya da geçiş
 * henüz uygulanmamışsa iki tablo da sessizce devre dışı kalır ve servis
 * eski, tek örneklik davranışına düşer — hiçbir şey kırılmaz.
 *
 * Her teklif, önbellekten gelse bile TAZE basılır: yeni quoteId, yeni
 * issuedAt/expiresAt ve yeni HMAC etiketi alır; bayat bir gözlem `observedAt`
 * üzerinden hâlâ sınırlıdır.
 */

/**
 * Sağlayıcı sonucunun önbellekte (L1 ve L2) kalma süresi.
 *
 * NEDEN 240 SANİYE — VE NEDEN BU TEKLİF ÖMRÜNDEN HİÇBİR ŞEY GÖTÜRMEZ:
 *
 * Teklif ömrü iki sınırın küçüğüdür (bkz. `mintUsdcTryQuote`):
 *
 *     kalan ömür = min(QUOTE_LIFETIME_MS, QUOTE_MAX_OBSERVATION_AGE_MS − yaş)
 *                = min(300 sn, 600 sn − gözlem yaşı)
 *
 * 300 saniyeye kadar eskimiş bir gözlem hâlâ TAM 300 saniyelik teklif verir;
 * kayıp ancak 300 saniyeden sonra başlar. 240 saniyelik TTL bu eşiğin altında
 * kalır ve 60 saniyelik pay bırakır.
 *
 * ESKİ DEĞER 60 SANİYEYDİ: izin verilen gözlem yaşının altıda biri, yani
 * gereksiz sıkı. Bedelini CoinGecko kotasından ödüyordu — Demo katmanının
 * AYLIK tavanı var ve düzenli trafikte dakikada bir çağrı onu ayın ortasında
 * bitirir. Dört kat uzatmak, çağrı sayısını dörtte bire indirir.
 *
 * DOĞRULAMA SINIRI DEĞİŞMEDİ: `QUOTE_MAX_OBSERVATION_AGE_MS` yaş kontrolü
 * yerinde durur ve hem L1'e hem L2'ye aynen uygulanır. Bu sabit yalnızca
 * "ne sıklıkla yeniden çekilir" sorusunu yanıtlar.
 */
export const PROVIDER_CACHE_TTL_MS = 240 * 1000;

/**
 * NEGATİF ÖNBELLEK (soğuma).
 *
 * Sağlayıcı 429/5xx/zaman aşımı döndüğünde her istek yeni bir yukarı akış
 * çağrısı üretirse Demo kotası hızla tükenir. Ardışık hatalarda üstel ama
 * sınırlı bir soğuma uygulanır; soğuma boyunca CoinGecko HİÇ çağrılmaz.
 */
export const COOLDOWN_BASE_MS = 5 * 1000;
export const COOLDOWN_MAX_MS = 120 * 1000;

type CacheEntry = { observation: ProviderObservation; storedAtMs: number };

let cachedObservation: CacheEntry | null = null;
let inflight: Promise<ObservationResult> | null = null;
let cooldownUntilMs = 0;
let consecutiveFailures = 0;
let lastFailureCode: ProviderFailureCode | null = null;

/**
 * PAYLAŞILAN BÜTÇEYİ SORAN İŞLEV.
 *
 * Enjekte edilebilir: testler belirlenimci kalsın ve bu modül Postgres'i
 * tanımasın diye. Varsayılanı tembel yüklenir — veritabanı kodu, gerçekten
 * bir sağlayıcı çağrısı yapılacağı ana kadar hiç içeri girmez.
 */
export type ProviderBudgetReserver = (
  nowMs: number,
) => Promise<ProviderBudgetOutcome>;

async function defaultReserver(nowMs: number): Promise<ProviderBudgetOutcome> {
  const { reserveCoinGeckoCall } = await import(
    "@/lib/db/provider-budget-service"
  );
  return reserveCoinGeckoCall(nowMs);
}

/**
 * Bütçeye ulaşılamadığında bir kez günlüğe düşer.
 *
 * Neden "bir kez": kesinti sırasında her istek satır yazsaydı günlük
 * kullanılmaz hâle gelirdi. Pencere değiştiğinde yeniden yazılır, böylece
 * süren bir kesinti görünmez olmaz.
 */
let lastUnavailableWindow: number | null = null;

function noteBudgetUnavailable(nowMs: number, log: (line: string) => void): void {
  const window = budgetWindowStart(nowMs);
  if (lastUnavailableWindow === window) {
    return;
  }
  lastUnavailableWindow = window;
  log(
    "[rates] paylasilan cagri butcesine ulasilamadi; ornekler arasi koruma bu pencerede YOK",
  );
}

/**
 * PAYLAŞILAN ÖNBELLEĞİ OKUYAN VE YAZAN İŞLEVLER.
 *
 * Bütçe sorucusuyla aynı gerekçe: enjekte edilebilir olmaları testleri
 * belirlenimci tutar ve bu modülü Postgres'ten habersiz bırakır.
 * Varsayılanları tembel yüklenir.
 */
export type SharedRateCacheEntry = Readonly<{
  observation: ProviderObservation;
  /** Kaydın paylaşılan depoya YAZILDIĞI an; TTL bundan hesaplanır. */
  storedAtMs: number;
}>;

export type SharedRateCacheReadResult =
  | { ok: true; entry: SharedRateCacheEntry }
  /**
   * `missing` ve `unconfigured` OLAY DEĞİLDİR: biri "henüz kimse yazmamış"
   * (soğuk dağıtımda normal), öteki "veritabanı hiç kurulmamış" (yerelde
   * normal) demektir. `unavailable` ise bir olaydır — depo kurulu ama
   * ulaşılamadı, ya da geçiş henüz uygulanmadı.
   */
  | { ok: false; reason: "missing" | "unconfigured" | "unavailable" };

export type SharedRateCacheReader = () => Promise<SharedRateCacheReadResult>;
export type SharedRateCacheWriter = (
  entry: SharedRateCacheEntry,
) => Promise<void>;

async function defaultSharedCacheReader(): Promise<SharedRateCacheReadResult> {
  const { readCoinGeckoRateCache } = await import(
    "@/lib/db/provider-rate-cache-service"
  );
  const outcome = await readCoinGeckoRateCache();
  if (!outcome.ok) {
    return { ok: false, reason: outcome.reason };
  }
  return {
    ok: true,
    entry: {
      observation: {
        rateText: outcome.observation.rateText,
        observedAt: outcome.observation.observedAt,
      },
      storedAtMs: outcome.observation.storedAtMs,
    },
  };
}

async function defaultSharedCacheWriter(
  entry: SharedRateCacheEntry,
): Promise<void> {
  const { writeCoinGeckoRateCache } = await import(
    "@/lib/db/provider-rate-cache-service"
  );
  await writeCoinGeckoRateCache({
    rateText: entry.observation.rateText,
    observedAt: entry.observation.observedAt,
    storedAtMs: entry.storedAtMs,
  });
}

/**
 * Paylaşılan önbelleğe ulaşılamadığında bir kez günlüğe düşer.
 *
 * `noteBudgetUnavailable` ile AYNI gerekçe ve aynı pencere kuralı. Ayrı bir
 * çıpası vardır: ikisi farklı arızalardır ve biri ötekini susturmamalıdır.
 *
 * Bu satır aynı zamanda geçişin uygulanmadığını söyler — tablo yoksa depo
 * `unavailable` döner ve mesaj pencere başına bir kez görünür.
 */
let lastSharedUnavailableWindow: number | null = null;

function noteSharedCacheUnavailable(
  nowMs: number,
  log: (line: string) => void,
): void {
  const window = budgetWindowStart(nowMs);
  if (lastSharedUnavailableWindow === window) {
    return;
  }
  lastSharedUnavailableWindow = window;
  log(
    "[rates] paylasilan kur onbellegine ulasilamadi; kur bu pencerede yalnizca surec icinde tutuluyor",
  );
}

/** Testler arasında süreç durumunu sıfırlar. */
export function resetRateQuoteCache(): void {
  cachedObservation = null;
  inflight = null;
  cooldownUntilMs = 0;
  consecutiveFailures = 0;
  lastFailureCode = null;
  lastUnavailableWindow = null;
  lastSharedUnavailableWindow = null;
}

/**
 * Gözlemin olumlu önbelleğe alınabilecek kadar taze olup olmadığı.
 *
 * Sağlayıcının bildirdiği `last_updated_at` gelecekteyse veya izin verilen
 * yaştan eskiyse veri geçerli sayılmaz. Bu kontrol teklif doğrulamasıyla AYNI
 * sınırları kullanır; böylece önbelleğe alınıp sonra her seferinde reddedilen
 * bir gözlem oluşamaz.
 */
function isFreshObservation(
  observation: ProviderObservation,
  nowMs: number,
): boolean {
  const nowSeconds = Math.floor(nowMs / 1000);
  const skewSeconds = Math.floor(QUOTE_MAX_CLOCK_SKEW_MS / 1000);
  const maxAgeSeconds = Math.floor(QUOTE_MAX_OBSERVATION_AGE_MS / 1000);
  const { observedAt } = observation;

  if (!Number.isSafeInteger(observedAt) || observedAt <= 0) {
    return false;
  }
  if (observedAt - skewSeconds > nowSeconds) {
    return false;
  }
  return nowSeconds - observedAt <= maxAgeSeconds;
}

/** Yapılandırma eksikliği bir sağlayıcı arızası değildir; soğutulmaz. */
function isCooldownWorthy(code: ProviderFailureCode): boolean {
  return code !== "notConfigured";
}

function nextCooldownMs(retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null) {
    // Sağlayıcının önerisi zaten kırpılmıştır; yine de tavanı uygulanır.
    return Math.min(retryAfterSeconds, MAX_RETRY_AFTER_SECONDS) * 1000;
  }
  const exponent = Math.max(0, consecutiveFailures - 1);
  return Math.min(COOLDOWN_BASE_MS * 2 ** exponent, COOLDOWN_MAX_MS);
}

export type ObservationSource = "cache" | "shared" | "provider";

export type ObservationResult =
  | { ok: true; observation: ProviderObservation; source: ObservationSource }
  | {
      ok: false;
      code: ProviderFailureCode;
      /** Soğuma nedeniyle sağlayıcıya hiç gidilmediyse true. */
      cooldown: boolean;
      retryAfterSeconds: number | null;
    };

/**
 * Önbellekli/tekilleştirilmiş gözlem. Aynı pencerede gelen ikinci istek yeni
 * bir yukarı akış çağrısı başlatmaz, devam edeni bekler.
 *
 * İKİ KATMANLI ÖNBELLEK:
 *
 *   L1  süreç içi  — bu Node.js örneğinin belleği. Bedava ve anlıktır, ama
 *                    soğuk başlangıçta boştur ve örnekler arasında PAYLAŞILMAZ.
 *   L2  Postgres   — bütün örneklerin gördüğü son gözlem.
 *
 * L2'NİN VARLIK NEDENİ: 0006 ile yukarı akış çağrılarının SAYISI bütün
 * örnekler adına sınırlandı, ama SONUÇ paylaşılmıyordu. Sonuç paylaşılmayınca
 * limitin bedelini önbellek isabeti değil KULLANICI ödüyordu — penceredeki
 * krediyi kapamayan eşzamanlı örnekler, taze kur yan taraftaki örneğin
 * belleğinde dururken `exhausted` görüp hata döndürüyordu.
 *
 * KALAN SINIR: iki örnek TAM AYNI ANDA gelir ve ikisi de L2'yi boş bulursa,
 * kazanan yazana kadar kaybeden yine hata döndürebilir. Bunu tümüyle kapatmak
 * dağıtık bir kilit ister; TTL başına bir kez ve saniyenin altında süren bu
 * artık, düzeltilen SÜREKLİ duruma göre önemsizdir.
 */
export async function getUsdcTryObservation(
  nowMs: number,
  options: FetchQuoteOptions &
    ClockOptions &
    BudgetOptions &
    SharedCacheOptions = {},
): Promise<ObservationResult> {
  /*
   * L1 isabeti TEK BAŞINA yeterli değildir. Depolama TTL'i içinde bile gözlem,
   * izin verilen yaş sınırını geçmiş olabilir; o zaman kayıt atılır ve taze
   * veri çekilir. Aksi hâlde sınırı aşmış bir gözlem TTL boyunca "geçerli"
   * gibi dönerdi.
   */
  if (
    cachedObservation !== null &&
    nowMs - cachedObservation.storedAtMs < PROVIDER_CACHE_TTL_MS
  ) {
    if (isFreshObservation(cachedObservation.observation, nowMs)) {
      return {
        ok: true,
        observation: cachedObservation.observation,
        source: "cache",
      };
    }
    cachedObservation = null;
  }

  /*
   * TEK UÇUŞ. `inflight` ataması SENKRONDUR ve öyle KALMALIDIR: bu satırdan
   * önce bir `await` olsaydı, beklerken giren ikinci istek de
   * `inflight === null` görür, ikinci bir yukarı akış çağrısı ve ikinci bir
   * bütçe kredisi başlatırdı.
   *
   * Paylaşılan önbellek okuması, soğuma kontrolü ve bütçe ayırma bu yüzden
   * uçuşun İÇİNDEDİR; hiçbiri bu atamadan önce beklenmez.
   */
  if (inflight === null) {
    inflight = resolveObservation(nowMs, options).finally(() => {
      // Zaman aşımından sonra da temizlenir: sonraki istek kilitlenmez.
      inflight = null;
    });
  }

  return inflight;
}

/**
 * Uçuşun gövdesi: L2 → soğuma → bütçe → sağlayıcı.
 *
 * SIRA BİLİNÇLİDİR. Özellikle L2 okuması soğuma kontrolünden ÖNCEDİR: soğuma
 * YUKARI AKIŞA gitmeyi durdurmak içindir, paylaşılan önbellekten okumak yukarı
 * akışa gitmez. Ters sırada, bütçe reddi yüzünden soğumaya girmiş örnek —
 * düzeltmenin konusu tam da o örnek — elinin altındaki taze kuru yine
 * kullanamaz, kullanıcıya hata dönerdi.
 */
async function resolveObservation(
  nowMs: number,
  options: FetchQuoteOptions & ClockOptions & BudgetOptions & SharedCacheOptions,
): Promise<ObservationResult> {
  const clock = options.clock ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));

  /*
   * L2 — PAYLAŞILAN ÖNBELLEK.
   *
   * Tazelik L1 ile BİREBİR AYNI ölçütle değerlendirilir: hem depolama TTL'i
   * hem de `QUOTE_MAX_OBSERVATION_AGE_MS` yaş sınırı. Verinin paylaşılan bir
   * yerden gelmesi hiçbir kontrolü gevşetmez.
   */
  const readShared = options.readSharedRateCache ?? defaultSharedCacheReader;
  const shared = await readShared();
  if (!shared.ok && shared.reason === "unavailable") {
    noteSharedCacheUnavailable(nowMs, log);
  }
  if (
    shared.ok &&
    nowMs - shared.entry.storedAtMs < PROVIDER_CACHE_TTL_MS &&
    isFreshObservation(shared.entry.observation, nowMs)
  ) {
    /*
     * L1'e de yazılır ki aynı örneğin sonraki isteği sorgu yapmasın. ÇIPA
     * paylaşılan kaydın KENDİ yazma anıdır, "şimdi" DEĞİL: aksi hâlde L1,
     * paylaşılan TTL'in ötesine uzar ve örnek tazelemeyi bırakırdı.
     */
    cachedObservation = {
      observation: shared.entry.observation,
      storedAtMs: shared.entry.storedAtMs,
    };
    return {
      ok: true,
      observation: shared.entry.observation,
      source: "shared",
    };
  }

  // Soğuma penceresindeyken yukarı akışa HİÇ gidilmez.
  if (nowMs < cooldownUntilMs) {
    return {
      ok: false,
      code: lastFailureCode ?? "providerUnavailable",
      cooldown: true,
      retryAfterSeconds: Math.max(1, Math.ceil((cooldownUntilMs - nowMs) / 1000)),
    };
  }

  /*
   * BÜTÇE. Önbellekten (L1 ya da L2) karşılanan istekler buraya HİÇ ulaşmaz;
   * sayaç kullanıcı isteğiyle değil, gerçekten harcanan krediyle orantılıdır.
   */
  const reserve = options.reserveProviderCall ?? defaultReserver;
  const budget = await reserve(nowMs);
  if (!budget.ok && budget.reason === "exhausted") {
    /*
     * Pencere dolu. Bu bir SAĞLAYICI HATASI DEĞİLDİR: ardışık hata sayacı
     * artmaz ve üstel soğuma tetiklenmez. Yalnızca pencerenin sonuna kadar
     * yukarı akışa gidilmemesi için soğuma çıpası ileri alınır.
     */
    const holdSeconds = windowRetryAfterSeconds(nowMs);
    cooldownUntilMs = Math.max(cooldownUntilMs, nowMs + holdSeconds * 1000);
    return {
      ok: false,
      code: "providerUnavailable",
      cooldown: false,
      retryAfterSeconds: holdSeconds,
    };
  }
  if (!budget.ok && budget.reason === "unavailable") {
    /*
     * Sayaç kurulu ama ULAŞILAMADI. Bilinçli karar: ENGELLENMEZ, süreç içi
     * korumaya düşülür. Ama sessiz de kalmaz; bu bir olaydır.
     *
     * `unconfigured` buraya girmez: paylaşılan sayacın hiç kurulmamış olması
     * bilinen bir dağıtım durumudur, her istekte olay üretmez.
     */
    noteBudgetUnavailable(nowMs, log);
  }

  const result = await fetchUsdcTryObservation(options);
  // Çıpa: isteğin başladığı an değil, yanıtın DÖNDÜĞÜ an.
  const settledAtMs = clock();

  if (result.ok && !isFreshObservation(result.observation, settledAtMs)) {
    /*
     * Bayat veya gelecekte görünen bir gözlem BAŞARI SAYILMAZ ve asla olumlu
     * önbelleğe alınmaz — ne L1'e ne L2'ye: aksi hâlde TTL boyunca her teklif
     * basımı aynı geçersiz veriyle düşerdi.
     */
    consecutiveFailures += 1;
    lastFailureCode = "invalidObservation";
    cooldownUntilMs = settledAtMs + nextCooldownMs(null);
    return {
      ok: false,
      code: "invalidObservation",
      cooldown: false,
      retryAfterSeconds: null,
    };
  }

  if (!result.ok) {
    if (isCooldownWorthy(result.code)) {
      consecutiveFailures += 1;
      lastFailureCode = result.code;
      cooldownUntilMs = settledAtMs + nextCooldownMs(result.retryAfterSeconds);
    }
    return {
      ok: false,
      code: result.code,
      cooldown: false,
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }

  cachedObservation = {
    observation: result.observation,
    storedAtMs: settledAtMs,
  };
  consecutiveFailures = 0;
  cooldownUntilMs = 0;
  lastFailureCode = null;

  /*
   * L2'YE YAZ — bu değişikliğin asıl kazancı burada. Bu satır olmadan çekilen
   * kur yalnızca bu örneğin belleğinde kalır.
   *
   * BEKLENİR, ateşle-unut DEĞİL: sunucusuz çalışmada yanıt döndükten sonra
   * bekleyen iş çalışmayabilir; beklenmeyen bir yazma hiç yazılmayabilirdi.
   * Bedeli yalnızca SAĞLAYICIYA GİDİLEN yolda tek bir sorgudur — o yol zaten
   * yüzlerce milisaniyelik bir ağ çağrısı yapmıştır.
   *
   * HATASI İSTEĞİ ETKİLEMEZ: kur elde edilmiştir; paylaşamamak bir sonraki
   * isteği pahalılaştırır, bu isteği bozmaz.
   */
  const writeShared = options.writeSharedRateCache ?? defaultSharedCacheWriter;
  await writeShared({
    observation: result.observation,
    storedAtMs: settledAtMs,
  }).catch(() => undefined);

  return { ok: true, observation: result.observation, source: "provider" };
}

export type QuoteMintFailure = ProviderFailureCode | "secretMissing" | "invalidQuote";

export type QuoteMintResult =
  | { ok: true; signed: SignedRateQuote; source: ObservationSource }
  | {
      ok: false;
      code: QuoteMintFailure;
      cooldown: boolean;
      retryAfterSeconds: number | null;
    };

/** "42.123456" -> { numerator: 42123456n, denominator: 1000000n } */
export function rateTextToRational(rateText: string): {
  numerator: string;
  denominator: string;
} | null {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{6})$/.exec(rateText);
  if (match === null) {
    return null;
  }
  const numerator = BigInt(`${match[1]}${match[2]}`);
  if (numerator <= BigInt(0)) {
    return null;
  }
  return {
    numerator: numerator.toString(),
    denominator: QUOTE_RATE_DENOMINATOR.toString(),
  };
}

/**
 * Paylaşılan bütçe bağımlılıkları. Enjekte edilebilir olmalarının nedeni
 * testlerin belirlenimci kalması ve bu modülün Postgres'i tanımamasıdır.
 */
export type BudgetOptions = {
  /** Verilmezse varsayılan sürücü (Postgres) tembel yüklenir. */
  reserveProviderCall?: ProviderBudgetReserver;
  /**
   * Paylaşılan bir bağımlılığa (bütçe ya da kur önbelleği) ulaşılamadığında
   * yazılan satır; verilmezse `console.log`.
   */
  log?: (line: string) => void;
};

/**
 * Paylaşılan kur önbelleği bağımlılıkları.
 *
 * Bütçeyle aynı gerekçe: enjekte edilebilir olmaları testlerin belirlenimci
 * kalmasını sağlar ve bu modülü Postgres'ten habersiz bırakır.
 */
export type SharedCacheOptions = {
  /** Verilmezse varsayılan sürücü (Postgres) tembel yüklenir. */
  readSharedRateCache?: SharedRateCacheReader;
  /** Verilmezse varsayılan sürücü (Postgres) tembel yüklenir. */
  writeSharedRateCache?: SharedRateCacheWriter;
};

export type ClockOptions = {
  /**
   * Yerleşim (settlement) saati. Önbellek ve soğuma çıpaları, isteğin
   * BAŞLADIĞI ana değil, sağlayıcı yanıtının DÖNDÜĞÜ ana bağlanır; aksi hâlde
   * 5 saniye süren bir çağrıdan sonra TTL ve soğuma 5 saniye kısalırdı.
   */
  clock?: () => number;
};

export type MintOptions = FetchQuoteOptions &
  ClockOptions &
  BudgetOptions &
  SharedCacheOptions & {
  /**
   * Basımın BAŞLADIĞI an. Testlerde sabit başlangıç vermek içindir; teklifin
   * kendisi bu ana değil, `clock` ile okunan YERLEŞİM anına çıpalanır.
   */
  nowMs?: number;
  /** Testlerde belirlenimci kimlik vermek için. */
  quoteId?: string;
};

/**
 * Taze, kimliklendirilmiş bir teklif basar. Gözlem önbellekten gelebilir; ama
 * teklifin kendisi her zaman yeni kimlik ve yeni geçerlilik penceresi alır.
 */
export async function mintUsdcTryQuote(
  options: MintOptions = {},
): Promise<QuoteMintResult> {
  const env = options.env ?? process.env;
  const secret = readQuoteSecret(env);
  if (!secret.ok) {
    return {
      ok: false,
      code: "secretMissing",
      cooldown: false,
      retryAfterSeconds: null,
    };
  }

  const startedAtMs = options.nowMs ?? Date.now();
  const observed = await getUsdcTryObservation(startedAtMs, options);
  if (!observed.ok) {
    return {
      ok: false,
      code: observed.code,
      cooldown: observed.cooldown,
      retryAfterSeconds: observed.retryAfterSeconds,
    };
  }

  const rational = rateTextToRational(observed.observation.rateText);
  if (rational === null) {
    return {
      ok: false,
      code: "invalidRate",
      cooldown: false,
      retryAfterSeconds: null,
    };
  }

  /*
   * ÇIPA: isteğin başladığı an DEĞİL, gözlemin elde edildiği YERLEŞİM anı.
   *
   * CoinGecko çağrısı saniyeler sürebilir. Başlangıç anına çıpalanmış bir
   * teklif, istemciye söz verdiğinden DAHA KISA bir ömürle ulaşırdı: 5 sn
   * süren bir çağrıdan sonra "5 dakika geçerli" denen teklifin gerçekte 4:55
   * ömrü kalırdı ve 60 saniyelik gönderim payı sınırda yenirdi. Bu yüzden
   * saat gözlemden SONRA yeniden okunur ve issuedAt/expiresAt/pay üçü de bu
   * ana göre hesaplanır.
   */
  const settledAtMs = options.clock?.() ?? options.nowMs ?? Date.now();
  const issuedAt = Math.floor(settledAtMs / 1000);
  /*
   * Teklif ömrü İKİ sınırın küçüğüdür: yerleşim anından itibaren normal TTL
   * ve gözlemin izin verilen yaşının bittiği an. Bayat bir gözleme dayanan
   * teklif, sırf yeni basıldı diye 5 dakika geçerli sayılamaz.
   */
  const observationHorizon =
    observed.observation.observedAt + QUOTE_MAX_OBSERVATION_AGE_MS / 1000;
  const expiresAt = Math.min(issuedAt + QUOTE_LIFETIME_MS / 1000, observationHorizon);

  /*
   * Gönderim payından kısa ömürlü bir teklif zaten kullanılamaz; üretilmez.
   * Ölçüm yerleşim anına göredir: yavaş sağlayıcı payı tükettiyse teklif
   * BASILMAZ, kısa ömürle dışarı verilmez.
   */
  if (expiresAt - issuedAt < QUOTE_MIN_SEND_MARGIN_SECONDS) {
    return {
      ok: false,
      code: "invalidObservation",
      cooldown: false,
      retryAfterSeconds: null,
    };
  }

  const candidate: RateQuote = {
    quoteVersion: RATE_QUOTE_VERSION,
    quoteId: options.quoteId ?? createQuoteId(),
    baseCurrency: QUOTE_BASE_CURRENCY,
    quoteCurrency: QUOTE_CURRENCY,
    source: QUOTE_SOURCE,
    rateNumerator: rational.numerator,
    rateDenominator: rational.denominator,
    observedAt: observed.observation.observedAt,
    issuedAt,
    expiresAt,
  };

  // Ürettiğimiz teklif de tükettiğimiz teklifle AYNI katı yoldan geçer.
  const validated = validateRateQuote(candidate, settledAtMs);
  if (!validated.ok) {
    return {
      ok: false,
      code: "invalidQuote",
      cooldown: false,
      retryAfterSeconds: null,
    };
  }

  return {
    ok: true,
    signed: Object.freeze({
      quote: validated.quote,
      tag: signRateQuote(validated.quote, secret.secret),
    }),
    source: observed.source,
  };
}

export { QUOTE_RATE_DECIMALS };
