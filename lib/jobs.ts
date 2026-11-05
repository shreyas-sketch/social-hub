import { one, raw, run, now, json } from "@/db";

/**
 * A small queue in SQLite. The web app only adds jobs; the worker process
 * (npm run worker) does the slow work: video edits, posting, reading numbers.
 */
export type JobKind =
  | "pull_stats"        // {accountId}
  | "pull_refs"         // {speakerId}
  | "write_brief"       // {speakerId, day}
  | "run_edit"          // {editId}
  | "post_trial"        // {trialId}
  | "read_trial"        // {trialId}
  | "publish"           // {publishId}
  | "refresh_tokens"    // {}
  | "pull_watch"        // {kind?}  trend pool + teachers
  | "agent"             // {agent, speakerId?, scriptIds?}
  | "session_transcribe" // {sessionId}  heavy: whole-recording transcript
  | "session_pick"      // {sessionId, again?}  Claude picks the clips + plans the long video
  | "run_longform"      // {longformId}  heavy: the long cut
  | "longform_thumbs"   // {longformId}  heavy: thumbnails again
  | "upload_longform"   // {longformId}  heavy: upload to YouTube (after Google's audit)
  | "pull_comments"     // {accountId}  new Instagram comments → DMs, reply drafts
  | "post_reply"        // {commentId}  an approved reply
  | "write_text_posts"  // {speakerId, day}
  | "post_text";        // {textPostId}

/** Video work runs one at a time on its own lane, so a long cut never holds up a post or a read. */
export const HEAVY_KINDS: JobKind[] = ["run_edit", "session_transcribe", "run_longform", "longform_thumbs", "upload_longform"];

export function enqueue(kind: JobKind, payload: Record<string, unknown> = {}, opts: { inMinutes?: number; unique?: boolean } = {}) {
  const p = JSON.stringify(payload);
  if (opts.unique !== false) {
    const dup = one(`SELECT id FROM jobs WHERE kind = ? AND payload = ? AND status IN ('queued','running')`, [kind, p]);
    if (dup) return dup.id as number;
  }
  const runAfter = new Date(Date.now() + (opts.inMinutes ?? 0) * 60e3).toISOString();
  const r = run(
    `INSERT INTO jobs (kind, payload, status, attempts, run_after, created_at, updated_at)
     VALUES (@kind, @payload, 'queued', 0, @runAfter, @at, @at)`,
    { kind, payload: p, runAfter, at: now() },
  );
  return Number(r.lastInsertRowid);
}

export type Job = { id: number; kind: JobKind; payload: any; attempts: number };

/** Takes the next due job and marks it running, in one step so two workers never share a job. */
export function claim(lane: "heavy" | "light" | "any" = "any"): Job | null {
  const heavy = HEAVY_KINDS.map((k) => `'${k}'`).join(",");
  const filter = lane === "heavy" ? `AND kind IN (${heavy})` : lane === "light" ? `AND kind NOT IN (${heavy})` : "";
  const row = one<any>(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = @at
     WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= @at ${filter} ORDER BY run_after LIMIT 1)
     RETURNING id, kind, payload, attempts`,
    { at: now() },
  );
  if (!row) return null;
  return { id: row.id, kind: row.kind, payload: json(row.payload, {}), attempts: row.attempts };
}

export function finish(id: number) {
  run(`UPDATE jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?`, [now(), id]);
}

/** Retries up to 4 times, waiting 2, 8, 30 minutes. Then it stays as an error for a person to look at. */
export function fail(job: Job, err: unknown): "retry" | "gave_up" {
  const msg = err instanceof Error ? err.message : String(err);
  const waits = [2, 8, 30];
  if (job.attempts <= waits.length) {
    run(`UPDATE jobs SET status = 'queued', last_error = ?, run_after = ?, updated_at = ? WHERE id = ?`, [
      msg.slice(0, 2000),
      new Date(Date.now() + waits[job.attempts - 1] * 60e3).toISOString(),
      now(),
      job.id,
    ]);
    return "retry";
  }
  run(`UPDATE jobs SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?`, [msg.slice(0, 2000), now(), job.id]);
  return "gave_up";
}

/** Put a job back in the queue later without counting it as a failure (e.g. a video still processing). */
export function later(job: Job, minutes: number) {
  run(`UPDATE jobs SET status = 'queued', attempts = attempts - 1, run_after = ?, updated_at = ? WHERE id = ?`, [
    new Date(Date.now() + minutes * 60e3).toISOString(),
    now(),
    job.id,
  ]);
}

/**
 * A worker that died mid-job leaves it "running"; free those after an hour (edits can take a while).
 * Long-session work (a 90-minute transcript or cut) can run for hours, so those get 6 hours.
 */
export function releaseStuck() {
  run(
    `UPDATE jobs SET status = 'queued', updated_at = @at
     WHERE status = 'running' AND (
       (kind NOT IN ('session_transcribe','run_longform','upload_longform') AND updated_at < @cut)
       OR updated_at < @longCut)`,
    { at: now(), cut: new Date(Date.now() - 60 * 60e3).toISOString(), longCut: new Date(Date.now() - 6 * 3600e3).toISOString() },
  );
}

/** One worker runs at a time, so anything still "running" when it starts was interrupted. */
export function releaseAllOnStart() {
  // Which posting jobs were really mid-way when the worker stopped. Those may or may not have gone out, so a person
  // checks. Ones still waiting in the queue never started: they're left alone and run as normal.
  const jobIds = (status: string, kind: JobKind, key: string) =>
    new Set(raw<{ payload: string }>(`SELECT payload FROM jobs WHERE status = ? AND kind = ?`, [status, kind]).map((j) => Number(json<any>(j.payload, {})[key])));
  const stuck = (table: string, statusCol: string, status: string, kind: JobKind, key: string) => {
    const running = jobIds("running", kind, key);
    const queued = jobIds("queued", kind, key);
    return raw<{ id: number }>(`SELECT id FROM ${table} WHERE ${statusCol} = ?`, [status]).map((r) => r.id).filter((id) => running.has(id) || !queued.has(id));
  };
  const each = (ids: number[], sql: string) => ids.forEach((id) => run(sql, [now(), id]));
  const msg = "Interrupted by a restart while posting. Check the platform; if it isn''t there, press Try again.";
  each(stuck("publishes", "status", "running", "publish", "publishId"), `UPDATE publishes SET status = 'error', error = '${msg}', updated_at = ? WHERE id = ? AND status = 'running'`);
  each(stuck("text_posts", "status", "posting", "post_text", "textPostId"), `UPDATE text_posts SET status = 'error', error = '${msg}', updated_at = ? WHERE id = ? AND status = 'posting'`);
  each(
    stuck("longforms", "status", "uploading", "upload_longform", "longformId"),
    `UPDATE longforms SET status = 'manual_todo', error = 'Interrupted by a restart while uploading. Check YouTube Studio first; if it isn''t there, upload it by hand (everything is on the session page).', updated_at = ? WHERE id = ? AND status = 'uploading'`,
  );
  // A comment reply mid-send: never resend blindly.
  each(stuck("comments", "reply_status", "posting", "post_reply", "commentId"), `UPDATE comments SET reply_status = 'error', reply_error = 'Interrupted by a restart. Check Instagram before trying again.' WHERE ? IS NOT NULL AND id = ? AND reply_status = 'posting'`);
  // A DM mid-send (the comment was claimed, the reply never came back): never resend blindly.
  run(`UPDATE comments SET dm_status = 'failed', dm_error = 'Interrupted by a restart while sending. Check the speaker''s DMs before trying again.' WHERE dm_status = 'sending'`);
  run(`UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running'`, [now()]);
}

export function retryJob(id: number) {
  run(`UPDATE jobs SET status = 'queued', attempts = 0, run_after = ?, updated_at = ? WHERE id = ? AND status = 'error'`, [now(), now(), id]);
}

export function jobCounts() {
  return raw<{ status: string; n: number }>(`SELECT status, COUNT(*) AS n FROM jobs WHERE status IN ('queued','running','error') GROUP BY status`);
}

export function recentJobErrors(limit = 20) {
  return raw(`SELECT id, kind, payload, attempts, last_error, updated_at FROM jobs WHERE status = 'error' ORDER BY updated_at DESC LIMIT ?`, [limit]);
}
