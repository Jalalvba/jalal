import { describe, expect, it } from "vitest";
import { hasPopulatedFields } from "@/components/fleet/ReadonlyFieldList";

describe("hasPopulatedFields — lets a caller decide emptiness before rendering", () => {
  it("is false for an empty field list", () => {
    expect(hasPopulatedFields([])).toBe(false);
  });

  it("is false when every field is blank or whitespace-only", () => {
    expect(
      hasPopulatedFields([
        { label: "A", value: "" },
        { label: "B", value: "   " },
      ])
    ).toBe(false);
  });

  it("is true when at least one field has real content", () => {
    expect(
      hasPopulatedFields([
        { label: "A", value: "" },
        { label: "B", value: "Casablanca" },
      ])
    ).toBe(true);
  });
});
