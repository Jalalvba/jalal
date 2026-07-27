// app/api/ds/history/route.ts
import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongo";
import { toErrorResponse } from "@/lib/apiError";
import type { Document } from "mongodb";

function parseYear(yearStr: string | null): { start?: Date; end?: Date } {
  if (!yearStr) return {};
  const y = Number(yearStr);
  if (!Number.isInteger(y) || y < 1970 || y > 2100) return {};
  return {
    start: new Date(`${y}-01-01T00:00:00.000Z`),
    end: new Date(`${y + 1}-01-01T00:00:00.000Z`),
  };
}

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = Number(v ?? def);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const imm = searchParams.get("imm")?.trim();
  if (!imm) {
    return NextResponse.json(
      { ok: false, error: "Missing required query param: imm" },
      { status: 400 }
    );
  }

  const limit = clampInt(searchParams.get("limit"), 200, 1, 2000);
  const { start, end } = parseYear(searchParams.get("year"));

  const match: Record<string, unknown> = { Immatriculation: imm };
  if (start && end) match["Date DS"] = { $gte: start, $lt: end };

  const pipeline: Document[] = [
    { $match: match },

    {
      $addFields: {
        km_num: {
          $convert: {
            input: {
              $replaceAll: {
                input: { $replaceAll: { input: { $toString: "$KM" }, find: ",", replacement: "" } },
                find: " ",
                replacement: "",
              },
            },
            to: "double", onError: null, onNull: null
          }
        },

      },
    },

    { $sort: { "Date DS": -1 } },

    {
      $group: {
        _id: "$N°DS",

        nds:          { $first: "$N°DS" },
        date_ds:      { $first: "$Date DS" },
        imm:          { $first: "$Immatriculation" },
        entite:       { $first: "$ENTITE" },
        description:  { $first: "$Description" },
        fournisseur:  { $first: "$Founisseur" },
        km_max:       { $max: "$km_num" },


        techniciens_raw: { $push: "$Technicein" },

        lines: {
          $push: {
            cmd_num:          "$CMD Num",
            code_art:         "$Code art",
            designation_conso: "$Désignation Consomation",
            qte:              "$Qté",

          },
        },
      },
    },

    {
      $addFields: {
        techniciens: {
          $setUnion: [
            {
              $filter: {
                input: "$techniciens_raw",
                as: "t",
                cond: {
                  $and: [
                    { $ne: ["$$t", null] },
                    { $ne: ["$$t", ""] },
                    { $ne: [{ $trim: { input: "$$t" } }, ""] },
                  ],
                },
              },
            },
            [],
          ],
        },
      },
    },

    {
      $project: {
        _id: 0,
        "N°DS":        "$nds",
        "Date DS":     "$date_ds",
        Immatriculation: "$imm",
        ENTITE:        "$entite",
        Description:   "$description",
        Fournisseur:   "$fournisseur",
        Techniciens:   "$techniciens",
        KM:            "$km_max",

        lines: 1,
      },
    },

    { $sort: { "Date DS": -1 } },
    { $limit: limit },
  ];

  // ── BC price join ───────────────────────────────────────────────────────
  // Was a $lookup with let+pipeline+$expr correlating each DS group's whole
  // `lines` array against "bc" — confirmed via explain() to never use bc's
  // {CMD Num, Code article} index regardless of shape (a correlated
  // let-bound subquery just doesn't get the index here, even for plain
  // scalar equality: "indexesUsed": [], "collectionScans": N), forcing a
  // full 56K-doc scan of "bc" per DS group (or, in an unwind-first attempt,
  // per line — confirmed empirically WORSE: 11.7s vs 6.9s on a 226-line
  // plate). A standalone, non-correlated query against the same fields DOES
  // use the index (confirmed via explain: IXSCAN) — so this now collects
  // every (cmd_num, code_art) pair up front and does ONE plain $or query
  // against "bc", then merges PU values back onto the lines in application
  // code. Same "first match wins, no explicit tie-break" semantics as
  // before for any duplicate (CMD Num, Code article) pairs in "bc".
  type LineDoc = { cmd_num?: string; code_art?: string; designation_conso?: string; qte?: unknown };
  type GroupDoc = { lines: LineDoc[]; [key: string]: unknown };

  function collectPairs(items: GroupDoc[]): { cmd: unknown; code: unknown }[] {
    const seen = new Set<string>();
    const pairs: { cmd: unknown; code: unknown }[] = [];
    for (const item of items) {
      for (const line of item.lines) {
        const key = JSON.stringify([line.cmd_num, line.code_art]);
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ cmd: line.cmd_num, code: line.code_art });
      }
    }
    return pairs;
  }

  async function fetchBcMatches(pairs: { cmd: unknown; code: unknown }[]) {
    const map = new Map<string, { PU: unknown }>();
    if (pairs.length === 0) return map;

    const bcCol = await getCollection("bc");
    const docs = await bcCol
      .find(
        { $or: pairs.map((p) => ({ "CMD Num": p.cmd, "Code article": p.code })) },
        { projection: { _id: 0, "CMD Num": 1, "Code article": 1, PU: 1 } }
      )
      .toArray();

    for (const doc of docs) {
      const key = JSON.stringify([doc["CMD Num"], doc["Code article"]]);
      if (!map.has(key)) map.set(key, { PU: doc["PU"] });
    }
    return map;
  }

  function mergeBcPrices(items: GroupDoc[], bcMatches: Map<string, { PU: unknown }>): GroupDoc[] {
    return items.map((item) => ({
      ...item,
      lines: item.lines.map((line) => {
        const match = bcMatches.get(JSON.stringify([line.cmd_num, line.code_art]));
        return {
          ...line,
          mt_ht: match ? match.PU : undefined,
          price_source: match ? "bc" : "ds",
        };
      }),
    }));
  }

  try {
    const col = await getCollection("ds");
    const items = (await col.aggregate(pipeline).toArray()) as unknown as GroupDoc[];

    const bcMatches = await fetchBcMatches(collectPairs(items));
    const merged = mergeBcPrices(items, bcMatches);

    return NextResponse.json({
      ok: true,
      imm,
      count: merged.length,
      items: merged,
    });
  } catch (e) {
    return toErrorResponse(e, "Query failed");
  }
}
