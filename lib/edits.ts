import fs from "node:fs";
import path from "node:path";
import { one, run, now, json } from "@/db";
import { abs, ensureDir } from "@/lib/media";
import { enqueue } from "@/lib/jobs";
import { setting } from "@/lib/config";
import { editVideo, DEFAULT_EDIT, type EditSettings } from "@/lib/edit/ffmpeg";
import type { Word } from "@/lib/edit/transcribe";
import { checkText, type Check, type Niche } from "@/lib/compliance";

/**
 * The rules check on what the cut itself says and shows: the words heard in the take (or as fixed by hand) and the
 * hook on screen. The script was checked before the shoot, but a speaker can say something that wasn't in it.
 */
export function cutCheck(e: { transcript?: string | null; settings?: string | null }, niche: Niche): Check {
  const words = json<Word[]>(e.transcript, []).map((w) => w.w).join(" ");
  const hook = String(json<any>(e.settings, {}).hookText || "");
  return checkText([words, hook].filter(Boolean).join("\n"), niche);
}

/** Blocking issues in `before` that are gone from `after` (same rule, same words). */
export function blocksRemoved(before: Check, after: Check) {
  return before.issues.filter((i) => i.level === "block" && !after.issues.some((j) => j.rule === i.rule && j.match.toLowerCase() === i.match.toLowerCase()));
}

/**
 * SQL (edits aliased as e): the newest version of each cut. A hook test's variants are cuts of their own, so each
 * variant (and each re-test hook) shows next to the first cut instead of hiding it.
 */
export const LATEST_CUT = `e.id = (SELECT MAX(x.id) FROM edits x WHERE x.video_id = e.video_id AND COALESCE(x.variant_of, 0) = COALESCE(e.variant_of, 0)
  AND COALESCE(json_extract(x.settings, '$.hookText'), '') = COALESCE(json_extract(e.settings, '$.hookText'), ''))`;

/** New edit version for a video. Optionally carries a hand-fixed transcript into the new version. */
export function createEdit(videoId: number, settings?: Partial<EditSettings>, carryWords?: Word[] | null) {
  const v = one<any>(`SELECT v.*, sp.caption_style AS speaker_style FROM videos v JOIN speakers sp ON sp.id = v.speaker_id WHERE v.id = ?`, [videoId]);
  if (!v) throw new Error("No such video");
  const prev = one<{ version: number }>(`SELECT MAX(version) AS version FROM edits WHERE video_id = ?`, [videoId]);
  const s: EditSettings = {
    ...DEFAULT_EDIT,
    // The speaker's own caption style wins over the hub-wide default.
    captionStyle: (v.speaker_style || setting("caption_style") || DEFAULT_EDIT.captionStyle) as any,
    frame: (setting("frame_mode") as any) || DEFAULT_EDIT.frame,
    ...(settings || {}),
  };
  const r = run(
    `INSERT INTO edits (video_id, script_id, version, settings, status, warnings, created_at, updated_at)
     VALUES (@v, @s, @ver, @settings, 'queued', '[]', @at, @at)`,
    { v: videoId, s: v.script_id, ver: (prev?.version || 0) + 1, settings: JSON.stringify(s), at: now() },
  );
  const editId = Number(r.lastInsertRowid);
  if (carryWords && carryWords.length) {
    const dir = ensureDir(`edits/${editId}`);
    fs.writeFileSync(path.join(dir, "transcript.json"), JSON.stringify(carryWords));
  }
  enqueue("run_edit", { editId });
  return editId;
}

export async function runEdit(editId: number) {
  const e = one<any>(
    `SELECT e.*, v.raw_path, v.clip_start, v.clip_end, s.hook, s.on_screen, sp.screen_disclaimer
     FROM edits e JOIN videos v ON v.id = e.video_id JOIN scripts s ON s.id = e.script_id JOIN speakers sp ON sp.id = s.speaker_id
     WHERE e.id = ?`,
    [editId],
  );
  if (!e) throw new Error(`No edit ${editId}`);
  // Never re-cut a version that's already finished or approved (a retried job must not overwrite a reel Meta may be downloading).
  if (!["queued", "running", "error"].includes(e.status)) return;
  run(`UPDATE edits SET status = 'running', error = NULL, updated_at = ? WHERE id = ?`, [now(), editId]);
  const rel = `edits/${editId}`;
  const dir = ensureDir(rel);
  try {
    const res = await editVideo({
      input: abs(e.raw_path),
      workDir: dir,
      output: path.join(dir, "reel.mp4"),
      settings: json<EditSettings>(e.settings, DEFAULT_EDIT),
      // A re-test can put a different hook on screen without a reshoot.
      hook: json<any>(e.settings, {}).hookText || e.hook,
      onScreen: json(e.on_screen, []),
      screenDisclaimer: e.screen_disclaimer,
      // A clip from a long session: only that part of the recording.
      clip: e.clip_start != null && e.clip_end != null ? { start: e.clip_start, end: e.clip_end } : null,
    });
    // Keep the final reel and thumbnail; drop the big intermediate files.
    for (const f of ["cut.mp4", "cut.wav", "src.mp4"]) fs.rmSync(path.join(dir, f), { force: true });
    run(
      `UPDATE edits SET status = 'ready', output_path = @o, thumb_path = @t, duration = @d, transcript = @w, warnings = @warn, updated_at = @at WHERE id = @id`,
      { o: `${rel}/reel.mp4`, t: `${rel}/reel.jpg`, d: res.duration, w: JSON.stringify(res.words), warn: JSON.stringify(res.warnings), at: now(), id: editId },
    );
    run(`UPDATE scripts SET status = CASE WHEN status IN ('approved','shot') THEN 'edited' ELSE status END, updated_at = ? WHERE id = ?`, [now(), e.script_id]);
  } catch (err) {
    run(`UPDATE edits SET status = 'error', error = ?, updated_at = ? WHERE id = ?`, [String((err as Error).message).slice(0, 1500), now(), editId]);
    throw err;
  }
}
