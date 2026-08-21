import { test, expect } from "./fixtures";

// Fully mocked /api/config/options GET response — deliberately does NOT
// touch live Mongo, unlike the write-flow spec below. This is what lets
// these two specs reproduce the exact race Opus's audit found (C2): the
// original bug was that admin-config.spec.ts's own networkidle wait
// structurally could never observe the loading window, since it always
// waits for the fetch to finish before interacting.
const FIXTURE_OPTIONS = {
  EMPLACEMENT_OPTIONS: ["ATELIER", "PARKING", "INTROUVABLE", "DEPOT", "EXTERNE"],
  ETAT_OPTIONS: ["INTERNE", "EXTERNE", "DISPONIBLE", "ANNULE", "ANNULEE"],
  FLAG_OPTIONS: [{ value: "Urgent", color: "red" }],
  CATEGORIE_OPTIONS: ["Cat A"],
  TECHNICIEN_OPTIONS: ["ALI ELGHORABI"],
  PRESTATAIRE_OPTIONS: [{ value: "SCAL", color: null }],
  RDV_CONVOYEURS: ["KHACHI Taha"],
};

test("admin/config: no editable UI (no Ajouter button) is rendered while the options fetch is still pending — C2 regression guard", async ({
  page,
}) => {
  // Delay the GET response well past when a real user could plausibly
  // click — this is the exact window the original bug's click-during-load
  // race exploited (Ajouter was gated on the mutation's pending state, not
  // the query's).
  await page.route("**/api/config/options", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ json: { ok: true, options: FIXTURE_OPTIONS, degraded: false, meta: {} } });
  });

  await page.goto("/admin/config"); // NOT networkidle — we want to observe the pending state

  // While pending: a loading placeholder is shown, and critically, no
  // "Ajouter" button exists anywhere on the page yet (previously, the
  // section cards — Ajouter included — rendered immediately, populated
  // with CLIENT_FALLBACK data, and a click during this window would have
  // POSTed that fallback data as if it were live).
  await expect(page.getByTestId("config-loading")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter" })).toHaveCount(0);

  // Once the delayed response lands, the real UI appears and becomes
  // interactive. Ajouter is disabled on an empty draft input regardless of
  // loading state, so type a value first — what's under test here is that
  // the `disabled` prop (the loading/degraded gate) is no longer the thing
  // blocking it, not that the button is unconditionally clickable.
  await expect(page.getByTestId("config-loading")).toHaveCount(0, { timeout: 5000 });
  const firstInput = page.locator('input[placeholder="Nouvelle valeur…"]').first();
  await firstInput.fill("probe-value");
  await expect(page.getByRole("button", { name: "Ajouter" }).first()).toBeEnabled();
});

test("admin/config: a degraded (Mongo-unreachable) response shows a banner and disables every edit control — C2 regression guard", async ({
  page,
}) => {
  await page.route("**/api/config/options", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ json: { ok: true, options: FIXTURE_OPTIONS, degraded: true, meta: {} } });
  });

  await page.goto("/admin/config", { waitUntil: "networkidle" });

  await expect(page.getByTestId("config-degraded-banner")).toBeVisible();
  const firstAjouter = page.getByRole("button", { name: "Ajouter" }).first();
  await expect(firstAjouter).toBeVisible();
  await expect(firstAjouter).toBeDisabled();
});

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
      // Wait for the save to actually land. Without this, the page.goto()
      // immediately below cancels the in-flight POST often enough to make the
      // final assertion flaky — the value is still there because the removal
      // never reached the server, not because the read was stale.
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/config/options") && r.request().method() === "POST"
        ),
        chip.locator("button").click(),
      ]);
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
