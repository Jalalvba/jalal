import { describe, it, expect, vi, beforeEach } from "vitest";

// The date guard's override path can't be reached through the real API (the
// model returns null on undated input), so the wrapper is mocked to force the
// case it exists for: a model that reports a range the text cannot support.
const callGeminiWithTracking = vi.fn();
vi.mock("@/lib/gemini/costTracker", () => ({
  callGeminiWithTracking: (...args: unknown[]) => callGeminiWithTracking(...args),
  GeminiCallError: class extends Error {},
}));

const { generateComplaintPlaybook } = await import("@/lib/gemini/complaintPlaybook");

const modelPlaybook = (dateRangeObserved: string | null) => ({
  sourceSummary: { threadsObserved: 2, dateRangeObserved, languagesObserved: ["Français"] },
  categories: [],
  crossCuttingObservations: [],
  notEvidenced: [],
});

function respondWith(dateRangeObserved: string | null) {
  callGeminiWithTracking.mockResolvedValue({
    result: JSON.stringify(modelPlaybook(dateRangeObserved)),
    costInfo: { model: "gemini-flash-latest" },
  });
}

describe("generateComplaintPlaybook date guard", () => {
  beforeEach(() => callGeminiWithTracking.mockReset());

  it("discards a reported range when the text carries no date", async () => {
    respondWith("2026-08");
    const { playbook } = await generateComplaintPlaybook("Le véhicule est tombé en panne.");
    expect(playbook.sourceSummary.dateRangeObserved).toBeNull();
  });

  it("keeps a reported range when the text does carry a date", async () => {
    respondWith("2026-03 to 2026-08");
    const { playbook } = await generateComplaintPlaybook("Loué le 19/08/2026, panne le lendemain.");
    expect(playbook.sourceSummary.dateRangeObserved).toBe("2026-03 to 2026-08");
  });

  it("leaves an already-null range alone", async () => {
    respondWith(null);
    const { playbook } = await generateComplaintPlaybook("Aucune date ici.");
    expect(playbook.sourceSummary.dateRangeObserved).toBeNull();
  });
});
