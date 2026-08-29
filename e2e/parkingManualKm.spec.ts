import { test, expect } from "./fixtures";

// Real click-through of the KM override field against the live PARKING tab.
//
// Writes and RESTORES the original value: this suite runs against the real
// spreadsheet, and leaving a manufactured mileage on a real vehicle would
// change what the work-order prompt says about that vehicle.
//
// Persistence is asserted on the value that comes back from the mutation's own
// `?fresh=1` refetch, NOT after a page reload. A reload is the wrong probe
// here: markFresh() lives in page memory and is gone after one, so the plain
// GET can legitimately serve the pre-write cached rows (see freshFetch.ts).
// The refetch is what the user actually sees, and its payload is read live from
// Sheets — so a value surviving it has genuinely round-tripped.

test.describe("Parking — manual km override", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const theme of ["light", "dark"] as const) {
    test(`renders, edits and round-trips at 375px (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem("theme", t);
        // Must be the literal string "true" — layout.tsx's no-flash script
        // compares against it exactly, and anything else falls through to the
        // time-of-day default (so a "light" run would silently render dark).
        localStorage.setItem("theme-explicit", "true");
      }, theme);
      await page.emulateMedia({ colorScheme: theme });

      const writes: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/api/parking/km")) writes.push(r.postData() ?? "");
      });

      await page.goto("/parking");
      await expect(page.getByText("KM relevé").first()).toBeVisible({ timeout: 30_000 });

      const field = page.locator('textarea[placeholder*="historique DS"]').first();
      await expect(field).toBeVisible();
      const original = await field.inputValue();

      // The theme is genuinely applied, so this is a real light/dark pass and
      // not two identical runs.
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark).*$/);

      // No sideways scroll at 375px.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);

      await field.fill("123456");
      await field.blur();

      // The mutation fired with this row's own identity — the rowIndex/imm pair
      // verifyRowIdentity() checks server-side.
      await expect.poll(() => writes.length, { timeout: 15_000 }).toBeGreaterThan(0);
      expect(writes[0]).toContain('"km":"123456"');
      expect(writes[0]).toMatch(/"rowIndex":\d+/);
      expect(writes[0]).toMatch(/"imm":"[^"]+"/);

      // Survives the refetch — i.e. it came back from Sheets, not from local
      // component state.
      await page.waitForResponse(
        (r) => r.url().includes("/api/parking?fresh=1") && r.status() === 200,
        { timeout: 20_000 }
      );
      await expect(field).toHaveValue("123456", { timeout: 20_000 });

      await page.screenshot({
        path: `/tmp/claude-1000/-home-jalal-jalal/548171c7-cd03-4b9e-ba1d-f223ecf3caae/scratchpad/parking-km-${theme}.png`,
      });

      // Restore, and confirm the clear round-trips too — an empty cell is the
      // "fall back to the DS history" state, so clearing has to actually work.
      await field.fill(original);
      await field.blur();
      await page.waitForResponse(
        (r) => r.url().includes("/api/parking?fresh=1") && r.status() === 200,
        { timeout: 20_000 }
      );
      await expect(field).toHaveValue(original, { timeout: 20_000 });
    });
  }
});
