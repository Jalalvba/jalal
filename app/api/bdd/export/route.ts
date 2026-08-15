export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Explicit rather than relying on the platform default — this is a report
// generator over at most MAX_ROWS rows of now-length-capped text, which
// completes in well under a second in practice; 30s is generous headroom,
// not a tuned-to-the-wire budget.
export const maxDuration = 30;

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

// Per-field length caps — without these, MAX_ROWS alone still allowed
// MAX_ROWS × an unbounded field length (confirmed live: 2000 rows × 20KB
// commentaire each took 106s of CPU and produced an 18.7MB PDF). Commentaire
// specifically can legitimately run to a few paragraphs (real free-text
// notes), hence its higher cap; IMM/client/modele are short reference
// fields that never legitimately approach even MAX_FIELD_LENGTH.
const MAX_FIELD_LENGTH = 500;
const MAX_COMMENTAIRE_LENGTH = 2000;

// Identity/reference fields, plus Emplacement. The other filter-axis fields
// (ETAT, prestataire, flag, Catégorie, Technicien, date_fin_contrat) stay
// dropped from the table — still redundant with the "Filtres actifs" header
// line, since none of those axes support selecting multiple values.
// Emplacement is the exception: it was originally dropped for the same
// reason, but Suivi RL's Emplacement filter is now multi-select, so a single
// export can legitimately span several different Emplacement values at
// once — the header line alone can no longer tell you which row is which.
// Same field/source as the Excel export's Emplacement column
// (app/api/bdd/export-excel/route.ts's BddExcelExportRow).
type BddExportRow = {
  IMM: string;
  client: string;
  modele: string;
  Emplacement: string;
  commentaire: string;
};

type BddExportPayload = {
  rows: BddExportRow[];
  activeFilters: { label: string; value: string }[];
  searchTerm?: string;
};

export function isValidRow(r: unknown): r is BddExportRow {
  if (!r || typeof r !== "object") return false;
  const obj = r as Record<string, unknown>;
  const shortKeys: (keyof BddExportRow)[] = ["IMM", "client", "modele", "Emplacement"];
  if (!shortKeys.every((k) => typeof obj[k] === "string" && (obj[k] as string).length <= MAX_FIELD_LENGTH)) {
    return false;
  }
  return typeof obj.commentaire === "string" && obj.commentaire.length <= MAX_COMMENTAIRE_LENGTH;
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

  // Portrait A4 — only 4 (narrower) columns now, and portrait's taller page
  // fits more rows before paginating, which matters more than extra width
  // now that the wide filter-axis columns are gone.
  const PW_PAGE = 595.28;
  const PH_PAGE = 841.89;
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
      // \x80-\x9f (the C1 control range) sits inside \x00-\xff but is NOT
      // encodable by pdf-lib's WinAnsi StandardFonts — the final catch-all
      // below used to let it through untouched (only \x00-\x1f/\x7f were
      // treated as control characters), so a Commentaire/IMM/search term
      // containing one of these (e.g. from a Windows-1252-mangled paste)
      // crashed the whole export with an opaque "BDD export failed" 500.
      .replace(/[\x80-\x9f]/g, " ")
      .replace(new RegExp("[\\u202f\\u00a0\\u2007\\u2009\\u200a\\u3000]", "g"), " ")
      .replace(new RegExp("[\\u2018\\u2019\\u02bc]", "g"), "'")
      .replace(new RegExp("[\\u201c\\u201d\\u00ab\\u00bb]", "g"), '"')
      .replace(new RegExp("[\\u2013\\u2212]", "g"), "-")
      .replace(new RegExp("[\\u2014\\u2015]", "g"), "--")
      .replace(new RegExp("[\\u2026]", "g"), "...")
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

  // Word-wraps (no truncation) into as many lines as needed — used only for
  // Commentaire, the one column allowed to grow a row instead of clipping.
  // Falls back to hard character-breaking for a single word wider than the
  // column (rare, but a run-on comment with no spaces would otherwise never
  // fit at all).
  const wrapText = (s: string, font: typeof fontR, size: number, maxW: number): string[] => {
    const words = sanitize(s).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxW) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxW) {
        current = word;
      } else {
        let chunk = "";
        for (const ch of word) {
          const next = chunk + ch;
          if (font.widthOfTextAtSize(next, size) <= maxW) {
            chunk = next;
          } else {
            lines.push(chunk);
            chunk = ch;
          }
        }
        current = chunk;
      }
    }
    if (current) lines.push(current);
    return lines;
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
  // IMM gets a deliberately dominant size — the plate is the one thing
  // fleet staff scan for "across a desk," not just modestly bigger than
  // Client/Modèle/Commentaire's shared, also-enlarged body size. Row
  // padding/line-height are generous too, so 22 rows (a typical filtered
  // export) actually use most of the page height instead of sitting in a
  // small dense block above a mostly-blank page.
  const IMM_SIZE = 20;
  const BODY_SIZE = 10;
  const HEADER_SIZE = 10;
  const LINE_H = 14; // leading for BODY_SIZE-sized wrapped Commentaire lines
  const CELL_PAD_TOP = 6;
  const CELL_PAD_BOTTOM = 8;
  const HEADER_H = 26;

  // IMM's width is fixed in points, not weight-proportional like the rest —
  // a real plate ("94102-E-1" etc.) measures ~90-95pt at 20pt bold
  // (confirmed via widthOfTextAtSize on real live plates), so 115pt clears
  // every real value with room for the cell padding on both sides.
  // Client/Modèle/Emplacement/Commentaire split whatever width remains.
  // Emplacement's weight is NOT the same as Modèle's despite both being
  // "short" values — confirmed via widthOfTextAtSize that modele's 1.1
  // weight is too narrow for Emplacement: the column header "Emplacement"
  // itself needs ~65pt at 10pt bold, and EMPLACEMENT_INTROUVABLE ("Emplacement
  // introuvable"'s live sheet value, "INTROUVABLE") needs ~70pt at 10pt —
  // both would truncate (found via a real export + decoding the PDF's
  // content stream, not assumed) at modele's width. 1.3 gives ~84pt, with
  // headroom for both.
  const IMM_W = 115;
  const restWeights = { client: 1.6, modele: 1.1, emplacement: 1.3, commentaire: 2.3 };
  const restTotalWeight = restWeights.client + restWeights.modele + restWeights.emplacement + restWeights.commentaire;
  const restW = PW - IMM_W;

  const columns: { key: keyof BddExportRow; label: string; width: number }[] = [
    { key: "IMM", label: "IMM", width: IMM_W },
    { key: "client", label: "Client", width: (restWeights.client / restTotalWeight) * restW },
    { key: "modele", label: "Modèle", width: (restWeights.modele / restTotalWeight) * restW },
    { key: "Emplacement", label: "Emplacement", width: (restWeights.emplacement / restTotalWeight) * restW },
    { key: "commentaire", label: "Commentaire", width: (restWeights.commentaire / restTotalWeight) * restW },
  ];
  const colWidths = columns.map((col) => col.width);
  const colX = columns.map((_, i) => ML + colWidths.slice(0, i).reduce((s, w) => s + w, 0));
  const commentaireIdx = columns.findIndex((col) => col.key === "commentaire");
  const commentaireX = colX[commentaireIdx];
  const commentaireW = colWidths[commentaireIdx] - 6;

  function drawTableHeader() {
    fillRect(ML, cy, PW, HEADER_H, NAVY);
    columns.forEach((col, i) => {
      drawText(col.label, colX[i] + 3, cy + 6, colWidths[i] - 6, fontB, HEADER_SIZE, WHITE);
    });
    cy += HEADER_H;
  }

  function needSpace(h: number) {
    if (cy + h > PH_PAGE - 40) {
      page = newPage();
      cy = 36;
      drawTableHeader();
    }
  }

  drawTableHeader();

  rows.forEach((row, idx) => {
    const commentLines = row.commentaire.trim()
      ? wrapText(row.commentaire, fontR, BODY_SIZE, commentaireW)
      : [];
    // Row must be tall enough for whichever is bigger: the wrapped Commentaire
    // block, or IMM's own (much larger) font — a 1-line comment alone would
    // otherwise size the row from LINE_H and leave no room for a 20pt IMM,
    // pushing it into the row above/below instead of centering cleanly.
    const contentH = Math.max(IMM_SIZE * 1.1, commentLines.length * LINE_H);
    const rowH = contentH + CELL_PAD_TOP + CELL_PAD_BOTTOM;

    needSpace(rowH);

    if (idx % 2 === 1) fillRect(ML, cy, PW, rowH, ALT);

    // IMM — deliberately larger + bold, vertically centered in the row.
    const immY = cy + CELL_PAD_TOP + (rowH - CELL_PAD_TOP - CELL_PAD_BOTTOM - IMM_SIZE) / 2 + IMM_SIZE * 0.15;
    drawText(row.IMM, colX[0] + 3, immY, colWidths[0] - 6, fontB, IMM_SIZE, NAVY);

    // Client / Modèle / Emplacement — single line, top-aligned, same
    // treatment. Emplacement can legitimately be blank (a row where nobody
    // has set it yet) — drawText/truncate/sanitize all handle an empty
    // string fine, so this just draws nothing in that cell.
    drawText(row.client, colX[1] + 3, cy + CELL_PAD_TOP + 1, colWidths[1] - 6, fontR, BODY_SIZE, DARK);
    drawText(row.modele, colX[2] + 3, cy + CELL_PAD_TOP + 1, colWidths[2] - 6, fontR, BODY_SIZE, DARK);
    drawText(row.Emplacement, colX[3] + 3, cy + CELL_PAD_TOP + 1, colWidths[3] - 6, fontR, BODY_SIZE, DARK);

    // Commentaire — wrapped, one line drawn per entry, never truncated.
    commentLines.forEach((line, li) => {
      drawText(line, commentaireX + 3, cy + CELL_PAD_TOP + 1 + li * LINE_H, commentaireW, fontR, BODY_SIZE, DARK);
    });

    cy += rowH;
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
