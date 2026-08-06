import { NextResponse } from "next/server";
import { getAllSheetFieldOptions, updateFieldOptions, OptionsValidationError, type UpdateOptionsInput } from "@/lib/sheetFieldOptions";
import { OPTION_KEYS, COLORED_OPTION_KEYS, type OptionKey } from "@/lib/types";
import { AUTHORIZED_EMAIL } from "@/lib/googleOAuth";
import { rateLimitOrNull } from "@/lib/rateLimit";
import { toErrorResponse } from "@/lib/apiError";

// Gated by proxy.ts's session check like every other route under app/api —
// no separate re-auth here, same convention the 17 Sheets mutation routes
// already follow.

export async function GET() {
  try {
    const options = await getAllSheetFieldOptions();
    return NextResponse.json({ ok: true, options });
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

  const { key, options } = body as { key?: unknown; options?: unknown };

  if (typeof key !== "string" || !(OPTION_KEYS as readonly string[]).includes(key)) {
    return NextResponse.json(
      { ok: false, error: `Missing or invalid 'key' (must be one of: ${OPTION_KEYS.join(", ")})` },
      { status: 400 }
    );
  }

  if (!Array.isArray(options)) {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'options' (must be an array)" }, { status: 400 });
  }

  const colored = (COLORED_OPTION_KEYS as readonly OptionKey[]).includes(key as OptionKey);

  if (colored) {
    const bad = options.find(
      (o) => !o || typeof o !== "object" || typeof o.value !== "string" || (o.color !== null && typeof o.color !== "string")
    );
    if (bad !== undefined) {
      return NextResponse.json(
        { ok: false, error: "Each option must be { value: string; color: string | null } for this key" },
        { status: 400 }
      );
    }
  } else {
    const bad = options.find((o) => typeof o !== "string");
    if (bad !== undefined) {
      return NextResponse.json({ ok: false, error: "Each option must be a string for this key" }, { status: 400 });
    }
  }

  try {
    await updateFieldOptions({ key, options } as UpdateOptionsInput, AUTHORIZED_EMAIL);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof OptionsValidationError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    return toErrorResponse(e, "Failed to update sheet field options");
  }
}
