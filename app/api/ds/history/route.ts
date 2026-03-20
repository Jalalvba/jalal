// app/api/ds/history/route.ts
import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import type { Document } from "mongodb";

function parseYear(yearStr: string | null): { start?: Date; end?: Date } {
  if (!yearStr) return {};
  const y = Number(yearStr);
  if (!Number.isInteger(y) || y < 1970 || y > 2100) return {};
  return {
    start: new Date(`${y}-01-01T00:00:00.000Z`),
    end:   new Date(`${y + 1}-01-01T00:00:00.000Z`),
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

  const limit             = clampInt(searchParams.get("limit"), 200, 1, 2000);
  const { start, end }    = parseYear(searchParams.get("year"));

  const dbName   = process.env.MONGODB_DB || "avis";
  const client   = await clientPromise;
  const col      = client.db(dbName).collection("ds");

  const match: Record<string, unknown> = { Immatriculation: imm };
  if (start && end) match["Date DS"] = { $gte: start, $lt: end };

  const pipeline: Document[] = [
    { $match: match },

    // Group by N°DS — aggregate lines per DS
    {
      $group: {
        _id: "$N°DS",

        nds:           { $first: "$N°DS" },
        date_ds:       { $first: "$Date DS" },
        imm:           { $first: "$Immatriculation" },
        km_max:        { $max: { $toDouble: "$KM" } },
        entite:        { $first: "$ENTITE" },
        description:   { $first: "$Description" },

        lines: {
          $push: {
            code_art:          "$Code art",
            designation_conso: "$Désignation Consomation",
            qte:               "$Qté",
            cmd_num:           "$CMD Num",
            fournisseur:       "$Founisseur",
            technicein:        "$Technicein",
          },
        },
      },
    },

    // Clean up techniciens list from lines
    {
      $addFields: {
        techniciens: {
          $setUnion: [
            {
              $filter: {
                input: { $map: { input: "$lines", as: "l", in: "$$l.technicein" } },
                as:    "t",
                cond:  { $and: [{ $ne: ["$$t", null] }, { $ne: ["$$t", ""] }] },
              },
            },
            [],
          ],
        },
      },
    },

    {
      $project: {
        _id:           0,
        "N°DS":        "$nds",
        "Date DS":     "$date_ds",
        Immatriculation: "$imm",
        KM:            "$km_max",
        ENTITE:        "$entite",
        Description:   "$description",
        Techniciens:   "$techniciens",
        lines:         1,
      },
    },

    { $sort:  { "Date DS": -1 } },
    { $limit: limit },

    // BC price lookup per line
    {
      $lookup: {
        from: "bc",
        let:  { ds_lines: "$lines" },
        pipeline: [
          {
            $match: {
              $expr: {
                $gt: [
                  {
                    $size: {
                      $filter: {
                        input: "$$ds_lines",
                        as:    "line",
                        cond: {
                          $and: [
                            { $eq: ["$CMD Num",      "$$line.cmd_num"] },
                            { $eq: ["$Code article", "$$line.code_art"] },
                          ],
                        },
                      },
                    },
                  },
                  0,
                ],
              },
            },
          },
          { $project: { _id: 0, "CMD Num": 1, "Code article": 1, PU: 1 } },
        ],
        as: "bc_prices",
      },
    },

    // Merge BC price into each line
    {
      $addFields: {
        lines: {
          $map: {
            input: "$lines",
            as:    "line",
            in: {
              $mergeObjects: [
                "$$line",
                {
                  price_source: {
                    $let: {
                      vars: {
                        bc_match: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: "$bc_prices",
                                as:    "bc",
                                cond: {
                                  $and: [
                                    { $eq: ["$$bc.CMD Num",      "$$line.cmd_num"] },
                                    { $eq: ["$$bc.Code article", "$$line.code_art"] },
                                  ],
                                },
                              },
                            },
                            0,
                          ],
                        },
                      },
                      in: { $cond: [{ $ifNull: ["$$bc_match", false] }, "bc", "ds"] },
                    },
                  },
                  bc_pu: {
                    $let: {
                      vars: {
                        bc_match: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: "$bc_prices",
                                as:    "bc",
                                cond: {
                                  $and: [
                                    { $eq: ["$$bc.CMD Num",      "$$line.cmd_num"] },
                                    { $eq: ["$$bc.Code article", "$$line.code_art"] },
                                  ],
                                },
                              },
                            },
                            0,
                          ],
                        },
                      },
                      in: { $ifNull: ["$$bc_match.PU", null] },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },

    { $unset: "bc_prices" },
  ];

  const items = await col.aggregate(pipeline).toArray();

  return NextResponse.json({ ok: true, imm, count: items.length, items });
}
