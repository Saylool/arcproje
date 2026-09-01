import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  authenticateRequest,
  type AuthenticatedAppUser,
  type AuthenticateRequest,
} from "@/lib/auth/session";
import { listContactBook } from "@/lib/db/contacts-service";
import { readBoundedBody } from "@/lib/http/bounded-body";
import {
  deleteSavedContacts,
  saveContact,
} from "@/lib/db/saved-contacts-service";
import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";

/**
 * `GET /api/contacts` — oturum açmış kişinin KENDİ geçmiş borçluları.
 *
 * Süzme ölçütü SUNUCUDAKİ oturumdur. İstek ne gövdede ne sorguda bir kullanıcı
 * kimliği taşıyabilir; işleyici hiçbir parametre ALMAZ.
 *
 * Yanıt, kullanıcının zaten kendi girdiği adres ve etiketlerdir — yeni bir
 * bilgi yaymaz. Başka bir kullanıcının rehberi hiçbir koşulda dönmez.
 *
 * GET birleşik defteri döner: KAYITLI kişiler asıl kaynaktır, geçmişten
 * türetilen öneriler yalnızca boşluğu doldurur. POST yeni kişi kaydeder,
 * DELETE ise tüm defteri siler — kalıcı bir kayıt tuttuğumuz için kullanıcı
 * onu tümüyle geri alabilmelidir.
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
  listContacts: typeof listContactBook;
}>;

export function createContactsGet(
  dependencies: Partial<ContactsRouteDependencies> = {},
) {
  const resolved: ContactsRouteDependencies = {
    authenticate: dependencies.authenticate ?? authenticateRequest,
    createRepository:
      dependencies.createRepository ?? createNeonSharedBillRepository,
    listContacts: dependencies.listContacts ?? listContactBook,
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
    userId: gate.user.id,
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

const MAX_BODY_BYTES = 4 * 1024;
const BODY_READ_DEADLINE_MS = 5000;

type ContactsWriteDependencies = Readonly<{
  authenticate: AuthenticateRequest;
  createRepository: typeof createNeonSharedBillRepository;
  readBody: typeof readBoundedBody;
  save: typeof saveContact;
  createContactId: () => string;
}>;

export function createContactsPost(
  dependencies: Partial<ContactsWriteDependencies> = {},
) {
  const resolved: ContactsWriteDependencies = {
    authenticate: dependencies.authenticate ?? authenticateRequest,
    createRepository:
      dependencies.createRepository ?? createNeonSharedBillRepository,
    readBody: dependencies.readBody ?? readBoundedBody,
    save: dependencies.save ?? saveContact,
    createContactId: dependencies.createContactId ?? (() => randomUUID()),
  };
  return (request: Request) => contactsPost(request, resolved);
}

async function contactsPost(
  request: Request,
  dependencies: ContactsWriteDependencies,
) {
  /* Auth gövde okumadan ve depo yaratmadan ÖNCEDİR. */
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

  const bounded = await dependencies.readBody(
    request,
    MAX_BODY_BYTES,
    BODY_READ_DEADLINE_MS,
  );
  if (bounded.status !== "ok") {
    return errorResponse(400, "INVALID_REQUEST", "İstek okunamadı.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bounded.text);
  } catch {
    return errorResponse(400, "MALFORMED_JSON", "İstek gövdesi okunamadı.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    return errorResponse(400, "INVALID_REQUEST", "İstek okunamadı.");
  }

  const repository = await dependencies.createRepository();
  if (repository === null) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Paylaşılan hesap servisi yapılandırılmamış. Sunucuda DATABASE_URL tanımlı değil.",
    );
  }

  const body = parsed as { label?: unknown; address?: unknown };
  const saved = await dependencies.save({
    /* Kime kaydedileceğini OTURUM söyler; gövde bunu etkileyemez. */
    userId: gate.user.id,
    repository,
    label: body.label,
    address: body.address,
    createContactId: dependencies.createContactId,
  });

  if (!saved.ok) {
    return errorResponse(saved.status, saved.code, saved.message);
  }
  return NextResponse.json(
    { contact: saved.contact },
    { status: 201, headers: NO_STORE_HEADERS },
  );
}

type ContactsDeleteDependencies = Readonly<{
  authenticate: AuthenticateRequest;
  createRepository: typeof createNeonSharedBillRepository;
  remove: typeof deleteSavedContacts;
}>;

export function createContactsDelete(
  dependencies: Partial<ContactsDeleteDependencies> = {},
) {
  const resolved: ContactsDeleteDependencies = {
    authenticate: dependencies.authenticate ?? authenticateRequest,
    createRepository:
      dependencies.createRepository ?? createNeonSharedBillRepository,
    remove: dependencies.remove ?? deleteSavedContacts,
  };
  return () => contactsDelete(resolved);
}

/**
 * TÜM defteri siler.
 *
 * Parametre almaz: hangi defterin silineceğini yalnızca oturum belirler.
 * Tek kişi silmek `/api/contacts/[contactId]` üzerindedir.
 */
async function contactsDelete(dependencies: ContactsDeleteDependencies) {
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
  return NextResponse.json(
    { deleted: removed.deleted },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export const GET = createContactsGet();
export const POST = createContactsPost();
export const DELETE = createContactsDelete();
