// app/api/cp/route.ts
import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongo";

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
    if (imm) orClauses.push({ IMM: imm });
    if (ww)  orClauses.push({ WW: ww });
    const match = orClauses.length === 1 ? orClauses[0] : { $or: orClauses };

    const items = await col.aggregate([
      { $match: match },
      {
        $project: {
          _id:                0,
          gestionnaire:       "$Gestionnaire",
          ww:                 "$WW",
          imm:                "$IMM",
          vin:                "$NUM chassis",
          marque:             "$Marque",
          model:              "$Modèle",
          version:            "$Libellé version long",
          type_location:      "$Type location",
          mce_date:           "$Date MCE",
          date_debut_contrat: "$Date début contrat",
          date_fin_contrat:   "$Date fin contrat",
          type:               "$Type",
          jockey:             "$Jockey",
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
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Query failed" },
      { status: 500 }
    );
  }
}
