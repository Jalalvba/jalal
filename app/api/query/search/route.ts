// app/api/query/search/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const client = await clientPromise;
    const dbName = process.env.MONGODB_DB || "avis360";
    const db     = client.db(dbName);
    const col    = db.collection("parc");

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = { $regex: "^" + escaped, $options: "i" };

    const docs = await col
      .find({ $or: [{ Immatriculation: regex }, { "Numéro WW": regex }, { VIN: regex }] })
      .project({ Immatriculation: 1, "Numéro WW": 1, Marque: 1, Modèle: 1, _id: 0 })
      .limit(10)
      .toArray();

    const results = docs.map(d => ({
      imm:   d["Immatriculation"] ?? "",
      ww:    d["Numéro WW"]       ?? "",
      label: [d["Immatriculation"], d["Marque"], d["Modèle"]].filter(Boolean).join(" — "),
    }));

    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ results: [], error: String(e) }, { status: 500 });
  }
}