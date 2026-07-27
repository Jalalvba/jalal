// app/api/query/route.ts
// Resolves partial IMM/WW (plate/WW only, no VIN) → returns
// { mode:"suggest", suggestions[] } or { mode:"data", imm, ww }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongo";
import { escapeRegex } from "@/lib/regex";
import { toErrorResponse } from "@/lib/apiError";
import type { ParcDoc } from "@/lib/types";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ ok: false, error: "Missing q" }, { status: 400 });

  try {
    const col = await getCollection<ParcDoc>("parc");

    // No $options: "i" — a case-insensitive anchored regex can't use a
    // standard (binary-collation) B-tree index, so this was silently
    // forcing a full collection scan on every keystroke despite
    // Immatriculation/Numéro WW both being indexed. Uppercasing the query
    // instead (parc's plates are stored uppercase — confirmed live: of
    // 7830 docs, only 18/35 have any lowercase char in Immatriculation/
    // Numéro WW respectively) keeps the search "feeling" case-insensitive
    // to the user while letting Mongo actually use the index.
    const regex = { $regex: "^" + escapeRegex(q.toUpperCase()) };

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
    return toErrorResponse(e, "Query failed");
  }
}