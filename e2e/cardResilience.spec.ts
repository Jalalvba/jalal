import { test, expect } from "@playwright/test";
import { authenticatedCookie } from "./helpers/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Regression guard for a whole-page blank.
//
// This app has no error.tsx and no global-error.tsx, so before
// CardErrorBoundary a render error in ONE card unmounted the entire tree.
// Measured on this exact page: 21 cards -> 0, document body down to 70 chars,
// with only "TypeError: Cannot read properties of undefined (reading 'status')"
// in the console. The vehicle card, the sheet cards and all 18 DS entries
// disappeared because an unrelated card touched a field that wasn't there.
//
// The realistic trigger is deploy skew: the browser holds client JS from one
// build while the serverless function answering it is from another, so a field
// added in a later deploy is simply absent from the response.
//
// This spec fabricates that response with page.route() rather than modifying
// source, so it is repeatable AND spends no Gemini quota — no RUN_AI_E2E gate
// needed, unlike e2e/dsAnalysis.spec.ts which drives the real model.
// ─────────────────────────────────────────────────────────────────────────────

const PLATE = "44329-B-7";

/** A well-formed analysis, minus every field added after the first release. */
const STALE_SHAPE = {
  ok: true,
  analysis: {
    contractFlag: { level: "unknown", label: "Date de fin de contrat indisponible" },
    findings: [{ level: "info", title: "T", detail: "D" }],
    summary: "Résumé de test.",
    insufficientData: false,
  },
  truncated: false,
  analysedCount: 1,
  totalCount: 1,
  costInfo: { model: "test", inputTokens: 1, outputTokens: 1, costUsd: 0, costMad: 0 },
  // intervalChecks / beltPumpCheck / oilGradeCheck deliberately ABSENT
};

async function search(page: import("@playwright/test").Page) {
  await page.goto("/ds-history");
  await page.getByPlaceholder("ex: 48070 / 832223WW").fill(PLATE);
  await page.getByRole("option", { name: PLATE }).click();
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(page.getByText("ANALYSE IA")).toBeVisible({ timeout: 30_000 });
}

test.describe("card resilience — one bad card must not blank the page", () => {
  test("a response missing newer fields degrades instead of unmounting the page", async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await context.addCookies([await authenticatedCookie(baseURL!)]);
    await page.route("**/api/ds-history/analyze", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STALE_SHAPE) })
    );

    await search(page);
    const before = await page.locator("div.rounded-2xl").count();
    expect(before).toBeGreaterThan(5);

    await page.getByRole("button", { name: "Analyser" }).click();
    await expect(page.getByText("Résumé de test.")).toBeVisible({ timeout: 30_000 });

    // The page survived: same cards, vehicle card intact, analysis rendered.
    expect(await page.locator("div.rounded-2xl").count()).toBeGreaterThanOrEqual(before);
    await expect(page.getByText("Véhicule", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Résumé de test.")).toBeVisible();
    // The missing checks are simply not shown — not faked, not crashed.
    await expect(page.getByText("Grade d'huile", { exact: true })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test("a hard render crash is contained to its own card", async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await context.addCookies([await authenticatedCookie(baseURL!)]);
    // contractFlag.level drives a lookup the card reads through; an unknown
    // level is the smallest realistic way to make that card fail on its own.
    await page.route("**/api/ds-history/analyze", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...STALE_SHAPE, analysis: { ...STALE_SHAPE.analysis, contractFlag: null } }),
      })
    );

    await search(page);
    const before = await page.locator("div.rounded-2xl").count();
    await page.getByRole("button", { name: "Analyser" }).click();
    await page.waitForTimeout(3000);

    // Whatever the AI card did, the rest of the page is still there.
    await expect(page.getByText("Véhicule", { exact: true })).toHaveCount(1);
    expect(await page.locator("div.rounded-2xl").count()).toBeGreaterThanOrEqual(before - 1);
    const body = (await page.locator("body").innerText()).trim();
    expect(body.length).toBeGreaterThan(1000); // not the 70-char blank page
  });
});
