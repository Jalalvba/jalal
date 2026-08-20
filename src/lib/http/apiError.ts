import { NextResponse } from "next/server";
import { log, serializeError } from "@/lib/http/logger";

/**
 * Throw this (or a subclass, e.g. RowIdentityError in googleSheetsClient.ts)
 * when a route handler wants its own message shown to the client verbatim.
 * Anything else caught by toErrorResponse() below — a raw Sheets/Mongo
 * driver error, for instance — is treated as unsafe to expose and replaced
 * with a generic message.
 */
export class ApiError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message);
  }
}

/**
 * Central catch-block handler for API routes. Known/intentional errors
 * (ApiError and its subclasses) surface their own message and status;
 * anything else — a raw MongoDB/Sheets driver error, for example — is
 * logged in full server-side only and replaced with a generic client-facing
 * message. This exists because MongoDB driver errors (e.g.
 * MongoServerSelectionError on a connection failure) can embed internal
 * infrastructure detail — Atlas cluster shard hostnames, for instance — in
 * `.message`, and every route handler used to ship `e.message` straight to
 * the client with no distinction between "safe, curated message" and "raw
 * exception dump."
 */
export function toErrorResponse(
  e: unknown,
  fallback: string,
  status = 500,
  extra?: Record<string, unknown>
): NextResponse {
  if (e instanceof ApiError) {
    return NextResponse.json({ ok: false, error: e.message, ...extra }, { status: e.status });
  }
  // Structured because this one line is the error path for 39 of the 46 API
  // routes — it was previously `console.error(fallback, e)`, which put the
  // client-facing fallback string and a raw Error into free text with no
  // queryable fields. NOTE: the route/method are still missing; adding them
  // means threading the Request through toErrorResponse()'s signature, which
  // would touch every call site. Deferred deliberately.
  log("error", "api", fallback, serializeError(e));
  return NextResponse.json({ ok: false, error: fallback, ...extra }, { status });
}
