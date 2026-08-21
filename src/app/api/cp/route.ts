// src/app/api/cp/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongo/client";
import { toErrorResponse } from "@/lib/http/apiError";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const imm    = searchParams.get("imm")?.trim();
  const ww     = searchParams.get("ww")?.trim();

  if (!imm && !ww) {
    return NextResponse.json(
      { ok: false, error: "Missing query param: imm or ww" },
      { status: 400 }
    );
  }

  try {
    const col = await getCollection("cp");

    const orClauses: Record<string, unknown>[] = [];
    if (imm) orClauses.push({ imm: imm });
    if (ww)  orClauses.push({ ww: ww });
    const match = orClauses.length === 1 ? orClauses[0] : { $or: orClauses };

    const items = await col.aggregate([
      { $match: match },
      {
        $project: {
          _id:                0,
          gestionnaire:       "$gestionnaire",
          ww:                 "$ww",
          imm:                "$imm",
          vin:                "$num_chassis",
          marque:             "$marque",
          model:              "$modele",
          version:            "$libelle_version_long",
          type_location:      "$type_location",
          mce_date:           "$date_mce",
          date_debut_contrat: "$date_debut_contrat",
          date_fin_contrat:   "$date_fin_contrat",
          type:               "$type_vh_relais",
          jockey:             "$jockey",
          // Added once ~/import 8ecafd5 put these into cp. `client` is the
          // renting client (the card prefers it over parc's); `statut` is the
          // contract lifecycle — "Arret facturation" is what legitimately
          // explains a vehicle having no parc row.
          client:             "$client",
          statut:             "$statut",
        },
      },
      { $limit: 50 },
    ]).toArray();

    return NextResponse.json({
      ok:    true,
      count: items.length,
      items,
      item:  items[0] ?? null,
    });
  } catch (e) {
    return toErrorResponse(e, "Query failed");
  }
}
