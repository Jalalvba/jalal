// app/api/bc/route.ts
import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const cmdNum  = searchParams.get("cmd")?.trim();
  const codeArt = searchParams.get("code")?.trim();

  if (!cmdNum) {
    return NextResponse.json(
      { ok: false, error: "Missing required param: cmd" },
      { status: 400 }
    );
  }

  const dbName = process.env.MONGODB_DB || "avis";
  const client = await clientPromise;
  const db     = client.db(dbName);
  const col    = db.collection("bc");

  const match: Record<string, unknown> = { "CMD Num": cmdNum };
  if (codeArt) match["Code article"] = codeArt;

  const items = await col
    .find(match, { projection: { _id: 0, "CMD Num": 1, "Code article": 1, PU: 1 } })
    .toArray();

  return NextResponse.json({
    ok:    true,
    count: items.length,
    items,
    item:  items[0] ?? null,
  });
}
