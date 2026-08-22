import { describe, expect, it } from "vitest";
import { classifyOwner } from "@/lib/sheets/googleSheetsParc";

describe("classifyOwner — Client, Société, and the AVIS fleet", () => {
  it("shows the Client when there is one", () => {
    expect(classifyOwner("STERIFIL", "LOCAFINANCE").display).toBe("STERIFIL");
  });

  it("falls back to Société when the Client is empty", () => {
    // 766 parc rows are exactly this: no customer, owner in Société only. The
    // PARKING tab's CLIENT lookup reads the Client column, so those vehicles
    // showed no owner at all before the fallback.
    expect(classifyOwner("", "AVIS").display).toBe("AVIS");
    expect(classifyOwner("   ", "LOCAFINANCE").display).toBe("LOCAFINANCE");
  });

  it("flags AVIS from either column", () => {
    // Both spellings occur live: Société "AVIS" (424 rows) and Client
    // "Scal Avis".
    expect(classifyOwner("", "AVIS").isAvis).toBe(true);
    expect(classifyOwner("Scal Avis", "LOCAFINANCE").isAvis).toBe(true);
  });

  it("does not flag a company that merely contains those letters", () => {
    // Word-boundary matching: "AVISO" and "SCALP" are not AVIS.
    expect(classifyOwner("AVISO MAROC", "LOCAFINANCE").isAvis).toBe(false);
    expect(classifyOwner("SCALPEL SARL", "PLF").isAvis).toBe(false);
  });

  it("handles a vehicle with neither field", () => {
    const o = classifyOwner("", "");
    expect(o.display).toBe("");
    expect(o.isAvis).toBe(false);
  });
});
