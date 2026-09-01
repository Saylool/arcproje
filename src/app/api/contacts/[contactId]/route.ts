import { NextResponse } from "next/server";

import {
  authenticateRequest,
  type AuthenticatedAppUser,
  type AuthenticateRequest,
} from "@/lib/auth/session";
import { createNeonSharedBillRepository } from "@/lib/db/neon-shared-bill-repository";
import {
  deleteSavedContacts,
  updateSavedContact,
} from "@/lib/db/saved-contacts-service";
import { readBoundedBody } from "@/lib/http/bounded-body";

/**
 * TEK bir kayıtlı kişi: düzenle veya sil.
 *
 * `contactId` yoldan gelir ama TEK BAŞINA yetki vermez: her sorgu ayrıca
 * oturumdaki `user_id` ile sınırlıdır. Başkasının kimliği tahmin edilse bile
 * o kayda dokunulamaz ve yanıt "bulunamadı" der — bir kimliğin var olup
 * olmadığı yanıttan öğrenilemez.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
const BODY_READ_DEADLINE_MS = 5000;
const CONTACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

type Context = { params: Promise<{ contactId: string }> };

type Dependencies = Readonly<{
  authenticate: AuthenticateRequest;
  createRepository: typeof createNeonSharedBillRepository;
  readBody: typeof readBoundedBody;
  update: typeof updateSavedContact;
  remove: typeof deleteSavedContacts;
}>;

function resolveDependencies(given: Partial<Dependencies>): Dependencies {
  return {
    authenticate: given.authenticate ?? authenticateRequest,
    createRepository: given.createRepository ?? createNeonSharedBillRepository,
    readBody: given.readBody ?? readBoundedBody,
    update: given.update ?? updateSavedContact,
    remove: given.remove ?? deleteSavedContacts,
  };
}

export function createContactPatch(given: Partial<Dependencies> = {}) {
  const dependencies = resolveDependencies(given);
  return async (request: Request, context: Context) => {
    const gate = authGate(await dependencies.authenticate());
    if (!gate.ok) {
      return gate.response;
    }

    const { contactId } = await context.params;
    if (!CONTACT_ID.test(contactId)) {
      return errorResponse(404, "CONTACT_NOT_FOUND", "Kayıtlı kişi bulunamadı.");
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
    const updated = await dependencies.update({
      /* Hangi deftere dokunulacağını OTURUM söyler; yol yalnızca satırı seçer. */
      userId: gate.user.id,
      repository,
      contactId,
      label: body.label,
      address: body.address,
    });

    if (!updated.ok) {
      return errorResponse(updated.status, updated.code, updated.message);
    }
    return NextResponse.json(
      { contact: updated.contact },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  };
}

export function createContactDelete(given: Partial<Dependencies> = {}) {
  const dependencies = resolveDependencies(given);
  return async (_request: Request, context: Context) => {
    const gate = authGate(await dependencies.authenticate());
    if (!gate.ok) {
      return gate.response;
    }

    const { contactId } = await context.params;
    if (!CONTACT_ID.test(contactId)) {
      return errorResponse(404, "CONTACT_NOT_FOUND", "Kayıtlı kişi bulunamadı.");
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
      contactId,
    });
    if (!removed.ok) {
      return errorResponse(removed.status, removed.code, removed.message);
    }
    if (removed.deleted === 0) {
      return errorResponse(404, "CONTACT_NOT_FOUND", "Kayıtlı kişi bulunamadı.");
    }
    return NextResponse.json(
      { deleted: removed.deleted },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  };
}

export const PATCH = createContactPatch();
export const DELETE = createContactDelete();
