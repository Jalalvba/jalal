import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocked BEFORE importing the module under test — vitest hoists vi.mock()
// calls above imports automatically. This is the exact path that was only
// verified by code review in the session that wrote it, specifically
// because testing it against real production Mongo felt too risky; these
// mocks close that gap without touching a real database.
vi.mock("@/lib/mongo/client", () => ({
  getCollection: vi.fn(),
}));
vi.mock("@/lib/sheets/googleSheetsClient", () => ({
  // Passthrough — isolates this test from whether Next's unstable_cache
  // behaves outside a real request context, which isn't what's under test
  // here (that's withCache's own concern, not getAllSheetFieldOptions's).
  withCache: (_key: string, _ttlMs: number, fn: () => unknown) => fn(),
  invalidateCache: vi.fn(),
}));

import { getCollection } from "@/lib/mongo/client";
import { invalidateCache } from "@/lib/sheets/googleSheetsClient";
import {
  getAllSheetFieldOptions,
  getAllSheetFieldOptionsWithStatus,
  getFallbackOptions,
  updateFieldOptions,
  OptionsValidationError,
  OptionsConflictError,
} from "@/lib/mongo/sheetFieldOptions";
import {
  EMPLACEMENT_OPTIONS_FALLBACK,
  TECHNICIEN_OPTIONS_FALLBACK,
  FLAG_OPTIONS_FALLBACK,
} from "@/types";

const mockedGetCollection = vi.mocked(getCollection);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAllSheetFieldOptions — fallback on Mongo failure", () => {
  it("getCollection rejecting entirely returns the full hardcoded fallback, not a thrown error", async () => {
    mockedGetCollection.mockRejectedValue(new Error("MongoServerSelectionError: Server selection timed out"));

    const options = await getAllSheetFieldOptions();

    expect(options.EMPLACEMENT_OPTIONS).toEqual(EMPLACEMENT_OPTIONS_FALLBACK);
    expect(options.TECHNICIEN_OPTIONS).toEqual(TECHNICIEN_OPTIONS_FALLBACK);
    expect(options.FLAG_OPTIONS).toEqual(FLAG_OPTIONS_FALLBACK);
  });

  it("getCollection resolving but .find().toArray() rejecting also falls back cleanly", async () => {
    mockedGetCollection.mockResolvedValue({
      find: () => ({ toArray: () => Promise.reject(new Error("MongoNetworkError: connection closed")) }),
    } as never);

    const options = await getAllSheetFieldOptions();

    expect(options.EMPLACEMENT_OPTIONS).toEqual(EMPLACEMENT_OPTIONS_FALLBACK);
    expect(options.TECHNICIEN_OPTIONS).toEqual(TECHNICIEN_OPTIONS_FALLBACK);
  });

  it("a real Mongo response is used in place of the fallback", async () => {
    mockedGetCollection.mockResolvedValue({
      find: () => ({
        toArray: () =>
          Promise.resolve([
            { _id: "TECHNICIEN_OPTIONS", key: "TECHNICIEN_OPTIONS", type: "plain", options: ["NEW GUY"], updatedAt: new Date("2026-01-01T00:00:00.000Z"), updatedBy: "test" },
          ]),
      }),
    } as never);

    const options = await getAllSheetFieldOptions();

    expect(options.TECHNICIEN_OPTIONS).toEqual(["NEW GUY"]);
  });

  it("a key with no Mongo document yet falls back for that key ONLY — other keys still come from Mongo", async () => {
    mockedGetCollection.mockResolvedValue({
      find: () => ({
        toArray: () =>
          Promise.resolve([
            { _id: "TECHNICIEN_OPTIONS", key: "TECHNICIEN_OPTIONS", type: "plain", options: ["NEW GUY"], updatedAt: new Date("2026-01-01T00:00:00.000Z"), updatedBy: "test" },
            // EMPLACEMENT_OPTIONS has no document at all — e.g. seed script
            // hasn't run yet for it.
          ]),
      }),
    } as never);

    const options = await getAllSheetFieldOptions();

    expect(options.TECHNICIEN_OPTIONS).toEqual(["NEW GUY"]);
    expect(options.EMPLACEMENT_OPTIONS).toEqual(EMPLACEMENT_OPTIONS_FALLBACK);
  });
});

describe("getAllSheetFieldOptionsWithStatus — degraded flag (C2)", () => {
  // Regression guard for the admin-config bug found in the audit: the GET
  // response must be able to tell "Mongo unreachable, serving hardcoded
  // fallback" apart from a normal healthy read, so /admin/config can block
  // edits rather than silently accept a write built on fallback data.
  it("Mongo unreachable -> degraded: true, and every key's meta is null", async () => {
    mockedGetCollection.mockRejectedValue(new Error("MongoServerSelectionError: Server selection timed out"));

    const { options, degraded, meta } = await getAllSheetFieldOptionsWithStatus();

    expect(degraded).toBe(true);
    expect(options.EMPLACEMENT_OPTIONS).toEqual(EMPLACEMENT_OPTIONS_FALLBACK);
    expect(meta.EMPLACEMENT_OPTIONS).toBeNull();
    expect(meta.TECHNICIEN_OPTIONS).toBeNull();
  });

  it("a healthy read -> degraded: false, even if some individual keys fall back for lack of a document yet", async () => {
    mockedGetCollection.mockResolvedValue({
      find: () => ({
        toArray: () =>
          Promise.resolve([
            { _id: "TECHNICIEN_OPTIONS", key: "TECHNICIEN_OPTIONS", type: "plain", options: ["NEW GUY"], updatedAt: new Date("2026-01-01T00:00:00.000Z"), updatedBy: "test" },
            // EMPLACEMENT_OPTIONS has no document at all — normal pre-seed
            // state, NOT a Mongo outage.
          ]),
      }),
    } as never);

    const { degraded, meta } = await getAllSheetFieldOptionsWithStatus();

    expect(degraded).toBe(false);
    expect(meta.TECHNICIEN_OPTIONS).toBe("2026-01-01T00:00:00.000Z");
    expect(meta.EMPLACEMENT_OPTIONS).toBeNull(); // no document yet, but this alone isn't "degraded"
  });

  it("getFallbackOptions() returns a deep copy, not a reference to the shared fallback (M9)", () => {
    const a = getFallbackOptions();
    const b = getFallbackOptions();
    a.TECHNICIEN_OPTIONS.push("MUTATED");
    expect(b.TECHNICIEN_OPTIONS).not.toContain("MUTATED");
  });
});

describe("updateFieldOptions — validation", () => {
  // Dispatches on collection name so the options write and the history
  // append are separately observable — they are different collections.
  function fakeCollection(previous: unknown = null) {
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const findOne = vi.fn().mockResolvedValue(previous);
    const insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
    mockedGetCollection.mockImplementation(
      async (name: string) =>
        (name === "sheetFieldOptionsHistory" ? { insertOne } : { updateOne, findOne }) as never
    );
    return { updateOne, findOne, insertOne };
  }

  it("rejects an empty options array", async () => {
    fakeCollection();
    await expect(updateFieldOptions({ key: "EMPLACEMENT_OPTIONS", options: [] }, "test@example.com")).rejects.toBeInstanceOf(
      OptionsValidationError
    );
  });

  it("rejects a duplicate value within the same list", async () => {
    fakeCollection();
    await expect(
      updateFieldOptions({ key: "EMPLACEMENT_OPTIONS", options: ["ATELIER", "ATELIER"] }, "test@example.com")
    ).rejects.toThrow(/double/);
  });

  it("rejects a color outside the defined palette for a colored option-set", async () => {
    fakeCollection();
    await expect(
      updateFieldOptions(
        { key: "FLAG_OPTIONS", options: [{ value: "Urgent", color: "chartreuse" as never }] },
        "test@example.com"
      )
    ).rejects.toThrow(/[Cc]ouleur/);
  });

  it("a valid write reaches Mongo with the right shape and invalidates the cache", async () => {
    const { updateOne } = fakeCollection();

    await updateFieldOptions({ key: "EMPLACEMENT_OPTIONS", options: ["ATELIER", "PARKING"] }, "test@example.com");

    expect(updateOne).toHaveBeenCalledWith(
      { _id: "EMPLACEMENT_OPTIONS" },
      {
        $set: expect.objectContaining({
          _id: "EMPLACEMENT_OPTIONS",
          type: "plain",
          options: ["ATELIER", "PARKING"],
          updatedBy: "test@example.com",
        }),
      },
      { upsert: true }
    );
    expect(invalidateCache).toHaveBeenCalledWith("sheetFieldOptions:all");
  });

  it("trims values before storage (I2 — trim-consistency), not just before the duplicate check", async () => {
    const { updateOne } = fakeCollection();

    // Route-layer trimming (src/app/api/config/options/route.ts) is what
    // actually strips this in production; this asserts updateFieldOptions
    // itself doesn't silently re-introduce untrimmed storage if called
    // directly with an already-untrimmed value from elsewhere.
    await updateFieldOptions({ key: "EMPLACEMENT_OPTIONS", options: ["ATELIER"] }, "test@example.com");

    expect(updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ options: ["ATELIER"] }) }),
      expect.anything()
    );
  });
});

describe("updateFieldOptions — options history", () => {
  function fakeCollection(previous: unknown = null) {
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const findOne = vi.fn().mockResolvedValue(previous);
    const insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
    mockedGetCollection.mockImplementation(
      async (name: string) =>
        (name === "sheetFieldOptionsHistory" ? { insertOne } : { updateOne, findOne }) as never
    );
    return { updateOne, findOne, insertOne };
  }

  it("captures the outgoing list, which a whole-set replace would otherwise destroy", async () => {
    const { insertOne } = fakeCollection({
      _id: "EMPLACEMENT_OPTIONS",
      key: "EMPLACEMENT_OPTIONS",
      label: "Emplacement",
      type: "plain",
      options: ["ATELIER", "PARKING", "DEPOT"],
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedBy: "someone@example.com",
    });

    // DEPOT is dropped — the value this whole feature exists to preserve.
    await updateFieldOptions(
      { key: "EMPLACEMENT_OPTIONS", options: ["ATELIER", "PARKING"] },
      "test@example.com"
    );

    expect(insertOne).toHaveBeenCalledOnce();
    const row = insertOne.mock.calls[0][0];
    expect(row.key).toBe("EMPLACEMENT_OPTIONS");
    expect(row.changedBy).toBe("test@example.com");
    expect(row.previous.options).toEqual(["ATELIER", "PARKING", "DEPOT"]);
    expect(row.previous.updatedBy).toBe("someone@example.com");
    expect(row.next.options).toEqual(["ATELIER", "PARKING"]);
  });

  it("records previous: null on the first write for a key (nothing was replaced)", async () => {
    const { insertOne } = fakeCollection(null);

    await updateFieldOptions({ key: "EMPLACEMENT_OPTIONS", options: ["ATELIER"] }, "test@example.com");

    expect(insertOne.mock.calls[0][0].previous).toBeNull();
  });

  it("a history-append failure does not fail the user's save — the write already landed", async () => {
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const findOne = vi.fn().mockResolvedValue(null);
    mockedGetCollection.mockImplementation(async (name: string) => {
      if (name === "sheetFieldOptionsHistory") throw new Error("MongoNetworkError: history unreachable");
      return { updateOne, findOne } as never;
    });

    await expect(
      updateFieldOptions({ key: "EMPLACEMENT_OPTIONS", options: ["ATELIER"] }, "test@example.com")
    ).resolves.toBeUndefined();

    expect(updateOne).toHaveBeenCalledOnce();
    expect(invalidateCache).toHaveBeenCalledWith("sheetFieldOptions:all");
  });

  it("a failed pre-read degrades to previous: null rather than blocking the save", async () => {
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const findOne = vi.fn().mockRejectedValue(new Error("MongoNetworkError"));
    const insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
    mockedGetCollection.mockImplementation(
      async (name: string) =>
        (name === "sheetFieldOptionsHistory" ? { insertOne } : { updateOne, findOne }) as never
    );

    await updateFieldOptions({ key: "EMPLACEMENT_OPTIONS", options: ["ATELIER"] }, "test@example.com");

    expect(updateOne).toHaveBeenCalledOnce();
    expect(insertOne.mock.calls[0][0].previous).toBeNull();
  });
});

describe("updateFieldOptions — optimistic concurrency (C2)", () => {
  function fakeCollectionWithFilterCheck(behavior: "match" | "conflict") {
    const updateOne = vi.fn().mockImplementation(async () => {
      if (behavior === "conflict") {
        const err = new Error("E11000 duplicate key error") as Error & { code: number };
        err.code = 11000;
        throw err;
      }
      return { acknowledged: true, matchedCount: 1, upsertedCount: 0 };
    });
    const findOne = vi.fn().mockResolvedValue(null);
    const insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
    mockedGetCollection.mockImplementation(
      async (name: string) =>
        (name === "sheetFieldOptionsHistory" ? { insertOne } : { updateOne, findOne }) as never
    );
    return { updateOne, insertOne };
  }

  it("a write whose expectedUpdatedAt matches the live document succeeds", async () => {
    const { updateOne } = fakeCollectionWithFilterCheck("match");

    await updateFieldOptions(
      { key: "EMPLACEMENT_OPTIONS", options: ["ATELIER"] },
      "test@example.com",
      "2026-01-01T00:00:00.000Z"
    );

    expect(updateOne).toHaveBeenCalledWith(
      { _id: "EMPLACEMENT_OPTIONS", updatedAt: new Date("2026-01-01T00:00:00.000Z") },
      expect.anything(),
      { upsert: true }
    );
  });

  it("a write whose expectedUpdatedAt no longer matches (someone else wrote since) throws OptionsConflictError, not a silent overwrite", async () => {
    fakeCollectionWithFilterCheck("conflict");

    await expect(
      updateFieldOptions(
        { key: "EMPLACEMENT_OPTIONS", options: ["ATELIER"] },
        "test@example.com",
        "2026-01-01T00:00:00.000Z" // stale — the live doc has since moved on
      )
    ).rejects.toBeInstanceOf(OptionsConflictError);
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("a rejected (conflicting) write appends NO history row — history records what actually landed", async () => {
    const { insertOne } = fakeCollectionWithFilterCheck("conflict");

    await expect(
      updateFieldOptions(
        { key: "EMPLACEMENT_OPTIONS", options: ["ATELIER"] },
        "test@example.com",
        "2026-01-01T00:00:00.000Z"
      )
    ).rejects.toBeInstanceOf(OptionsConflictError);

    expect(insertOne).not.toHaveBeenCalled();
  });

  it("expectedUpdatedAt: null (caller believes no document exists yet) also detects a conflict if one now does", async () => {
    fakeCollectionWithFilterCheck("conflict");

    await expect(
      updateFieldOptions({ key: "EMPLACEMENT_OPTIONS", options: ["ATELIER"] }, "test@example.com", null)
    ).rejects.toBeInstanceOf(OptionsConflictError);
  });

  it("omitting expectedUpdatedAt entirely preserves the old unconditional-overwrite behavior (backward compat)", async () => {
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const findOne = vi.fn().mockResolvedValue(null);
    const insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
    mockedGetCollection.mockImplementation(
      async (name: string) =>
        (name === "sheetFieldOptionsHistory" ? { insertOne } : { updateOne, findOne }) as never
    );

    await updateFieldOptions({ key: "EMPLACEMENT_OPTIONS", options: ["ATELIER"] }, "test@example.com");

    expect(updateOne).toHaveBeenCalledWith({ _id: "EMPLACEMENT_OPTIONS" }, expect.anything(), { upsert: true });
  });
});
