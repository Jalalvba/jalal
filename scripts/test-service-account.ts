/**
 * Standalone diagnostic — verifies a Google service account can actually
 * reach the Sheets/Drive resources this app will eventually use.
 *
 * NOT part of the app build, not imported by anything under app/ or lib/.
 * Run manually:
 *
 *   npx tsx scripts/test-service-account.ts
 *   npx tsx scripts/test-service-account.ts "SomeTab!A1:E5"   # optional range override
 *
 * Reads (does not write) from .env.local:
 *   GOOGLE_SERVICE_ACCOUNT_KEY_B64  — base64-encoded service account JSON
 *   GOOGLE_SHEETS_ID
 *   GOOGLE_DRIVE_FOLDER_ID
 *
 * Never logs private_key or the full raw service account JSON, even on failure.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

const STEP_NAMES = [
  "Step 1: Decode & parse key",
  "Step 2: Authenticate",
  "Step 3: Sheet metadata",
  "Step 4: Sheet data read",
  "Step 5: Drive folder",
] as const;

type StepName = (typeof STEP_NAMES)[number];
type StepStatus = "PASS" | "FAIL" | "SKIPPED" | "PENDING";

const results = new Map<StepName, { status: StepStatus; detail?: string }>(
  STEP_NAMES.map((name) => [name, { status: "PENDING" as StepStatus }])
);

function printSummary() {
  console.log("\n" + "─".repeat(64));
  console.log("SUMMARY");
  console.log("─".repeat(64));
  for (const name of STEP_NAMES) {
    const r = results.get(name)!;
    const icon =
      r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : r.status === "SKIPPED" ? "⏭️ " : "⬜";
    console.log(`${icon} ${r.status.padEnd(8)} ${name}`);
  }
  console.log("─".repeat(64));
}

function pass(name: StepName, detail?: string) {
  results.set(name, { status: "PASS", detail });
  console.log(`\n✅ PASS — ${name}`);
  if (detail) console.log(`   ${detail.replace(/\n/g, "\n   ")}`);
}

/** Marks the step FAIL, prints the whole-picture summary, and exits. Never returns. */
function fail(name: StepName, detail: string): never {
  results.set(name, { status: "FAIL", detail });
  console.error(`\n❌ FAIL — ${name}`);
  console.error(`   ${detail.replace(/\n/g, "\n   ")}`);
  printSummary();
  process.exit(1);
}

function skip(name: StepName, reason: string) {
  results.set(name, { status: "SKIPPED", detail: reason });
  console.log(`\n⏭️  SKIPPED — ${name}`);
  console.log(`   ${reason}`);
}

/** Extracts a safe {status, message} pair from a googleapis/google-auth-library error without ever touching key material. */
function errorInfo(e: unknown): { status?: number; message: string } {
  if (e && typeof e === "object") {
    const anyErr = e as Record<string, unknown>;
    const response = anyErr.response as Record<string, unknown> | undefined;
    const status =
      (typeof anyErr.code === "number" ? anyErr.code : undefined) ??
      (typeof response?.status === "number" ? (response.status as number) : undefined);
    const responseData = response?.data as Record<string, unknown> | undefined;
    const googleMessage =
      (responseData?.error as Record<string, unknown> | undefined)?.message ??
      responseData?.error_description ??
      (anyErr.message as string | undefined);
    return { status, message: String(googleMessage ?? e) };
  }
  return { message: String(e) };
}

// ─── env loading (.env.local only, no dependency, read-only) ──────────────

function loadEnvLocal(): Record<string, string> {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    console.error(`FAIL: .env.local not found at ${path}. Run this script from the repo root.`);
    process.exit(1);
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value; // last occurrence wins if a key appears more than once
  }
  return env;
}

async function main() {
  console.log("Service account diagnostic — verifying Sheets/Drive access");
  const env = loadEnvLocal();

  // ── Step 1: decode & parse key ──────────────────────────────────────────
  const keyB64 = env.GOOGLE_SERVICE_ACCOUNT_KEY_B64;
  if (!keyB64) {
    fail(
      "Step 1: Decode & parse key",
      "GOOGLE_SERVICE_ACCOUNT_KEY_B64 is missing from .env.local. Add the base64-encoded service account JSON (base64 -w0 key.json) as that variable and re-run."
    );
  }

  let decoded: string;
  try {
    decoded = Buffer.from(keyB64, "base64").toString("utf8");
  } catch (e) {
    fail("Step 1: Decode & parse key", `Base64 decode threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  let key: Record<string, unknown>;
  try {
    key = JSON.parse(decoded);
  } catch {
    fail(
      "Step 1: Decode & parse key",
      "Decoded content is not valid JSON. Re-check that GOOGLE_SERVICE_ACCOUNT_KEY_B64 is the full, unmodified base64 encoding of the service account JSON file (no truncation, no extra whitespace/newlines inserted)."
    );
  }

  const clientEmail = key.client_email as string | undefined;
  const projectId = key.project_id as string | undefined;
  const privateKey = key.private_key as string | undefined;

  const missingFields = [
    !clientEmail && "client_email",
    !projectId && "project_id",
    !privateKey && "private_key",
  ].filter((v): v is string => Boolean(v));

  if (missingFields.length > 0) {
    fail(
      "Step 1: Decode & parse key",
      `Decoded JSON is missing required field(s): ${missingFields.join(", ")}. This doesn't look like a valid service account key — re-download it from GCP Console (IAM & Admin → Service Accounts → Keys) and re-encode.`
    );
  }

  pass("Step 1: Decode & parse key", `client_email: ${clientEmail}\nproject_id:   ${projectId}`);

  // ── Step 2: authenticate ────────────────────────────────────────────────
  const auth = new google.auth.JWT({ email: clientEmail, key: privateKey, scopes: SCOPES });

  try {
    const token = await auth.authorize();
    if (!token.access_token) {
      fail("Step 2: Authenticate", "authorize() resolved but returned no access_token — unexpected empty response from Google.");
    }
  } catch (e) {
    const { status, message } = errorInfo(e);
    fail(
      "Step 2: Authenticate",
      `Google rejected the auth request${status ? ` (status ${status})` : ""}: ${message}\n` +
        `Common causes: the private key doesn't match client_email, the service account was deleted/disabled, ` +
        `or the Google Sheets API / Google Drive API aren't enabled for project "${projectId}" in GCP Console → APIs & Services.`
    );
  }

  pass("Step 2: Authenticate", `Access token acquired for scopes:\n${SCOPES.join("\n")}`);

  // ── Step 3: sheet metadata ──────────────────────────────────────────────
  const sheetsId = env.GOOGLE_SHEETS_ID;
  if (!sheetsId) {
    fail("Step 3: Sheet metadata", "GOOGLE_SHEETS_ID is missing from .env.local.");
  }

  const sheetsApi = google.sheets({ version: "v4", auth });
  let sheetTitle = "";
  let tabNames: string[] = [];

  try {
    const res = await sheetsApi.spreadsheets.get({ spreadsheetId: sheetsId });
    sheetTitle = res.data.properties?.title ?? "(untitled)";
    tabNames = (res.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => Boolean(t));
  } catch (e) {
    const { status, message } = errorInfo(e);
    if (status === 403) {
      fail(
        "Step 3: Sheet metadata",
        `403 Forbidden: ${message}\nFix: Service account client_email needs to be added as a Viewer on this spreadsheet: ${clientEmail}\n(Open the sheet → Share → add that email → Viewer.)`
      );
    }
    if (status === 404) {
      fail(
        "Step 3: Sheet metadata",
        `404 Not Found: ${message}\nFix: GOOGLE_SHEETS_ID ("${sheetsId}") may be wrong. It's the long id in the sheet's URL between /d/ and /edit.`
      );
    }
    fail("Step 3: Sheet metadata", `Unexpected error${status ? ` (status ${status})` : ""}: ${message}`);
  }

  pass("Step 3: Sheet metadata", `Title: "${sheetTitle}"\nTabs (${tabNames.length}): ${tabNames.join(", ") || "(none found)"}`);

  // ── Step 4: actual data read ────────────────────────────────────────────
  const rangeOverride = process.argv[2];
  if (tabNames.length === 0 && !rangeOverride) {
    skip("Step 4: Sheet data read", "No tabs found in Step 3 and no range override given as a CLI arg — nothing to read.");
  } else {
    const range = rangeOverride ?? `${tabNames[0]}!A1:Z5`;
    try {
      const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId: sheetsId, range });
      const rows = res.data.values ?? [];
      pass(
        "Step 4: Sheet data read",
        `Range "${range}" → ${rows.length} row(s) returned\nFirst row: ${JSON.stringify(rows[0] ?? "(empty)")}`
      );
    } catch (e) {
      const { status, message } = errorInfo(e);
      fail(
        "Step 4: Sheet data read",
        `Failed to read range "${range}"${status ? ` (status ${status})` : ""}: ${message}\n` +
          (status === 400
            ? `Fix: the range/tab name is likely wrong. Valid tabs from Step 3: ${tabNames.join(", ") || "(none)"}. Pass a specific range as a CLI arg, e.g. npx tsx scripts/test-service-account.ts "${tabNames[0] ?? "Sheet1"}!A1:E5"`
            : "")
      );
    }
  }

  // ── Step 5: Drive folder ────────────────────────────────────────────────
  const folderId = env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    fail("Step 5: Drive folder", "GOOGLE_DRIVE_FOLDER_ID is missing from .env.local.");
  }

  const driveApi = google.drive({ version: "v3", auth });
  try {
    const res = await driveApi.files.list({
      q: `'${folderId}' in parents`,
      pageSize: 10,
      fields: "files(id, name)",
    });
    const files = res.data.files ?? [];
    pass(
      "Step 5: Drive folder",
      `${files.length} file(s) found\nFirst few: ${files.slice(0, 5).map((f) => f.name).join(", ") || "(none)"}`
    );
  } catch (e) {
    const { status, message } = errorInfo(e);
    if (status === 403) {
      fail(
        "Step 5: Drive folder",
        `403 Forbidden: ${message}\nFix: the Drive folder needs to be shared with the service account: ${clientEmail}\n(Open the folder → Share → add that email → Viewer.)`
      );
    }
    if (status === 404) {
      fail("Step 5: Drive folder", `404 Not Found: ${message}\nFix: GOOGLE_DRIVE_FOLDER_ID ("${folderId}") may be wrong.`);
    }
    fail("Step 5: Drive folder", `Unexpected error${status ? ` (status ${status})` : ""}: ${message}`);
  }

  // ── Step 6: summary ─────────────────────────────────────────────────────
  printSummary();
  process.exit(0);
}

main().catch((e) => {
  console.error("\n❌ Unexpected script error:", e instanceof Error ? e.message : String(e));
  printSummary();
  process.exit(1);
});
