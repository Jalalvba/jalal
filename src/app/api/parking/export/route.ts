// PDF export of the Parking list, exactly as it is currently filtered.
//
// Seven columns, chosen by the people who use the report: IMM, TIMESTAMP,
// ACTION, ZONING, MARQUE, MODEL, gemini. Two of them (ACTION and gemini) are
// long free text, so the page is LANDSCAPE — the BDD report is portrait
// because its five columns are narrow, and copying that choice here would have
// squeezed the work order into a column too narrow to read.
//
// Read-only: it renders what the client sends, which is the filtered view the
// user is looking at. Same rate-limit bucket shape as the other export routes.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";
import { truncate, wrapPreservingBreaks, wrapText } from "@/lib/pdf/text";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 5 * 60 * 1000;

// The live tab holds ~84 rows, so a legitimate export never approaches this.
// It exists to reject a malformed payload before it costs real function time.
const MAX_ROWS = 2000;
// Per-field caps: MAX_ROWS alone still allows MAX_ROWS x an unbounded field.
// ACTION and gemini are genuinely long (a work order, an analysis paragraph),
// the rest are short reference values.
const MAX_FIELD_LENGTH = 500;
const MAX_LONG_LENGTH = 4000;

type ParkingExportRow = {
  imm: string;
  timestamp: string;
  action: string;
  zoning: string;
  marque: string;
  model: string;
  gemini: string;
};

type ParkingExportPayload = {
  rows: ParkingExportRow[];
  activeFilters: { label: string; value: string }[];
  searchTerm?: string;
};

const SHORT_KEYS: (keyof ParkingExportRow)[] = ["imm", "timestamp", "zoning", "marque", "model"];
const LONG_KEYS: (keyof ParkingExportRow)[] = ["action", "gemini"];

export function isValidRow(r: unknown): r is ParkingExportRow {
  if (!r || typeof r !== "object") return false;
  const obj = r as Record<string, unknown>;
  if (!SHORT_KEYS.every((k) => typeof obj[k] === "string" && (obj[k] as string).length <= MAX_FIELD_LENGTH)) {
    return false;
  }
  return LONG_KEYS.every((k) => typeof obj[k] === "string" && (obj[k] as string).length <= MAX_LONG_LENGTH);
}

export async function POST(req: Request): Promise<NextResponse> {
  const limited = await rateLimitOrNull(req, "parking-export", RATE_LIMIT, RATE_WINDOW_MS);
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

  const { rows, activeFilters, searchTerm } = body as Partial<ParkingExportPayload>;

  if (!Array.isArray(rows) || !rows.every(isValidRow)) {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'rows'" }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: "Aucune ligne à exporter" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ ok: false, error: `Trop de lignes (max ${MAX_ROWS})` }, { status: 400 });
  }
  const filters = Array.isArray(activeFilters)
    ? activeFilters.filter(
        (f): f is { label: string; value: string } =>
          !!f && typeof f === "object" &&
          typeof (f as { label?: unknown }).label === "string" &&
          typeof (f as { value?: unknown }).value === "string"
      )
    : [];

  try {
    const pdf = await buildPdf(rows, filters, typeof searchTerm === "string" ? searchTerm : undefined);
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="parking-${new Date().toISOString().slice(0, 10)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return toErrorResponse(e, "Échec de l'export PDF");
  }
}

async function buildPdf(
  rows: ParkingExportRow[],
  activeFilters: { label: string; value: string }[],
  searchTerm: string | undefined
): Promise<Uint8Array> {
  const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

  const c = (r: number, g: number, b: number) => rgb(r / 255, g / 255, b / 255);
  const NAVY = c(30, 58, 95);
  const ALT = c(245, 248, 252);
  const BORD = c(197, 211, 224);
  const GRAY = c(136, 136, 136);
  const DARK = c(34, 34, 34);
  const WHITE = c(255, 255, 255);

  const pdfDoc = await PDFDocument.create();
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // A4 LANDSCAPE — seven columns, two of them long free text.
  const PW_PAGE = 841.89;
  const PH_PAGE = 595.28;
  const ML = 28;
  const PW = PW_PAGE - ML * 2;

  const newPage = () => pdfDoc.addPage([PW_PAGE, PH_PAGE]);
  let page = newPage();
  let cy = 28;
  const Y = (topY: number) => PH_PAGE - topY;

  const fillRect = (x: number, y: number, w: number, h: number, color: ReturnType<typeof rgb>) => {
    page.drawRectangle({ x, y: Y(y + h), width: w, height: h, color });
  };
  const hLine = (y: number) => {
    page.drawLine({ start: { x: ML, y: Y(y) }, end: { x: ML + PW, y: Y(y) }, color: BORD, thickness: 0.4 });
  };
  const drawText = (
    s: string, x: number, y: number, maxW: number,
    font: typeof fontR, size: number, color: ReturnType<typeof rgb>
  ) => {
    page.drawText(truncate(s, font, size, maxW), { x, y: Y(y + size * 0.8), font, size, color });
  };

  // ── Title + meta ──
  drawText("Rapport PARKING", ML, cy, PW, fontB, 15, NAVY);
  cy += 18;

  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR");
  const timeStr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  drawText(
    `Généré le ${dateStr} à ${timeStr}  ·  ${rows.length} véhicule${rows.length > 1 ? "s" : ""}`,
    ML, cy, PW, fontR, 8, GRAY
  );
  cy += 11;

  const filterParts = activeFilters.map((f) => `${f.label}: ${f.value}`);
  if (searchTerm) filterParts.push(`Recherche: "${searchTerm}"`);
  drawText(
    filterParts.length > 0 ? `Filtres actifs — ${filterParts.join("  ·  ")}` : "Aucun filtre actif",
    ML, cy, PW, fontR, 8, GRAY
  );
  cy += 16;

  // ── Table ──
  const IMM_SIZE = 13;
  const BODY_SIZE = 8;
  const HEADER_SIZE = 8;
  const LINE_H = 10;
  const CELL_PAD_TOP = 5;
  const CELL_PAD_BOTTOM = 6;
  const HEADER_H = 20;

  // IMM is fixed in points — a real plate ("94102-E-1") measures ~62pt at 13pt
  // bold, so 78 clears every live value plus padding. The rest share what is
  // left by weight, with ACTION and gemini given the space they need: those
  // two carry the content someone actually reads the report for.
  const IMM_W = 78;
  // Measured against the live tab, not guessed: TIMESTAMP holds
  // "17/08/2026 17:42" (~64pt at 8pt), which clipped to "17/08/2026 17:..." at
  // weight 1.0; MODEL holds values like "MG3 Hybride Plus" that clipped too.
  // Both are now wide enough AND wrapped, so a longer-than-expected value
  // grows the row instead of losing its tail.
  const weights = { timestamp: 1.35, action: 3.1, zoning: 1.3, marque: 0.85, model: 1.1, gemini: 3.1 };
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
  const restW = PW - IMM_W;

  const columns: { key: keyof ParkingExportRow; label: string; width: number; wrap?: boolean }[] = [
    { key: "imm", label: "IMM", width: IMM_W },
    { key: "timestamp", label: "TIMESTAMP", width: (weights.timestamp / totalWeight) * restW, wrap: true },
    { key: "action", label: "ACTION", width: (weights.action / totalWeight) * restW, wrap: true },
    { key: "zoning", label: "ZONING", width: (weights.zoning / totalWeight) * restW, wrap: true },
    { key: "marque", label: "MARQUE", width: (weights.marque / totalWeight) * restW, wrap: true },
    { key: "model", label: "MODEL", width: (weights.model / totalWeight) * restW, wrap: true },
    { key: "gemini", label: "GEMINI", width: (weights.gemini / totalWeight) * restW, wrap: true },
  ];
  const colX = columns.map((_, i) => ML + columns.slice(0, i).reduce((s, col) => s + col.width, 0));

  function drawTableHeader() {
    fillRect(ML, cy, PW, HEADER_H, NAVY);
    columns.forEach((col, i) => {
      drawText(col.label, colX[i] + 3, cy + 5, col.width - 6, fontB, HEADER_SIZE, WHITE);
    });
    cy += HEADER_H;
  }

  function needSpace(h: number) {
    if (cy + h > PH_PAGE - 30) {
      page = newPage();
      cy = 28;
      drawTableHeader();
    }
  }

  drawTableHeader();

  rows.forEach((row, idx) => {
    // ACTION keeps its own line breaks: it holds a numbered work order, one
    // operation per line, and re-flowing it into a paragraph would undo the
    // single most useful thing about that column.
    const lineSets = columns.map((col) =>
      col.wrap
        ? col.key === "action"
          ? wrapPreservingBreaks(row[col.key], fontR, BODY_SIZE, col.width - 6)
          : wrapText(row[col.key], fontR, BODY_SIZE, col.width - 6)
        : null
    );

    const tallest = Math.max(1, ...lineSets.map((ls) => ls?.length ?? 1));
    const contentH = Math.max(IMM_SIZE * 1.1, tallest * LINE_H);
    const rowH = contentH + CELL_PAD_TOP + CELL_PAD_BOTTOM;

    needSpace(rowH);
    if (idx % 2 === 1) fillRect(ML, cy, PW, rowH, ALT);

    // IMM — larger and bold, vertically centred: it is what the reader scans.
    const immY = cy + CELL_PAD_TOP + (rowH - CELL_PAD_TOP - CELL_PAD_BOTTOM - IMM_SIZE) / 2 + IMM_SIZE * 0.15;
    drawText(row.imm, colX[0] + 3, immY, columns[0].width - 6, fontB, IMM_SIZE, NAVY);

    columns.forEach((col, i) => {
      if (i === 0) return;
      const lines = lineSets[i];
      if (lines) {
        lines.forEach((line, li) => {
          drawText(line, colX[i] + 3, cy + CELL_PAD_TOP + 1 + li * LINE_H, col.width - 6, fontR, BODY_SIZE, DARK);
        });
      } else {
        drawText(row[col.key], colX[i] + 3, cy + CELL_PAD_TOP + 1, col.width - 6, fontR, BODY_SIZE, DARK);
      }
    });

    cy += rowH;
    hLine(cy);
  });

  // ── page numbers ──
  const totalPages = pdfDoc.getPageCount();
  pdfDoc.getPages().forEach((p, i) => {
    const fy = PH_PAGE - 16;
    p.drawLine({ start: { x: ML, y: fy + 3 }, end: { x: ML + PW, y: fy + 3 }, color: BORD, thickness: 0.4 });
    const label = `PARKING  ·  ${dateStr}  ·  Page ${i + 1} / ${totalPages}`;
    const tw = fontR.widthOfTextAtSize(label, 7);
    p.drawText(label, { x: ML + PW - tw, y: fy - 5, font: fontR, size: 7, color: GRAY });
  });

  return pdfDoc.save();
}
