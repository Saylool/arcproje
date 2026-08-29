import { NextResponse } from "next/server";

import {
  authenticateRequest,
  type AuthenticatedAppUser,
  type AuthenticateRequest,
} from "@/lib/auth/session";
import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";
import {
  isAppUserId,
  listSharedBillsCreatedBy,
} from "@/lib/db/shared-bill-listing-service";
import { createSharedBillFromSubmission } from "@/lib/db/shared-bill-service";
import { readBoundedBody } from "@/lib/http/bounded-body";

/**
 * Paylaşılan grup hesabının oluşturulması. YALNIZCA SUNUCU.
 *
 * Fişi ödeyen kişi TEK bir EIP-712 manifest imzalar; sunucu manifesti, borç
 * satırlarını ve imzayı doğrular, borç taahhüdünü YENİDEN HESAPLAR ve ancak
 * ondan sonra hesabı ve borçları ATOMİK olarak yazar.
 *
 * Yanıt asgaridir: yalnızca genel hesap kimliği, göreli paylaşım yolu ve bitiş
 * anı. Borç listesi, adresler, etiketler, taahhüt ve imza DÖNMEZ.
 *
 * Depo yapılandırılmamışsa kontrollü 503 döner; bellek içi bir yedeğe ASLA
 * düşülmez.
 *
 * GET, oturum açmış kullanıcının KENDİ oluşturduğu hesapları listeler. Süzme
 * ölçütü SUNUCUDAKİ oturumdur: istek ne gövdede ne sorguda bir kullanıcı
 * kimliği taşıyabilir. Bu rotanın GET'i, Google oturumunun yalnızca bir
 * kötüye kullanım kapısı değil, gerçek bir YETKİ ölçütü olduğu yerdir.
 *
 * SAHİPLİK ÖDEME YETKİSİ DEĞİLDİR: bir hesabı oluşturmuş olmak, o hesapta
 * parayı hareket ettirme ya da borçlunun cüzdan imzasının yerine geçme hakkı
 * VERMEZ. Borçlu akışı bu rotayı hiç çağırmaz.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gövde üst sınırı. En fazla 50 borç satırı + manifest + imza fazlasıyla
 * sığar; sınır AYRIŞTIRMADAN ÖNCE uygulanır.
 */
const MAX_BODY_BYTES = 32 * 1024;
const BODY_READ_DEADLINE_MS = 5000;

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
 * Her iki yöntemin ORTAK kapısı. Gövde okumadan ve depo yaratmadan ÖNCE
 * çalışır, böylece oturumsuz bir istek hiçbir kaynağı tüketmez.
 *
 * Ayrımlı sonuç döner: başarı dalında çağıran kimliği doğrudan alır ve
 * "acaba gerçekten oturum açık mı" diye ikinci kez sormak zorunda kalmaz.
 */
type AuthGate =
  | { ok: true; user: AuthenticatedAppUser }
  | { ok: false; response: ReturnType<typeof errorResponse> };

function authGate(
  authentication: Awaited<ReturnType<AuthenticateRequest>>,
): AuthGate {
  if (authentication.status === "unavailable") {
    return {
      ok: false,
      response: errorResponse(
        503,
        "SERVICE_NOT_CONFIGURED",
        "Kimlik doğrulama servisi şu anda kullanılamıyor.",
      ),
    };
  }
  if (authentication.status === "signedOut") {
    return {
      ok: false,
      response: errorResponse(
        401,
        "AUTH_REQUIRED",
        "Bu işlem için oturum açman gerekiyor.",
      ),
    };
  }
  return { ok: true, user: authentication.user };
}

type SharedBillRouteDependencies = Readonly<{
  authenticate: AuthenticateRequest;
  readBody: typeof readBoundedBody;
  createRepository: typeof createNeonSharedBillRepository;
  createBill: typeof createSharedBillFromSubmission;
}>;

export function createSharedBillPost(
  dependencies: Partial<SharedBillRouteDependencies> = {},
) {
  const resolved: SharedBillRouteDependencies = {
    authenticate: dependencies.authenticate ?? authenticateRequest,
    readBody: dependencies.readBody ?? readBoundedBody,
    createRepository:
      dependencies.createRepository ?? createNeonSharedBillRepository,
    createBill: dependencies.createBill ?? createSharedBillFromSubmission,
  };
  return (request: Request) => sharedBillPost(request, resolved);
}

async function sharedBillPost(
  request: Request,
  dependencies: SharedBillRouteDependencies,
) {
  /* Auth gövde başlıklarından, akış okumadan ve depo yaratmadan ÖNCEDİR. */
  const gate = authGate(await dependencies.authenticate());
  if (!gate.ok) {
    return gate.response;
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return errorResponse(
      400,
      "INVALID_CONTENT_TYPE",
      "İstek application/json biçiminde olmalı.",
    );
  }

  /*
   * Content-Length yalnızca UCUZ bir ön elemedir; tek sınır olarak ona
   * güvenilmez. Parçalı (chunked) bir istek onu hiç göndermeyebilir.
   */
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return errorResponse(413, "BODY_TOO_LARGE", "İstek gövdesi çok büyük.");
  }

  const bounded = await dependencies.readBody(
    request,
    MAX_BODY_BYTES,
    BODY_READ_DEADLINE_MS,
  );
  if (bounded.status === "tooLarge") {
    return errorResponse(413, "BODY_TOO_LARGE", "İstek gövdesi çok büyük.");
  }
  if (bounded.status === "invalidEncoding") {
    return errorResponse(
      400,
      "INVALID_ENCODING",
      "İstek gövdesi geçerli UTF-8 değil.",
    );
  }
  if (bounded.status === "timeout") {
    return errorResponse(
      408,
      "BODY_READ_TIMEOUT",
      "İstek gövdesi zamanında okunamadı.",
    );
  }
  if (bounded.status === "unreadable") {
    return errorResponse(400, "INVALID_REQUEST", "İstek okunamadı.");
  }

  /*
   * Depo YOKSA kontrollü 503. Üretimde sessizce belleğe düşülmez: aksi hâlde
   * kullanıcı çalıştığını sanır ve bağlantı ilk soğuk başlangıçta kaybolurdu.
   */
  const repository = await dependencies.createRepository();
  if (repository === null) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Paylaşılan hesap servisi yapılandırılmamış. Sunucuda DATABASE_URL tanımlı değil.",
    );
  }

  const result = await dependencies.createBill({
    bodyText: bounded.text,
    repository,
    nowMs: Date.now(),
    /*
     * Atıf beklenmedik biçimde okunamazsa hesap YİNE oluşturulur, yalnızca
     * sahipsiz kalır. Hesabın kendisi atıftan daha değerlidir; doğrulamanın
     * hiçbir adımı bu değere bağlı değildir.
     */
    createdByUserId: isAppUserId(gate.user.id) ? gate.user.id : null,
  });

  if (!result.ok) {
    return errorResponse(result.status, result.code, result.message);
  }

  return NextResponse.json(
    {
      billId: result.billId,
      path: result.path,
      expiresAt: result.expiresAt,
    },
    {
      status: result.created ? 201 : 200,
      headers: NO_STORE_HEADERS,
    },
  );
}

type SharedBillListDependencies = Readonly<{
  authenticate: AuthenticateRequest;
  createRepository: typeof createNeonSharedBillRepository;
  listBills: typeof listSharedBillsCreatedBy;
}>;

export function createSharedBillList(
  dependencies: Partial<SharedBillListDependencies> = {},
) {
  const resolved: SharedBillListDependencies = {
    authenticate: dependencies.authenticate ?? authenticateRequest,
    createRepository:
      dependencies.createRepository ?? createNeonSharedBillRepository,
    listBills: dependencies.listBills ?? listSharedBillsCreatedBy,
  };
  return () => sharedBillList(resolved);
}

async function sharedBillList(dependencies: SharedBillListDependencies) {
  const gate = authGate(await dependencies.authenticate());
  if (!gate.ok) {
    return gate.response;
  }

  const repository = await dependencies.createRepository();
  if (repository === null) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Paylaşılan hesap servisi yapılandırılmamış. Sunucuda DATABASE_URL tanımlı değil.",
    );
  }

  /*
   * Süzme ölçütü YALNIZCA oturumdan gelir. `request` bilerek hiç okunmaz:
   * sorgu dizesinden bir kullanıcı kimliği kabul edilseydi, oturum açmış
   * herkes başkasının listesini isteyebilirdi.
   */
  const listed = await dependencies.listBills({
    createdByUserId: gate.user.id,
    repository,
  });

  if (!listed.ok) {
    return errorResponse(listed.status, listed.code, listed.message);
  }

  return NextResponse.json(
    { bills: listed.bills },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export const POST = createSharedBillPost();
export const GET = createSharedBillList();
