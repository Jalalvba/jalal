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

// Chosen deliberately: 62 real DS entries split 49 external / 12 internal /
// 1 unknown across 9 distinct suppliers, with AUTO MECANIQUE IBN ROCHD
// appearing 8 times — so this plate exercises the internal/external split AND
// the supplier-recurrence finding against real data, not a synthetic fixture.
const PLATE = "47024-B-7";

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

    // Either label: this plate may already carry a stored analysis from an
    // earlier run, in which case the button offers a re-run instead of a first
    // run. Pinning "Analyser" made the test depend on the state of a live
    // collection.
    const analyse = page.getByRole("button", { name: /^(Analyser|Relancer l'analyse)$/ });
    await expect(analyse).toBeEnabled();
    await analyse.click();

    // The analysis itself — generous timeout, this is a real model round trip.
    // exact: true — the save-status line under the button now also contains the
    // word ("… résumé non enregistré"), so a loose match is ambiguous and fails
    // on strict mode rather than on anything being wrong.
    await expect(page.getByText("Résumé", { exact: true })).toBeVisible({ timeout: 60_000 });

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

    // The internal/external split is computed client-side and shown before any
    // call is made, so it must render even without an analysis.
    await expect(page.getByText(/interne.*externe/)).toBeVisible();

    // Interval compliance is computed server-side in code, not by the model,
    // and rendered as auditable facts rather than prose.
    await expect(page.getByText("Intervalles d'entretien")).toBeVisible();
    // .first(): the term legitimately appears twice — once as the interval row
    // label, once inside the model's summary prose.
    await expect(page.getByText("Filtre à gasoil", { exact: true }).first()).toBeVisible();

    // Follow-up input appears only once an analysis exists.
    const ask = page.getByPlaceholder(/pourquoi tu n'as pas/);
    await expect(ask).toBeVisible();
    await ask.fill("combien d'interventions externes ?");
    await page.getByRole("button", { name: "Demander" }).click();

    // The exchange is APPENDED — the original analysis must still be there.
    await expect(page.getByText(/^Q — /)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Résumé", { exact: true })).toBeVisible();

    // The String() coercion on part designations exists because real Mongo
    // values do not honour their declared types; a regression there throws in
    // the click handler rather than failing a request.
    expect(pageErrors).toEqual([]);
  });
});

// NOT gated by RUN_AI_E2E: it must never reach a model, and it asserts exactly
// that. The whole value of ds_analyses is that a vehicle already analysed
// costs nothing to look at again, so "the analyze route was not called" is the
// assertion, not a side note.
test("a stored analysis renders on arrival, without calling the model", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await context.addCookies([await authenticatedCookie(baseURL!)]);

  const STORED = {
    imm: PLATE,
    tier: "pro",
    model: "gemini-flash-latest",
    costUsd: 0.008,
    entriesCount: 62,
    lastEntryDate: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    analysis: {
      contractFlag: { level: "unknown", label: "Date de fin de contrat indisponible" },
      findings: [
        // Title and detail share no substring — otherwise a getByText on the
        // title also matches the detail and trips strict mode.
        { level: "warn", title: "Turbo moteur récurrent", detail: "Trois remplacements en 2025." },
      ],
      summary: "RÉSUMÉ ENREGISTRÉ — relu depuis Mongo, sans nouvel appel.",
      insufficientData: false,
    },
  };

  await page.route("**/api/ds-history/analysis**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, analysis: STORED }),
    })
  );

  let analyzeCalls = 0;
  await page.route("**/api/ds-history/analyze", async (route) => {
    analyzeCalls++;
    await route.abort();
  });

  await page.goto("/ds-history");
  await page.getByPlaceholder("ex: 48070 / 832223WW").fill(PLATE);
  await page.getByRole("option", { name: PLATE }).click();
  await page.getByRole("button", { name: "Rechercher" }).click();

  // The stored summary and finding appear on their own — no click involved.
  await expect(page.getByText(STORED.analysis.summary)).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText("Turbo moteur récurrent")).toBeVisible();
  await expect(page.getByText("Trois remplacements en 2025.")).toBeVisible();
  await expect(page.getByText(/Analyse enregistrée du/)).toBeVisible();

  // The history moved under it (62 stored vs whatever the live data holds), so
  // the card must say so rather than present the verdict as current.
  await expect(page.getByText(/l'historique a changé/i)).toBeVisible();

  // And the button offers a re-run rather than a first run.
  await expect(page.getByRole("button", { name: "Relancer l'analyse" })).toBeVisible();

  expect(analyzeCalls, "showing a stored analysis must not call the model").toBe(0);
  expect(pageErrors).toEqual([]);
});
