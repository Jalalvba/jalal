import { describe, expect, it, vi } from "vitest";

// Deliberately does NOT mock @/lib/rateLimit — this test exercises the
// REAL rate-limit code path (checkRateLimit -> getCollection) with only
// Mongo itself mocked to fail, proving the actual production bug (BDD
// export 500s, root-caused via Vercel's runtime-error logs to an uncaught
// MongoNetworkError from the rate-limiter) stays fixed at the exact route
// where it was reported — not just at lib/rateLimit.ts's own unit level.
vi.mock("@/lib/mongo/client", () => ({
  getCollection: vi.fn().mockRejectedValue(new Error("MongoServerSelectionError: Server selection timed out")),
}));

import { POST } from "@/app/api/bdd/export/route";

const validRow = { IMM: "12345-B-6", client: "Acme", modele: "208", Emplacement: "PARKING", commentaire: "RAS" };

describe("POST /api/bdd/export — resilience to a real Mongo outage", () => {
  it("still returns a real PDF when the rate-limiter's Mongo call fails, instead of a 500", async () => {
    const res = await POST(
      new Request("http://localhost/api/bdd/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows: [validRow], activeFilters: [] }),
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");
  });
});
