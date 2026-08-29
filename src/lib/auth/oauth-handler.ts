import { NextResponse } from "next/server";

import type { AuthenticationRuntimeResolution } from "./auth-runtime";

const NO_STORE_HEADERS = {
  "cache-control": "no-store, private, max-age=0",
} as const;

function unavailableResponse() {
  return NextResponse.json(
    {
      error: {
        code: "SERVICE_NOT_CONFIGURED",
        message: "Kimlik doğrulama servisi şu anda kullanılamıyor.",
      },
    },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export function createOAuthHandler(
  method: "GET" | "POST",
  resolveRuntime: () => AuthenticationRuntimeResolution,
) {
  return async (request: Request) => {
    const resolved = resolveRuntime();
    if (resolved.status === "unavailable") {
      return unavailableResponse();
    }
    try {
      return await resolved.runtime.handle(method, request);
    } catch {
      return unavailableResponse();
    }
  };
}
