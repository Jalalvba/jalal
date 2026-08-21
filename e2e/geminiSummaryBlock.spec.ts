import { test, expect } from "@playwright/test";
import { authenticatedCookie } from "./helpers/auth";

// The AI summary lives in ONE place (BDD's gemini column) but is shown on the
// zone pages, which read their own sheet tabs and have no such column. This
// pins the lookup: the block must find the summary for the plate it is on,
// leave the others on the empty state, and cost one /api/bdd request for the
// whole page rather than one per card.
//
// /api/bdd is stubbed so the test is deterministic and spends no Gemini quota
// — the point here is the display path, not generating a summary.
const SUMMARY = "RÉSUMÉ DE TEST — vérification du rendu dans la carte.";

test("zone card shows the BDD summary for its own plate", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await context.addCookies([await authenticatedCookie(baseURL!)]);

  // Which plate is actually rendered first on the page?
  await page.goto("/parking");
  await expect(page.getByText("Résumé IA").first()).toBeVisible({ timeout: 40_000 });
  const firstCard = page.getByTestId("record-card").filter({ hasText: "Résumé IA" }).first();
  const plate = (await firstCard.innerText()).split("\n")[0].trim();
  expect(plate).toMatch(/\d/);

  let bddCalls = 0;
  await page.route("**/api/bdd", async (route) => {
    bddCalls++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, rows: [{ IMM: plate, gemini: SUMMARY, _row: 2 }] }),
    });
  });

  await page.reload();
  const card = page.getByTestId("record-card").filter({ hasText: plate }).first();
  await expect(card).toContainText(SUMMARY, { timeout: 40_000 });

  // Every other card stays on the empty state — the lookup is per plate.
  const body = await page.locator("body").innerText();
  expect((body.match(new RegExp(SUMMARY, "g")) ?? []).length).toBe(1);
  expect(body).toContain("Aucun résumé");

  // One shared fetch, not one per card.
  expect(bddCalls).toBeLessThanOrEqual(2);
  expect(errs).toEqual([]);
});
