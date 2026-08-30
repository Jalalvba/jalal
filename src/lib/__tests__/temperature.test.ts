import { describe, expect, it } from "vitest";
import { temperatureFor, TEMPERATURE, PARKING_WORKORDER_TEMPERATURE } from "@/lib/ai/dsAnalysis/run";
import { DS_PARKING_WORKORDER_PROMPT } from "@/lib/ai/dsAnalysis/prompt-parking";
import { DS_ANALYSIS_SYSTEM_PROMPT } from "@/lib/ai/dsAnalysis/prompt";
import { DS_FOLLOWUP_SYSTEM_PROMPT } from "@/lib/ai/dsAnalysis/followUpPrompt";

// Temperature is per-PROMPT, not per-route. /api/parking/analyse is a Parking
// route that runs the DS History prompt, so keying on "is this parking?" would
// have dropped that route's summaries to 0 as a side effect.
describe("temperatureFor — the work order is a classifier, the analysis is prose", () => {
  it("runs the PARKING work order at 0 — greedy, no sampling", () => {
    expect(temperatureFor(DS_PARKING_WORKORDER_PROMPT)).toBe(0);
    expect(PARKING_WORKORDER_TEMPERATURE).toBe(0);
  });

  it("leaves DS History's analysis and follow-up at the default", () => {
    expect(temperatureFor(DS_ANALYSIS_SYSTEM_PROMPT)).toBe(TEMPERATURE);
    expect(temperatureFor(DS_FOLLOWUP_SYSTEM_PROMPT)).toBe(TEMPERATURE);
    expect(TEMPERATURE).toBe(0.2);
  });

  it("gives an unknown prompt the default rather than silently going greedy", () => {
    expect(temperatureFor("some future prompt")).toBe(TEMPERATURE);
  });

  it("passes 0 as a real value — gemini.ts gates on !== undefined, not truthiness", () => {
    // A `temperature && {temperature}` style guard would drop 0 and silently
    // restore sampling. This pins that 0 is a value, not an absence.
    expect(temperatureFor(DS_PARKING_WORKORDER_PROMPT)).not.toBeUndefined();
    expect(Object.is(temperatureFor(DS_PARKING_WORKORDER_PROMPT), 0)).toBe(true);
  });
});
