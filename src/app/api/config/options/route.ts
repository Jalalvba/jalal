import { NextResponse } from "next/server";
import {
  getAllSheetFieldOptionsWithStatus,
  updateFieldOptions,
  OptionsValidationError,
  OptionsConflictError,
  type UpdateOptionsInput,
} from "@/lib/sheetFieldOptions";
import { OPTION_KEYS, COLORED_OPTION_KEYS, type OptionKey } from "@/lib/types";
import { AUTHORIZED_EMAIL } from "@/lib/googleOAuth";
import { rateLimitOrNull } from "@/lib/rateLimit";
import { toErrorResponse } from "@/lib/apiError";

// Gated by proxy.ts's session check like every other route under app/api —
// no separate re-auth here, same convention the 17 Sheets mutation routes
// already follow.

export async function GET() {
  try {
    const { options, degraded, meta } = await getAllSheetFieldOptionsWithStatus();
    return NextResponse.json({ ok: true, options, degraded, meta });
  } catch (e) {
    return toErrorResponse(e, "Failed to load sheet field options");
  }
}

export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "config-options-update", 30, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const { key, options, expectedUpdatedAt } = body as { key?: unknown; options?: unknown; expectedUpdatedAt?: unknown };

  if (typeof key !== "string" || !(OPTION_KEYS as readonly string[]).includes(key)) {
    return NextResponse.json(
      { ok: false, error: `Missing or invalid 'key' (must be one of: ${OPTION_KEYS.join(", ")})` },
      { status: 400 }
    );
  }

  if (!Array.isArray(options)) {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'options' (must be an array)" }, { status: 400 });
  }

  // Defensive caps — these lists are meant to hold a few dozen entries at
  // most (see OPTION_LABELS); an unbounded list would balloon every page's
  // /api/config/options fetch and every dropdown built from it.
  const MAX_OPTIONS = 100;
  const MAX_VALUE_LENGTH = 200;
  if (options.length > MAX_OPTIONS) {
    return NextResponse.json({ ok: false, error: `Trop de valeurs (max ${MAX_OPTIONS}).` }, { status: 400 });
  }

  if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null && typeof expectedUpdatedAt !== "string") {
    return NextResponse.json({ ok: false, error: "Invalid 'expectedUpdatedAt' (must be a string, null, or omitted)" }, { status: 400 });
  }

  const colored = (COLORED_OPTION_KEYS as readonly OptionKey[]).includes(key as OptionKey);

  if (colored) {
    const bad = options.some(
      (o) =>
        !o ||
        typeof o !== "object" ||
        typeof o.value !== "string" ||
        o.value.length > MAX_VALUE_LENGTH ||
        (o.color !== null && typeof o.color !== "string")
    );
    if (bad) {
      return NextResponse.json(
        { ok: false, error: `Each option must be { value: string (max ${MAX_VALUE_LENGTH} chars); color: string | null } for this key` },
        { status: 400 }
      );
    }
  } else {
    const bad = options.some((o) => typeof o !== "string" || o.length > MAX_VALUE_LENGTH);
    if (bad) {
      return NextResponse.json({ ok: false, error: `Each option must be a string (max ${MAX_VALUE_LENGTH} chars) for this key` }, { status: 400 });
    }
  }

  // Trim before storage, not just before the duplicate-value check inside
  // updateFieldOptions() — otherwise "ALI " (trailing space) could pass
  // validation (its trimmed form is checked for emptiness/duplicates) yet
  // persist untrimmed, silently failing to match real sheet data anywhere
  // it's compared against a trimmed value.
  const trimmedOptions = colored
    ? (options as { value: string; color: string | null }[]).map((o) => ({ ...o, value: o.value.trim() }))
    : (options as string[]).map((v) => v.trim());

  try {
    await updateFieldOptions(
      { key, options: trimmedOptions } as UpdateOptionsInput,
      AUTHORIZED_EMAIL,
      expectedUpdatedAt === undefined ? undefined : (expectedUpdatedAt as string | null)
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof OptionsValidationError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    if (e instanceof OptionsConflictError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    return toErrorResponse(e, "Failed to update sheet field options");
  }
}
