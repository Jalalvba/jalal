// Reads back a stored DS analysis. NEVER calls a model — that is what
// /api/ds-history/analyze is for, and the whole point of this route is to let
// a card render an existing answer without paying for it again.
//
// Two shapes, one route:
//   ?imm=X   the full analysis for one vehicle (DS History's card)
//   (no imm) every stored analysis, findings stripped, for the list pages —
//            Suivi RL renders ~101 cards and must not make ~101 requests.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getAnalysis, getAllSummaries } from "@/lib/mongo/dsAnalyses";
import { toErrorResponse } from "@/lib/http/apiError";

export async function GET(request: Request) {
  const imm = new URL(request.url).searchParams.get("imm")?.trim();

  try {
    if (imm) {
      const doc = await getAnalysis(imm);
      // A vehicle with no analysis yet is a fact, not an error: the card shows
      // its "start an analysis" affordance and nothing else.
      return NextResponse.json({ ok: true, analysis: doc });
    }
    return NextResponse.json({ ok: true, summaries: await getAllSummaries() });
  } catch (e) {
    return toErrorResponse(e, "Lecture des analyses impossible");
  }
}
