import { NextResponse, type NextRequest } from "next/server";

import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";
import {
  BILL_RETENTION_DAYS,
  QUOTA_RETENTION_DAYS,
  RETENTION_BATCH_LIMIT,
  quotaCutoffDay,
  retentionCutoffMs,
} from "@/lib/db/retention";

/**
 * `GET /api/cron/retention` — saklama süresi dolmuş kayıtları SİLER.
 *
 * Önce sayar, sonra siler ve her çalışmada ikisini de bildirir. Tablodaki
 * toplam da raporlanır: uygun sayısı sıfırken toplam da sıfırsa, ölçütün
 * gerçekten bir şey bulup bulamadığı bilinemez.
 *
 * Bu uç, sayan hâliyle önce yayına alındı ve üretimde ölçüldü: tablo boş
 * DEĞİLKEN uygun sayısı sıfır döndü. Bu, eşiğin geleceğe kaymadığını —
 * yani her kaydı eşleştiren bozuk bir ölçüt olmadığını — kanıtlar. Silme,
 * o sayımla BİREBİR aynı eşiği kullanır.
 *
 * KİMLİK DOĞRULAMASI ZORUNLUDUR ve gevşetilemez. Bu adres herkese açıktır ve
 * arkasında GERİ ALINAMAZ bir silme durur; korumasız bırakılırsa yabancıların
 * tetikleyebileceği bir "verileri sil" düğmesine dönüşür.
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
   * Toplam da okunur. Uygun sayısı SIFIRKEN toplam da sıfırsa, ölçütün
   * gerçekten bir şey bulup bulamadığı bilinemez; ikisi birlikte anlamlıdır.
   * Okunamazsa temizlik yine de sürer — bu yalnızca tanısal bir sayıdır.
   */
  const total = await repository.countAllBills();

  /*
   * HİÇBİR ŞEY UYGUN DEĞİLSE silme HİÇ ÇAĞRILMAZ. Boş bir temizlik zararsız
   * olurdu ama çağrılmaması, günlükte "0 uygun → 0 silindi" satırının
   * gerçekten bir şey yapılmadığını göstermesini sağlar.
   */
  let deleted = 0;
  if (counted.count > 0) {
    const removed = await repository.deleteBillsPastRetention({
      cutoffMs,
      limit: RETENTION_BATCH_LIMIT,
    });
    if (!removed.ok) {
      return errorResponse(
        503,
        "SERVICE_UNAVAILABLE",
        "Temizlik şu anda yapılamıyor.",
      );
    }
    deleted = removed.deleted;
  }

  /*
   * KOTA SAYAÇLARI ayrı temizlenir ve hesap temizliğini ENGELLEMEZ.
   *
   * İkisinin sınırı farklıdır (biri gün, biri an) ve biri düşerse diğerinin
   * de durması için bir sebep yok. Kota temizliği başarısız olursa sayı
   * `null` raporlanır; sessizce sıfır demek, hiç satır olmadığıyla
   * karıştırılırdı.
   */
  const cutoffDay = quotaCutoffDay(dependencies.now());
  const quota = await repository.deleteQuotaRowsPastRetention({
    cutoffDay,
    limit: RETENTION_BATCH_LIMIT,
  });

  /*
   * Günlüğe yazılır: sayıları görmek için kimsenin sırrı elle taşıması
   * gerekmesin. Kayıt kimliği, adres ya da etiket YAZILMAZ — yalnızca sayı.
   */
  console.log(
    `[retention] uygun ${counted.count}, silinen ${deleted}, tablodaki toplam ${total.ok ? total.count : "okunamadi"} (sınır ${new Date(cutoffMs).toISOString()}, saklama ${BILL_RETENTION_DAYS} gün) | kota silinen ${quota.ok ? quota.deleted : "basarisiz"} (sınır ${cutoffDay}, saklama ${QUOTA_RETENTION_DAYS} gün)`,
  );

  return NextResponse.json(
    {
      eligible: counted.count,
      deleted,
      total: total.ok ? total.count : null,
      cutoff: new Date(cutoffMs).toISOString(),
      retentionDays: BILL_RETENTION_DAYS,
      quotaRowsDeleted: quota.ok ? quota.deleted : null,
      quotaCutoffDay: cutoffDay,
      quotaRetentionDays: QUOTA_RETENTION_DAYS,
      batchLimit: RETENTION_BATCH_LIMIT,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export const GET = createRetentionGet();
