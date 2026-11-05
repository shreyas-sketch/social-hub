import { NextRequest } from "next/server";
import { readMediaToken } from "@/lib/secure";
import { abs } from "@/lib/media";
import { streamFile } from "@/lib/stream";

/** Public, signed, expiring video links — Meta downloads the reel from here when we post it. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const rel = readMediaToken(params.token);
  if (!rel) return new Response("Link expired", { status: 410 });
  return streamFile(abs(rel), req.headers.get("range"), { cache: "no-store" });
}

export const HEAD = GET;
