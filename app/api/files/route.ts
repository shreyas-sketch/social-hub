import { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { abs } from "@/lib/media";
import { streamFile } from "@/lib/stream";

/** Reels, thumbnails and raw files for signed-in people. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!currentUser()) return new Response("Sign in first", { status: 401 });
  const rel = req.nextUrl.searchParams.get("p") || "";
  let file: string;
  try {
    file = abs(rel);
  } catch {
    return new Response("Bad path", { status: 400 });
  }
  return streamFile(file, req.headers.get("range"), { download: req.nextUrl.searchParams.has("download") });
}
