import { NextResponse } from "next/server";

import { readBoundedBody } from "@/lib/http/bounded-body";
import { parseCspReport } from "@/lib/security/csp-report";

/**
 * `POST /api/csp-report` — tarayıcının bildirdiği CSP ihlallerini günlüğe yazar.
 *
 * VARLIK SEBEBİ: `connect-src` şu an yalnızca ölçüyor ve engellemiyor. Onu
 * engelleyici yapabilmek için tarayıcının gerçekte nereye bağlandığını
 * bilmemiz gerekiyor. Konsola bakmak masaüstünde kolay, TELEFONDA neredeyse
 * imkânsız; bu uç sayesinde cihaz kendisi bildiriyor.
 *
 * KİMLİK DOĞRULAMASI YOKTUR ve olamaz: raporu tarayıcı, oturumdan bağımsız
 * olarak gönderir. Bu yüzden uç hiçbir şey OKUMAZ, hiçbir şey YAZMAZ ve
 * veritabanına DOKUNMAZ — tek yaptığı kısa bir satır günlüğe düşürmek.
 * Yabancı biri çöp gönderirse en fazla günlük gürültüsü olur.
 *
 * Gövde küçük bir sınırla okunur; tanınmayan yük sessizce atılır.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rapor gövdeleri küçüktür; büyüğü okumaya değmez. */
const MAX_BODY_BYTES = 8 * 1024;
const BODY_READ_DEADLINE_MS = 2000;

type CspReportDependencies = Readonly<{
  readBody: typeof readBoundedBody;
  log: (line: string) => void;
}>;

export function createCspReportPost(
  dependencies: Partial<CspReportDependencies> = {},
) {
  const resolved: CspReportDependencies = {
    readBody: dependencies.readBody ?? readBoundedBody,
    log: dependencies.log ?? ((line) => console.log(line)),
  };
  return (request: Request) => cspReportPost(request, resolved);
}

async function cspReportPost(
  request: Request,
  dependencies: CspReportDependencies,
) {
  /*
   * HER yolda 204 döner. Tarayıcıya durum bildirmenin bir faydası yok ve
   * hata döndürmek, gönderenin davranışını değiştirmez.
   */
  const noContent = new NextResponse(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });

  const body = await dependencies.readBody(
    request,
    MAX_BODY_BYTES,
    BODY_READ_DEADLINE_MS,
  );
  if (body.status !== "ok") {
    return noContent;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return noContent;
  }

  const report = parseCspReport(payload);
  if (report === null) {
    return noContent;
  }

  /*
   * Sayfanın adresi BİLEREK yazılmaz: ortak hesap adresleri `billId` taşır
   * ve günlüğe düşmesi o bağlantıyı sızdırmak olurdu.
   */
  dependencies.log(
    `[csp] ${report.directive} <- ${report.origin}${
      report.disposition === null ? "" : ` (${report.disposition})`
    }`,
  );
  return noContent;
}

export const POST = createCspReportPost();
