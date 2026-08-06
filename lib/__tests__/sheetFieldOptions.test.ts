import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocked BEFORE importing the module under test — vitest hoists vi.mock()
// calls above imports automatically. This is the exact path that was only
// verified by code review in the session that wrote it, specifically
// because testing it against real production Mongo felt too risky; these
// mocks close that gap without touching a real database.
vi.mock("@/lib/mongo", () => ({
  getCollection: vi.fn(),
}));
vi.mock("@/lib/googleSheetsClient", () => ({
  // Passthrough — isolates this test from whether Next's unstable_cache
  // behaves outside a real request context, which isn't what's under test
  // here (that's withCache's own concern, not getAllSheetFieldOptions's).
  withCache: (_key: string, _ttlMs: number, fn: () => unknown) => fn(),
  invalidateCache: vi.fn(),
}));

import { getCollection } from "@/lib/mongo";
import { invalidateCache } from "@/lib/googleSheetsClient";
import {
  getAllSheetFieldOptions,
  updateFieldOptions,
  OptionsValidationError,
} from "@/lib/sheetFieldOptions";
import {
  EMPLACEMENT_OPTIONS_FALLBACK,
  TECHNICIEN_OPTIONS_FALLBACK,
  FLAG_OPTIONS_FALLBACK,
} from "@/lib/types";

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
            { _id: "TECHNICIEN_OPTIONS", key: "TECHNICIEN_OPTIONS", type: "plain", options: ["NEW GUY"] },
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
            { _id: "TECHNICIEN_OPTIONS", key: "TECHNICIEN_OPTIONS", type: "plain", options: ["NEW GUY"] },
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

describe("updateFieldOptions — validation", () => {
  function fakeCollection() {
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    mockedGetCollection.mockResolvedValue({ updateOne } as never);
    return updateOne;
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
    const updateOne = fakeCollection();

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
});
