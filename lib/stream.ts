import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".json": "application/json", ".m4v": "video/mp4", ".webm": "video/webm", ".srt": "text/plain; charset=utf-8" };

/** Sends a file with Range support (video players and Meta's fetcher both ask for byte ranges). */
export function streamFile(file: string, rangeHeader: string | null, opts: { download?: boolean; cache?: string } = {}) {
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
  const headers: Record<string, string> = {
    "content-type": type,
    "accept-ranges": "bytes",
    "cache-control": opts.cache || "private, max-age=300",
  };
  if (opts.download) headers["content-disposition"] = `attachment; filename="${path.basename(path.dirname(file))}-${path.basename(file)}"`;
  const m = rangeHeader?.match(/bytes=(\d*)-(\d*)/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(body, { status: 200, headers: { ...headers, "content-length": String(size) } });
}
