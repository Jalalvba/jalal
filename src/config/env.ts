// Boot-time environment validation.
//
// Several modules already throw on a missing var at import time
// (src/lib/mongo/client.ts, src/lib/sheets/googleSheetsRdvMonthly.ts), but
// they only fire once something happens to import them — so a misconfigured
// deploy surfaces as a confusing 500 on one route rather than a clear
// failure at startup. This schema is validated once from
// src/instrumentation.ts's register() so the whole set fails loudly, at
// boot, naming every missing var at once.
//
// Required vs optional is decided by real behaviour, not by presence in
// .env.example — see the per-var notes below. Optional vars are the ones the
// app is designed to degrade on; promoting one to required here would turn a
// documented graceful fallback into a hard boot failure.

import { z } from "zod";

const envSchema = z.object({
  // --- Required: the app cannot serve a single authenticated request without these ---

  // src/lib/mongo/client.ts throws on both of these at import time.
  MONGODB_URI: z
    .string()
    .min(1)
    .refine(
      (v) => v.startsWith("mongodb://") || v.startsWith("mongodb+srv://"),
      "must be a mongodb:// or mongodb+srv:// connection string",
    ),
  MONGODB_DB: z.string().min(1),

  // Single-user Google OAuth (CLAUDE.md §4) — the only way in.
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),

  // iron-session refuses to seal a cookie with a secret under 32 chars.
  IRON_SESSION_SECRET: z
    .string()
    .min(32, "must be at least 32 characters (openssl rand -base64 32)"),

  // Base64-encoded service-account JSON backing every googleSheets*.ts
  // module. Decoding here catches a truncated/mispasted value at boot
  // instead of as an opaque JWT error on the first Sheets call.
  GOOGLE_SERVICE_ACCOUNT_KEY_B64: z
    .string()
    .min(1)
    .refine((v) => {
      try {
        return JSON.parse(Buffer.from(v, "base64").toString("utf8")).client_email != null;
      } catch {
        return false;
      }
    }, "must be base64-encoded service-account JSON containing a client_email"),

  // The main spreadsheet (BDD/Parking/Atelier/Depot/RL).
  GOOGLE_SHEETS_ID: z.string().min(1),

  // The SEPARATE monthly-RDV spreadsheet. Required because
  // googleSheetsRdvMonthly.ts already throws without it, and because it is
  // Production-scope-only on Vercel (CLAUDE.md §2) — which makes it the var
  // most likely to be missing on a Preview deployment. Failing at boot is
  // the whole point of listing it here.
  GOOGLE_RDV_SHEETS_ID: z.string().min(1),

  // --- Optional: the app has a documented fallback for each of these ---

  // costTracker.ts logs an error and degrades rather than throwing, so the
  // Gemini-backed routes fail individually while the rest of the app runs.
  GEMINI_API_KEY: z.string().min(1).optional(),

  // /api/trigger-import deliberately returns 500 when unset, and there is a
  // test asserting exactly that ("returns 500 and never calls fetch when
  // IMPORT_PIPELINE_TOKEN is unset"). Required here would break that
  // contract.
  IMPORT_PIPELINE_TOKEN: z.string().min(1).optional(),

  // USD_TO_MAD_RATE and GEMINI_PREPAID_USD_BALANCE are deliberately NOT
  // validated as numbers here, even though both are numeric.
  //
  // Both are specified to tolerate an unparseable value: costTracker.ts's
  // startingCreditUsd() guards with Number.isFinite, and there is a test
  // ("falls back to 9.4 MAD/USD when the rate is unset or unparseable",
  // src/lib/__tests__/geminiCostTracker.test.ts) asserting that a literal
  // "not-a-number" still yields the 9.4 default. Boot-failing on a bad value
  // would break that contract — same reasoning as IMPORT_PIPELINE_TOKEN
  // above. They are accepted as free-form optional strings so the schema
  // stays a complete inventory of what the app reads.
  USD_TO_MAD_RATE: z.string().optional(),
  GEMINI_PREPAID_USD_BALANCE: z.string().optional(),
});

// Deliberately NOT validated:
//   GOOGLE_DRIVE_FOLDER_ID — read only by scripts/test-service-account.ts,
//     never by the app itself.
//   VERCEL_OIDC_TOKEN — populated by `vercel env pull` / `vercel dev`,
//     absent in plenty of valid environments.

export type Env = z.infer<typeof envSchema>;

/**
 * Validates process.env against the schema above.
 *
 * Throws with every failing variable listed at once — a partial .env.local
 * should surface as one complete list, not a fix-one-rerun-repeat loop.
 */
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid environment configuration — ${result.error.issues.length} problem(s) found:\n` +
        `${details}\n\n` +
        `Fill these in .env.local (see .env.example), or pull them with:\n` +
        `  vercel env pull .env.local --environment=production`,
    );
  }

  return result.data;
}
