import { NextResponse } from "next/server";
import { one } from "@/db";

/** For the host's health check (Railway): 200 when the app is up and the database opens. Public, says nothing else. */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    one(`SELECT 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
