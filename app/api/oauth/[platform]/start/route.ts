import { NextRequest, NextResponse } from "next/server";
import { currentUser, canApprove } from "@/lib/auth";
import { readConnectToken, signToken } from "@/lib/secure";
import { startUrl, type OAuthPlatform } from "@/lib/oauth";
import { env } from "@/lib/config";

const OK: OAuthPlatform[] = ["meta", "youtube", "linkedin", "x"];

/** Starts a platform sign-in: either a signed-in owner/admin, or a speaker holding a signed connect link. */
export async function GET(req: NextRequest, { params }: { params: { platform: string } }) {
  const p = params.platform as OAuthPlatform;
  const back = (msg: string) => NextResponse.redirect(`${env.appUrl()}/connect/done?e=${encodeURIComponent(signToken({ m: msg.slice(0, 400) }, 1))}`);
  if (!OK.includes(p)) return back("Unknown platform");
  try {
    const t = req.nextUrl.searchParams.get("t");
    if (t) {
      const c = readConnectToken(t);
      if (!c || c.oauth !== p) return back("This link has expired. Ask the Mudita team for a new one.");
      return NextResponse.redirect(startUrl(p, c.speakerId, null));
    }
    const u = currentUser();
    if (!u || !canApprove(u)) return NextResponse.redirect(`${env.appUrl()}/login`);
    const speakerId = Number(req.nextUrl.searchParams.get("speaker"));
    if (!speakerId) return back("Pick a speaker first");
    return NextResponse.redirect(startUrl(p, speakerId, u.id));
  } catch (e) {
    return back((e as Error).message);
  }
}
