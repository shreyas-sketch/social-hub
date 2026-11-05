import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/config";
import { addSignups, type SignupIn } from "@/lib/growth";

/**
 * Webinar sign-ups sent back by the webinar side (or a Zapier/Make step), so the Growth page can show
 * sign-ups per 1,000 views. Protected by SIGNUPS_KEY (header x-hub-key). Send the utm_* values the
 * tracking link put on the URL; "ref" (an order or lead id) stops a resend being counted twice.
 *
 *   POST /api/signups  {"signups":[{"utm_id":"Ab3x9Qk","utm_term":"deepak","utm_content":"script-12","utm_source":"instagram","day":"2026-11-05","ref":"order-881"}]}
 */
export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: NextRequest) {
  const key = env.signupsKey();
  const got = req.headers.get("x-hub-key") || "";
  if (!key || !same(got, key)) return NextResponse.json({ ok: false, error: "Wrong or missing key" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const items: SignupIn[] = Array.isArray(body?.signups) ? body.signups : body && typeof body === "object" && (body.utm_id || body.utm_term) ? [body] : [];
  if (!items.length) return NextResponse.json({ ok: false, error: 'Send {"signups":[…]}' }, { status: 400 });
  const r = addSignups(items, "api", null);
  return NextResponse.json({ ok: true, ...r });
}
