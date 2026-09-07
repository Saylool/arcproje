import { NextResponse } from "next/server";

import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";

/**
 * `GET /api/admin/review` — elle mutabakat bekleyen borç satırları.
 *
 * NEDEN VAR: `review_required` şemada baştan beri vardı ama KİMSE BAKMIYORDU.
 * Bu duruma düşen her satır, gerçek bir insanın "ödedim ama görünmüyor"
 * anıdır: zincirde bir şey oldu, beklenen transferi kanıtlamadı, kilit kaldı
 * ve otomatik bir çıkış YOK — çıkış bir insanın mutabakatı.
 *
 * Onbeş test kullanıcısında bunlar hiç görünmedi. Binde haftada birkaç tane
 * çıkar ve onları görmenin tek yolu kullanıcının yazması olurdu.
 *
 * SALT OKUR. Hiçbir durumu değiştirmez ve `review_required`tan çıkışı
 * OTOMATİKLEŞTİRMEZ: yalnızca bakılacak kayıtları gösterir. Çıkış, insanın
 * ArcScan ve cüzdan geçmişiyle yaptığı mutabakattır.
 *
 * ---------------------------------------------------------------------------
 * GİZLİLİK — BU UÇ BİLİNÇLİ BİR İSTİSNADIR
 * ---------------------------------------------------------------------------
 *
 * `/api/admin/metrics` yalnızca TOPLAM döndürür ve döndürmelidir. Burası
 * farklıdır: takılı bir ödemeyi çözmek için HANGİ kayıt olduğunu bilmek
 * şarttır, sayı tek başına hiçbir şeyi çözmez.
 *
 * İSTİSNA MÜMKÜN OLDUĞUNCA DAR TUTULUR — yalnızca ZİNCİRDE ZATEN AÇIK olan
 * şeyler döner: adresler ve işlem hash'i, artı kaydı bulmaya yarayan hesap
 * kimliği ve tutar. İNSAN ADLARI ve uygulama kullanıcısı kimliği DÖNMEZ;
 * mutabakat zincire karşı yapılır, kişiye karşı değil.
 *
 * AYRI BİR SIR KULLANIR (`REVIEW_SECRET`), `METRICS_SECRET` DEĞİL. Ölçüm ucu
 * hiçbir kişisel veri sızdırmaz, burası kimlik döndürür: farklı duyarlılık,
 * farklı anahtar, farklı patlama yarıçapı. Aynı gerekçeyle `CRON_SECRET` de
 * ayrıdır.
 *
 * Sır tanımlı değilse uç ÇALIŞMAZ: açık bir uç, sessizce korumasız kalmış bir
 * uçtan iyidir.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Bütçe: tek bir okuma sorgusu. */
export const maxDuration = 15;

/**
 * Bir çalışmada gösterilecek EN FAZLA satır.
 *
 * İnceleme elle yapılan bir iştir; iki yüz satırlık bir liste kimsenin
 * bakmayacağı bir listedir. Sayı sınıra dayanıyorsa zaten daha derin bir
 * sorun vardır ve o, ölçüm ucunun işidir.
 */
export const REVIEW_PAGE_LIMIT = 50;

const NO_STORE_HEADERS = {
  "cache-control": "no-store, private, max-age=0",
} as const;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: NO_STORE_HEADERS },
  );
}

/** Sabit zamanlı değildir ve olması gerekmez; bkz. `cron/retention`. */
function isAuthorized(request: Request, secret: string): boolean {
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

type ReviewDependencies = Readonly<{
  createRepository: typeof createNeonSharedBillRepository;
  readSecret: () => string | undefined;
}>;

export function createReviewGet(
  dependencies: Partial<ReviewDependencies> = {},
) {
  const resolved: ReviewDependencies = {
    createRepository:
      dependencies.createRepository ?? createNeonSharedBillRepository,
    readSecret: dependencies.readSecret ?? (() => process.env.REVIEW_SECRET),
  };
  return (request: Request) => reviewGet(request, resolved);
}

async function reviewGet(request: Request, dependencies: ReviewDependencies) {
  const secret = dependencies.readSecret();
  if (secret === undefined || secret.trim() === "") {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "İnceleme ucu yapılandırılmamış. Sunucuda REVIEW_SECRET tanımlı değil.",
    );
  }
  if (!isAuthorized(request, secret)) {
    return errorResponse(401, "UNAUTHORIZED", "Yetkisiz.");
  }

  const repository = await dependencies.createRepository();
  if (repository === null) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "İnceleme listesi okunamıyor. Sunucuda DATABASE_URL tanımlı değil.",
    );
  }

  const found = await repository.listDebtsAwaitingReview({
    limit: REVIEW_PAGE_LIMIT,
  });
  if (!found.ok) {
    return errorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      "İnceleme listesi şu anda okunamıyor.",
    );
  }

  /*
   * GÜNLÜĞE YAZILMAZ. Yanıt kimlik taşıyor; onu cron günlüklerine düşürmek,
   * dar tutulan istisnayı kalıcı bir kayda çevirirdi. Sayısı görmek isteyen
   * ölçüm ucuna bakar.
   */
  return NextResponse.json(
    { debts: found.debts, count: found.debts.length, limit: REVIEW_PAGE_LIMIT },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export const GET = createReviewGet();
