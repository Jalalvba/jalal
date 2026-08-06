import { describe, expect, it } from "vitest";
import { buildSummary } from "@/components/fleet/ImportTrigger";
import type { ImportPipelineResult, ImportPipelineRunStatus } from "@/lib/types";

// Minimal fixture builder — only the fields buildSummary actually reads
// (status, pipeline, steps) need real values; the rest are filler.
function pipeline(overrides: Partial<ImportPipelineResult> & { status: ImportPipelineRunStatus }): ImportPipelineResult {
  return {
    label: overrides.pipeline ?? "test",
    filename: "test.xlsx",
    pipeline: "test",
    run_id: "run-1",
    started_at: null,
    finished_at: null,
    steps: [],
    ...overrides,
  };
}

describe("buildSummary", () => {
  it("all success — reports the exact count, no updated/skipped breakdown needed", () => {
    const results = [pipeline({ pipeline: "ds", status: "success" }), pipeline({ pipeline: "cp", status: "success" })];

    const summary = buildSummary(results, 42);

    expect(summary.ok).toBe(true);
    expect(summary.text).toBe("✅ All 2 pipelines completed successfully in 42s");
  });

  it("one failed — reports failure with the failing step's own detail, not a generic message", () => {
    const results = [
      pipeline({
        pipeline: "ds",
        status: "failed",
        steps: [
          { step: "download", status: "success", detail: "", timestamp: null },
          { step: "upload_mongo", status: "failed", detail: "connection refused", timestamp: null },
        ],
      }),
      pipeline({ pipeline: "cp", status: "success" }),
    ];

    const summary = buildSummary(results, 15);

    expect(summary.ok).toBe(false);
    expect(summary.text).toBe("❌ Import failed after 15s — DS (upload_mongo: connection refused)");
  });

  it("failed with no steps recorded at all — falls back to 'unknown error', never throws", () => {
    const results = [pipeline({ pipeline: "bc", status: "failed", steps: [] })];

    const summary = buildSummary(results, 5);

    expect(summary.ok).toBe(false);
    expect(summary.text).toBe("❌ Import failed after 5s — BC (unknown error)");
  });

  it("all skipped_unchanged — reports 'already up to date', no absent-file note", () => {
    const results = [
      pipeline({ pipeline: "ds", status: "skipped_unchanged" }),
      pipeline({ pipeline: "cp", status: "skipped_unchanged" }),
    ];

    const summary = buildSummary(results, 3);

    expect(summary.ok).toBe(true);
    expect(summary.text).toBe("⏭️ All 2 pipelines already up to date in 3s — no changes since last run");
  });

  it("skipped_absent is called out by name, distinctly from skipped_unchanged — the exact bug this locks in", () => {
    // Regression guard: real backend statuses are always skipped_unchanged
    // (nothing changed) or skipped_absent (file missing from Drive entirely)
    // — never a bare "skipped". These are DIFFERENT problems (one is
    // routine, the other usually means something's actually wrong upstream)
    // and must never collapse into one indistinguishable "skipped" bucket.
    const results = [
      pipeline({ pipeline: "ds", status: "skipped_unchanged" }),
      pipeline({ pipeline: "bc", status: "skipped_absent" }),
    ];

    const summary = buildSummary(results, 8);

    expect(summary.ok).toBe(true);
    expect(summary.text).toBe(
      "⏭️ All 2 pipelines already up to date in 8s — no changes since last run — BC file not found in Drive"
    );
  });

  it("multiple skipped_absent pipelines pluralize 'files' correctly", () => {
    const results = [
      pipeline({ pipeline: "ds", status: "skipped_absent" }),
      pipeline({ pipeline: "bc", status: "skipped_absent" }),
    ];

    const summary = buildSummary(results, 4);

    expect(summary.text).toContain("DS, BC files not found in Drive");
  });

  it("mixed success + skipped — reports the 'updated' vs 'already up to date' breakdown", () => {
    const results = [
      pipeline({ pipeline: "ds", status: "success" }),
      pipeline({ pipeline: "cp", status: "skipped_unchanged" }),
      pipeline({ pipeline: "parc", status: "skipped_absent" }),
    ];

    const summary = buildSummary(results, 60);

    expect(summary.ok).toBe(true);
    // 1 updated (ds), 2 already up to date (cp skipped_unchanged + parc
    // skipped_absent both count toward the aggregate skipped total)...
    expect(summary.text).toBe(
      "✅ Import complete in 60s — 1 updated, 2 already up to date — PARC file not found in Drive"
    );
  });

  it("any failure takes priority over skipped/success accounting entirely", () => {
    const results = [
      pipeline({ pipeline: "ds", status: "success" }),
      pipeline({ pipeline: "cp", status: "skipped_unchanged" }),
      pipeline({
        pipeline: "bc",
        status: "failed",
        steps: [{ step: "parse", status: "failed", detail: "malformed row 42", timestamp: null }],
      }),
    ];

    const summary = buildSummary(results, 20);

    expect(summary.ok).toBe(false);
    expect(summary.text).toBe("❌ Import failed after 20s — BC (parse: malformed row 42)");
  });
});
