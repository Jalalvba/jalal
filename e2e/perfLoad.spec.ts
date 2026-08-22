import { test, expect } from "@playwright/test";
import { authenticatedCookie } from "./helpers/auth";

// The realistic future state, today: every vehicle analysed. The store holds a
// handful of documents right now, so measuring against it says nothing about
// what the page will feel like once the backfill has run — this stubs a full
// store and throttles the CPU to a mid-range phone.
test("perf under a fully-populated analysis store", async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await context.addCookies([await authenticatedCookie(baseURL!)]);

  let plates: string[] = [];
  await page.route("**/api/bdd**", async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { rows: Record<string, unknown>[] };
    plates = (json.rows ?? []).map((r) => String(r.IMM ?? ""));
    await route.fulfill({ response: res, json });
  });

  // Answered from whatever the BDD call saw, so every rendered card has a
  // stored analysis to look up — the worst case for a per-card lookup.
  await page.route("**/api/ds-history/analysis**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        summaries: plates.map((imm, i) => ({
          imm,
          tier: i % 2 ? "pro" : "standard",
          entriesCount: 20 + i,
          lastEntryDate: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-08-22T00:00:00.000Z",
          summary: `Résumé stocké pour ${imm}. `.repeat(6),
        })),
      }),
    });
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const t0 = Date.now();
  await page.goto(process.env.PERF_PAGE ?? "/suivi-rl");
  await expect(page.getByTestId("record-card").first()).toBeVisible({ timeout: 90_000 });
  const firstCard = Date.now() - t0;
  await page.waitForTimeout(2000);

  const cards = await page.getByTestId("record-card").count();
  const withSummary = await page.getByText(/^Résumé stocké pour /).count();

  // What a keystroke costs: type into the plate filter and wait for the list
  // to settle. This is the interaction that felt slow.
  // Instrument the keystroke: long tasks (main-thread blocks) and any network
  // it triggers, so "slow" can be attributed instead of guessed at.
  await page.evaluate(() => {
    (window as unknown as { __lt: number[] }).__lt = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) (window as unknown as { __lt: number[] }).__lt.push(Math.round(e.duration));
    }).observe({ entryTypes: ["longtask"] });
  });
  const during: string[] = [];
  const onReq = (r: import("@playwright/test").Request) => {
    const u = new URL(r.url()).pathname;
    if (u.startsWith("/api/")) during.push(u);
  };
  page.on("request", onReq);

  const search = page.getByPlaceholder("Rechercher par immatriculation…").first();
  const t1 = Date.now();
  await search.fill("4");
  await page.waitForTimeout(400);
  const keystroke = Date.now() - t1 - 400;
  page.off("request", onReq);
  const longTasks = await page.evaluate(() => (window as unknown as { __lt: number[] }).__lt);
  console.log(`[perfLoad] long tasks during keystroke: ${JSON.stringify(longTasks)}`);
  console.log(`[perfLoad] requests during keystroke  : ${JSON.stringify(during)}`);

  console.log(`\n[perfLoad] cards=${cards} withStoredSummary=${withSummary}`);
  console.log(`[perfLoad] first card visible: ${firstCard}ms (4x CPU throttle)`);
  console.log(`[perfLoad] filter keystroke  : ${keystroke}ms`);

  expect(cards).toBeGreaterThan(0);
});
