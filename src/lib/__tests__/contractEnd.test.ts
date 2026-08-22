import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/mongo/client", () => ({ getCollection: vi.fn() }));
vi.mock("@/lib/sheets/googleSheetsBdd", () => ({ getSheetRows: vi.fn() }));

import { resolveContractEnd, parseSheetDate } from "@/lib/vehicle/contractEnd";
import { getCollection } from "@/lib/mongo/client";
import { getSheetRows } from "@/lib/sheets/googleSheetsBdd";

const mockedCollection = vi.mocked(getCollection);
const mockedRows = vi.mocked(getSheetRows);

function cpReturning(doc: unknown) {
  mockedCollection.mockResolvedValue({ findOne: vi.fn().mockResolvedValue(doc) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  cpReturning(null);
  mockedRows.mockResolvedValue([]);
});

describe("parseSheetDate — dd/mm/yyyy, explicitly", () => {
  it("reads 01/05/2028 as 1 May, not 5 January", () => {
    // new Date("01/05/2028") is 5 January in a US locale. A contract flag that
    // moves by four months depending on where the code runs is worse than no
    // flag, which is why this parse is explicit.
    expect(parseSheetDate("01/05/2028")).toBe("2028-05-01T00:00:00.000Z");
  });

  it("accepts a single-digit day and month", () => {
    expect(parseSheetDate("1/5/2028")).toBe("2028-05-01T00:00:00.000Z");
  });

  it("returns null for anything else rather than guessing", () => {
    for (const v of ["", "2028-05-01", "mai 2028", null, undefined, 45678]) {
      expect(parseSheetDate(v)).toBeNull();
    }
  });
});

describe("resolveContractEnd", () => {
  it("keeps what the caller already resolved", async () => {
    const iso = "2027-07-03T00:00:00.000Z";
    expect(await resolveContractEnd("39357-B-7", iso)).toBe(iso);
    expect(mockedCollection).not.toHaveBeenCalled();
  });

  it("falls back to cp when the caller sent nothing", async () => {
    cpReturning({ date_fin_contrat: new Date("2027-07-03T00:00:00.000Z") });
    expect(await resolveContractEnd("39357-B-7", null)).toBe("2027-07-03T00:00:00.000Z");
  });

  it("falls back to the BDD sheet when cp has no document for the plate", async () => {
    // 71374-B-7 exactly: a BDD row stating 01/05/2028, and no cp document at
    // all. Before this fallback the analysis said "contrat inconnu" about a
    // vehicle whose contract end is on the very card being looked at.
    mockedRows.mockResolvedValue([{ date_fin_contrat: "01/05/2028" }] as never);
    expect(await resolveContractEnd("71374-B-7", null)).toBe("2028-05-01T00:00:00.000Z");
  });

  it("returns null when no source knows — never invents one", async () => {
    expect(await resolveContractEnd("00000-X-0", null)).toBeNull();
  });

  it("degrades to null instead of throwing when a lookup fails", async () => {
    // The user is waiting on an analysis; a Mongo hiccup must cost the
    // contract line, not the analysis.
    mockedCollection.mockRejectedValue(new Error("mongo down"));
    mockedRows.mockRejectedValue(new Error("sheets down"));
    expect(await resolveContractEnd("39357-B-7", null)).toBeNull();
  });
});
