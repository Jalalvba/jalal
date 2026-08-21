import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { markFresh, freshUrl } from "@/hooks/freshFetch";

// Regression cover for the sticky-after-delete card: every mutation route
// calls invalidateCache(), but Next's revalidateTag is stale-while-revalidate,
// so the refetch fired the instant a mutation resolves was served the
// pre-mutation rows. The read has to opt out of the cache instead.

describe("freshFetch", () => {
  it("leaves an ordinary read cached", () => {
    expect(freshUrl("atelier", "/api/atelier")).toBe("/api/atelier");
  });

  it("bypasses the cache on the read that follows a write", () => {
    markFresh("atelier");
    expect(freshUrl("atelier", "/api/atelier")).toBe("/api/atelier?fresh=1");
  });

  it("is one-shot — background polling stays cached, or the quota reasoning breaks", () => {
    markFresh("parking");
    expect(freshUrl("parking", "/api/parking")).toBe("/api/parking?fresh=1");
    expect(freshUrl("parking", "/api/parking")).toBe("/api/parking");
  });

  it("does not leak across tabs", () => {
    markFresh("depot");
    expect(freshUrl("bdd", "/api/bdd")).toBe("/api/bdd");
    expect(freshUrl("depot", "/api/depot")).toBe("/api/depot?fresh=1");
  });

  it("appends to a URL that already has a query string", () => {
    markFresh("bdd");
    expect(freshUrl("bdd", "/api/bdd?imm=X")).toBe("/api/bdd?imm=X&fresh=1");
  });
});

// The suite runs under `environment: "node"`, which has no sessionStorage —
// the same condition as a browser with storage disabled. Stubbing it here
// exercises the stored-window path; the "no storage at all" path is covered by
// the last test in this block.
describe("freshFetch — cross-navigation window", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps bypassing the cache across page loads for the whole window", async () => {
    const { markFreshFor, freshUrl } = await import("@/hooks/freshFetch");
    markFreshFor("config-options", 60_000);
    // Several reads, as several pages would do after the admin's save.
    expect(freshUrl("config-options", "/api/config/options")).toContain("fresh=1");
    expect(freshUrl("config-options", "/api/config/options")).toContain("fresh=1");
  });

  it("stops once the window has passed, so the cache goes back to doing its job", async () => {
    const { markFreshFor, freshUrl } = await import("@/hooks/freshFetch");
    markFreshFor("expired-scope", -1);
    expect(freshUrl("expired-scope", "/api/x")).toContain("fresh=1"); // the in-memory one-shot
    expect(freshUrl("expired-scope", "/api/x")).toBe("/api/x");
  });

  it("degrades to the one-shot flag when storage is unavailable, never throws", async () => {
    vi.unstubAllGlobals();
    const { markFreshFor, freshUrl } = await import("@/hooks/freshFetch");
    expect(() => markFreshFor("no-storage", 60_000)).not.toThrow();
    expect(freshUrl("no-storage", "/api/x")).toContain("fresh=1");
    expect(freshUrl("no-storage", "/api/x")).toBe("/api/x");
  });
});
