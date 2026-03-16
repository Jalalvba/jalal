import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

export async function GET(request: Request) {

  const { searchParams } = new URL(request.url);

  const article = searchParams.get("article")?.trim() || "";
  const model = searchParams.get("model")?.trim() || "";
  const yearParam = searchParams.get("year");

  if (!article || !model) {
    return NextResponse.json(
      { ok: false, error: "article and model parameters are required" },
      { status: 400 }
    );
  }

  try {

    const dbName = process.env.MONGODB_DB || "avis360";
    const client = await clientPromise;
    const db = client.db(dbName);
    const col = db.collection("ds");

    /* -------------------------------
       MULTI WORD SEARCH
       "boite vitesse" -> ["boite","vitesse"]
    ------------------------------- */

    const words = article.split(/\s+/).filter(Boolean);

    const wordFilters = words.map((w) => ({
      "Désignation Consomation ": { $regex: w, $options: "i" }
    }));


    const pipeline: any[] = [

      {
        $match: {
          $and: [
            ...wordFilters,
            { "Désignation véhicule": { $regex: model, $options: "i" } },
            { "Code art": { $not: /^PIM/i } }
          ]
        }
      },

      {
        $addFields: {

          /* Convert price string → numeric */

          pu_numeric: {
            $convert: {
              input: {
                $replaceAll: {
                  input: {
                    $replaceAll: {
                      input: { $toString: "$Prix Unitaire ds" },
                      find: ",",
                      replacement: ""
                    }
                  },
                  find: " ",
                  replacement: ""
                }
              },
              to: "double",
              onError: 0,
              onNull: 0
            }
          },

          /* Extract year */

          Année: { $year: "$Date DS" }

        }
      }

    ];

    /* -------------------------------
       YEAR FILTER
    ------------------------------- */

    if (yearParam && yearParam !== "all") {

      pipeline.push({
        $match: { Année: Number(yearParam) }
      });

    }

    pipeline.push(

      {
        $match: { pu_numeric: { $gt: 0 } }
      },

      {
        $sort: { pu_numeric: -1 }
      },

      {
        $project: {

          _id: 0,

          "N°DS": 1,
          "CMD Num": 1,
          "Code art": 1,

          Année: 1,

          "Désignation Consomation ": 1,

          Fournisseur: "$Founisseur",

          Prix: { $round: ["$pu_numeric", 2] }

        }
      }

    );

    const items = await col.aggregate(pipeline).toArray();

    return NextResponse.json({
      ok: true,
      count: items.length,
      items
    });

  } catch (error) {

    console.error(error);

    return NextResponse.json(
      { ok: false, error: "Aggregation failed" },
      { status: 500 }
    );

  }

}