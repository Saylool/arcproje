import { NextResponse, type NextRequest } from "next/server";

import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";
import {
  BILL_RETENTION_DAYS,
  retentionCutoffMs,
} from "@/lib/db/retention";

/**
 * `GET /api/cron/retention` — saklama süresi dolmuş kayıtları SAYAR.
 *
 * BU UÇ HİÇBİR ŞEY SİLMEZ. Amacı, geri dönüşü olmayan bir temizliği açmadan
 * önce "kaç kayıt etkilenecek" sorusunu ÖLÇMEK. Sayı beklendiği gibi
 * çıktığında silme ayrı bir adımda eklenir.
 *
 * KİMLİK DOĞRULAMASI ZORUNLUDUR ve gevşetilemez. Bu adres herkese açıktır;
 * korumasız bırakılırsa ileride buraya eklenecek silme, yabancıların
 * tetikleyebileceği bir düğmeye dönüşür.
 *
 * `CRON_SECRET` tanımlıysa Vercel, cron çağrısında `Authorization: Bearer`
 * başlığını KENDİSİ gönderir. Sır tanımlı değilse uç ÇALIŞMAZ: açık bir uç,
 * sessizce korumasız kalmış bir uçtan iyidir.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "no-store, private, max-age=0",
} as const;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: NO_STORE_HEADERS },
  );
}

/**
 * Sabit zamanlı karşılaştırma değildir ve olması da gerekmez: karşılaştırılan
 * şey bir parola değil, tek kullanımlık olmayan uzun rastgele bir dizgedir ve
 * yanıt her iki durumda da aynı gövdeyi döndürür.
 */
function isAuthorized(request: NextRequest, secret: string): boolean {
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

type RetentionDependencies = Readonly<{
  createRepository: typeof createNeonSharedBillRepository;
  readSecret: () => string | undefined;
  now: () => number;
}>;

export function createRetentionGet(
  dependencies: Partial<RetentionDependencies> = {},
) {
  const resolved: RetentionDependencies = {
    createRepository:
      dependencies.createRepository ?? createNeonSharedBillRepository,
    readSecret: dependencies.readSecret ?? (() => process.env.CRON_SECRET),
    now: dependencies.now ?? (() => Date.now()),
  };
  return (request: NextRequest) => retentionGet(request, resolved);
}

async function retentionGet(
  request: NextRequest,
  dependencies: RetentionDependencies,
) {
  const secret = dependencies.readSecret();
  if (secret === undefined || secret.length === 0) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Bakım ucu yapılandırılmamış. Sunucuda CRON_SECRET tanımlı değil.",
    );
  }
  if (!isAuthorized(request, secret)) {
    /* Depo YARATILMAZ: yetkisiz istek kaynak harcamaz. */
    return errorResponse(401, "AUTH_REQUIRED", "Bu uç yalnızca zamanlanmış görev tarafından çağrılır.");
  }

  const repository = await dependencies.createRepository();
  if (repository === null) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Paylaşılan hesap servisi yapılandırılmamış. Sunucuda DATABASE_URL tanımlı değil.",
    );
  }

  const cutoffMs = retentionCutoffMs(dependencies.now());
  const counted = await repository.countBillsPastRetention({ cutoffMs });
  if (!counted.ok) {
    return errorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      "Kayıt sayısı şu anda okunamıyor.",
    );
  }

  /*
   * Günlüğe yazılır: sayıyı görmek için kimsenin sırrı elle taşıması
   * gerekmesin. Kayıt kimliği, adres ya da etiket YAZILMAZ — yalnızca sayı.
   */
  console.log(
    `[retention] silinmeye uygun hesap: ${counted.count} (sınır ${new Date(cutoffMs).toISOString()}, saklama ${BILL_RETENTION_DAYS} gün)`,
  );

  return NextResponse.json(
    {
      eligible: counted.count,
      cutoff: new Date(cutoffMs).toISOString(),
      retentionDays: BILL_RETENTION_DAYS,
      /* Bu adımda silme YOKTUR; yanıt bunu açıkça söyler. */
      deleted: 0,
      mode: "count-only",
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export const GET = createRetentionGet();
