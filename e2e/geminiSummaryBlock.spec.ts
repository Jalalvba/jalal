import { test, expect } from "@playwright/test";
import { authenticatedCookie } from "./helpers/auth";

// The summary is shown on four pages that get it from two different places,
// and this pins both routes:
//
//   Suivi RL / Atelier / Parking  — their own tab HAS a gemini column, so the
//                                   value comes straight from the row.
//   Depot                         — its tab has no such column, so the value
//                                   is looked up from BDD by plate.
//
// Everything is stubbed: deterministic, and no Gemini quota spent — the point
// is the display path, not generating a summary.
const SUMMARY = "RÉSUMÉ DE TEST — vérification du rendu dans la carte.";

test("a zone card shows the summary from its own tab's gemini column", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await context.addCookies([await authenticatedCookie(baseURL!)]);

  // Take the real rows and give the FIRST one a summary, so the fixture keeps
  // the live row shape instead of inventing one that can drift from it.
  let rows: Record<string, unknown>[] = [];
  await page.route("**/api/parking**", async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { ok: boolean; rows: Record<string, unknown>[] };
    rows = json.rows ?? [];
    if (rows.length) rows = rows.map((r, i) => ({ ...r, gemini: i === 0 ? SUMMARY : "" }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, rows }),
    });
  });

  await page.goto("/parking");
  await expect(page.getByText("Résumé IA").first()).toBeVisible({ timeout: 40_000 });
  test.skip(rows.length === 0, "PARKING tab is empty — nothing to render");

  const plate = String(rows[0].imm);
  const card = page.getByTestId("record-card").filter({ hasText: plate }).first();
  await expect(card).toContainText(SUMMARY, { timeout: 40_000 });

  // Exactly one card shows it — the value is per row, not per page.
  const body = await page.locator("body").innerText();
  expect((body.match(new RegExp(SUMMARY, "g")) ?? []).length).toBe(1);
  if (rows.length > 1) expect(body).toContain("Aucun résumé");
  expect(errs).toEqual([]);
});

test("Depot, whose tab has no gemini column, falls back to a BDD lookup", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await context.addCookies([await authenticatedCookie(baseURL!)]);

  // Ask the API directly first: the DEPOT tab is routinely empty, and an empty
  // tab is not a failure of this behaviour — it is nothing to assert about.
  const live = await context.request.get(`${baseURL}/api/depot`);
  const depotRows = ((await live.json()) as { rows: Record<string, unknown>[] }).rows ?? [];
  test.skip(depotRows.length === 0, "DEPOT tab is empty — nothing to render");

  let bddCalls = 0;
  await page.route("**/api/bdd**", async (route) => {
    bddCalls++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, rows: [{ IMM: depotRows[0].imm, gemini: SUMMARY, _row: 2 }] }),
    });
  });

  await page.goto("/depot");
  await expect(page.getByText("Résumé IA").first()).toBeVisible({ timeout: 40_000 });

  const plate = String(depotRows[0].imm);
  const card = page.getByTestId("record-card").filter({ hasText: plate }).first();
  await expect(card).toContainText(SUMMARY, { timeout: 40_000 });

  // One shared BDD fetch for the whole page, not one per card.
  expect(bddCalls).toBeLessThanOrEqual(2);
  expect(errs).toEqual([]);
});
