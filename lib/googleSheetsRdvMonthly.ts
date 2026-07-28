import { type sheets_v4 } from "googleapis";
import type { RdvAddInput, MonthlyWriteResult } from "@/lib/types";
import { RDV_EDITABLE_FIELDS, RDV_CONVOYEURS } from "@/lib/types";
import { getSheetsClient, isoDateToSerial } from "@/lib/googleSheetsClient";

// Writes appointments into the monthly appointment-calendar tabs (e.g.
// "Juillet 2026") — the DURABLE source of truth, generated and periodically
// rebuilt by an external Google Apps Script bound to this spreadsheet (NOT
// the same file as GOOGLE_SHEETS_ID). That script's "Synchroniser"/"Mettre
// à jour" menu actions scrape ONLY these monthly tabs to wholesale rewrite
// the flat "RDV" mirror tab in the main AVIS spreadsheet — so anything
// written only to the flat tab (lib/googleSheetsRdv.ts) would be silently
// destroyed on the next sync. This module is always called BEFORE that
// flat-tab write, never instead of it (see addRdvRow() in
// lib/googleSheetsRdv.ts for the two-write orchestration).
//
// Row geometry, header text, and the CONVOYEUR/Matricule validation rules
// were all confirmed live against the real "Juillet 2026" tab (not just
// inferred from the generating script) before this was written.

const spreadsheetId = process.env.GOOGLE_RDV_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_RDV_SHEETS_ID in .env.local");

const MONTHS_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

const DEFAULT_HEURE = "9h";
const HEADERS: readonly string[] = RDV_EDITABLE_FIELDS;

type Block = { headerRow: number; dataStart: number; dataEnd: number };

/**
 * Only the current and next calendar month are in scope — matches the GAS
 * pipeline's own real-world scope (runDualMonthExecutionPipeline only ever
 * generates/regenerates those two tabs). Older/malformed tab names
 * (confirmed live: mixed casing, missing accents, slash-separated,
 * duplicated "Copie de ..." tabs) are deliberately NOT handled — fail loud
 * rather than guess.
 */
function resolveTargetTab(dateIso: string): { tabName: string } | { error: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso.trim());
  if (!m) return { error: `Date invalide: "${dateIso}" (attendu yyyy-mm-dd).` };
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return { error: `Mois invalide dans la date "${dateIso}".` };

  const now = new Date();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth();
  let nextY = curY;
  let nextM = curM + 1;
  if (nextM > 11) {
    nextM = 0;
    nextY++;
  }

  const inWindow = (year === curY && monthIndex === curM) || (year === nextY && monthIndex === nextM);
  if (!inWindow) {
    return {
      error: `La date "${dateIso}" est hors de la période gérée par cette fonctionnalité (mois actuel ou suivant uniquement).`,
    };
  }

  return { tabName: `${MONTHS_FR[monthIndex]} ${year}` };
}

async function getTabInfo(sheets: sheets_v4.Sheets, tabName: string): Promise<{ sheetId: number; rowCount: number } | null> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId!,
    fields: "sheets.properties",
  });
  const props = res.data.sheets?.find((s) => s.properties?.title === tabName)?.properties;
  if (!props || props.sheetId == null) return null;
  return { sheetId: props.sheetId, rowCount: props.gridProperties?.rowCount ?? 0 };
}

function isHeaderRow(row: unknown[]): boolean {
  if (!row || row.length < HEADERS.length) return false;
  for (let i = 0; i < HEADERS.length; i++) {
    if (String(row[i] ?? "").trim() !== HEADERS[i]) return false;
  }
  return true;
}

/**
 * Pattern-scans the whole tab for the header row whose following data rows'
 * Date column matches dateSerial, then grows the block downward while that
 * column keeps matching — this is how the block's true row count (16
 * weekday / 5 Saturday, or anything else) is discovered live rather than
 * assumed from CONFIG.STANDARD_ROWS_PER_DAY/SATURDAY_ROWS_PER_DAY. Every
 * data row (even blank appointment slots) has Date pre-filled by the
 * generating script — confirmed live — so a blank column A reliably marks
 * the first spacer row, i.e. the block's end.
 */
function findDayBlock(values: unknown[][], dateSerial: number): Block | null {
  for (let i = 0; i < values.length; i++) {
    if (!isHeaderRow(values[i])) continue;
    const firstDataIdx = i + 1;
    if (firstDataIdx >= values.length) continue;
    const firstDateRaw = values[firstDataIdx][0];
    if (typeof firstDateRaw !== "number" || firstDateRaw !== dateSerial) continue;

    let dataEndIdx = firstDataIdx;
    while (dataEndIdx + 1 < values.length && values[dataEndIdx + 1][0] === dateSerial) {
      dataEndIdx++;
    }
    return { headerRow: i + 1, dataStart: firstDataIdx + 1, dataEnd: dataEndIdx + 1 };
  }
  return null;
}

/** First row (top to bottom, so a manually-cleared slot gets reused) whose Clients column (C) is blank. */
function findEmptyRow(values: unknown[][], block: Block): number | null {
  for (let r = block.dataStart; r <= block.dataEnd; r++) {
    const row = values[r - 1] ?? [];
    const clients = row[2];
    if (clients == null || String(clients).trim() === "") return r;
  }
  return null;
}

function buildRowValues(input: RdvAddInput, dateSerial: number): (string | number)[] {
  return [
    dateSerial,
    input.heure.trim() || DEFAULT_HEURE,
    input.clients.trim(),
    input.vehicule.trim(),
    input.matricule.trim().toUpperCase(),
    input.intervention.trim(),
    input.contact.trim(),
    input.convoyeur.trim(),
  ];
}

/**
 * Reapplies the same two live data-validation rules (Matricule format,
 * CONVOYEUR dropdown) confirmed live on the surrounding rows, so a
 * fallback-inserted row behaves identically for anyone editing it directly
 * in the sheet afterward. Formula uses ";" as the argument separator — the
 * spreadsheet's locale is confirmed fr_FR, where "," is not a valid
 * function-argument separator.
 */
async function applyRowValidation(sheets: sheets_v4.Sheets, sheetId: number, row: number): Promise<void> {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId!,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 4, endColumnIndex: 5 },
            rule: {
              condition: {
                type: "CUSTOM_FORMULA",
                values: [
                  {
                    userEnteredValue: `=REGEXMATCH(TO_TEXT(E${row}); "^([0-9]{6}[A-Za-z]{2}|[0-9]{4,5}-[A-Za-z]-[0-9])$")`,
                  },
                ],
              },
              strict: false,
              inputMessage:
                "Format Matricule Incorrect !\n\nVeuillez respecter l'une des structures suivantes :\n- Exemple 1 : 980867WW (6 chiffres suivis de 2 lettres)\n- Exemple 2 : 79421-B-7 ou 3929-T-1 (4 à 5 chiffres - 1 lettre - 1 chiffre)",
            },
          },
        },
        {
          setDataValidation: {
            range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 7, endColumnIndex: 8 },
            rule: {
              condition: {
                type: "ONE_OF_LIST",
                values: RDV_CONVOYEURS.map((name) => ({ userEnteredValue: name })),
              },
              strict: false,
              showCustomUi: true,
              inputMessage: "Nom du convoyeur invalide. Veuillez sélectionner un nom exact dans la liste déroulante officielle.",
            },
          },
        },
      ],
    },
  });
}

/**
 * Grows a fully-booked block by one row via insertDimension, immediately
 * after the block's last data row (i.e. exactly where the first of the 3
 * trailing spacer rows currently sits). This is a pure row-shift: the 3
 * spacer rows and every later day's title/header/data/spacer rows move
 * down by one, unchanged, with no risk of bleeding into the next day's
 * title row. inheritFromBefore copies formatting from the last real data
 * row (zebra/border/wrap), not the blank spacer row that follows it.
 */
async function insertFallbackRow(
  sheets: sheets_v4.Sheets,
  tabName: string,
  sheetId: number,
  block: Block,
  input: RdvAddInput,
  dateSerial: number
): Promise<number> {
  // Defensive re-check narrows (doesn't eliminate) the race window between
  // the full-tab read and this structural mutation. Single-authorized-user
  // app + existing 30 req/min rate limiting keeps true concurrent inserts
  // low-probability; not worth a distributed lock for that residual risk.
  const recheck = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${tabName}'!C${block.dataEnd}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const stillFull = String(recheck.data.values?.[0]?.[0] ?? "").trim() !== "";
  if (!stillFull) {
    throw new Error("Row freed up between read and write — retry the add.");
  }

  const startIndex = block.dataEnd; // 0-based == last data row's 1-based number
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId!,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: { sheetId, dimension: "ROWS", startIndex, endIndex: startIndex + 1 },
            inheritFromBefore: true,
          },
        },
      ],
    },
  });

  const newRow = block.dataEnd + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId!,
    range: `'${tabName}'!A${newRow}:H${newRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [buildRowValues(input, dateSerial)] },
  });

  await applyRowValidation(sheets, sheetId, newRow);

  return newRow;
}

export async function addAppointmentToMonthlyTab(input: RdvAddInput): Promise<MonthlyWriteResult> {
  const resolved = resolveTargetTab(input.date);
  if ("error" in resolved) return { written: false, error: resolved.error };
  const { tabName } = resolved;

  const dateSerial = isoDateToSerial(input.date);
  if (dateSerial == null) {
    return { written: false, error: `Date invalide: "${input.date}" (attendu yyyy-mm-dd).` };
  }

  const sheets = getSheetsClient();
  const tabInfo = await getTabInfo(sheets, tabName);
  if (!tabInfo) {
    return {
      written: false,
      error: `L'onglet "${tabName}" n'existe pas encore — lancez "Synchroniser" dans le calendrier avant d'ajouter un rendez-vous pour cette date.`,
    };
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${tabName}'!A1:H${tabInfo.rowCount}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const values = res.data.values ?? [];

  const block = findDayBlock(values, dateSerial);
  if (!block) {
    return {
      written: false,
      error: `Aucun bloc trouvé pour le ${input.date} dans l'onglet "${tabName}" (dimanche, ou date hors du mois).`,
    };
  }

  const emptyRow = findEmptyRow(values, block);
  if (emptyRow != null) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId!,
      range: `'${tabName}'!A${emptyRow}:H${emptyRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [buildRowValues(input, dateSerial)] },
    });
    return { written: true, tab: tabName, row: emptyRow };
  }

  const newRow = await insertFallbackRow(sheets, tabName, tabInfo.sheetId, block, input, dateSerial);
  return { written: true, tab: tabName, row: newRow };
}
