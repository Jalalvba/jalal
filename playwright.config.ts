import { defineConfig, devices } from "@playwright/test";

// E2E suite needs a real running dev server + real .env.local secrets
// (IRON_SESSION_SECRET for the auth fixture, real Sheets/Mongo access for
// the flows themselves — these hit the actual live BDD/Atelier data, same
// as every manual verification pass this session did). See TESTING.md for
// how to run this against a server you started yourself vs. letting
// Playwright start one.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Every spec shares one real backend (live Sheets/Mongo data, one
  // session) — different spec FILES still run in separate workers by
  // default even with fullyParallel:false, so this is pinned to 1 to avoid
  // cross-test interference (observed: admin-config's add/remove racing
  // against other specs' page loads against the same live data).
  workers: 1,
  retries: 0,
  reporter: "list",
  // Generous default: against `pnpm dev` (Turbopack), the FIRST hit to any
  // given route triggers several seconds of on-demand compilation — a real
  // 6s+ delay was observed on /api/config/options's first POST, nothing to
  // do with the app itself. A production build (`pnpm build && pnpm start`)
  // wouldn't have this tax; see TESTING.md.
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
