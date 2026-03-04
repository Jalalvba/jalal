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

  // number of DS documents (not lines) you want back
  const limit = clampInt(searchParams.get("limit"), 200, 1, 2000);

  const { start, end } = parseYear(searchParams.get("year"));

  const dbName = process.env.MONGODB_DB || "avis360";
  const client = await clientPromise;
  const db = client.db(dbName);
  const col = db.collection("ds");

  const match: Record<string, unknown> = { Immatriculation: imm };
  if (start && end) match["Date DS"] = { $gte: start, $lt: end };

  const pipeline: Document[] = [
    { $match: match },

    // Optional: clean KM to number so max KM works even if stored like "336,349.00"
    {
      $addFields: {
        km_num: {
          $let: {
            vars: { s: { $toString: "$KM" } },
            in: {
              $convert: {
                input: {
                  $replaceAll: {
                    input: {
                      $replaceAll: {
                        input: "$$s",
                        find: ",",
                        replacement: "",
                      },
                    },
                    find: " ",
                    replacement: "",
                  },
                },
                to: "double",
                onError: null,
                onNull: null,
              },
            },
          },
        },
      },
    },

    // Sort lines so when we $group and take $first, we keep the newest DS info
    { $sort: { "Date DS": -1 } },

    // Group all lines that share the same N°DS
    {
      $group: {
        _id: "$N°DS",

        // "header" fields (take from the newest line)
        nds: { $first: "$N°DS" },
        site: { $first: "$Site" },
        date_ds: { $first: "$Date DS" },
        imm: { $first: "$Immatriculation" },
        entite: { $first: "$ENTITE" },
        description: { $first: "$Description" },

        // pick a technician (first non-empty). You can refine later.
        technicien: { $first: "$Technicein" },

        // max KM across lines of the same N°DS
        km_max: { $max: "$km_num" },

        // collect the lines
        lines: {
          $push: {
            code_art: "$Code art",
            designation: "$Désignation Consomation",
            qte: "$Qté",
            mt_ht: "$Mt HT DS",
          },
        },
      },
    },

    // Rename fields + remove _id
    {
      $project: {
        _id: 0,
        "N°DS": "$nds",
        Site: "$site",
        "Date DS": "$date_ds",
        Immatriculation: "$imm",
        KM: "$km_max",
        ENTITE: "$entite",
        Description: "$description",
        Technicien: "$technicien",
        lines: 1,
      },
    },

    // Ensure DS documents remain sorted newest -> oldest
    { $sort: { "Date DS": -1 } },

    { $limit: limit },
  ];

  const items = await col.aggregate(pipeline).toArray();

  return NextResponse.json({ ok: true, imm, count: items.length, items });
}