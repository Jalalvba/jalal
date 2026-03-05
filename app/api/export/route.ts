// app/api/export/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// ─── Types (mirror the frontend) ─────────────────────────────────────────────

type Line = {
  n_intervention?: string;
  cmd_num?: string;
  code_art?: string;
  designation_art?: string;
  designation_conso?: string;
  qte?: number;
  mt_ht?: number | null;
  prix_unitaire?: number | null;
  dernier_prix?: number | null;
};

type DsItem = {
  "N°DS": string;
  Societe?: string;
  Site?: string;
  "SITE DS"?: string;
  "Date DS"?: string;
  "Date entrée"?: string;
  "Date interv"?: string;
  "Effectué le"?: string;
  Immatriculation?: string;
  Parc?: string;
  "Type Parc"?: string;
  "Désignation véhicule"?: string;
  Marque?: string;
  ENTITE?: string;
  "Code entité"?: string;
  Entité?: string;
  Description?: string;
  "Type DS"?: string;
  "Type de DS"?: string;
  Techniciens?: string[];
  User?: string | null;
  "Facturé par"?: string | null;
  "Client Final"?: string;
  "Raison Social"?: string;
  "Client DS"?: string;
  "Code Client"?: string;
  "Détenteur DS"?: string;
  "Détenteur parc"?: string;
  "Locat Parc"?: string;
  "A Facturé"?: string;
  "Statut facture"?: string;
  "N° Facture"?: string;
  Affectation?: string;
  "Ref CP"?: string;
  "CMD Num"?: string;
  Réceptionné?: string;
  Soldé?: string;
  "Demande satisfaite"?: string;
  Fournisseur?: string;
  KM?: number;
  "MT Total HT"?: number;
  lines?: Line[];
};

// ✅ FIXED: keys match what /api/parc actually returns (camelCase projection)
type ParcItem = {
  id?: number;
  company?: string;
  client?: string;
  brand?: string;
  model?: string | number;
  imm?: string;
  ww?: string;
  vin?: string;
  vehicle_state?: string;
  vehicle_type?: string;
  location_type?: string;
  tenant?: string;
  received?: string;
  received_date?: string;
  mce_date?: string;
  sold?: string;
  scrap?: string;
  purchase_order?: string;
  purchase_price_net?: number;
};

type CpItem = {
  reference?: string;
  nature?: string;
  statut?: string;
  ww?: string;
  imm?: string;
  marque?: string;
  model?: string;
  version?: string;
  client?: string;
  gestionnaire?: string;
  duree?: string | number;
  date_debut_contrat?: string;
  date_fin_contrat?: string;
  date_debut_rl?: string;
  vh_relais?: string;
  type?: string; // type relais
  type_location?: string;
  type_vehicle?: string;
};

type ExportPayload = {
  imm: string;
  count: number;
  items: DsItem[];
  contracts?: CpItem[];

  // visibility
  visibleCardFields: string[];
  visibleLineFields: string[];

  // labels
  vehicleMetaFields: { key: string; label: string }[]; // keys are camelCase ParcItem keys
  cardFieldLabels: Record<string, string>;
  lineFieldLabels: Record<string, string>;
  topBarKeys: string[];

  // vehicle card from /api/parc
  vehicle?: ParcItem | null;

  // parc field grouping sent from frontend
  parcMandatoryKeys?: string[];
  parcExtraKeys?: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}

function fmtNum(v?: number | null, dec = 0): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(v);
}

function getCardValue(item: DsItem, key: string): string {
  const v = (item as Record<string, unknown>)[key];
  if (v == null) return "—";
  if (key === "Techniciens") return (v as string[]).join(", ") || "—";
  if (key === "KM") return fmtNum(v as number) + " km";
  if (key === "MT Total HT") return fmtNum(v as number, 2) + " MAD";
  if (["Date DS", "Date entrée", "Date interv", "Effectué le"].includes(key))
    return fmtDate(v as string);
  return String(v).trim() || "—";
}

function getLineValue(line: Line, key: string): string {
  const v = (line as Record<string, unknown>)[key];
  if (v == null) return "—";
  if (["mt_ht", "prix_unitaire", "dernier_prix"].includes(key))
    return fmtNum(v as number, 2);
  if (key === "qte") return String(v);
  return String(v).trim() || "—";
}

function getVehicleValue(vehicle: ParcItem | null | undefined, key: string): string {
  if (!vehicle) return "—";
  const v = (vehicle as Record<string, unknown>)[key];
  if (v == null) return "—";
  // ✅ FIXED: key is now camelCase
  if (key === "purchase_price_net") return fmtNum(v as number, 2) + " MAD";
  return String(v).trim() || "—";
}

// ─── DocX builders ────────────────────────────────────────────────────────────

const COLORS = {
  headerBg: "1E3A5F",
  headerFg: "FFFFFF",
  sectionBg: "E8EFF7",
  sectionFg: "1E3A5F",
  rowAlt: "F5F8FC",
  border: "C5D3E0",
  labelFg: "555555",
  totalBg: "D5E8F0",
};

const PAGE_W = 9360; // A4 content width in DXA with 1" margins

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") ?? "docx"; // "pdf" or "docx"

  // ── PDF branch (pdf-lib — pure JS, no font files needed) ────────────────
  if (format === "pdf") {
    const payload: ExportPayload = await req.json();
    const {
      items, count, visibleCardFields, visibleLineFields,
      vehicleMetaFields, cardFieldLabels, lineFieldLabels,
      topBarKeys, vehicle, imm, contracts,
      parcMandatoryKeys, parcExtraKeys,
    } = payload;

    const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

    // colours  (pdf-lib uses 0-1 floats)
    const c = (r: number, g: number, b: number) => rgb(r/255, g/255, b/255);
    const NAVY  = c(30,  58,  95);
    const LIGHT = c(238, 243, 248);
    const ALT   = c(245, 248, 252);
    const TOTAL = c(213, 232, 240);
    const BORD  = c(197, 211, 224);
    const GRAY  = c(136, 136, 136);
    const DARK  = c(34,  34,  34);
    const MID   = c(68,  68,  68);
    const WHITE = c(255, 255, 255);

    const numKeys    = new Set(["qte","mt_ht","prix_unitaire","dernier_prix"]);
    const topSet     = new Set(topBarKeys);
    const MAND_DS    = new Set(["Description","Techniciens","ENTITE"]);
    const infoSet    = new Set(visibleCardFields.filter(k => k !== "N°DS" && !topSet.has(k)));
    MAND_DS.forEach(k => infoSet.add(k));
    const infoFields = [...infoSet];
    const immat      = (vehicle?.imm ?? imm ?? "—").toString();
    const now        = new Date().toLocaleDateString("fr-FR");
    const mandParcF  = vehicleMetaFields.filter(f => (parcMandatoryKeys ?? []).includes(f.key));
    const extraParcF = vehicleMetaFields.filter(f => (parcExtraKeys    ?? []).includes(f.key));

    const pdfDoc = await PDFDocument.create();
    const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // A4 dimensions in points
    const PW_PAGE = 595.28;
    const PH_PAGE = 841.89;
    const ML = 36;
    const PW = PW_PAGE - ML * 2;

    // pages array — we add pages as needed
    const pages: ReturnType<typeof pdfDoc.addPage>[] = [];
    const newPage = () => {
      const p = pdfDoc.addPage([PW_PAGE, PH_PAGE]);
      pages.push(p);
      return p;
    };

    let page = newPage();
    let cy   = 36; // top-down: distance from top of page

    // pdf-lib draws from bottom-left (y=0 at bottom).
    // cy is top-down; Y() converts to bottom-up for pdf-lib.
    const Y = (topY: number) => PH_PAGE - topY;

    const needPage = (h: number) => {
      if (cy + h > PH_PAGE - 50) { page = newPage(); cy = 36; }
    };

    // ── drawing primitives ──
    const fillRect = (x: number, y: number, w: number, h: number, color: ReturnType<typeof rgb>) => {
      page.drawRectangle({ x, y: Y(y + h), width: w, height: h, color });
    };
    const strokeRect = (x: number, y: number, w: number, h: number) => {
      page.drawRectangle({ x, y: Y(y + h), width: w, height: h,
        borderColor: BORD, borderWidth: 0.4, color: undefined });
    };
    const hLine = (y: number) => {
      page.drawLine({ start: { x: ML, y: Y(y) }, end: { x: ML + PW, y: Y(y) },
        color: BORD, thickness: 0.4 });
    };

    // Sanitize to WinAnsi — pdf-lib standard fonts only support cp1252
    const sanitize = (s: string): string =>
      String(s ?? "-")
        .replace(/[\r\n\t\x00-\x1f\x7f]/g, " ")   // control chars + newlines -> space
        .replace(/[\u202f\u00a0\u2007\u2009\u200a\u3000]/g, " ")  // all special spaces
        .replace(/[\u2018\u2019\u02bc]/g, "'")
        .replace(/[\u201c\u201d\u00ab\u00bb]/g, '"')
        .replace(/[\u2013\u2212]/g, "-")
        .replace(/[\u2014\u2015]/g, "--")
        .replace(/[\u2026]/g, "...")
        .replace(/[^\x20-\xff]/g, "?");   // anything non-printable outside latin-1 -> ?

    // safe string truncation for pdf-lib (no built-in ellipsis)
    const truncate = (s: string, font: typeof fontR, size: number, maxW: number): string => {
      const str = sanitize(s);
      if (font.widthOfTextAtSize(str, size) <= maxW) return str;
      let t = str;
      while (t.length > 1 && font.widthOfTextAtSize(t + "...", size) > maxW) t = t.slice(0, -1);
      return t + "...";
    };

    const drawText = (
      s: string, x: number, y: number, maxW: number,
      font: typeof fontR, size: number, color: ReturnType<typeof rgb>,
      align: "left"|"right" = "left"
    ) => {
      const safe = truncate(s, font, size, maxW);
      const tw   = font.widthOfTextAtSize(safe, size);
      const dx   = align === "right" ? maxW - tw : 0;
      page.drawText(safe, { x: x + dx, y: Y(y + size * 0.8), font, size, color });
    };

    // ── Title ──
    drawText(`Historique DS — ${immat}`, ML, cy, PW, fontB, 16, NAVY);
    cy += 22;
    drawText(`Généré le ${now}  ·  ${count} dossier${count > 1 ? "s" : ""}`, ML, cy, PW, fontR, 8, GRAY);
    cy += 16;

    const secHead = (label: string, forceNewPage = false) => {
      if (forceNewPage) { page = newPage(); cy = 36; }
      cy += 8;
      drawText(label, ML, cy, PW, fontB, 10, NAVY);
      cy += 14;
      hLine(cy);
      cy += 5;
    };

    const kvRow = (label: string, value: string) => {
      needPage(15);
      const LW = 140;
      fillRect(ML,      cy, LW,      15, LIGHT);
      fillRect(ML + LW, cy, PW - LW, 15, WHITE);
      strokeRect(ML, cy, PW, 15);
      drawText(label, ML + 4,      cy + 4, LW - 8,      fontB, 7.5, MID);
      drawText(value, ML + LW + 4, cy + 4, PW - LW - 8, fontR, 7.5, DARK);
      cy += 15;
    };

    // ── Parc ──
    secHead("Véhicule — Données fixes (parc)");
    mandParcF.forEach(f => kvRow(f.label, getVehicleValue(vehicle, f.key)));

    // ── CP contracts ──
    if (contracts && contracts.length > 0) {
      secHead(`Contrats CP (${contracts.length})`);
      contracts.forEach(cp => {
        needPage(90);
        const cpY = cy;
        fillRect(ML, cy, PW, 16, NAVY);
        const refStr = sanitize(`${cp.reference ?? "—"}  ${cp.statut ?? ""}`);
        drawText(refStr, ML + 5, cy + 4, PW - 10, fontB, 8, WHITE);
        cy += 20;
        const CW4 = Math.floor(PW / 4);
        const CW3 = Math.floor(PW / 3);
        const row1: [string,string][] = [
          ["Marque / Modele", cp.marque && cp.model ? `${cp.marque} ${cp.model}` : (cp.marque ?? cp.model ?? "—")],
          ["Client",          cp.client ?? "—"],
          ["Version",         cp.version ?? "—"],
          ["Fin contrat",     cp.date_fin_contrat ?? "—"],
        ];
        const row2: [string,string][] = [
          ["VH relais",   cp.vh_relais ?? "—"],
          ["Type relais", cp.type ?? "—"],
          ["Debut RL",    cp.date_debut_rl ?? "—"],
        ];
        row1.forEach(([label, val], i) => {
          const x = ML + i * CW4;
          drawText(label, x + 3, cy,     CW4 - 6, fontR, 6.5, GRAY);
          drawText(val,   x + 3, cy + 8, CW4 - 6, fontB, 7.5, DARK);
        });
        cy += 18;
        row2.forEach(([label, val], i) => {
          const x = ML + i * CW3;
          drawText(label, x + 3, cy,     CW3 - 6, fontR, 6.5, GRAY);
          drawText(val,   x + 3, cy + 8, CW3 - 6, fontB, 7.5, DARK);
        });
        cy += 18;
        strokeRect(ML, cpY, PW, cy - cpY);
        cy += 6;
      });
    }

    // ── DS cards ──
    secHead(`Dossiers de service (${count})`, true);

    for (const it of items) {
      const lc    = it.lines?.length ?? 0;
      const fRows = Math.ceil(infoFields.length / 3);
      const estH  = 20 + fRows * 16 + (lc > 0 ? 14 + lc * 12 + 14 : 0) + 10;
      needPage(estH);

      const cardY = cy;

      // header
      fillRect(ML, cy, PW, 18, NAVY);
      const lStr = [
        visibleCardFields.includes("Date DS") && it["Date DS"] ? fmtDate(it["Date DS"]) : "",
        visibleCardFields.includes("KM") && it.KM != null      ? fmtNum(it.KM) + " km"  : "",
      ].filter(Boolean).join("  ·  ");
      const rStr = [
        visibleCardFields.includes("MT Total HT") && it["MT Total HT"] != null ? fmtNum(it["MT Total HT"], 2) + " MAD" : "",
        visibleCardFields.includes("Site") && it.Site          ? it.Site        : "",
        visibleCardFields.includes("Type DS") && it["Type DS"] ? it["Type DS"]! : "",
        visibleCardFields.includes("Affectation") && it.Affectation ? it.Affectation : "",
        it["N°DS"],
      ].filter(Boolean).join("  ·  ");
      drawText(lStr, ML + 5,    cy + 5, PW/2 - 10, fontB, 8,   WHITE, "left");
      drawText(rStr, ML + PW/2, cy + 5, PW/2 - 5,  fontR, 7.5, WHITE, "right");
      cy += 22;

      // field grid 3 cols
      const CW   = Math.floor(PW / 3);
      let   ci   = 0;
      let   rowY = cy;
      for (const key of infoFields) {
        const x = ML + ci * CW;
        drawText(cardFieldLabels[key] ?? key, x + 3, rowY,     CW - 6, fontR, 6.5, GRAY);
        drawText(getCardValue(it, key),       x + 3, rowY + 8, CW - 6, fontB, 7.5, DARK);
        ci++;
        if (ci >= 3) { ci = 0; rowY += 16; }
      }
      cy = rowY + (ci > 0 ? 16 : 0) + 4;

      // lines
      if (lc > 0 && visibleLineFields.length > 0) {
        drawText(`LIGNES (${lc})`, ML, cy, PW, fontB, 7, NAVY);
        cy += 11;
        const colW = Math.floor(PW / visibleLineFields.length);

        fillRect(ML, cy, PW, 13, NAVY);
        visibleLineFields.forEach((k, i) => {
          drawText(lineFieldLabels[k] ?? k, ML + i*colW + 2, cy + 3,
            colW - 4, fontB, 6.5, WHITE, numKeys.has(k) ? "right" : "left");
        });
        cy += 13;

        it.lines!.forEach((line, li) => {
          if (li % 2 === 1) fillRect(ML, cy, PW, 12, ALT);
          hLine(cy + 12);
          visibleLineFields.forEach((k, i) => {
            drawText(getLineValue(line, k), ML + i*colW + 2, cy + 2,
              colW - 4, fontR, 7, DARK, numKeys.has(k) ? "right" : "left");
          });
          cy += 12;
        });

        if (lc > 1 && it["MT Total HT"] != null && visibleLineFields.includes("mt_ht")) {
          fillRect(ML, cy, PW, 13, TOTAL);
          visibleLineFields.forEach((k, i) => {
            const v = k === "mt_ht" ? fmtNum(it["MT Total HT"]!, 2) : i === 0 ? "Total" : "";
            drawText(v, ML + i*colW + 2, cy + 3,
              colW - 4, fontB, 7, DARK, numKeys.has(k) ? "right" : "left");
          });
          cy += 13;
        }
        cy += 2;
      }

      strokeRect(ML, cardY, PW, cy - cardY);
      cy += 8;
    }

    // ── page numbers ──
    const totalPages = pdfDoc.getPageCount();
    pdfDoc.getPages().forEach((p, i) => {
      const fy = PH_PAGE - 20;
      p.drawLine({ start: { x: ML, y: fy + 3 }, end: { x: ML + PW, y: fy + 3 },
        color: BORD, thickness: 0.4 });
      const label = `${immat}  ·  ${now}  ·  Page ${i+1} / ${totalPages}`;
      const tw = fontR.widthOfTextAtSize(label, 7);
      p.drawText(label, { x: ML + PW - tw, y: fy - 5, font: fontR, size: 7, color: GRAY });
    });

    const pdfBytes = await pdfDoc.save();
    const body     = new Uint8Array(pdfBytes);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="historique_ds_${immat.replace(/[^a-zA-Z0-9-]/g,"_")}.pdf"`,
      },
    });
  }

  // ── DOCX branch (default) ─────────────────────────────────────────────────
  // Dynamic import fixes Turbopack/Vercel build issues
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    HeadingLevel,
    AlignmentType,
    BorderStyle,
    WidthType,
    ShadingType,
    PageNumber,
    Header,
    Footer,
  } = await import("docx");

  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: COLORS.border };
  const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

  function labelValueRow(label: string, value: string, shade?: string) {
    return new TableRow({
      children: [
        new TableCell({
          borders,
          width: { size: 2200, type: WidthType.DXA },
          shading: { fill: shade ?? "F0F4F8", type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: label,
                  bold: true,
                  size: 18,
                  color: COLORS.labelFg,
                  font: "Arial",
                }),
              ],
            }),
          ],
        }),
        new TableCell({
          borders,
          width: { size: PAGE_W - 2200, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: [new TextRun({ text: value, size: 18, font: "Arial" })] })],
        }),
      ],
    });
  }

  function sectionHeading(text: string) {
    return new Paragraph({
      spacing: { before: 200, after: 60 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.sectionFg, space: 1 },
      },
      children: [new TextRun({ text, bold: true, size: 20, color: COLORS.sectionFg, font: "Arial" })],
    });
  }

  function buildVehicleTable(vehicle: ParcItem | null | undefined, fields: { key: string; label: string }[]) {
    return new Table({
      width: { size: PAGE_W, type: WidthType.DXA },
      columnWidths: [2200, PAGE_W - 2200],
      rows: fields.map((f) => labelValueRow(f.label, getVehicleValue(vehicle, f.key))),
    });
  }

  function buildDsInfoTable(item: DsItem, fields: string[], labels: Record<string, string>) {
    return new Table({
      width: { size: PAGE_W, type: WidthType.DXA },
      columnWidths: [2200, PAGE_W - 2200],
      rows: fields.map((key) => labelValueRow(labels[key] ?? key, getCardValue(item, key))),
    });
  }

  function buildLinesTable(
    lines: Line[],
    fields: string[],
    labels: Record<string, string>,
    totalMtHt?: number | null
  ) {
    const numKeys = new Set(["qte", "mt_ht", "prix_unitaire", "dernier_prix"]);
    const colW = Math.floor(PAGE_W / Math.max(fields.length, 1));
    const colWidths = fields.map((_, i) =>
      i === fields.length - 1 ? PAGE_W - colW * (fields.length - 1) : colW
    );

    const headerRow = new TableRow({
      tableHeader: true,
      children: fields.map((key, i) =>
        new TableCell({
          borders,
          width: { size: colWidths[i], type: WidthType.DXA },
          shading: { fill: COLORS.headerBg, type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [
            new Paragraph({
              alignment: numKeys.has(key) ? AlignmentType.RIGHT : AlignmentType.LEFT,
              children: [
                new TextRun({
                  text: labels[key] ?? key,
                  bold: true,
                  size: 18,
                  color: COLORS.headerFg,
                  font: "Arial",
                }),
              ],
            }),
          ],
        })
      ),
    });

    const dataRows = lines.map(
      (line, rowIdx) =>
        new TableRow({
          children: fields.map((key, i) =>
            new TableCell({
              borders,
              width: { size: colWidths[i], type: WidthType.DXA },
              shading: { fill: rowIdx % 2 === 1 ? COLORS.rowAlt : "FFFFFF", type: ShadingType.CLEAR },
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: numKeys.has(key) ? AlignmentType.RIGHT : AlignmentType.LEFT,
                  children: [new TextRun({ text: getLineValue(line, key), size: 18, font: "Arial" })],
                }),
              ],
            })
          ),
        })
    );

    const rows: InstanceType<typeof TableRow>[] = [headerRow, ...dataRows];

    if (lines.length > 1 && totalMtHt != null && fields.includes("mt_ht")) {
      rows.push(
        new TableRow({
          children: fields.map((key, i) =>
            new TableCell({
              borders,
              width: { size: colWidths[i], type: WidthType.DXA },
              shading: { fill: COLORS.totalBg, type: ShadingType.CLEAR },
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: numKeys.has(key) ? AlignmentType.RIGHT : AlignmentType.LEFT,
                  children: [
                    new TextRun({
                      text: key === "mt_ht" ? fmtNum(totalMtHt, 2) : i === 0 ? "Total" : "",
                      bold: true,
                      size: 18,
                      font: "Arial",
                    }),
                  ],
                }),
              ],
            })
          ),
        })
      );
    }

    return new Table({
      width: { size: PAGE_W, type: WidthType.DXA },
      columnWidths: colWidths,
      rows,
    });
  }

  const payload: ExportPayload = await req.json();
  const {
    items,
    count,
    visibleCardFields,
    visibleLineFields,
    vehicleMetaFields,
    cardFieldLabels,
    lineFieldLabels,
    topBarKeys,
    vehicle,
    imm,
    parcMandatoryKeys,
    parcExtraKeys,
  } = payload;

  const firstDs = items?.[0];
  // ✅ FIXED: vehicle.imm instead of vehicle.Immatriculation
  const immat = (vehicle?.imm ?? firstDs?.Immatriculation ?? imm ?? "—").toString();
  const now = new Date().toLocaleDateString("fr-FR");
  const topSet = new Set(topBarKeys);

  // Mirror the UI: mandatory DS fields always included in body (same as MANDATORY_CARD_KEYS in frontend)
  const MANDATORY_DS = new Set(["Description", "Techniciens", "ENTITE"]);
  const infoFieldsSet = new Set(visibleCardFields.filter(k => k !== "N°DS" && !topSet.has(k)));
  // Add mandatory fields if they were hidden by user (so export always matches minimum visible)
  MANDATORY_DS.forEach(k => infoFieldsSet.add(k));
  const infoFields = [...infoFieldsSet];

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 0, after: 120 },
      children: [
        new TextRun({
          text: `Historique DS — ${immat}`,
          bold: true,
          size: 36,
          color: COLORS.headerBg,
          font: "Arial",
        }),
      ],
    })
  );

  children.push(
    new Paragraph({
      spacing: { after: 300 },
      children: [
        new TextRun({
          text: `Généré le ${now}  ·  ${count} dossier${count > 1 ? "s" : ""}`,
          size: 18,
          color: "888888",
          font: "Arial",
        }),
      ],
    })
  );

  // Vehicle section — split into mandatory (always shown) + details
  children.push(sectionHeading("Véhicule — Données fixes (parc)"));

  // Only mandatory parc fields in export
  const mandatoryParcFields = vehicleMetaFields.filter(f => (parcMandatoryKeys ?? []).includes(f.key));
  children.push(buildVehicleTable(vehicle, mandatoryParcFields.length ? mandatoryParcFields : vehicleMetaFields));

  children.push(new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }));

  // ── CP contracts ──
  const contracts = payload.contracts ?? [];
  if (contracts.length > 0) {
    children.push(
      new Paragraph({
        spacing: { before: 200, after: 80 },
        children: [new TextRun({ text: `Contrats CP (${contracts.length})`, bold: true, size: 24, color: COLORS.headerBg, font: "Arial" })],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.headerBg } },
      })
    );
    contracts.forEach(cp => {
      const refLine = [cp.reference ?? "—", cp.statut ?? ""].filter(Boolean).join("  |  ");
      children.push(
        new Paragraph({
          spacing: { before: 160, after: 40 },
          children: [new TextRun({ text: refLine, bold: true, size: 20, color: COLORS.headerBg, font: "Arial" })],
        })
      );
      const cpFields: [string, string][] = [
        ["Marque / Modele", cp.marque && cp.model ? `${cp.marque} ${cp.model}` : (cp.marque ?? cp.model ?? "—")],
        ["Client",          cp.client ?? "—"],
        ["Version",         cp.version ?? "—"],
        ["Fin contrat",     cp.date_fin_contrat ?? "—"],
        ["VH relais",       cp.vh_relais ?? "—"],
        ["Type relais",     cp.type ?? "—"],
        ["Debut RL",        cp.date_debut_rl ?? "—"],
      ];
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: cpFields.map(([label, val]) =>
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 25, type: WidthType.PERCENTAGE },
                  shading: { fill: COLORS.altRow },
                  children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, font: "Arial" })] })],
                }),
                new TableCell({
                  width: { size: 75, type: WidthType.PERCENTAGE },
                  children: [new Paragraph({ children: [new TextRun({ text: val, size: 18, font: "Arial" })] })],
                }),
              ],
            })
          ),
        })
      );
    });
    children.push(new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }));
  }

  // DS items — only fields the user has checked visible in the UI
  items.forEach((it, idx) => {
    // Top summary line (mirrors the UI top bar)
    const topParts: string[] = [];
    if (visibleCardFields.includes("Date DS") && it["Date DS"])
      topParts.push(fmtDate(it["Date DS"]));
    if (visibleCardFields.includes("KM") && it.KM != null)
      topParts.push(fmtNum(it.KM) + " km");
    if (visibleCardFields.includes("MT Total HT") && it["MT Total HT"] != null)
      topParts.push(fmtNum(it["MT Total HT"], 2) + " MAD");
    if (visibleCardFields.includes("Site") && it.Site)
      topParts.push(it.Site);
    if (visibleCardFields.includes("Type DS") && it["Type DS"])
      topParts.push(it["Type DS"]!);
    if (visibleCardFields.includes("Affectation") && it.Affectation)
      topParts.push(it.Affectation);

    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: idx === 0 ? 0 : 400, after: 80 },
        children: [
          new TextRun({ text: it["N°DS"], bold: true, size: 26, color: COLORS.headerBg, font: "Arial" }),
          ...(topParts.length
            ? [
                new TextRun({ text: "    ", size: 22, font: "Arial" }),
                new TextRun({ text: topParts.join("  ·  "), size: 20, color: "666666", font: "Arial" }),
              ]
            : []),
        ],
      })
    );

    // Info grid — only fields visible in UI, minus top-bar ones and N°DS
    if (infoFields.length > 0) {
      children.push(buildDsInfoTable(it, infoFields, cardFieldLabels));
    }

    // Lines table — only columns visible in UI
    if (it.lines?.length && visibleLineFields.length > 0) {
      children.push(
        new Paragraph({
          spacing: { before: 140, after: 60 },
          children: [
            new TextRun({
              text: `Lignes (${it.lines.length})`,
              bold: true,
              size: 18,
              color: COLORS.sectionFg,
              font: "Arial",
            }),
          ],
        })
      );
      children.push(buildLinesTable(it.lines, visibleLineFields, lineFieldLabels, it["MT Total HT"]));
    }
  });

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border, space: 1 } },
                children: [
                  new TextRun({ text: `Historique DS — ${immat}`, size: 18, color: "888888", font: "Arial" }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border, space: 1 } },
                children: [
                  new TextRun({ text: `${now}  ·  Page `, size: 16, color: "888888", font: "Arial" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888", font: "Arial" }),
                  new TextRun({ text: " / ", size: 16, color: "888888", font: "Arial" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "888888", font: "Arial" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const body = new Uint8Array(buffer);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="historique_ds_${immat.replace(/[^a-zA-Z0-9-]/g, "_")}.docx"`,
    },
  });
}