export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/rateLimit";
import { toErrorResponse } from "@/lib/apiError";

// Same rate-limit bucket sizing as app/api/bdd/export's PDF export — this is
// also a read-only report generator, not a Sheets mutation.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 5 * 60 * 1000;

// Same defensive caps as the PDF export route (app/api/bdd/export/route.ts)
// — kept in sync deliberately, not derived, since the two routes validate
// independently.
const MAX_ROWS = 2000;
const MAX_FIELD_LENGTH = 500;
const MAX_COMMENTAIRE_LENGTH = 2000;

// Identical field-for-field to the PDF export's BddExportRow
// (app/api/bdd/export/route.ts) — Emplacement included. This route got the
// Emplacement column first (12bdc5e), when multi-select made an export able to
// span several Emplacement values so the "Filtres actifs" header line could no
// longer tell you which row was which; e3bc354 then applied the same reasoning
// to the PDF export, which is why the two row types now match exactly.
//
// The two types are still declared separately on purpose: each route validates
// its own payload independently (see the caps above), so neither can silently
// widen the other's accepted input. Keep them in sync by hand when either
// changes.
type BddExcelExportRow = {
  IMM: string;
  client: string;
  modele: string;
  Emplacement: string;
  commentaire: string;
};

type BddExcelExportPayload = {
  rows: BddExcelExportRow[];
  activeFilters: { label: string; value: string }[];
  searchTerm?: string;
};

export function isValidExcelRow(r: unknown): r is BddExcelExportRow {
  if (!r || typeof r !== "object") return false;
  const obj = r as Record<string, unknown>;
  const shortKeys: (keyof BddExcelExportRow)[] = ["IMM", "client", "modele", "Emplacement"];
  if (!shortKeys.every((k) => typeof obj[k] === "string" && (obj[k] as string).length <= MAX_FIELD_LENGTH)) {
    return false;
  }
  return typeof obj.commentaire === "string" && obj.commentaire.length <= MAX_COMMENTAIRE_LENGTH;
}

async function buildExcel(
  rows: BddExcelExportRow[],
  activeFilters: { label: string; value: string }[],
  searchTerm?: string
): Promise<Buffer> {
  // exceljs, not pdf-lib — this is the app's first Excel export, so there's
  // no existing xlsx utility elsewhere to reuse (confirmed: only pdf-lib
  // for PDF and docx for DS History's Word export exist in this repo).
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AVIS Maroc — jalal";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("BDD");

  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR");
  const timeStr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  sheet.addRow(["Rapport BDD — Suivi RL"]).font = { bold: true, size: 14 };
  sheet.addRow([`Généré le ${dateStr} à ${timeStr}  ·  ${rows.length} véhicule${rows.length > 1 ? "s" : ""}`]);

  const filterParts = activeFilters.map((f) => `${f.label}: ${f.value}`);
  if (searchTerm) filterParts.push(`Recherche: "${searchTerm}"`);
  sheet.addRow([filterParts.length > 0 ? `Filtres actifs — ${filterParts.join("  ·  ")}` : "Aucun filtre actif"]);
  sheet.addRow([]);

  const headerRow = sheet.addRow(["IMM", "Client", "Modèle", "Emplacement", "Commentaire"]);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } }; // navy, matches PDF export's header bar
  });

  for (const r of rows) {
    sheet.addRow([r.IMM, r.client, r.modele, r.Emplacement, r.commentaire]);
  }

  sheet.columns = [
    { width: 16 }, // IMM
    { width: 24 }, // Client
    { width: 16 }, // Modèle
    { width: 16 }, // Emplacement
    { width: 50 }, // Commentaire
  ];
  // Wrap long free-text Commentaire values instead of truncating/overflowing
  sheet.getColumn(5).alignment = { wrapText: true, vertical: "top" };

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function POST(req: Request): Promise<NextResponse> {
  const limited = await rateLimitOrNull(req, "bdd-export-excel", RATE_LIMIT, RATE_WINDOW_MS);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const { rows, activeFilters, searchTerm } = body as Partial<BddExcelExportPayload>;

  if (!Array.isArray(rows) || !rows.every(isValidExcelRow)) {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'rows'" }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: "No rows to export" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ ok: false, error: `Too many rows (max ${MAX_ROWS})` }, { status: 400 });
  }
  if (activeFilters !== undefined && (!Array.isArray(activeFilters) || !activeFilters.every((f) => f && typeof f.label === "string" && typeof f.value === "string"))) {
    return NextResponse.json({ ok: false, error: "Invalid 'activeFilters'" }, { status: 400 });
  }
  if (searchTerm !== undefined && typeof searchTerm !== "string") {
    return NextResponse.json({ ok: false, error: "Invalid 'searchTerm'" }, { status: 400 });
  }

  try {
    const buf = await buildExcel(rows, activeFilters ?? [], searchTerm);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="bdd-export.xlsx"',
      },
    });
  } catch (e) {
    return toErrorResponse(e, "BDD Excel export failed");
  }
}
