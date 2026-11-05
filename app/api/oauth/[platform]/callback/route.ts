import { NextRequest, NextResponse } from "next/server";
import { finishOAuth, type OAuthPlatform } from "@/lib/oauth";
import { signToken } from "@/lib/secure";
import { env } from "@/lib/config";
import { one } from "@/db";

/** Platforms send people back here. The random state ties it to the sign-in we started (20-minute window). */
export async function GET(req: NextRequest, { params }: { params: { platform: string } }) {
  const q = req.nextUrl.searchParams;
  const back = (msg: string) => NextResponse.redirect(`${env.appUrl()}/connect/done?e=${encodeURIComponent(signToken({ m: msg.slice(0, 400) }, 1))}`);
  if (q.get("error")) {
    // The platform's own words are shown only for a sign-in this hub started (this page is public).
    const ours = q.get("state") && one(`SELECT 1 FROM oauth_states WHERE state = ?`, [q.get("state")]);
    if (!ours) return back("Sign-in was cancelled or didn't finish. Try the connect link again.");
    return back(`The platform said: ${(q.get("error_description") || q.get("error_reason") || q.get("error") || "cancelled").slice(0, 200)}`);
  }
  const code = q.get("code");
  const state = q.get("state");
  if (!code || !state) return back("The platform didn't send a sign-in code back.");
  try {
    const next = await finishOAuth(params.platform as OAuthPlatform, code, state);
    return NextResponse.redirect(`${env.appUrl()}${next}`);
  } catch (e) {
    return back((e as Error).message);
  }
}
