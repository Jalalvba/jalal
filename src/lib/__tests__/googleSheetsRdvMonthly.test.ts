import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocked before importing the module under test — same pattern as
// src/lib/__tests__/googleSheetsBdd.test.ts.
vi.mock("@/lib/sheets/googleSheetsClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sheets/googleSheetsClient")>("@/lib/sheets/googleSheetsClient");
  return {
    ...actual,
    getSheetsClient: vi.fn(),
  };
});

import { getSheetsClient, isoDateToSerial } from "@/lib/sheets/googleSheetsClient";
import { addAppointmentToMonthlyTab } from "@/lib/sheets/googleSheetsRdvMonthly";
import type { RdvAddInput } from "@/types";

const mockedGetSheetsClient = vi.mocked(getSheetsClient);

const HEADER_ROW = ["Date", "Heure", "Clients", "Véhicule", "Matricule", "Intervention", "Contact", "CONVOYEUR"];

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/** Same computation as resolveTargetTab()'s current-month branch, so the mocked tab name matches what the module will ask for. */
function currentMonthTabName(): { tabName: string; date: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return { tabName: `${MONTHS_FR[m]} ${y}`, date: `${y}-${String(m + 1).padStart(2, "0")}-15` };
}

const BASE_INPUT: Omit<RdvAddInput, "date"> = {
  heure: "10h",
  clients: "Client Test",
  vehicule: "Clio",
  matricule: "12345-B-6",
  intervention: "Révision",
  contact: "0600000000",
  convoyeur: "Ahmed",
};

/** One day block: header row + 3 data rows sharing dateSerial in column A, then a blank spacer row (block end). */
function buildTabValues(dateSerial: number, clientsFilled: boolean[]): unknown[][] {
  const rows: unknown[][] = [HEADER_ROW];
  for (const filled of clientsFilled) {
    rows.push([dateSerial, "9h", filled ? "Someone" : "", "", "", "", "", ""]);
  }
  rows.push(["", "", "", "", "", "", "", ""]); // spacer row, blank Date = block end
  return rows;
}

function fakeSheets(tabName: string, tabValues: unknown[][], recheckValue: unknown) {
  const valuesGet = vi.fn().mockImplementation(({ range }: { range: string }) => {
    // The single-cell recheck range has no ":" (e.g. 'Tab'!C3); the full-tab
    // read range does (e.g. 'Tab'!A1:H10).
    if (!range.includes(":")) {
      return Promise.resolve({ data: { values: [[recheckValue]] } });
    }
    return Promise.resolve({ data: { values: tabValues } });
  });
  const valuesUpdate = vi.fn().mockResolvedValue({});
  const sheets = {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: {
          sheets: [
            { properties: { title: tabName, sheetId: 1, gridProperties: { rowCount: tabValues.length } } },
          ],
        },
      }),
      batchUpdate: vi.fn().mockResolvedValue({}),
      values: { get: valuesGet, update: valuesUpdate },
    },
  };
  return { sheets, valuesGet, valuesUpdate };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("addAppointmentToMonthlyTab — empty-row race guard", () => {
  it("re-reads the empty row's Clients cell and refuses the write when another appointment has since taken it", async () => {
    const { tabName, date } = currentMonthTabName();
    const dateSerial = isoDateToSerial(date)!;
    // Row 2 of the block (data row index 1) is the empty slot findEmptyRow() will pick.
    const tabValues = buildTabValues(dateSerial, [true, false, true]);
    // The recheck finds it now occupied — a concurrent add won the race.
    const { sheets, valuesGet, valuesUpdate } = fakeSheets(tabName, tabValues, "Someone Else");
    mockedGetSheetsClient.mockReturnValue(sheets as never);

    const result = await addAppointmentToMonthlyTab({ ...BASE_INPUT, date });

    expect(result.written).toBe(false);
    if (!result.written) {
      expect(result.error).toMatch(/créneau|pris/i);
    }
    // The recheck ran (a single-cell get, distinguishable by no full-tab batch write following it).
    expect(valuesGet).toHaveBeenCalled();
    expect(valuesUpdate).not.toHaveBeenCalled();
  });

  it("writes the row when the recheck confirms it is still empty", async () => {
    const { tabName, date } = currentMonthTabName();
    const dateSerial = isoDateToSerial(date)!;
    const tabValues = buildTabValues(dateSerial, [true, false, true]);
    const { sheets, valuesUpdate } = fakeSheets(tabName, tabValues, "");
    mockedGetSheetsClient.mockReturnValue(sheets as never);

    const result = await addAppointmentToMonthlyTab({ ...BASE_INPUT, date });

    expect(result.written).toBe(true);
    expect(valuesUpdate).toHaveBeenCalledTimes(1);
  });
});
