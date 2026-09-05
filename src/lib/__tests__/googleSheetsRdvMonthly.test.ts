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
import { addAppointmentToMonthlyTab, moveAppointment } from "@/lib/sheets/googleSheetsRdvMonthly";
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

describe("moveAppointment — write-then-clear composition", () => {
  /** "Second day of the current month" — deliberately different from currentMonthTabName()'s "15", so old/new occupy distinct blocks within the same tab. */
  function secondDayIso(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    return `${y}-${String(m + 1).padStart(2, "0")}-02`;
  }

  function colIndex(letter: string): number {
    return letter.charCodeAt(0) - "A".charCodeAt(0);
  }

  /** Two day blocks in one tab: the OLD date has one occupied row matching BASE_INPUT's identity, the NEW date has one empty row. */
  function buildMoveTabValues(oldSerial: number, newSerial: number): unknown[][] {
    return [
      HEADER_ROW,
      [oldSerial, BASE_INPUT.heure, BASE_INPUT.clients, BASE_INPUT.vehicule, BASE_INPUT.matricule, BASE_INPUT.intervention, BASE_INPUT.contact, BASE_INPUT.convoyeur],
      ["", "", "", "", "", "", "", ""], // spacer — end of old block
      HEADER_ROW,
      [newSerial, "9h", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""], // spacer — end of new block
    ];
  }

  /**
   * Generic single-cell mock: any no-colon range (e.g. 'Tab'!E2) resolves by
   * reading straight out of tabValues at that cell, so both the H1 empty-row
   * recheck and verifyMonthlyRowIdentity's key-cell recheck reflect the SAME
   * fixture as the full-tab read by default (nothing changed between reads —
   * the ordinary case). `overrides` forces a specific cell to a different
   * value, for the race/mismatch tests.
   */
  function fakeMoveSheets(tabName: string, tabValues: unknown[][], overrides: Record<string, unknown> = {}) {
    const valuesGet = vi.fn().mockImplementation(({ range }: { range: string }) => {
      if (range in overrides) return Promise.resolve({ data: { values: [[overrides[range]]] } });
      const m = /!([A-H])(\d+)$/.exec(range);
      if (m) {
        const row = Number(m[2]);
        const col = colIndex(m[1]);
        return Promise.resolve({ data: { values: [[tabValues[row - 1]?.[col] ?? ""]] } });
      }
      return Promise.resolve({ data: { values: tabValues } });
    });
    const valuesUpdate = vi.fn().mockResolvedValue({});
    const batchClear = vi.fn().mockResolvedValue({});
    const sheets = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: { sheets: [{ properties: { title: tabName, sheetId: 1, gridProperties: { rowCount: tabValues.length } } }] },
        }),
        batchUpdate: vi.fn().mockResolvedValue({}),
        values: { get: valuesGet, update: valuesUpdate, batchClear },
      },
    };
    return { sheets, valuesGet, valuesUpdate, batchClear };
  }

  it("rejects a move to the same date without touching the sheet", async () => {
    const { date } = currentMonthTabName();
    const result = await moveAppointment({ ...BASE_INPUT, date }, date);

    expect(result.moved).toBe(false);
    expect(mockedGetSheetsClient).not.toHaveBeenCalled();
  });

  it("writes the new slot THEN clears the old one, in that order (happy path)", async () => {
    const { tabName, date: oldDate } = currentMonthTabName();
    const newDate = secondDayIso();
    const oldSerial = isoDateToSerial(oldDate)!;
    const newSerial = isoDateToSerial(newDate)!;
    const tabValues = buildMoveTabValues(oldSerial, newSerial);
    const { sheets, valuesUpdate, batchClear } = fakeMoveSheets(tabName, tabValues);
    mockedGetSheetsClient.mockReturnValue(sheets as never);

    const result = await moveAppointment({ ...BASE_INPUT, date: oldDate }, newDate);

    expect(result.moved).toBe(true);
    if (result.moved) {
      expect(result.tab).toBe(tabName);
      expect(result.row).toBe(5); // the new block's data row
    }
    expect(valuesUpdate).toHaveBeenCalledTimes(1);
    expect(batchClear).toHaveBeenCalledTimes(1);
    expect(batchClear.mock.calls[0][0].requestBody.ranges[0]).toContain("C2:H2"); // the old block's data row
    // Write-then-clear, never the reverse.
    expect(valuesUpdate.mock.invocationCallOrder[0]).toBeLessThan(batchClear.mock.invocationCallOrder[0]);
  });

  it("leaves everything untouched when the write into the new slot fails", async () => {
    const { date: oldDate } = currentMonthTabName();
    // Six months out is outside resolveTargetTab's current/next-month window
    // — addAppointmentToMonthlyTab fails before reading anything.
    const now = new Date();
    const farYear = now.getUTCFullYear() + 1;
    const newDate = `${farYear}-06-15`;

    const result = await moveAppointment({ ...BASE_INPUT, date: oldDate }, newDate);

    expect(result.moved).toBe(false);
    if (!result.moved) expect(result.duplicate).toBeUndefined();
    // Nothing was ever touched — resolveTargetTab rejected before any sheets call.
    expect(mockedGetSheetsClient).not.toHaveBeenCalled();
  });

  it("reports a duplicate, distinctly logged, when the write succeeds but the clear fails", async () => {
    const { tabName, date: oldDate } = currentMonthTabName();
    const newDate = secondDayIso();
    const oldSerial = isoDateToSerial(oldDate)!;
    const newSerial = isoDateToSerial(newDate)!;
    const tabValues = buildMoveTabValues(oldSerial, newSerial);
    // Force verifyMonthlyRowIdentity's key-cell recheck (Matricule, column E,
    // old block's data row 2) to mismatch — the old row "changed" between
    // resolve and clear, so clearAppointmentInMonthlyTab fails after the new
    // slot has already been written.
    const { sheets, valuesUpdate, batchClear } = fakeMoveSheets(tabName, tabValues, {
      [`'${tabName}'!E2`]: "SOMETHING-ELSE",
    });
    mockedGetSheetsClient.mockReturnValue(sheets as never);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await moveAppointment({ ...BASE_INPUT, date: oldDate }, newDate);

    expect(result.moved).toBe(false);
    if (!result.moved) {
      expect(result.duplicate).toBe(true);
      // Both locations named explicitly, per the confirmed UX requirement.
      expect(result.error).toContain(tabName); // new location
      expect(result.error).toContain("5"); // new row
      expect(result.error).toContain(tabName); // old location (same tab here)
      expect(result.error).toContain("2"); // old row
    }
    expect(valuesUpdate).toHaveBeenCalledTimes(1); // the new slot WAS written
    expect(batchClear).not.toHaveBeenCalled(); // the old slot was never cleared
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[RDV] DUPLICATE APPOINTMENT"));

    consoleErrorSpy.mockRestore();
  });
});
