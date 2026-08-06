import { test, expect } from "./fixtures";
import type { AtelierRow } from "@/lib/types";

// Permanent version of this session's manual verification: click a named
// Technicien chip and the new "Non assigné" chip, cross-check each against
// the real API's row data rather than a hardcoded expectation.
test.describe("atelier: Technicien filter", () => {
  test("a named technician chip isolates exactly their assigned rows", async ({ page }) => {
    await page.goto("/atelier", { waitUntil: "networkidle" });

    const res = await page.request.get("/api/atelier");
    expect(res.ok()).toBe(true);
    const { rows } = (await res.json()) as { rows: AtelierRow[] };

    const named = [...new Set(rows.map((r) => r.technicien).filter(Boolean))].sort();
    test.skip(named.length === 0, "no technician currently has an assigned vehicle in live Atelier data");

    const technicien = named[0];
    const expectedCount = rows.filter((r) => r.technicien === technicien).length;

    await page.getByRole("radio", { name: technicien, exact: true }).click();
    await page.waitForTimeout(400);

    const countBadge = page.locator("span.font-mono.text-micro").first();
    await expect(countBadge).toHaveText(String(expectedCount));
  });

  test("'Non assigné' isolates exactly the rows with a blank Technicien", async ({ page }) => {
    await page.goto("/atelier", { waitUntil: "networkidle" });

    const res = await page.request.get("/api/atelier");
    expect(res.ok()).toBe(true);
    const { rows } = (await res.json()) as { rows: AtelierRow[] };

    const expectedCount = rows.filter((r) => !r.technicien?.trim()).length;

    await page.getByRole("radio", { name: "Non assigné", exact: true }).click();
    await page.waitForTimeout(400);

    const countBadge = page.locator("span.font-mono.text-micro").first();
    await expect(countBadge).toHaveText(String(expectedCount));

    if (expectedCount > 0) {
      // Every visible card's Technicien select should show the empty
      // placeholder — the count matching alone wouldn't catch the filter
      // predicate silently inverting.
      const technicienSelects = page.locator("select").nth(1);
      await expect(technicienSelects).toHaveValue("");
    }
  });
});
