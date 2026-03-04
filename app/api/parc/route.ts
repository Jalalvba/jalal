// app/api/parc/route.ts
import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = Number(v ?? def);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("imm")?.trim();
  if (!q) {
    return NextResponse.json(
      { ok: false, error: "Missing required query param: imm" },
      { status: 400 }
    );
  }

  const limit = clampInt(searchParams.get("limit"), 1, 1, 50);

  const dbName = process.env.MONGODB_DB || "avis360";
  const client = await clientPromise;
  const db = client.db(dbName);

  const col = db.collection("parc");

  const items = await col
    .aggregate([
      {
        $match: {
          $or: [
            { Immatriculation: q },
            { "Numéro WW": q },
            { "N° de chassis": q },
          ],
        },
      },
      {
        $project: {
          _id: 0,

          id: "$ID",
          company: "$Société",
          client: "$Client",

          brand: "$Marque",
          model: "$Modèle",

          imm: "$Immatriculation",
          ww: "$Numéro WW",
          vin: "$N° de chassis",

          vehicle_state: "$Etat véhicule",
          vehicle_type: "$Type véhicule",

          location_type: "$Type location",
          tenant: "$Locataire",

          received: "$Reçu",
          received_date: "$Date réception",
          mce_date: "$Date MCE",

          sold: "$Vendu",
          scrap: "$Epave",

          purchase_order: "$BC",
          purchase_price_net: "$Prix achat net",
        },
      },
      { $limit: limit },
    ])
    .toArray();

  return NextResponse.json({
    ok: true,
    query: q,
    count: items.length,
    items,
    item: items[0] ?? null,
  });
}