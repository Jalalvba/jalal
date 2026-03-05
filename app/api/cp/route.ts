// app/api/cp/route.ts
import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = Number(v ?? def);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // ── Search param: accept imm OR ww OR ref OR client
  const imm    = searchParams.get("imm")?.trim();
  const ww     = searchParams.get("ww")?.trim();
  const ref    = searchParams.get("ref")?.trim();
  const client = searchParams.get("client")?.trim();

  // At least one param required
  if (!imm && !ww && !ref && !client) {
    return NextResponse.json(
      { ok: false, error: "Missing query param: imm, ww, ref or client" },
      { status: 400 }
    );
  }

  const limit = clampInt(searchParams.get("limit"), 50, 1, 500);

  const dbName = process.env.MONGODB_DB || "avis360";
  const client_db = await clientPromise;
  const db  = client_db.db(dbName);
  const col = db.collection("cp");

  // Build the $match — only add conditions for params that were provided
  const orClauses: Record<string, unknown>[] = [];
  if (imm)    orClauses.push({ IMM: imm });
  if (ww)     orClauses.push({ WW: ww });
  if (ref)    orClauses.push({ Référence: ref });
  if (client) orClauses.push({ Client: { $regex: client, $options: "i" } }); // case-insensitive

  const match = orClauses.length === 1 ? orClauses[0] : { $or: orClauses };

  const items = await col
    .aggregate([
      { $match: match },

      {
        $project: {
          _id: 0,

          // Identification
          reference:    "$Référence",
          nature:       "$Nature",
          statut:       "$Statut",

          // Véhicule
          ww:           "$WW",
          imm:          "$IMM",
          vin:          "$NUM chassis",
          marque:       "$Marque",
          model:        "$Modèle",
          version:      "$Libellé version long",
          type_vehicle: "$Type véhicule",
          type_location:"$Type location",

          // Contrat
          client:       "$Client",
          gestionnaire: "$Gestionnaire",
          duree:        "$Durée",
          km_prevu:     "$Km prévu",
          bon_commande: "$Bon de commande",

          // Dates contrat
          mce_date:              "$Date MCE",
          date_debut_contrat:    "$Date début contrat",
          date_fin_contrat:      "$Date fin contrat",
          date_debut_facturation:"$Date début facturation",

          // Etats
          etat_livraison:        "$Etat livraison",
          date_livraison:        "$Date livraison",
          etat_restitution:      "$Etat restitution",
          etat_prorogation:      "$Etat prorogation",
          avenant:               "$Avenant",
          intersociete:          "$Intersociété",
          conducteur:            "$Conducteur",
          type_vehicle:          "$Type véhicule",

          // Relais / KM tracking
          vh_relais:             "$VH relais",
          type:                  "$Type",
          date_debut_rl:         "$Date début RL",
          km_depart:             "$KM départ",
          dernier_km:            "$Dernier KM",
          date_dernier_km:       "$Date dernier KM",
          total_relais:          "$Total relais",
          km_consomme:           "$KM consommé",
          ecart_km:              "$Ecart KM",
          projection_km:         "$Projection km",
          ecart_pct:             "$Ecart%",
        },
      },

      { $limit: limit },
    ])
    .toArray();

  return NextResponse.json({
    ok:    true,
    count: items.length,
    items,
    item:  items[0] ?? null, // convenience: first result directly
  });
}