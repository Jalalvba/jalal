import { test, expect } from "@playwright/test";
import { authenticatedCookie } from "./helpers/auth";

// Guards a silent, expensive failure mode: each googleSheets*.ts module reads
// a FIXED column range (A1:X for ATELIER, A1:T for PARKING). A column that
// falls outside that range is invisible to buildColMap(), and every lookup for
// it returns undefined rather than throwing — so the AI summary write reported
// "this tab has no gemini column" and was skipped as an ordinary non-match,
// while a real, paid-for Gemini analysis was discarded. The read ranges said
// S and O; `gemini` lives at U and Q.
//
// Cheap on purpose: a plain read, no Gemini call, no write. If someone adds a
// column to one of these tabs without widening the range, this fails.
test("the zone tabs' read ranges reach their gemini column", async ({ context, baseURL }) => {
  test.setTimeout(120_000);
  await context.addCookies([await authenticatedCookie(baseURL!)]);

  for (const path of ["/api/atelier", "/api/parking"]) {
    const res = await context.request.get(`${baseURL}${path}?fresh=1`);
    expect(res.status(), path).toBe(200);
    const json = (await res.json()) as { ok: boolean; rows: Record<string, unknown>[] };
    expect(json.ok, path).toBe(true);
    test.skip(json.rows.length === 0, `${path} is empty — nothing to inspect`);
    // Present as a key at all is the assertion: absent means the column fell
    // outside the read range, which is exactly the bug.
    expect(json.rows[0], `${path} rows must expose their own gemini column`).toHaveProperty("gemini");
  }
});
