import { NextResponse } from "next/server";

import {
  authenticateRequest,
  type AuthenticatedAppUser,
  type AuthenticateRequest,
} from "@/lib/auth/session";
import { deleteAccount } from "@/lib/db/account-deletion-service";
import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";

/**
 * `DELETE /api/account` — oturum açmış kişinin KENDİ hesabını siler.
 *
 * Parametre ALMAZ. Hangi hesabın silineceğini yalnızca sunucudaki oturum
 * belirler; istemci başka birinin kimliğini gösteremez.
 *
 * OTURUM ÇEREZİ BURADA ÖLDÜRÜLÜR. Sıra önemlidir: önce kayıt gider, sonra
 * çerez; ters sırada silme düşerse kullanıcı hem hesabını hem oturumunu
 * kaybederdi.
 *
 * Bu yalnızca İSTEĞİ GÖNDEREN tarayıcıyı etkiler. Oturum bir JWT'dir ve
 * sunucu onu iptal edemez; başka bir cihazdaki çerez süresi dolana kadar
 * geçerli kalır. O yolu kapatan şey, para harcayan uçtaki "kullanıcı hâlâ
 * var mı" kontrolüdür.
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

type AccountDeleteDependencies = Readonly<{
  authenticate: AuthenticateRequest;
  createRepository: typeof createNeonSharedBillRepository;
  remove: typeof deleteAccount;
  endSession: () => Promise<unknown>;
}>;

export function createAccountDelete(
  dependencies: Partial<AccountDeleteDependencies> = {},
) {
  const resolved: AccountDeleteDependencies = {
    authenticate: dependencies.authenticate ?? authenticateRequest,
    createRepository:
      dependencies.createRepository ?? createNeonSharedBillRepository,
    remove: dependencies.remove ?? deleteAccount,
    /*
     * TEMBEL yüklenir. Auth.js'i modül düzeyinde içeri almak, bu rotayı
     * test ortamında yüklenemez hâle getiriyor; testler zaten kendi
     * sahtesini geçiyor.
     */
    endSession:
      dependencies.endSession ??
      (async () => {
        const actions = await import("@/app/auth-actions");
        await actions.endGoogleSessionWithoutRedirect();
      }),
  };
  return () => accountDelete(resolved);
}

async function accountDelete(dependencies: AccountDeleteDependencies) {
  /* Auth, depo yaratmadan ÖNCEDİR: oturumsuz istek kaynak tüketmez. */
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

  const removed = await dependencies.remove({
    userId: gate.user.id,
    repository,
  });
  if (!removed.ok) {
    return errorResponse(removed.status, removed.code, removed.message);
  }

  /*
   * Çerez, kayıt gittikten SONRA temizlenir. Çerez adları ortama göre değişir
   * (`__Secure-` öneki, parçalı çerezler); adları elle üretmek yerine Auth.js
   * kendi çerezlerini temizler.
   */
  await dependencies.endSession();

  return NextResponse.json(
    { deleted: removed.deleted },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export const DELETE = createAccountDelete();
