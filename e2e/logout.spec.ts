import { test, expect } from "./fixtures";

// Regression guard for I3: hooks/queryClient.tsx persists the full BDD
// dataset (plates, client names, technician assignments, free-text
// comments) to localStorage. app/login/actions.ts's logout() server action
// only destroys the session cookie — it has no way to reach into the
// browser's localStorage — so without a client-side clear, that data used
// to survive logout indefinitely on a shared/kiosk machine.
test("logout clears the persisted BDD query cache from localStorage", async ({ page }) => {
  // Load a page that populates the persisted "bdd" query cache.
  await page.goto("/suivi-rl", { waitUntil: "networkidle" });

  const beforeLogout = await page.evaluate(() => window.localStorage.getItem("jalal-query-cache"));
  expect(beforeLogout).not.toBeNull();
  expect(beforeLogout).toContain('"bdd"'); // the persisted cache actually contains BDD row data

  await page.getByTitle("Déconnexion").click();
  await page.waitForURL("**/login");

  // Not asserting the key is fully ABSENT: TanStack's own async persister
  // re-subscribes to the query client and re-writes an (empty) dehydrated
  // state to localStorage shortly after queryClient.clear() fires — that
  // race is expected and harmless, since it re-writes an EMPTY cache, not
  // the data we're clearing. What actually matters (per the audit's I3
  // finding) is that no real BDD row data survives logout — no plate, no
  // query entries at all.
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem("jalal-query-cache")), { timeout: 3000 })
    .not.toContain("queries\":[{");
});
