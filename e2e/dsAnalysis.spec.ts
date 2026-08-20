import { test, expect } from "@playwright/test";
import { authenticatedCookie } from "./helpers/auth";

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL-TRIGGER ONLY — THIS SPEC SPENDS REAL MONEY.
//
// It drives the DS History "Analyse IA" button through a real browser click,
// which makes a REAL Gemini API call against the live key (~4,800 input tokens
// per run, billed to the "jalal" AI Studio project once the free daily quota is
// used up). It also reads real production Mongo data.
//
// Two gates, deliberately:
//   1. CI's e2e job already runs on workflow_dispatch only
//      (.github/workflows/ci.yml — "E2E tests (Playwright — manual trigger
//      only)"), so nothing here runs on a push.
//   2. This spec ALSO skips unless RUN_AI_E2E=1 is set, so a routine local
//      `pnpm test:e2e` — or a manual CI e2e run kicked off for an unrelated
//      reason — does not quietly spend Gemini quota.
//
// Run it deliberately:
//   RUN_AI_E2E=1 pnpm exec playwright test e2e/dsAnalysis.spec.ts
//
// (CI's e2e job does not export GEMINI_API_KEY at all, so even with gate 2
// lifted the route would return "L'analyse IA n'est pas configurée" there
// rather than billing anything.)
// ─────────────────────────────────────────────────────────────────────────────

const PLATE = "39357-B-7";

test.describe("DS History — Analyse IA", () => {
  test.skip(
    process.env.RUN_AI_E2E !== "1",
    "makes a real, billable Gemini call — set RUN_AI_E2E=1 to run deliberately"
  );

  test("runs from a real click and renders a grounded analysis", async ({ page, context, baseURL }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await context.addCookies([await authenticatedCookie(baseURL!)]);
    await page.goto("/ds-history");

    await page.getByPlaceholder("ex: 48070 / 832223WW").fill(PLATE);
    // Pick the suggestion — the real user flow, and the open dropdown would
    // otherwise sit over the Rechercher button and swallow the click.
    await page.getByRole("option", { name: PLATE }).click();
    await page.getByRole("button", { name: "Rechercher" }).click();

    // The card renders as soon as DS entries load, before any AI call.
    await expect(page.getByText("ANALYSE IA")).toBeVisible({ timeout: 30_000 });

    const analyse = page.getByRole("button", { name: "Analyser" });
    await expect(analyse).toBeEnabled();
    await analyse.click();

    // The analysis itself — generous timeout, this is a real model round trip.
    await expect(page.getByText("Résumé")).toBeVisible({ timeout: 60_000 });

    // A contract flag is always rendered, whatever the level.
    await expect(page.getByText(/Contrat/).first()).toBeVisible();

    // The summary must be real prose, not an empty shell: isDsAnalysisShape()
    // rejects a blank summary server-side, so an empty one here would mean the
    // guard was bypassed.
    const summary = await page.locator("p.whitespace-pre-wrap").first().innerText();
    expect(summary.trim().length).toBeGreaterThan(40);

    // The cost badge proves the call went through the tracked path rather than
    // some direct fetch — every callAI() result carries costInfo inline.
    await expect(page.getByText(/MAD/).first()).toBeVisible();

    // The String() coercion on part designations exists because real Mongo
    // values do not honour their declared types; a regression there throws in
    // the click handler rather than failing a request.
    expect(pageErrors).toEqual([]);
  });
});
