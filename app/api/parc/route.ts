// app/api/parc/route.ts
import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("imm")?.trim();
  if (!q) {
    return NextResponse.json(
      { ok: false, error: "Missing required query param: imm" },
      { status: 400 }
    );
  }

  const dbName = process.env.MONGODB_DB || "avis";
  const client = await clientPromise;
  const db     = client.db(dbName);
  const col    = db.collection("parc");

  const items = await col.aggregate([
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
        _id:           0,
        client:        "$Client",
        brand:         "$Marque",
        model:         "$Modèle",
        imm:           "$Immatriculation",
        ww:            "$Numéro WW",
        vin:           "$N° de chassis",
        vehicle_state: "$Etat véhicule",
        mce_date:      "$Date MCE",
        location_type: "$Type location",
        tenant:        "$Locataire",
      },
    },
    { $limit: 1 },
  ]).toArray();

  return NextResponse.json({
    ok:    true,
    query: q,
    count: items.length,
    items,
    item:  items[0] ?? null,
  });
}
