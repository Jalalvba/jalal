import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongo";
import type { SuiviDraft } from "@/lib/models/suivi";

const DB   = process.env.MONGODB_DB!;
const COLL = "suivi_draft";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  try {
    const body: Partial<Omit<SuiviDraft, "_id">> = await req.json();
    const client = await clientPromise;
    const result = await client
      .db(DB)
      .collection(COLL)
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { ...body, updatedAt: new Date() } }
      );

    if (result.matchedCount === 0) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "DB error" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  try {
    const client = await clientPromise;
    const result = await client
      .db(DB)
      .collection(COLL)
      .deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "DB error" },
      { status: 500 }
    );
  }
}
