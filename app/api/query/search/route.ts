// app/api/query/search/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongo";
import { escapeRegex } from "@/lib/regex";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ ok: true, results: [] });
  }

  try {
    const col = await getCollection("parc");

    const regex = { $regex: "^" + escapeRegex(q), $options: "i" };

    const docs = await col
      .find({ $or: [{ Immatriculation: regex }, { "Numéro WW": regex }] })
      .project({ Immatriculation: 1, "Numéro WW": 1, Marque: 1, Modèle: 1, _id: 0 })
      .limit(10)
      .toArray();

    const results = docs.map(d => ({
      imm:   d["Immatriculation"] ?? "",
      ww:    d["Numéro WW"]       ?? "",
      label: [d["Immatriculation"], d["Marque"], d["Modèle"]].filter(Boolean).join(" — "),
    }));

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Query failed", results: [] },
      { status: 500 }
    );
  }
}