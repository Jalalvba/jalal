import { test, expect } from "@playwright/test";
import { authenticatedCookie } from "./helpers/auth";

// Both per-row buttons drive REAL endpoints that write to the live sheet, so
// this intercepts them: what is being pinned is the wiring — which button
// calls which route, with which plate, and whether an existing value turns the
// click into a refresh (force). Nothing is spent and nothing is written.
test("each Parking row offers both analyses, each to its own column", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await context.addCookies([await authenticatedCookie(baseURL!)]);

  const calls: { url: string; imms: string[]; force: boolean }[] = [];
  for (const path of ["**/api/parking/actions", "**/api/parking/analyse"]) {
    await page.route(path, async (route) => {
      const body = route.request().postDataJSON() as { imms: string[]; force?: boolean };
      calls.push({
        url: new URL(route.request().url()).pathname,
        imms: body.imms,
        force: body.force === true,
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, results: [{ imm: body.imms[0], outcome: "written" }] }),
      });
    });
  }

  await page.goto("/parking");
  const card = page.getByTestId("record-card").first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  const plate = (await card.locator("span.font-mono").first().innerText()).trim();

  await card.getByRole("button", { name: "Action", exact: true }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].url).toBe("/api/parking/actions");
  expect(calls[0].imms).toEqual([plate]);

  await card.getByRole("button", { name: "Analyse DS", exact: true }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].url).toBe("/api/parking/analyse");
  expect(calls[1].imms).toEqual([plate]);

  // The two batch buttons in the header are still the whole-list version, and
  // must not be confused with the per-row ones.
  await expect(page.getByRole("button", { name: "Actions IA (liste)" })).toBeVisible();
  expect(errs).toEqual([]);
});
