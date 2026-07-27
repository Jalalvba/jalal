import { NextResponse } from "next/server";
import { getIMMListSafe } from "@/lib/googleSheetsParking";

export async function GET() {
  // getIMMListSafe() never throws (a Mongo outage degrades to []), so an
  // empty autocomplete list is the only failure mode here — no try/catch
  // needed.
  const imms = await getIMMListSafe();
  return NextResponse.json({ ok: true, imms });
}
