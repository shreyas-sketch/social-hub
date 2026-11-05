import { NextRequest, NextResponse } from "next/server";
import { linkTarget } from "@/lib/publish";

/** Tracking link from a caption → the speaker's ₹99 webinar page, with UTM tags the Performance Hub can read. */
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { code: string } }) {
  const to = linkTarget(params.code);
  return NextResponse.redirect(to || "https://www.google.com", 302);
}
