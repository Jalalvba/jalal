import { describe, expect, it } from "vitest";
import { displayDateToIso } from "@/lib/utils/sheetDate";

describe("displayDateToIso", () => {
  it("converts the dd/mm/yyyy the BDD reader produces to the yyyy-mm-dd an <input type=\"date\"> needs", () => {
    expect(displayDateToIso("30/09/2026")).toBe("2026-09-30");
    expect(displayDateToIso("01/01/2026")).toBe("2026-01-01");
  });

  it("keeps day and month in the right order — 09/10 is 9 October, not 10 September", () => {
    expect(displayDateToIso("09/10/2026")).toBe("2026-10-09");
  });

  it("passes an already-ISO value through, so a re-render of a just-committed value is stable", () => {
    expect(displayDateToIso("2026-09-30")).toBe("2026-09-30");
  });

  it("returns \"\" for a blank cell, which is what clears the field", () => {
    expect(displayDateToIso("")).toBe("");
    expect(displayDateToIso("   ")).toBe("");
  });

  it("returns \"\" rather than guessing at anything that is not one of the two shapes", () => {
    expect(displayDateToIso("SANS RL")).toBe("");
    expect(displayDateToIso("9/10/2026")).toBe("");
    expect(displayDateToIso("46295")).toBe("");
  });
});
