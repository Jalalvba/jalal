// src/app/api/ds/history/route.ts
import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongo/client";
import { toErrorResponse } from "@/lib/http/apiError";
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

  const match: Record<string, unknown> = { immatriculation: imm };
  if (start && end) match["date_ds"] = { $gte: start, $lt: end };

  const pipeline: Document[] = [
    { $match: match },

    {
      $addFields: {
        km_num: {
          $convert: {
            input: {
              $replaceAll: {
                input: { $replaceAll: { input: { $toString: "$km" }, find: ",", replacement: "" } },
                find: " ",
                replacement: "",
              },
            },
            to: "double", onError: null, onNull: null
          }
        },

      },
    },

    { $sort: { date_ds: -1 } },

    {
      $group: {
        _id: "$n_ds",

        nds:          { $first: "$n_ds" },
        date_ds:      { $first: "$date_ds" },
        imm:          { $first: "$immatriculation" },
        entite:       { $first: "$entite_nom" },
        description:  { $first: "$description" },
        fournisseur:  { $first: "$fournisseur" },
        km_max:       { $max: "$km_num" },


        techniciens_raw: { $push: "$technicien" },

        lines: {
          $push: {
            cmd_num:          "$cmd_num",
            code_art:         "$code_art",
            // TEMPORARY dual-read: field_mapping.py's rename of
            // "Désignation Consomation" -> designation_consommation had a
            // trailing-space typo that made it never actually apply, so
            // ~252k/258k live `ds` docs still carry the old dirty key.
            // Remove this $ifNull fallback (and the dirty key) once the
            // Part 5 backfill has renamed the field on every existing doc.
            // verify-field-names:allow designation_consommation -- clean key not yet backfilled onto existing docs, see above
            designation_consommation: {
              $ifNull: ["$designation_consommation", "$Désignation Consomation"],
            },
            qte:              "$qte",

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
        n_ds:            "$nds",
        date_ds:         "$date_ds",
        immatriculation: "$imm",
        entite_nom:      "$entite",
        description:     "$description",
        fournisseur:     "$fournisseur",
        techniciens:     "$techniciens",
        km:              "$km_max",

        lines: 1,
      },
    },

    { $sort: { date_ds: -1 } },
    { $limit: limit },
  ];

  try {
    const col = await getCollection("ds");
    const items = await col.aggregate(pipeline).toArray();

    return NextResponse.json({
      ok: true,
      imm,
      count: items.length,
      items,
    });
  } catch (e) {
    return toErrorResponse(e, "Query failed");
  }
}
