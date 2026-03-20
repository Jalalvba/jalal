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

  const dbName = process.env.MONGODB_DB || "avis";
  const client = await clientPromise;
  const db = client.db(dbName);
  const col = db.collection("ds");

  const match: Record<string, unknown> = { Immatriculation: imm };
  if (start && end) match["Date DS"] = { $gte: start, $lt: end };

  const pipeline: Document[] = [
    { $match: match },

    {
      $addFields: {
        km_num: {
          $convert: {
            input: { $replaceAll: { input: { $toString: "$KM" }, find: ",", replacement: "" } },
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

    // ── BC price lookup ────────────────────────────────────────────────────
    {
      $lookup: {
        from: "bc",
        let: { ds_lines: "$lines" },
        pipeline: [
          {
            $match: {
              $expr: {
                $gt: [
                  {
                    $size: {
                      $filter: {
                        input: "$$ds_lines",
                        as: "line",
                        cond: {
                          $and: [
                            { $eq: ["$CMD Num", "$$line.cmd_num"] },
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

    {
      $addFields: {
        lines: {
          $map: {
            input: "$lines",
            as: "line",
            in: {
              $mergeObjects: [
                "$$line",
                {
                  mt_ht: {
                    $let: {
                      vars: {
                        bc_match: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: "$bc_prices",
                                as: "bc",
                                cond: {
                                  $and: [
                                    { $eq: ["$$bc.CMD Num", "$$line.cmd_num"] },
                                    { $eq: ["$$bc.Code article", "$$line.code_art"] },
                                  ],
                                },
                              },
                            },
                            0,
                          ],
                        },
                      },
                      in: "$$bc_match.PU",
                    },
                  },
                  price_source: {
                    $let: {
                      vars: {
                        bc_match: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: "$bc_prices",
                                as: "bc",
                                cond: {
                                  $and: [
                                    { $eq: ["$$bc.CMD Num", "$$line.cmd_num"] },
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

  return NextResponse.json({
    ok: true,
    imm,
    count: items.length,
    items,
  });
}
