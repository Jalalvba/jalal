// app/api/debug/route.ts
// TEMPORARY — delete after fixing field names
import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q          = searchParams.get("q")?.trim();
  const collection = searchParams.get("col")?.trim() ?? "parc";

  if (!q) return NextResponse.json({ error: "Missing ?q=" }, { status: 400 });

  const client = await clientPromise;
  const db     = client.db(process.env.MONGODB_DB || "avis360");
  const col    = db.collection(collection);

  // Find ONE raw document — no projection, shows exact field names
  const doc = await col.findOne({
    $or: [
      { Immatriculation: q },
      { "Numéro WW": q },
      { "N° de chassis": q },
      { IMM: q },
      { WW: q },
    ],
  });

  if (!doc) return NextResponse.json({ found: false, q, collection });

  // Return the raw field names so we can see exactly what MongoDB has
  const fieldNames = Object.keys(doc);

  return NextResponse.json({
    found: true,
    q,
    collection,
    fieldNames,   // ← the actual field names in the doc
    doc,          // ← the full raw document
  });
}