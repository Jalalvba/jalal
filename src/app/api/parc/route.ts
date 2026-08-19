// src/app/api/parc/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongo/client";
import { toErrorResponse } from "@/lib/http/apiError";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("imm")?.trim();
  if (!q) {
    return NextResponse.json(
      { ok: false, error: "Missing required query param: imm" },
      { status: 400 }
    );
  }

  try {
    const col = await getCollection("parc");

    const items = await col.aggregate([
      {
        $match: {
          $or: [
            { immatriculation: q },
            { numero_ww: q },
            { n_de_chassis: q },
          ],
        },
      },
      {
        $project: {
          _id:           0,
          client:        "$client",
          brand:         "$marque",
          model:         "$modele",
          imm:           "$immatriculation",
          ww:            "$numero_ww",
          vin:           "$n_de_chassis",
          vehicle_state: "$etat_vehicule",
          mce_date:      "$date_mce",
          location_type: "$type_location",
          tenant:        "$locataire",
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
  } catch (e) {
    return toErrorResponse(e, "Query failed");
  }
}
