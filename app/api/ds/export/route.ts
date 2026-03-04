// app/api/ds/export/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// ─── Types (mirror the frontend) ─────────────────────────────────────────────

type Line = {
  n_intervention?: string;
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

type ExportPayload = {
  imm: string;
  count: number;
  items: DsItem[];
  visibleCardFields: string[];
  visibleLineFields: string[];
  vehicleMetaFields: { key: string; label: string }[];
  cardFieldLabels: Record<string, string>;
  lineFieldLabels: Record<string, string>;
  topBarKeys: string[];
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
  // ✅ Dynamic import fixes Turbopack/Vercel build issues
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
          children: [
            new Paragraph({
              children: [new TextRun({ text: value, size: 18, font: "Arial" })],
            }),
          ],
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

  function buildVehicleTable(item: DsItem, fields: { key: string; label: string }[]) {
    return new Table({
      width: { size: PAGE_W, type: WidthType.DXA },
      columnWidths: [2200, PAGE_W - 2200],
      rows: fields.map((f) =>
        labelValueRow(
          f.label,
          (() => {
            const v = (item as Record<string, unknown>)[f.key];
            return v != null ? String(v).trim() || "—" : "—";
          })()
        )
      ),
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
    const colW = Math.floor(PAGE_W / fields.length);
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

    const rows: any[] = [headerRow, ...dataRows];

    if (lines.length > 1 && totalMtHt != null && fields.includes("mt_ht")) {
      const totalRow = new TableRow({
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
      });
      rows.push(totalRow);
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
  } = payload;

  const vehicle = items[0];
  const immat = vehicle?.Immatriculation ?? "—";
  const now = new Date().toLocaleDateString("fr-FR");
  const topSet = new Set(topBarKeys);

  const infoFields = visibleCardFields.filter((k) => k !== "N°DS" && !topSet.has(k));

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];

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

  children.push(sectionHeading("Véhicule — Données fixes"));
  children.push(buildVehicleTable(vehicle, vehicleMetaFields));
  children.push(new Paragraph({ spacing: { before: 300, after: 0 }, children: [] }));

  items.forEach((it, idx) => {
    const topParts: string[] = [];
    if (visibleCardFields.includes("Date DS") && it["Date DS"]) topParts.push(fmtDate(it["Date DS"]));
    if (visibleCardFields.includes("Site") && it.Site) topParts.push(it.Site);
    if (visibleCardFields.includes("Type DS") && it["Type DS"]) topParts.push(it["Type DS"]!);
    if (visibleCardFields.includes("KM") && it.KM != null) topParts.push(fmtNum(it.KM) + " km");
    if (visibleCardFields.includes("MT Total HT") && it["MT Total HT"] != null)
      topParts.push(fmtNum(it["MT Total HT"], 2) + " MAD");

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

    if (infoFields.length > 0) {
      children.push(buildDsInfoTable(it, infoFields, cardFieldLabels));
    }

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
                children: [new TextRun({ text: `Historique DS — ${immat}`, size: 18, color: "888888", font: "Arial" })],
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

  // ✅ TS-safe: convert Buffer -> Uint8Array (BodyInit compatible)
  const body = new Uint8Array(buffer);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="historique_ds_${immat.replace(
        /[^a-zA-Z0-9-]/g,
        "_"
      )}.docx"`,
    },
  });
}