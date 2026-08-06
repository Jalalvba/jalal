import { test, expect } from "./fixtures";

// This is the highest-stakes spec in the suite: it writes to the real
// Mongo-backed sheetFieldOptions collection the deployed app actually
// reads from (Stage 1 config system). The finally block guarantees cleanup
// even if a mid-test assertion fails, so a failed run never leaves a
// permanent test value in production config.
test("admin/config: adding a Technicien value appears in the Atelier dropdown, and removing it cleans up", async ({
  page,
}) => {
  const testValue = `E2E-TEST-${Date.now()}`;

  await page.goto("/admin/config", { waitUntil: "networkidle" });
  const technicienSection = page.locator(".rounded-2xl").filter({ has: page.getByRole("heading", { name: "Technicien", exact: true }) });

  try {
    await technicienSection.locator('input[placeholder="Nouvelle valeur…"]').fill(testValue);
    await technicienSection.getByRole("button", { name: "Ajouter" }).click();
    await expect(technicienSection.getByText(testValue, { exact: true })).toBeVisible();

    // Dependent dropdown: Atelier's per-card Technicien <select> is
    // Mongo-backed via the same useSheetFieldOptions() hook.
    await page.goto("/atelier", { waitUntil: "networkidle" });
    const technicienSelect = page.locator("select").nth(1);
    await expect(technicienSelect.locator(`option:text-is("${testValue}")`)).toHaveCount(1);
  } finally {
    // Deliberately no assertions in here — a throw from inside a finally
    // block replaces/masks whatever the try block itself failed with. Just
    // the cleanup action; verification happens as a normal step below.
    await page.goto("/admin/config", { waitUntil: "networkidle" });
    const cleanupSection = page.locator(".rounded-2xl").filter({ has: page.getByRole("heading", { name: "Technicien", exact: true }) });
    const chip = cleanupSection.locator("span", { hasText: testValue }).first();
    if (await chip.count() > 0) {
      await chip.locator("button").click();
    }
  }

  await page.goto("/admin/config", { waitUntil: "networkidle" });
  const finalSection = page.locator(".rounded-2xl").filter({ has: page.getByRole("heading", { name: "Technicien", exact: true }) });
  await expect(finalSection.getByText(testValue, { exact: true })).toHaveCount(0);

  // Confirm cleanup actually took, outside the finally so a cleanup failure
  // itself fails the test loudly instead of being swallowed.
  await page.goto("/atelier", { waitUntil: "networkidle" });
  const technicienSelectAfter = page.locator("select").nth(1);
  await expect(technicienSelectAfter.locator(`option:text-is("${testValue}")`)).toHaveCount(0);
});
