import { NextResponse } from "next/server";

import { readMetricsReport } from "@/lib/db/metrics-service";
import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";

/**
 * `GET /api/admin/metrics` — işletme sayaçları.
 *
 * NEDEN VAR: bu depoda `console.error` dışında hiçbir ölçüm yoktu. Vercel'in
 * runtime günlükleri kısa saklamalı, toplanmıyor ve alarmı yok. Onbeş test
 * kullanıcısında bu sorun değildi; binde, biri "çalışmıyor" dediğinde bunun
 * herkeste mi yoksa tek kişide mi olduğunu söyleyecek hiçbir şey yok demektir.
 *
 * Yeni bir tablo GEREKTİRMEZ: veritabanı bu sayıları zaten tutuyordu. Ödeme
 * denemelerinin durumu bedava bir huni, kota tablosu günlük analizi,
 * bütçe tablosu sağlayıcı çağrılarını veriyor. Eksik olan tek şey onları
 * okuyan bir yoldu.
 *
 * SALT OKUR. Hiçbir sayacı tüketmez, hiçbir satır yazmaz; ölçmek için
 * ölçüleni değiştirmez.
 *
 * YALNIZCA TOPLAMLAR DÖNER. Kullanıcı kimliği, cüzdan adresi, hesap kimliği
 * ya da işlem hash'i bu yanıttan GEÇMEZ — sayım için gereken "kaç tane",
 * "kim" değil. Bu sınır gevşetilmez: uç, tanımı gereği ayrıcalıklıdır ve
 * ayrıcalıklı bir ucun sızdırdığı şey en çok sızan şeydir.
 *
 * KİMLİK DOĞRULAMASI ZORUNLUDUR. `METRICS_SECRET` tanımlı değilse uç
 * ÇALIŞMAZ: açık bir uç, sessizce korumasız kalmış bir uçtan iyidir — aynı
 * karar `/api/cron/retention` için de verilmişti.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Bütçe: yalnızca veritabanı — altı sayaç, tek işlem, tek gidiş-dönüş. */
export const maxDuration = 15;

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
 * Sabit zamanlı karşılaştırma değildir ve olması gerekmez: karşılaştırılan şey
 * bir parola değil, uzun ve rastgele bir dizedir; yanıt her iki durumda da
 * aynı gövdeyi döndürür.
 */
function isAuthorized(request: Request, secret: string): boolean {
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

type MetricsDependencies = Readonly<{
  createRepository: typeof createNeonSharedBillRepository;
  readSecret: () => string | undefined;
  now: () => number;
}>;

export function createMetricsGet(
  dependencies: Partial<MetricsDependencies> = {},
) {
  const resolved: MetricsDependencies = {
    createRepository:
      dependencies.createRepository ?? createNeonSharedBillRepository,
    readSecret: dependencies.readSecret ?? (() => process.env.METRICS_SECRET),
    now: dependencies.now ?? (() => Date.now()),
  };
  return (request: Request) => metricsGet(request, resolved);
}

async function metricsGet(request: Request, dependencies: MetricsDependencies) {
  const secret = dependencies.readSecret();
  if (secret === undefined || secret.trim() === "") {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Ölçüm ucu yapılandırılmamış. Sunucuda METRICS_SECRET tanımlı değil.",
    );
  }
  if (!isAuthorized(request, secret)) {
    /*
     * Yetkisiz çağırana neyin eksik olduğu SÖYLENMEZ; sırrın var olup
     * olmadığı bile bilgi taşır.
     */
    return errorResponse(401, "UNAUTHORIZED", "Yetkisiz.");
  }

  const repository = await dependencies.createRepository();
  if (repository === null) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Ölçüm okunamıyor. Sunucuda DATABASE_URL tanımlı değil.",
    );
  }

  const outcome = await readMetricsReport({
    repository,
    nowMs: dependencies.now(),
  });
  if (!outcome.ok) {
    return errorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      "Sayaçlar şu anda okunamıyor.",
    );
  }

  return NextResponse.json(outcome.report, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

export const GET = createMetricsGet();
