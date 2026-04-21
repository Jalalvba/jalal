import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import type { SuiviDraft } from "@/lib/models/suivi";

const DB   = process.env.MONGODB_DB!;
const COLL = "suivi_draft";

export async function GET() {
  try {
    const client = await clientPromise;
    const docs = await client
      .db(DB)
      .collection(COLL)
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const items = docs.map(d => ({
      ...d,
      _id: d._id.toString(),
    }));

    return NextResponse.json({ ok: true, count: items.length, items });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "DB error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: Omit<SuiviDraft, "_id"> = await req.json();

    if (!body.IMM?.trim()) {
      return NextResponse.json(
        { ok: false, error: "IMM is required" },
        { status: 400 }
      );
    }

    const now = new Date();
    const doc = { ...body, createdAt: now, updatedAt: now };

    const client = await clientPromise;
    const result = await client.db(DB).collection(COLL).insertOne(doc);

    return NextResponse.json({
      ok: true,
      _id: result.insertedId.toString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "DB error" },
      { status: 500 }
    );
  }
}