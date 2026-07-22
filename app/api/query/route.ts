// app/api/query/route.ts
// Resolves partial IMM/WW (plate/WW only, no VIN) → returns
// { mode:"suggest", suggestions[] } or { mode:"data", imm, ww }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongo";
import { escapeRegex } from "@/lib/regex";
import type { ParcDoc } from "@/lib/types";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ ok: false, error: "Missing q" }, { status: 400 });

  try {
    const col = await getCollection<ParcDoc>("parc");

    const regex = { $regex: "^" + escapeRegex(q), $options: "i" };

    const docs = await col
      .find({ $or: [
        { Immatriculation: regex },
        { "Numéro WW": regex },
      ]})
      .project({ Immatriculation: 1, "Numéro WW": 1, Marque: 1, "Modèle": 1, _id: 0 })
      .limit(10)
      .toArray();

    if (docs.length > 1) {
      const ql = q.toLowerCase();
      return NextResponse.json({
        ok: true,
        mode: "suggest",
        suggestions: docs.map(d => {
          const imm   = String(d["Immatriculation"] ?? "");
          const ww    = String(d["Numéro WW"]       ?? "");
          const marque = String(d["Marque"]  ?? "");
          const model  = String(d["Modèle"]  ?? "");
          // Show whichever field matched the query
          const matchedByWW  = ww.toLowerCase().includes(ql);
          const matchedByIMM = imm.toLowerCase().includes(ql);
          const primary = matchedByWW && !matchedByIMM ? ww : imm;
          const secondary = matchedByWW && !matchedByIMM ? `IMM: ${imm}` : (ww ? `WW: ${ww}` : "");
          return {
            imm,
            ww,
            primary,
            label: [marque, model].filter(Boolean).join(" — "),
            secondary,
          };
        }),
      });
    }

    return NextResponse.json({
      ok:   true,
      mode: "data",
      imm:  docs[0]?.["Immatriculation"] ? String(docs[0]["Immatriculation"]) : q,
      ww:   docs[0]?.["Numéro WW"]       ? String(docs[0]["Numéro WW"])       : q,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Query failed" },
      { status: 500 }
    );
  }
}