import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const article   = searchParams.get("article")?.trim() || "";
  const brand     = searchParams.get("brand")?.trim()   || "";
  const yearParam = searchParams.get("year");
  const limit     = Math.min(Number(searchParams.get("limit") || 200), 500);

  if (!article) {
    return NextResponse.json(
      { ok: false, error: "article parameter is required" },
      { status: 400 }
    );
  }

  try {
    const dbName = process.env.MONGODB_DB || "avis";
    const client = await clientPromise;
    const db     = client.db(dbName);
    const col    = db.collection("bc");

    const words = article.split(/\s+/).filter(Boolean);
    const wordFilters = words.map((w) => ({
      "Description article": { $regex: w, $options: "i" },
    }));

    const pipeline: any[] = [
      {
        $match: {
          $and: [
            ...wordFilters,
            { "Code article": { $not: /^PIM/i } },
          ],
        },
      },

      {
        $addFields: {
          pu_numeric: {
            $convert: {
              input: {
                $replaceAll: {
                  input: {
                    $replaceAll: {
                      input: { $toString: "$PU" },
                      find: ",",
                      replacement: "",
                    },
                  },
                  find: " ",
                  replacement: "",
                },
              },
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
          Année: {
            $cond: {
              if:   { $ifNull: ["$Date BC", false] },
              then: { $year: { $toDate: "$Date BC" } },
              else: null,
            },
          },
        },
      },
    ];

    if (yearParam && yearParam !== "all") {
      pipeline.push({ $match: { Année: Number(yearParam) } });
    }

    pipeline.push(
      { $match: { pu_numeric: { $gt: 0 } } },
      { $sort: { pu_numeric: -1 } },

      // ── Limit BEFORE expensive lookups ───────────────────────────────────
      { $limit: limit },

      // ── lookup parc ───────────────────────────────────────────────────────
      {
        $lookup: {
          from: "parc",
          let:  { imm: "$Immatriculation" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$$imm", null] },
                    { $ne: ["$$imm", ""]   },
                    { $eq: ["$Immatriculation", "$$imm"] },
                  ],
                },
              },
            },
            {
              $project: {
                _id:     0,
                Marque:  "$Marque",
                Modele:  "$Modèle",
                DateMCE: "$Date MCE",
              },
            },
            { $limit: 1 },
          ],
          as: "_parc",
        },
      },
      {
        $addFields: {
          Marque:  { $ifNull: [{ $arrayElemAt: ["$_parc.Marque",  0] }, null] },
          Modele:  { $ifNull: [{ $arrayElemAt: ["$_parc.Modele",  0] }, null] },
          DateMCE: { $ifNull: [{ $arrayElemAt: ["$_parc.DateMCE", 0] }, null] },
        },
      },
      { $unset: "_parc" },

      // ── lookup cp ─────────────────────────────────────────────────────────
      {
        $lookup: {
          from: "cp",
          let:  { imm: "$Immatriculation" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$$imm", null] },
                    { $ne: ["$$imm", ""]   },
                    { $eq: ["$IMM", "$$imm"] },
                  ],
                },
              },
            },
            {
              $project: {
                _id:     0,
                Version: "$Libellé version long",
                MCE:     "$Date MCE",
              },
            },
            { $limit: 1 },
          ],
          as: "_cp",
        },
      },
      {
        $addFields: {
          Version: { $ifNull: [{ $arrayElemAt: ["$_cp.Version", 0] }, null] },
          DateMCE: {
            $ifNull: [
              { $arrayElemAt: ["$_cp.MCE", 0] },
              "$DateMCE",
            ],
          },
        },
      },
      { $unset: "_cp" },
    );

    // brand filter after parc join — matches Marque OR Modele
    if (brand) {
      pipeline.push({
        $match: {
          $or: [
            { Marque: { $regex: brand, $options: "i" } },
            { Modele: { $regex: brand, $options: "i" } },
          ],
        },
      });
    }

    pipeline.push({
      $project: {
        _id:                   0,
        "CMD Num":             1,
        "Date BC":             1,
        Fournisseurs:          1,
        "Code article":        1,
        "Description article": 1,
        PU:                    1,
        "Qté":                 1,
        "N° DS":               1,
        "Cree par":            1,
        Année:                 1,
        Prix:                  { $round: ["$pu_numeric", 2] },
        Immatriculation:       1,
        Marque:                1,
        Modele:                1,
        Version:               1,
        DateMCE:               1,
      },
    });

    const items = await col.aggregate(pipeline).toArray();

    return NextResponse.json({ ok: true, count: items.length, items });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: "Aggregation failed" },
      { status: 500 }
    );
  }
}
