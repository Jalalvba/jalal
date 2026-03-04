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

// Converts "2,450.00" or 450 or null → double, safely
const toDouble = (fieldExpr: string) => ({
  $let: {
    vars: { s: { $toString: fieldExpr } },
    in: {
      $convert: {
        input: {
          $replaceAll: {
            input: {
              $replaceAll: { input: "$$s", find: ",", replacement: "" },
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
});

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

  const dbName = process.env.MONGODB_DB || "avis360";
  const client = await clientPromise;
  const db = client.db(dbName);
  const col = db.collection("ds");

  const match: Record<string, unknown> = { Immatriculation: imm };
  if (start && end) match["Date DS"] = { $gte: start, $lt: end };

  const pipeline: Document[] = [
    { $match: match },

    // Normalize numeric fields stored as strings like "336,349.00"
    {
      $addFields: {
        km_num:    toDouble("$KM"),
        mt_ht_num: toDouble("$Mt HT DS "),      // trailing space
        pu_num:    toDouble("$Prix Unitaire ds"),
      },
    },

    // Sort lines newest-first so $first picks the most recent header values
    { $sort: { "Date DS": -1 } },

    // Collapse all lines sharing the same N°DS into one document
    {
      $group: {
        _id: "$N°DS",

        // ── Header fields (one value per DS) ──
        nds:              { $first: "$N°DS" },
        societe:          { $first: "$Societe" },
        site:             { $first: "$Site" },
        site_ds:          { $first: "$SITE DS" },
        date_ds:          { $first: "$Date DS" },
        date_entree:      { $first: "$Date d'entrèe" },
        date_interv:      { $first: "$Date interv" },
        effectue_le:      { $first: "$Effectue le" },
        imm:              { $first: "$Immatriculation" },
        parc:             { $first: "$Parc" },
        type_parc:        { $first: "$Type Parc" },
        designation_veh:  { $first: "$Désignation véhicule" },
        marque:           { $first: "$Marque" },
        entite:           { $first: "$ENTITE" },
        code_entite:      { $first: "$Code entité" },
        entite_code:      { $first: "$Entité" },
        description:      { $first: "$Description" },
        type_ds:          { $first: "$Type DS" },
        type_de_ds:       { $first: "$Type de DS" },

        // ── Techniciens: collect ALL values, deduplicate after ──
        // "Technicein" is the real field name in DB (intentional typo)
        techniciens_raw:  { $push: "$Technicein" },

        user:             { $first: "$User" },
        facture_par:      { $first: "$FACTURE PAR " },  // trailing space

        // ── Client / billing ──
        client_final:     { $first: "$Client Final" },
        raison_social:    { $first: "$Raison Social" },
        client_ds:        { $first: "$Client DS" },
        code_client:      { $first: "$Code Client " },  // trailing space
        detenteur_ds:     { $first: "$Detenteur DS" },
        detenteur_parc:   { $first: "$Dètenteur parc" },
        locat_parc:       { $first: "$Locat Parc" },
        a_facture:        { $first: "$A Facturè" },
        statut_facture:   { $first: "$Statut facture" },
        n_facture:        { $first: "$N° Facture" },
        affectation:      { $first: "$Affectation" },
        ref_cp:           { $first: "$ref CP" },
        cmd_num:          { $first: "$CMD Num" },
        receptionne:      { $first: "$Réceptionné" },
        solde:            { $first: "$Soldé" },
        demande_satisfaite: { $first: "$Demande satisfaite" },
        fournisseur:      { $first: "$Founisseur" },  // typo in DB: "Founisseur"

        // ── Numeric aggregates ──
        km_max:   { $max: "$km_num" },
        mt_total: { $sum: "$mt_ht_num" },

        // ── Lines array ──
        lines: {
          $push: {
            n_intervention:    "$N° intervention",
            code_art:          "$Code art",
            designation_art:   "$Désignation article",
            designation_conso: "$Désignation Consomation ", // trailing space
            qte:               "$Qté",
            mt_ht:             "$mt_ht_num",
            prix_unitaire:     "$pu_num",
            dernier_prix:      "$Dernier Prix Achat NET",
          },
        },
      },
    },

    // Deduplicate techniciens_raw:
    // 1. filter out nulls and empty strings
    // 2. $setUnion to remove duplicates
    {
      $addFields: {
        techniciens: {
          $setUnion: [
            {
              $filter: {
                input: "$techniciens_raw",
                as:    "t",
                cond: {
                  $and: [
                    { $ne: ["$$t", null] },
                    { $ne: ["$$t", ""] },
                    { $ne: [{ $trim: { input: "$$t" } }, ""] },
                  ],
                },
              },
            },
            [], // ensures result is always an array
          ],
        },
      },
    },

    // Reshape to clean output field names
    {
      $project: {
        _id: 0,

        // Identification
        "N°DS":           "$nds",
        Societe:          "$societe",
        Site:             "$site",
        "SITE DS":        "$site_ds",

        // Dates
        "Date DS":        "$date_ds",
        "Date entrée":    "$date_entree",
        "Date interv":    "$date_interv",
        "Effectué le":    "$effectue_le",

        // Vehicle
        Immatriculation:  "$imm",
        Parc:             "$parc",
        "Type Parc":      "$type_parc",
        "Désignation véhicule": "$designation_veh",
        Marque:           "$marque",

        // Location
        ENTITE:           "$entite",
        "Code entité":    "$code_entite",
        Entité:           "$entite_code",

        // DS info
        Description:      "$description",
        "Type DS":        "$type_ds",
        "Type de DS":     "$type_de_ds",

        // People — Techniciens is now an array of unique names
        Techniciens:      "$techniciens",
        User:             "$user",
        "Facturé par":    "$facture_par",

        // Client / billing
        "Client Final":   "$client_final",
        "Raison Social":  "$raison_social",
        "Client DS":      "$client_ds",
        "Code Client":    "$code_client",
        "Détenteur DS":   "$detenteur_ds",
        "Détenteur parc": "$detenteur_parc",
        "Locat Parc":     "$locat_parc",
        "A Facturé":      "$a_facture",
        "Statut facture": "$statut_facture",
        "N° Facture":     "$n_facture",
        Affectation:      "$affectation",
        "Ref CP":         "$ref_cp",
        "CMD Num":        "$cmd_num",
        Réceptionné:      "$receptionne",
        Soldé:            "$solde",
        "Demande satisfaite": "$demande_satisfaite",
        Fournisseur:      "$fournisseur",

        // Aggregates
        KM:             "$km_max",
        "MT Total HT":  "$mt_total",

        // Lines
        lines: 1,
      },
    },

    { $sort: { "Date DS": -1 } },
    { $limit: limit },
  ];

  const items = await col.aggregate(pipeline).toArray();

  return NextResponse.json({ ok: true, imm, count: items.length, items });
}