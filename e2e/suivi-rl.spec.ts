import { test, expect } from "./fixtures";
import type { BddRow } from "@/lib/types";

// Turns the ad-hoc "apply Emplacement filter, read the count badge, compare
// to the API" verification done manually (and thrown away) earlier this
// session into a permanent regression check.
test("suivi-rl: Emplacement filter shows exactly the rows matching that value", async ({ page }) => {
  await page.goto("/suivi-rl", { waitUntil: "networkidle" });

  // Cross-check against the real API rather than a hardcoded expected
  // count — this is live production data that changes over time (observed
  // firsthand this session), so the test computes its own expectation from
  // the same data the page just loaded.
  const res = await page.request.get("/api/bdd");
  expect(res.ok()).toBe(true);
  const { rows } = (await res.json()) as { rows: BddRow[] };

  // Mirrors app/suivi-rl/page.tsx's own cascade: default active Fleet is
  // "INTERNE" (not TOUS) on first load, then Emplacement narrows further.
  const fleetFiltered = rows.filter((r) => r.ETAT?.toUpperCase() === "INTERNE");
  const emplacementValue = "ATELIER";
  const expectedCount = fleetFiltered.filter((r) => r.Emplacement === emplacementValue).length;

  await page.getByRole("radio", { name: emplacementValue, exact: true }).click();
  await page.waitForTimeout(400);

  const countBadge = page.locator("span.font-mono.text-micro").first();
  await expect(countBadge).toHaveText(String(expectedCount));
});
