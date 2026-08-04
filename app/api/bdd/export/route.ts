export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/rateLimit";
import { toErrorResponse } from "@/lib/apiError";

// Same rate-limit bucket shape as app/api/export/route.ts's DS-history
// export (20 req / 5min) — this is a read-only report generator, not a
// Sheets mutation, so it doesn't belong in the 17-route 30/min bucket.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 5 * 60 * 1000;

// Defensive upper bound — the live BDD tab has ~85 rows today, so a
// legitimate export never gets close to this; it exists to reject a
// malformed/oversized payload before it costs a Vercel function real time
// generating an enormous PDF.
const MAX_ROWS = 2000;

type BddExportRow = {
  IMM: string;
  client: string;
  modele: string;
  ETAT: string;
  Emplacement: string;
  prestataire: string;
  flag: string;
  "Catégorie": string;
  Technicien: string;
  date_fin_contrat: string;
};

type BddExportPayload = {
  rows: BddExportRow[];
  activeFilters: { label: string; value: string }[];
  searchTerm?: string;
};

function isValidRow(r: unknown): r is BddExportRow {
  if (!r || typeof r !== "object") return false;
  const keys: (keyof BddExportRow)[] = [
    "IMM", "client", "modele", "ETAT", "Emplacement",
    "prestataire", "flag", "Catégorie", "Technicien", "date_fin_contrat",
  ];
  return keys.every((k) => typeof (r as Record<string, unknown>)[k] === "string");
}

export async function POST(req: Request): Promise<NextResponse> {
  const limited = await rateLimitOrNull(req, "bdd-export", RATE_LIMIT, RATE_WINDOW_MS);
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

  const { rows, activeFilters, searchTerm } = body as Partial<BddExportPayload>;

  if (!Array.isArray(rows) || !rows.every(isValidRow)) {
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
    const pdfBytes = await buildPdf(rows, activeFilters ?? [], searchTerm);
    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="bdd-export.pdf"',
      },
    });
  } catch (e) {
    return toErrorResponse(e, "BDD export failed");
  }
}

// ─── PDF builder (pdf-lib — same tool/visual language as app/api/export's
// DS-history PDF branch: navy header bars, zebra-striped rows, footer page
// numbers) ───────────────────────────────────────────────────────────────

async function buildPdf(
  rows: BddExportRow[],
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

  // Landscape A4 — a 10-column table needs the width portrait can't give.
  const PW_PAGE = 841.89;
  const PH_PAGE = 595.28;
  const ML = 36;
  const PW = PW_PAGE - ML * 2;

  const pages: ReturnType<typeof pdfDoc.addPage>[] = [];
  const newPage = () => {
    const p = pdfDoc.addPage([PW_PAGE, PH_PAGE]);
    pages.push(p);
    return p;
  };

  let page = newPage();
  let cy = 36;
  const Y = (topY: number) => PH_PAGE - topY;

  const fillRect = (x: number, y: number, w: number, h: number, color: ReturnType<typeof rgb>) => {
    page.drawRectangle({ x, y: Y(y + h), width: w, height: h, color });
  };
  const hLine = (y: number) => {
    page.drawLine({ start: { x: ML, y: Y(y) }, end: { x: ML + PW, y: Y(y) }, color: BORD, thickness: 0.4 });
  };

  const sanitize = (s: string): string =>
    String(s ?? "")
      .replace(/[\r\n\t\x00-\x1f\x7f]/g, " ")
      .replace(/[     　]/g, " ")
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”«»]/g, '"')
      .replace(/[–−]/g, "-")
      .replace(/[—―]/g, "--")
      .replace(/[…]/g, "...")
      .replace(/[^\x20-\xff]/g, "?");

  const truncate = (s: string, font: typeof fontR, size: number, maxW: number): string => {
    const str = sanitize(s);
    if (font.widthOfTextAtSize(str, size) <= maxW) return str;
    let t = str;
    while (t.length > 1 && font.widthOfTextAtSize(t + "...", size) > maxW) t = t.slice(0, -1);
    return t + "...";
  };

  const drawText = (
    s: string, x: number, y: number, maxW: number,
    font: typeof fontR, size: number, color: ReturnType<typeof rgb>
  ) => {
    const safe = truncate(s, font, size, maxW);
    page.drawText(safe, { x, y: Y(y + size * 0.8), font, size, color });
  };

  // ── Title + meta ──
  drawText("Rapport BDD — Suivi RL", ML, cy, PW, fontB, 16, NAVY);
  cy += 20;

  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR");
  const timeStr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  drawText(
    `Généré le ${dateStr} à ${timeStr}  ·  ${rows.length} véhicule${rows.length > 1 ? "s" : ""}`,
    ML, cy, PW, fontR, 8, GRAY
  );
  cy += 12;

  const filterParts = activeFilters.map((f) => `${f.label}: ${f.value}`);
  if (searchTerm) filterParts.push(`Recherche: "${searchTerm}"`);
  if (filterParts.length > 0) {
    drawText(`Filtres actifs — ${filterParts.join("  ·  ")}`, ML, cy, PW, fontR, 8, GRAY);
    cy += 12;
  } else {
    drawText("Aucun filtre actif", ML, cy, PW, fontR, 8, GRAY);
    cy += 12;
  }
  cy += 6;

  // ── Table ──
  const columns: { key: keyof BddExportRow; label: string; weight: number }[] = [
    { key: "IMM", label: "IMM", weight: 1.0 },
    { key: "client", label: "Client", weight: 1.6 },
    { key: "modele", label: "Modèle", weight: 1.2 },
    { key: "ETAT", label: "État", weight: 0.8 },
    { key: "Emplacement", label: "Emplacement", weight: 1.0 },
    { key: "prestataire", label: "Prestataire", weight: 1.3 },
    { key: "flag", label: "Flag", weight: 0.7 },
    { key: "Catégorie", label: "Catégorie", weight: 2.0 },
    { key: "Technicien", label: "Technicien", weight: 1.3 },
    { key: "date_fin_contrat", label: "Fin contrat", weight: 0.9 },
  ];
  const totalWeight = columns.reduce((s, c) => s + c.weight, 0);
  const colWidths = columns.map((c) => (c.weight / totalWeight) * PW);

  const ROW_H = 14;
  const HEADER_H = 16;

  function drawTableHeader() {
    fillRect(ML, cy, PW, HEADER_H, NAVY);
    let x = ML;
    columns.forEach((col, i) => {
      drawText(col.label, x + 3, cy + 3, colWidths[i] - 6, fontB, 7, WHITE);
      x += colWidths[i];
    });
    cy += HEADER_H;
  }

  function needRowSpace() {
    if (cy + ROW_H > PH_PAGE - 40) {
      page = newPage();
      cy = 36;
      drawTableHeader();
    }
  }

  drawTableHeader();

  rows.forEach((row, idx) => {
    needRowSpace();
    if (idx % 2 === 1) fillRect(ML, cy, PW, ROW_H, ALT);
    let x = ML;
    columns.forEach((col, i) => {
      drawText(String(row[col.key] ?? ""), x + 3, cy + 2, colWidths[i] - 6, fontR, 7, DARK);
      x += colWidths[i];
    });
    cy += ROW_H;
    hLine(cy);
  });

  // ── page numbers ──
  const totalPages = pdfDoc.getPageCount();
  pdfDoc.getPages().forEach((p, i) => {
    const fy = PH_PAGE - 20;
    p.drawLine({ start: { x: ML, y: fy + 3 }, end: { x: ML + PW, y: fy + 3 }, color: BORD, thickness: 0.4 });
    const label = `BDD  ·  ${dateStr}  ·  Page ${i + 1} / ${totalPages}`;
    const tw = fontR.widthOfTextAtSize(label, 7);
    p.drawText(label, { x: ML + PW - tw, y: fy - 5, font: fontR, size: 7, color: GRAY });
  });

  return pdfDoc.save();
}
