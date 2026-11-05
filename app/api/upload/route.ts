import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { one, run, now } from "@/db";
import { currentUser } from "@/lib/auth";
import { abs, ensureDir, safeName } from "@/lib/media";
import { audit } from "@/lib/secure";
import { probe } from "@/lib/edit/ffmpeg";
import { createEdit } from "@/lib/edits";
import { attachRecording } from "@/lib/sessions";

/**
 * Raw video uploads, in pieces:
 *   POST {step:"start"}   → an upload id
 *   PUT  ?u=id&offset=n   → append one piece (must start where the last ended, so retries are safe)
 *   GET  ?u=id            → how much has arrived (to resume)
 *   POST {step:"finish"}  → checks the file, saves it, starts the first cut
 */
export const dynamic = "force-dynamic";
const MAX = 4 * 1024 ** 3; // 4 GB for a take
const MAX_SESSION = 20 * 1024 ** 3; // 20 GB for a long session (90 minutes of 1080p is about 5–10 GB)

/** A take for one script, or the recording of a long session. */
type Pending = { scriptId?: number; sessionId?: number; name: string; size: number; userId: number; file: string };
const meta = (id: string) => abs(`uploads/${id}.json`);
const load = (id: string): Pending | null => {
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(meta(id), "utf8"));
  } catch {
    return null;
  }
};
const received = (p: Pending) => (fs.existsSync(abs(p.file)) ? fs.statSync(abs(p.file)).size : 0);
const err = (msg: string, status = 400) => NextResponse.json({ ok: false, error: msg }, { status });

export async function POST(req: NextRequest) {
  const u = currentUser();
  if (!u) return err("Sign in first", 401);
  const body = await req.json().catch(() => ({}));

  if (body.step === "start" && body.sessionId) {
    const se = one<any>(`SELECT id, status, raw_path FROM sessions WHERE id = ?`, [Number(body.sessionId)]);
    if (!se) return err("No such session");
    // Clips are cut from the recording at fixed times, so a session's recording is never swapped. A new recording = a new session.
    if (se.raw_path || one(`SELECT id FROM scripts WHERE session_id = ?`, [se.id])) return err("This session already has its recording. Start a new session for a new recording.");
    if (!Number(body.size) || Number(body.size) > MAX_SESSION) return err("File is empty or over 20 GB — record long sessions at 1080p.");
    const id = crypto.randomBytes(12).toString("hex");
    ensureDir("uploads");
    const ext = path.extname(String(body.name || "")).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".mp4";
    const p: Pending = { sessionId: se.id, name: String(body.name || "session").slice(0, 200), size: Number(body.size), userId: u.id, file: `uploads/${id}${ext}` };
    fs.writeFileSync(meta(id), JSON.stringify(p));
    return NextResponse.json({ ok: true, id });
  }

  if (body.step === "start") {
    const sc = one<any>(`SELECT id, speaker_id, status FROM scripts WHERE id = ?`, [Number(body.scriptId)]);
    if (!sc) return err("No such script");
    if (!["approved", "shot", "edited"].includes(sc.status)) return err("Only approved scripts can get a video.");
    if (!Number(body.size) || Number(body.size) > MAX) return err("File is empty or over 4 GB");
    const id = crypto.randomBytes(12).toString("hex");
    ensureDir("uploads");
    const ext = path.extname(String(body.name || "")).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".mp4";
    const p: Pending = { scriptId: sc.id, name: String(body.name || "video").slice(0, 200), size: Number(body.size), userId: u.id, file: `uploads/${id}${ext}` };
    fs.writeFileSync(meta(id), JSON.stringify(p));
    return NextResponse.json({ ok: true, id });
  }

  if (body.step === "finish") {
    const id = String(body.id || "");
    const p = load(id);
    if (!p) return err("Upload not found");
    if (received(p) !== p.size) return err(`Only ${received(p)} of ${p.size} bytes arrived — upload again.`);
    if (p.sessionId) {
      const se = one<any>(`SELECT id, speaker_id FROM sessions WHERE id = ?`, [p.sessionId]);
      if (!se) return err("No such session");
      const dir = `raw/${se.speaker_id}/sessions/${se.id}`;
      ensureDir(dir);
      const finalRel = `${dir}/${Date.now()}-${safeName(p.name)}`;
      fs.renameSync(abs(p.file), abs(finalRel));
      fs.rmSync(meta(id), { force: true });
      let duration: number | null = null;
      try {
        duration = (await probe(abs(finalRel))).duration;
      } catch {
        fs.rmSync(abs(finalRel), { force: true });
        return err("That doesn't look like a video file ffmpeg can read.");
      }
      if (!attachRecording(se.id, finalRel, p.name, p.size, duration)) {
        fs.rmSync(abs(finalRel), { force: true });
        return err("This session already has a recording. Start a new session for a new recording.");
      }
      audit(u.id, "upload_session", "session", se.id, { name: p.name, size: p.size });
      return NextResponse.json({ ok: true, sessionId: se.id });
    }
    const sc = one<any>(`SELECT id, speaker_id FROM scripts WHERE id = ?`, [p.scriptId]);
    if (!sc) return err("No such script");
    const dir = `raw/${sc.speaker_id}/${p.scriptId}`;
    ensureDir(dir);
    const finalRel = `${dir}/${Date.now()}-${safeName(p.name)}`;
    fs.renameSync(abs(p.file), abs(finalRel));
    fs.rmSync(meta(id), { force: true });
    let duration: number | null = null;
    try {
      duration = (await probe(abs(finalRel))).duration;
    } catch {
      fs.rmSync(abs(finalRel), { force: true });
      return err("That doesn't look like a video file ffmpeg can read.");
    }
    const r = run(
      `INSERT INTO videos (script_id, speaker_id, raw_path, raw_name, raw_size, duration, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sc.id, sc.speaker_id, finalRel, p.name, p.size, duration, u.id, now()],
    );
    const videoId = Number(r.lastInsertRowid);
    run(`UPDATE scripts SET status = CASE WHEN status = 'approved' THEN 'shot' ELSE status END, updated_at = ? WHERE id = ?`, [now(), sc.id]);
    audit(u.id, "upload_raw", "video", videoId, { name: p.name, size: p.size });
    const editId = createEdit(videoId);
    return NextResponse.json({ ok: true, videoId, editId });
  }
  return err("Unknown step");
}

export async function PUT(req: NextRequest) {
  const u = currentUser();
  if (!u) return err("Sign in first", 401);
  const id = req.nextUrl.searchParams.get("u") || "";
  const offset = Number(req.nextUrl.searchParams.get("offset"));
  const p = load(id);
  if (!p) return err("Upload not found");
  const have = received(p);
  if (offset !== have) return NextResponse.json({ ok: true, received: have }); // a retry of a piece we already have
  const buf = Buffer.from(await req.arrayBuffer());
  if (have + buf.length > p.size) return err("More data than the file size");
  fs.appendFileSync(abs(p.file), buf);
  return NextResponse.json({ ok: true, received: have + buf.length });
}

export async function GET(req: NextRequest) {
  const u = currentUser();
  if (!u) return err("Sign in first", 401);
  const p = load(req.nextUrl.searchParams.get("u") || "");
  if (!p) return err("Upload not found");
  return NextResponse.json({ ok: true, received: received(p) });
}
