import { test, expect } from "@playwright/test";
import { authenticatedCookie } from "./helpers/auth";

// A measurement, not a gate. It prints where the time actually goes on the two
// pages that got slower, so a "it feels slow" report can be answered with
// numbers instead of a guess. Thresholds are deliberately loose — this exists
// to catch an order-of-magnitude regression, not to fail on jitter.
const PAGES = ["/suivi-rl", "/parking"] as const;

for (const path of PAGES) {
  test(`perf: ${path} paints its rows`, async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    await context.addCookies([await authenticatedCookie(baseURL!)]);

    const api: { url: string; ms: number }[] = [];
    page.on("requestfinished", async (req) => {
      const u = new URL(req.url()).pathname;
      if (!u.startsWith("/api/")) return;
      const timing = req.timing();
      api.push({ url: u, ms: Math.round(timing.responseEnd - timing.requestStart) });
    });

    const t0 = Date.now();
    await page.goto(path);
    await expect(page.getByTestId("record-card").first()).toBeVisible({ timeout: 60_000 });
    const firstCard = Date.now() - t0;

    // Let the page settle so every card has rendered, then measure the DOM.
    await page.waitForTimeout(1500);
    const cards = await page.getByTestId("record-card").count();

    // How long a full re-render of the list takes, measured from inside the
    // page: this is what a filter keystroke or a cache update costs.
    const rerender = await page.evaluate(async () => {
      const t = performance.now();
      // Force layout + paint of the whole list.
      document.body.getBoundingClientRect();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t);
    });

    console.log(`\n[perf] ${path}`);
    console.log(`  first card visible : ${firstCard}ms`);
    console.log(`  cards rendered     : ${cards}`);
    console.log(`  forced reflow      : ${rerender}ms`);
    for (const a of api.sort((x, y) => y.ms - x.ms).slice(0, 6)) {
      console.log(`  ${String(a.ms).padStart(6)}ms  ${a.url}`);
    }

    expect(cards).toBeGreaterThan(0);
  });
}
