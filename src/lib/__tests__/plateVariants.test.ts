import { describe, expect, it } from "vitest";
import { buildPlateVariants } from "@/lib/utils/plateVariants";

// The zone-detection pipeline (hooks/useVehicleZone.ts) and BDD/RL search
// both key exclusively off this function's output — a wrong variant list
// silently breaks "is this plate in Parking/Atelier/RDV/Depot" for any
// plate stored inconsistently as "980874WW" vs "WW980874" vs "980874"
// across tabs, with no error, just a badge that never lights up.

describe("buildPlateVariants", () => {
  it("a plain plate with no WW affix returns only itself, uppercased/trimmed", () => {
    expect(buildPlateVariants(" 12345-b-6 ")).toEqual(["12345-B-6"]);
  });

  it("a WW-suffixed plate also returns the WW-prefixed and bare forms", () => {
    expect(buildPlateVariants("980874WW")).toEqual(["980874WW", "WW980874", "980874"]);
  });

  it("a WW-prefixed plate also returns the WW-suffixed and bare forms", () => {
    expect(buildPlateVariants("WW980874")).toEqual(["WW980874", "980874WW", "980874"]);
  });

  it("lowercase input is normalized to uppercase before matching", () => {
    expect(buildPlateVariants("980874ww")).toEqual(["980874WW", "WW980874", "980874"]);
  });

  it("a bare numeric plate (neither WW-prefixed nor suffixed) has only itself as a variant", () => {
    expect(buildPlateVariants("980874")).toEqual(["980874"]);
  });

  it("a plate that is literally just 'WW' doesn't blow up — both the prefix and suffix branches fire on an empty core", () => {
    // Not real fleet data, but documented as current behavior rather than
    // left to throw or silently misbehave: both branches independently
    // fire (it both starts and ends with "WW"), each contributing their own
    // "" variant.
    expect(buildPlateVariants("WW")).toEqual(["WW", "WW", "", "WW", ""]);
  });
});
