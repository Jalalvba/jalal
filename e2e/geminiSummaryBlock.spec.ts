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

  // Stored analyses would otherwise fill in summaries for rows this fixture
  // deliberately left blank, and the empty-state assertion below is the point
  // of the test.
  await page.route("**/api/ds-history/analysis**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, summaries: [] }),
    })
  );

  await page.goto("/parking");
  await expect(page.getByText("Résumé IA").first()).toBeVisible({ timeout: 40_000 });
  test.skip(rows.length === 0, "PARKING tab is empty — nothing to render");

  const plate = String(rows[0].imm);
  const card = page.getByTestId("record-card").filter({ hasText: plate }).first();
  await expect(card).toContainText(SUMMARY, { timeout: 40_000 });

  // Exactly one card shows it — the value is per row, not per page.
  const body = await page.locator("body").innerText();
  expect((body.match(new RegExp(SUMMARY, "g")) ?? []).length).toBe(1);
  // A row with no summary renders NO panel at all — just the icon that starts
  // one. The old placeholder ("Aucun résumé — lancez l'analyse…") was a
  // bordered rectangle per row announcing its own emptiness, ~95 of them on
  // Suivi RL. Its absence is the assertion.
  expect(body).not.toContain("Aucun résumé");
  if (rows.length > 1) {
    // …and the row still offers a way to create one. On Parking that is the
    // pair of per-row AI buttons (ACTION / gemini), not the generic sparkle:
    // this page stopped writing through the BDD fan-out.
    await expect(
      page.getByTestId("record-card").first().getByRole("button", { name: "Analyse DS", exact: true })
    ).toBeVisible();
  }
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

// The paid tier is opt-in per PAGE, and the only thing standing between "free"
// and "billed" is one prop threaded through two components. A unit test cannot
// see that wiring — it lives in JSX — so this drives a real click and reads the
// request the browser actually sent.
//
// Nothing is spent and nothing is written: the analyze call is intercepted
// before it leaves the browser, and the save that would follow never happens.
test("Suivi RL asks for the paid tier, and Parking goes through its own route", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await context.addCookies([await authenticatedCookie(baseURL!)]);

  // The paid tier is opt-in per PAGE, and the only thing standing between
  // "free" and "billed" is one prop threaded through two components. A unit
  // test cannot see that wiring — it lives in JSX — so this drives a real
  // click and reads the request the browser actually sent.
  const analyze: (string | undefined)[] = [];
  await page.route("**/api/ds-history/analyze", async (route) => {
    const body = route.request().postDataJSON() as { quality?: string };
    analyze.push(body?.quality);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        analysis: {
          contractFlag: { level: "unknown", label: "Date de fin de contrat indisponible" },
          findings: [],
          summary: "Résumé de test.",
          insufficientData: false,
        },
      }),
    });
  });
  await page.route("**/api/bdd/gemini", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, saved: false, tabs: [], failures: [], reason: "no-row" }),
    })
  );
  const parkingCalls: string[] = [];
  await page.route("**/api/parking/analyse", async (route) => {
    parkingCalls.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, results: [{ imm: "X", outcome: "written" }] }),
    });
  });

  // Suivi RL: the paid tier, asked for by name.
  await page.goto("/suivi-rl");
  const rlButton = page.getByRole("button", { name: /Résumé IA|Regénérer/ }).first();
  await expect(rlButton).toBeVisible({ timeout: 40_000 });
  await rlButton.click();
  const confirm = page.getByRole("button", { name: "Regénérer", exact: true }).last();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect.poll(() => analyze.length, { timeout: 40_000 }).toBe(1);
  expect(analyze[0]).toBe("pro");

  // Parking: its own route, and never the shared analyze endpoint — that is
  // what keeps this page off the paid tier AND out of the BDD fan-out.
  await page.goto("/parking");
  // The per-ROW button, scoped to a card: the header carries a batch button
  // whose label says "(liste)", and clicking that one opens a confirm instead.
  const parkingButton = page
    .getByTestId("record-card")
    .first()
    .getByRole("button", { name: "Analyse DS", exact: true });
  await expect(parkingButton).toBeVisible({ timeout: 40_000 });
  await parkingButton.click();
  await expect.poll(() => parkingCalls.length, { timeout: 40_000 }).toBe(1);
  expect(analyze.length, "Parking must not call the shared analyze endpoint").toBe(1);
});
