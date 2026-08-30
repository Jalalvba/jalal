import { describe, it, expect } from "vitest";
import { computeStableOrder } from "@/hooks/useStableRowOrder";

// Characterization tests for the ordering rule Atelier/Parking/Depot depend on.
// Written before restructuring the hook around them (issue #2) so the behaviour
// is pinned rather than rediscovered: the hook had no coverage at all, despite
// being load-bearing on three pages.

type Row = { imm: string; ts: number };
const key = (r: Row) => r.imm;
const rows = (...specs: [string, number][]): Row[] => specs.map(([imm, ts]) => ({ imm, ts }));

describe("computeStableOrder", () => {
  it("adopts the server order on the first pass, when nothing is remembered", () => {
    const server = rows(["A", 1], ["B", 2], ["C", 3]);
    const { order, rows: out } = computeStableOrder([], server, key);
    expect(order).toEqual(["A", "B", "C"]);
    expect(out.map(key)).toEqual(["A", "B", "C"]);
  });

  it("keeps an edited row in place when its timestamp bump re-sorts it server-side", () => {
    // The whole reason the hook exists: editing B bumps its TIMESTAMP, so the
    // server returns it last. It must still render in position 2.
    const previous = ["A", "B", "C"];
    const afterEdit = rows(["A", 1], ["C", 3], ["B", 9]);
    const { rows: out } = computeStableOrder(previous, afterEdit, key);
    expect(out.map(key)).toEqual(["A", "B", "C"]);
  });

  it("returns the row data from the latest fetch, not the remembered copy", () => {
    // Only position is pinned. The bumped timestamp must survive.
    const { rows: out } = computeStableOrder(["A", "B"], rows(["B", 9], ["A", 1]), key);
    expect(out.find((r) => r.imm === "B")!.ts).toBe(9);
  });

  it("drops rows that disappeared from the server", () => {
    const { order, rows: out } = computeStableOrder(["A", "B", "C"], rows(["A", 1], ["C", 3]), key);
    expect(order).toEqual(["A", "C"]);
    expect(out.map(key)).toEqual(["A", "C"]);
  });

  it("appends genuinely new rows in the server's own order, after the known ones", () => {
    const server = rows(["D", 4], ["A", 1], ["E", 5], ["B", 2]);
    const { rows: out } = computeStableOrder(["A", "B"], server, key);
    expect(out.map(key)).toEqual(["A", "B", "D", "E"]);
  });

  it("re-adopts the server order when the caller resets (empty previous order)", () => {
    // What the hook does on resetToken change: clears the remembered order,
    // so the next pass is identical to a first mount.
    const server = rows(["C", 3], ["A", 1], ["B", 2]);
    expect(computeStableOrder([], server, key).rows.map(key)).toEqual(["C", "A", "B"]);
  });

  it("ignores remembered keys the server no longer returns at all", () => {
    const { order } = computeStableOrder(["X", "Y"], rows(["A", 1]), key);
    expect(order).toEqual(["A"]);
  });

  it("is stable when nothing changed", () => {
    const server = rows(["A", 1], ["B", 2]);
    const once = computeStableOrder(["A", "B"], server, key);
    const twice = computeStableOrder(once.order, server, key);
    expect(twice.order).toEqual(once.order);
    expect(twice.rows.map(key)).toEqual(once.rows.map(key));
  });

  it("handles an empty server response without losing the remembered order's shape", () => {
    const { order, rows: out } = computeStableOrder(["A", "B"], [], key);
    expect(order).toEqual([]);
    expect(out).toEqual([]);
  });
});
