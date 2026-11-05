import { NextRequest, NextResponse } from "next/server";

/**
 * Everything is behind sign-in except:
 *  /login, /setup        — signing in, and creating the first owner
 *  /api/media/<token>    — Meta fetches our videos from here; each link is signed and expires
 *  /api/cron             — protected by CRON_KEY instead
 *  /api/oauth, /connect  — connecting accounts; gated by a hub sign-in OR a signed 3-day connect
 *                          link sent to the speaker, and by a one-time random state on the way back
 *  /r/<code>             — tracking links in captions
 *  /api/signups          — webinar sign-ups sent back; protected by SIGNUPS_KEY instead
 */
const PUBLIC = ["/login", "/setup", "/api/media/", "/api/cron", "/api/oauth/", "/api/signups", "/connect", "/r/"];
const COOKIE = "social_session";

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const toB64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function valid(token: string | undefined) {
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret || !token.includes(".")) return false;
  const [body, sig] = token.split(".");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toB64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  if (expected !== sig) return false;
  try {
    const j = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return typeof j.exp === "number" && Date.now() < j.exp;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (await valid(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
