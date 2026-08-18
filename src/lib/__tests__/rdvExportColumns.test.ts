import { describe, expect, it } from "vitest";
import { RDV_HEADERS } from "@/types";
import { EXPORT_COLUMNS } from "@/app/rdv/page";

describe("RDV export table columns — derived from RDV_HEADERS, not hand-copied (M2)", () => {
  it("is exactly RDV_HEADERS minus 'Date'", () => {
    expect(EXPORT_COLUMNS).toEqual(RDV_HEADERS.filter((h) => h !== "Date"));
  });

  it("uses the real sheet header text 'CONVOYEUR', not the hand-copied 'Convoyeur' that had drifted", () => {
    expect(EXPORT_COLUMNS).toContain("CONVOYEUR");
    expect(EXPORT_COLUMNS).not.toContain("Convoyeur");
  });

  it("has exactly 7 entries, matching the 7 hand-written <td> cells in ExportTable", () => {
    // The <td>s themselves are still positional (see the comment in
    // app/rdv/page.tsx) — this at least catches a column COUNT drift, even
    // though it can't catch an ORDER drift without a bigger refactor.
    expect(EXPORT_COLUMNS).toHaveLength(7);
  });
});
