import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongo";
import { escapeRegex } from "@/lib/regex";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import type { Document } from "mongodb";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = Number(v ?? def);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export async function GET(request: Request) {
  const { allowed, retryAfterSeconds } = await checkRateLimit(
    "article",
    clientIp(request),
    RATE_LIMIT,
    RATE_WINDOW_MS
  );
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: `Trop de requêtes. Réessayez dans ${retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  const { searchParams } = new URL(request.url);

  const article   = searchParams.get("article")?.trim() || "";
  const brand     = searchParams.get("brand")?.trim()   || "";
  const yearParam = searchParams.get("year");
  const limit     = clampInt(searchParams.get("limit"), 200, 1, 500);

  if (!article) {
    return NextResponse.json(
      { ok: false, error: "article parameter is required" },
      { status: 400 }
    );
  }

  try {
    const col = await getCollection("bc");

    const words = article.split(/\s+/).filter(Boolean);
    const wordFilters = words.map((w) => ({
      "Description article": { $regex: escapeRegex(w), $options: "i" },
    }));

    const pipeline: Document[] = [
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

    const year = yearParam && yearParam !== "all" ? Number(yearParam) : null;
    if (year !== null && Number.isInteger(year)) {
      pipeline.push({ $match: { Année: year } });
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
            { Marque: { $regex: escapeRegex(brand), $options: "i" } },
            { Modele: { $regex: escapeRegex(brand), $options: "i" } },
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
