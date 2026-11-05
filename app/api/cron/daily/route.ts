import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/config";
import { dailyTick } from "@/lib/daily";

/** Optional: lets an outside cron kick the daily jobs (the worker already does this on its own). */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!env.cronKey() || req.nextUrl.searchParams.get("key") !== env.cronKey()) return NextResponse.json({ error: "bad key" }, { status: 401 });
  return NextResponse.json({ ok: true, queued: dailyTick(req.nextUrl.searchParams.has("force")) });
}
