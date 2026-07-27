// app/api/query/search/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongo";
import { escapeRegex } from "@/lib/regex";
import { toErrorResponse } from "@/lib/apiError";
import type { ParcDoc } from "@/lib/types";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ ok: true, results: [] });
  }

  try {
    const col = await getCollection<ParcDoc>("parc");

    // See app/api/query/route.ts's identical fix for why: dropping
    // $options: "i" and uppercasing the query lets Mongo use the existing
    // Immatriculation/Numéro WW indexes instead of a full collection scan.
    const regex = { $regex: "^" + escapeRegex(q.toUpperCase()) };

    const docs = await col
      .find({ $or: [{ Immatriculation: regex }, { "Numéro WW": regex }] })
      .project({ Immatriculation: 1, "Numéro WW": 1, Marque: 1, Modèle: 1, _id: 0 })
      .limit(10)
      .toArray();

    const results = docs.map(d => ({
      imm:   d["Immatriculation"] ?? "",
      ww:    d["Numéro WW"]       ?? "",
      label: [d["Marque"], d["Modèle"]].filter(Boolean).join(" — "),
    }));

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return toErrorResponse(e, "Query failed", 500, { results: [] });
  }
}