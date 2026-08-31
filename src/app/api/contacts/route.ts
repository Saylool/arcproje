import { NextResponse } from "next/server";

import {
  authenticateRequest,
  type AuthenticatedAppUser,
  type AuthenticateRequest,
} from "@/lib/auth/session";
import { listRecentContacts } from "@/lib/db/contacts-service";
import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";

/**
 * `GET /api/contacts` — oturum açmış kişinin KENDİ geçmiş borçluları.
 *
 * Süzme ölçütü SUNUCUDAKİ oturumdur. İstek ne gövdede ne sorguda bir kullanıcı
 * kimliği taşıyabilir; işleyici hiçbir parametre ALMAZ.
 *
 * Bu uç yalnızca OKUR. Yanıt, kullanıcının zaten kendi girdiği adres ve
 * etiketlerdir — yeni bir bilgi yaymaz. Başka bir kullanıcının rehberi hiçbir
 * koşulda dönmez.
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

type ContactsRouteDependencies = Readonly<{
  authenticate: AuthenticateRequest;
  createRepository: typeof createNeonSharedBillRepository;
  listContacts: typeof listRecentContacts;
}>;

export function createContactsGet(
  dependencies: Partial<ContactsRouteDependencies> = {},
) {
  const resolved: ContactsRouteDependencies = {
    authenticate: dependencies.authenticate ?? authenticateRequest,
    createRepository:
      dependencies.createRepository ?? createNeonSharedBillRepository,
    listContacts: dependencies.listContacts ?? listRecentContacts,
  };
  return () => contactsGet(resolved);
}

async function contactsGet(dependencies: ContactsRouteDependencies) {
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

  const listed = await dependencies.listContacts({
    createdByUserId: gate.user.id,
    repository,
  });
  if (!listed.ok) {
    return errorResponse(listed.status, listed.code, listed.message);
  }

  return NextResponse.json(
    { contacts: listed.contacts },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export const GET = createContactsGet();
