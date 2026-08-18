import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocked before importing the module under test (vitest hoists vi.mock()
// above imports) — same pattern as lib/__tests__/sheetFieldOptions.test.ts.
vi.mock("@/lib/googleSheetsClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/googleSheetsClient")>("@/lib/googleSheetsClient");
  return {
    ...actual,
    getSheetsClient: vi.fn(),
    withCache: (_key: string, _ttlMs: number, fn: () => unknown) => fn(),
    invalidateCache: vi.fn(),
    verifyRowIdentity: vi.fn(),
  };
});

import { getSheetsClient, verifyRowIdentity } from "@/lib/googleSheetsClient";
import { updateSheetRow, deleteBddRow } from "@/lib/googleSheetsBdd";

const mockedGetSheetsClient = vi.mocked(getSheetsClient);
const mockedVerifyRowIdentity = vi.mocked(verifyRowIdentity);

function fakeSheets(headerRow: string[]) {
  const batchUpdate = vi.fn().mockResolvedValue({});
  const valuesGet = vi.fn().mockResolvedValue({ data: { values: [headerRow] } });
  const sheets = {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({ data: { sheets: [{ properties: { title: "BDD", sheetId: 1 } }] } }),
      batchUpdate: vi.fn().mockResolvedValue({}),
      values: {
        get: valuesGet,
        batchUpdate,
      },
    },
  };
  return { sheets, batchUpdate, valuesGet };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedVerifyRowIdentity.mockResolvedValue(undefined);
});

describe("updateSheetRow — row-identity safety", () => {
  it("calls verifyRowIdentity with the expected IMM before writing, same as every other write path", async () => {
    const headers = ["IMM", "date", "client", "modele", "ETAT", "prestataire", "flag", "Emplacement", "commentaire", "Catégorie", "Technicien"];
    const { sheets, batchUpdate } = fakeSheets(headers);
    mockedGetSheetsClient.mockReturnValue(sheets as never);

    await updateSheetRow(42, { commentaire: "hello" }, "12345-B-6");

    expect(mockedVerifyRowIdentity).toHaveBeenCalledTimes(1);
    expect(mockedVerifyRowIdentity).toHaveBeenCalledWith(
      sheets,
      expect.any(String),
      expect.stringContaining("42"),
      "12345-B-6"
    );
    // verifyRowIdentity must run BEFORE the write, not after.
    const verifyOrder = mockedVerifyRowIdentity.mock.invocationCallOrder[0];
    const writeOrder = batchUpdate.mock.invocationCallOrder[0];
    expect(verifyOrder).toBeLessThan(writeOrder);
  });

  it("refuses the write (does not call batchUpdate) when verifyRowIdentity rejects — stale row", async () => {
    const headers = ["IMM", "commentaire"];
    const { sheets, batchUpdate } = fakeSheets(headers);
    mockedGetSheetsClient.mockReturnValue(sheets as never);
    mockedVerifyRowIdentity.mockRejectedValue(new Error("row identity mismatch"));

    await expect(updateSheetRow(42, { commentaire: "hello" }, "12345-B-6")).rejects.toThrow();
    expect(batchUpdate).not.toHaveBeenCalled();
  });
});

describe("updateSheetRow — BDD_EDITABLE_FIELDS allowlist enforcement", () => {
  // Called out by name (alongside deleteBddRow's verifyRowIdentity gap) in
  // the audit's mutation-testing list — not one of the 4 explicitly
  // required test-suite-gap items, but closing it for completeness since
  // it's in the same paragraph.
  it("rejects a field not in BDD_EDITABLE_FIELDS — does not reach verifyRowIdentity or batchUpdate at all", async () => {
    const headers = ["IMM", "date", "commentaire", "ds"]; // "ds" is a read-only XLOOKUP column, never editable
    const { sheets, batchUpdate } = fakeSheets(headers);
    mockedGetSheetsClient.mockReturnValue(sheets as never);

    const result = await updateSheetRow(42, { ds: "should not be writable" }, "12345-B-6");

    expect(result.ok).toBe(false);
    expect(mockedVerifyRowIdentity).not.toHaveBeenCalled();
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it("accepts a real editable field (commentaire) unchanged", async () => {
    const headers = ["IMM", "commentaire"];
    const { sheets, batchUpdate } = fakeSheets(headers);
    mockedGetSheetsClient.mockReturnValue(sheets as never);

    const result = await updateSheetRow(42, { commentaire: "hello" }, "12345-B-6");

    expect(result.ok).toBe(true);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("deleteBddRow — row-identity safety (existing behavior, locked in)", () => {
  it("calls verifyRowIdentity before issuing the row deletion", async () => {
    const headers = ["IMM", "commentaire"];
    const { sheets } = fakeSheets(headers);
    mockedGetSheetsClient.mockReturnValue(sheets as never);

    await deleteBddRow(42, "12345-B-6");

    expect(mockedVerifyRowIdentity).toHaveBeenCalledWith(
      sheets,
      expect.any(String),
      expect.stringContaining("42"),
      "12345-B-6"
    );
  });
});
