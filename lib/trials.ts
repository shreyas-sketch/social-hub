import { one, raw, run, now, json, istDay } from "@/db";
import { accessToken, accountFor } from "@/lib/accounts";
import { env, setting, settingNum } from "@/lib/config";
import { enqueue, type Job, later } from "@/lib/jobs";
import { publicMediaUrl, audit } from "@/lib/secure";
import { finalCaption } from "@/lib/compliance";
import { cutCheck } from "@/lib/edits";
import { baselineViews, baselineSends } from "@/lib/learn";
import { igCreateReel, igContainerStatus, igPublish, igMediaInfo, igInsights, igRecentMedia, igProfile } from "@/lib/platforms/meta";

/** Reads at 3h, 6h and 12h to watch it move, and the verdict at trial_read_hours (24h by default). */
const READ_POINTS = [3, 6, 12];

/** Up to 3 Instagram usernames invited as collaborators on this cut (stored with the cut's settings). */
export function collaboratorsOf(settings: string | null | undefined): string[] {
  const c = json<any>(settings, {}).collaborators;
  return Array.isArray(c) ? c.filter((x) => typeof x === "string" && /^[a-z0-9._]{1,30}$/i.test(x)).slice(0, 3) : [];
}

export function trialFor(editId: number) {
  return one<any>(`SELECT * FROM trials WHERE edit_id = ? ORDER BY id DESC LIMIT 1`, [editId]);
}

/**
 * Instagram only allows trial reels on public accounts with 1,000+ followers. Below that, the reel goes
 * out as a normal reel and is compared only with the speaker's other normal reels.
 */
export const TRIAL_MIN_FOLLOWERS = 1000;
export function trialMode(igAccountId: number): "trial" | "regular" {
  const f = one<{ followers: number | null }>(`SELECT followers FROM account_stats WHERE account_id = ? ORDER BY day DESC LIMIT 1`, [igAccountId])?.followers;
  return f != null && f < TRIAL_MIN_FOLLOWERS ? "regular" : "trial";
}

/** A named person approves the cut and sends it out as a trial reel. */
export function startTrial(editId: number, userId: number) {
  const e = one<any>(
    `SELECT e.*, s.speaker_id, s.caption, s.hashtags, s.decided_by AS script_approved_by, s.compliance, sp.caption_disclaimer, sp.niche
     FROM edits e JOIN scripts s ON s.id = e.script_id JOIN speakers sp ON sp.id = s.speaker_id WHERE e.id = ?`,
    [editId],
  );
  if (!e) throw new Error("No such edit");
  if (!e.script_approved_by) throw new Error("This script was never approved.");
  if (json<any>(e.compliance, {}).status === "block") throw new Error("The script now breaks a blocking rule (it was edited after approval). Fix it on the script page first.");
  if (e.status !== "ready" && e.status !== "approved") throw new Error("This cut isn't ready yet");
  // What the speaker actually said in the take, and the hook on screen, get the same check as the script.
  // A take with sound but no transcript can't be checked, so it can't go out (unless transcription is switched off for the hub).
  const heard = json<any[]>(e.transcript, []);
  const silent = json<string[]>(e.warnings, []).some((w) => /has no sound/i.test(w));
  if (!heard.length && !silent && env.transcribeEngine() !== "none") throw new Error("The words in this take couldn't be checked (no transcript). Re-cut it; if that doesn't help, check the sound or the transcription setup.");
  const said = cutCheck(e, e.niche);
  if (said.status === "block") {
    const words = said.issues.filter((i) => i.level === "block").map((i) => `"${i.match}"`).join(", ");
    throw new Error(`This cut says or shows ${words}, which breaks a blocking rule. Re-shoot that part (or, if the caption misheard it, fix the words).`);
  }
  const ig = accountFor(e.speaker_id, "instagram");
  if (!ig || ig.status !== "connected") throw new Error("Connect this speaker's Instagram first (Accounts page)");
  const existing = trialFor(editId);
  if (existing && existing.status !== "error") return existing.id as number;
  // An errored trial that already reached Instagram (it has a container) is retried, never re-created — that could post it twice.
  if (existing && existing.container_id) throw new Error("This reel may already be on Instagram. Use \"Try again\" on the Trials page, or check the account first.");
  const caption = finalCaption(e.caption || "", e.hashtags, e.caption_disclaimer, null);
  // A collab post can't be a trial reel (Meta's rule), so a cut with collaborators goes out as a normal reel.
  const collabs = collaboratorsOf(e.settings);
  const mode = collabs.length ? "regular" : trialMode(ig.id);
  if (mode === "trial") {
    // Instagram allows about 20 trial reels a day per account; stay under the cap in Settings.
    const cap = settingNum("trial_daily_cap");
    const midnight = new Date(Date.parse(`${istDay()}T00:00:00+05:30`)).toISOString();
    const today = one<{ n: number }>(`SELECT COUNT(*) AS n FROM trials WHERE account_id = ? AND mode = 'trial' AND created_at >= ? AND status NOT IN ('error','replaced')`, [ig.id, midnight])?.n ?? 0;
    if (today >= cap) throw new Error(`Already ${today} trial reels today on this account (the cap is ${cap}, in Settings). Approve this one tomorrow.`);
  }
  const r = run(
    `INSERT INTO trials (edit_id, account_id, status, caption, approved_by, verdict, mode, created_at, updated_at)
     VALUES (@e, @a, 'queued', @c, @u, 'pending', @mode, @at, @at)`,
    { e: editId, a: ig.id, c: caption, u: userId, mode, at: now() },
  );
  const trialId = Number(r.lastInsertRowid);
  // The failed first try is replaced by this one, so it can't also be retried (that would post the reel twice).
  if (existing) run(`UPDATE trials SET status = 'replaced', updated_at = ? WHERE id = ? AND status = 'error'`, [now(), existing.id]);
  run(`UPDATE edits SET status = 'approved', decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?`, [userId, now(), now(), editId]);
  run(`UPDATE scripts SET status = 'trial', updated_at = ? WHERE id = ?`, [now(), e.script_id]);
  audit(userId, "approve_cut_and_trial", "edit", editId, { trialId });
  enqueue("post_trial", { trialId });
  return trialId;
}

/** Worker: create the container, wait for Meta to process it, publish. Re-queues itself while Meta is processing. */
export async function postTrial(trialId: number, job: Job) {
  const t = one<any>(`SELECT t.*, e.output_path, e.settings FROM trials t JOIN edits e ON e.id = t.edit_id WHERE t.id = ?`, [trialId]);
  if (!t || t.status === "live" || t.status === "done") return;
  const ig = one<any>(`SELECT * FROM accounts WHERE id = ?`, [t.account_id]);
  const token = await accessToken(ig);
  if (env.dryRun()) {
    run(`UPDATE trials SET status = 'live', media_id = 'dry-run', posted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), trialId]);
    return;
  }
  let containerId = t.container_id as string | null;
  if (!containerId && t.mode === "trial" && !one(`SELECT 1 FROM account_stats WHERE account_id = ? AND followers IS NOT NULL`, [ig.id])) {
    // Followers not read yet (a new connection): Instagram refuses trial reels under 1,000 followers, so check first.
    const followers = await igProfile(ig.external_id, token).then((p) => Number(p.followers_count ?? NaN)).catch(() => NaN);
    if (Number.isFinite(followers)) {
      run(`INSERT INTO account_stats (account_id, day, followers, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, day) DO UPDATE SET followers = excluded.followers`, [ig.id, istDay(), followers, now()]);
      if (followers < TRIAL_MIN_FOLLOWERS) {
        run(`UPDATE trials SET status = 'error', error = ?, updated_at = ? WHERE id = ?`, [`This account has ${followers} followers, and Instagram only takes trial reels from 1,000. Nothing was posted. Approve the cut again to post it as a normal reel.`, now(), trialId]);
        return;
      }
    }
  }
  if (!containerId) {
    const grad = setting("trial_graduation") === "SS_PERFORMANCE" ? "SS_PERFORMANCE" : "MANUAL";
    containerId = await igCreateReel({ igId: ig.external_id, token, videoUrl: publicMediaUrl(t.output_path, 24), caption: t.caption, trial: t.mode === "regular" ? null : grad, collaborators: t.mode === "regular" ? collaboratorsOf(t.settings) : [] });
    run(`UPDATE trials SET status = 'posting', container_id = ?, updated_at = ? WHERE id = ?`, [containerId, now(), trialId]);
  }
  const st = await igContainerStatus(containerId, token);
  if (st.status_code === "IN_PROGRESS") return later(job, 2);
  if (st.status_code === "PUBLISHED") {
    // Published on an earlier try, but the reply never reached us. Find it instead of posting twice.
    const recent = await igRecentMedia(ig.external_id, token, 10);
    // Hook variants share a caption, so skip any reel already tied to another trial.
    const hit = recent.find((m: any) => (m.caption || "").trim() === String(t.caption || "").trim() && !one(`SELECT id FROM trials WHERE media_id = ? AND id <> ?`, [m.id, trialId]));
    if (!hit) {
      run(`UPDATE trials SET status = 'error', error = ?, updated_at = ? WHERE id = ?`, ["Instagram says this reel is already posted, but the hub couldn't find it. Check the account before trying again.", now(), trialId]);
      return;
    }
    return markLive(t, trialId, hit.id, token);
  }
  if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
    run(`UPDATE trials SET status = 'error', error = ?, container_id = NULL, updated_at = ? WHERE id = ?`, [`Instagram couldn't process the video: ${st.status || st.status_code}`, now(), trialId]);
    return;
  }
  const mediaId = await igPublish(ig.external_id, token, containerId);
  return markLive(t, trialId, mediaId, token);
}

async function markLive(t: any, trialId: number, mediaId: string, token: string) {
  const info = await igMediaInfo(mediaId, token).catch(() => ({ permalink: null, timestamp: null }) as any);
  const postedAt = info.timestamp ? new Date(info.timestamp).toISOString() : now();
  run(`UPDATE trials SET status = 'live', media_id = ?, permalink = ?, posted_at = ?, error = NULL, updated_at = ? WHERE id = ?`, [mediaId, info.permalink || null, postedAt, now(), trialId]);
  run(
    `INSERT INTO posts (account_id, external_id, permalink, caption, media_type, published_at, via_hub, edit_id, is_trial, created_at)
     VALUES (@a, @x, @l, @c, 'REELS', @p, 1, @e, 1, @at) ON CONFLICT(account_id, external_id) DO NOTHING`,
    { a: t.account_id, x: mediaId, l: info.permalink || null, c: t.caption, p: postedAt, e: t.edit_id, at: now() },
  );
  audit(t.approved_by, "trial_posted", "trial", trialId, { mediaId });
  const verdictAt = settingNum("trial_read_hours");
  for (const h of READ_POINTS.filter((x) => x < verdictAt)) enqueue("read_trial", { trialId, hours: h }, { inMinutes: h * 60 });
  enqueue("read_trial", { trialId, hours: verdictAt, verdict: true }, { inMinutes: verdictAt * 60 });
  // Meta says insights can lag up to 48 hours, so take one last reading for the record (it never changes the verdict).
  if (verdictAt < 48) enqueue("read_trial", { trialId, hours: 48 }, { inMinutes: 48 * 60 });
}

/** Worker: read the numbers; at the verdict point, compare with the speaker's median trial. */
export async function readTrial(trialId: number, hours: number, isVerdict = false) {
  const t = one<any>(`SELECT t.*, s.speaker_id, s.id AS script_id FROM trials t JOIN edits e ON e.id = t.edit_id JOIN scripts s ON s.id = e.script_id WHERE t.id = ?`, [trialId]);
  if (!t || !t.media_id || t.media_id === "dry-run") return;
  const ig = one<any>(`SELECT * FROM accounts WHERE id = ?`, [t.account_id]);
  const m = await igInsights(t.media_id, await accessToken(ig), true);
  run(`INSERT INTO trial_snapshots (trial_id, hours, metrics, created_at) VALUES (?, ?, ?, ?)`, [trialId, hours, JSON.stringify(m), now()]);
  run(
    `UPDATE trials SET views = @v, reach = @r, likes = @l, comments = @c, shares = @sh, saves = @sv, avg_watch_ms = @w,
       skip_rate = @sk, total_watch_ms = @tw, read_at = @at, updated_at = @at WHERE id = @id`,
    { v: m.views, r: m.reach, l: m.likes, c: m.comments, sh: m.shares, sv: m.saves, w: m.avgWatchMs, sk: m.skipRate, tw: m.totalWatchMs, at: now(), id: trialId },
  );
  run(`UPDATE posts SET views = ?, likes = ?, comments = ?, shares = ?, saves = ?, reach = ?, avg_watch_ms = ?, skip_rate = ?, metrics_at = ? WHERE account_id = ? AND external_id = ?`, [
    m.views, m.likes, m.comments, m.shares, m.saves, m.reach, m.avgWatchMs, m.skipRate, now(), t.account_id, t.media_id,
  ]);
  // The automatic verdict happens once, at the verdict point, and never overrides one a person already made.
  if (isVerdict && t.verdict === "pending" && !t.verdict_set_by) decide(trialId, t.speaker_id, t.script_id, m.views ?? 0);
}

export function decide(trialId: number, speakerId: number, scriptId: number, views: number) {
  const t = one<any>(`SELECT mode, shares, reach FROM trials WHERE id = ?`, [trialId]) || {};
  const mode = t.mode === "regular" ? "regular" : "trial";
  const kind = mode === "regular" ? "normal reel" : "trial";
  const base = baselineViews(speakerId, 20, mode);
  const sends = baselineSends(speakerId, 20, mode);
  const sendRate = t.reach > 0 && t.shares != null ? (t.shares / t.reach) * 1000 : null;
  const need = settingNum("min_trials_for_baseline");
  const mult = settingNum("winner_multiplier");
  let verdict = "pending";
  let reason: string;
  if (base.n < need) {
    reason = `Only ${base.n} finished ${kind}${base.n === 1 ? "" : "s"} so far — pick winners by hand until there are ${need}.`;
  } else if (views >= base.median * mult) {
    verdict = "winner";
    reason = `${views} views vs a median of ${base.median} over the last ${base.n} ${kind}s (needs ${Math.ceil(base.median * mult)}).`;
  } else if (sendRate != null && sends.n >= need && sends.median > 0 && sendRate >= sends.median * 1.5 && views >= base.median) {
    // Sends matter most for reaching new people, so a reel that's shared far more than usual goes to a person, not the bin.
    reason = `Views (${views}) missed the bar of ${Math.ceil(base.median * mult)}, but it was shared ${(sendRate / sends.median).toFixed(1)}× more than usual per person reached. Your call.`;
  } else {
    verdict = "not_winner";
    reason = `${views} views vs a median of ${base.median} (needs ${Math.ceil(base.median * mult)}).`;
  }
  const r = run(
    `UPDATE trials SET status = 'done', verdict = ?, verdict_reason = ?, baseline_views = ?, verdict_at = ?, updated_at = ? WHERE id = ? AND verdict = 'pending' AND verdict_set_by IS NULL`,
    [verdict, reason, base.median || null, now(), now(), trialId],
  );
  if (r.changes && verdict !== "pending") run(`UPDATE scripts SET status = ?, updated_at = ? WHERE id = ?`, [verdict, now(), scriptId]);
}

/** A person overrides the verdict (also how winners are picked before there's a baseline). */
export function setVerdict(trialId: number, verdict: "winner" | "not_winner", userId: number) {
  const t = one<any>(`SELECT t.*, e.script_id FROM trials t JOIN edits e ON e.id = t.edit_id WHERE t.id = ?`, [trialId]);
  if (!t) throw new Error("No such trial");
  if (!["live", "done"].includes(t.status)) throw new Error("This trial isn't live yet.");
  run(
    `UPDATE trials SET verdict = ?, verdict_set_by = ?, verdict_at = ?,
       verdict_reason = CASE WHEN COALESCE(verdict_reason, '') = '' THEN 'Set by hand.' WHEN verdict_reason LIKE '%set by hand' THEN verdict_reason ELSE verdict_reason || ' · set by hand' END,
       status = 'done', updated_at = ? WHERE id = ?`,
    [verdict, userId, now(), now(), trialId],
  );
  run(`UPDATE scripts SET status = ?, updated_at = ? WHERE id = ?`, [verdict, now(), t.script_id]);
  audit(userId, "set_verdict", "trial", trialId, { verdict });
}

export function trialRows(filter: "live" | "done" | "all" = "all") {
  const where = filter === "live" ? `WHERE t.status IN ('queued','posting','live')` : filter === "done" ? `WHERE t.status = 'done'` : "";
  return raw<any>(
    `SELECT t.*, e.thumb_path, e.duration, e.output_path, e.settings AS edit_settings, e.variant_of, e.video_id, s.title, s.hook, s.source, s.lane, s.caption AS script_caption, s.hashtags, s.compliance, s.linkedin_text, s.doctor,
       s.id AS script_id, sp.name AS speaker, sp.id AS speaker_id, sp.caption_disclaimer, sp.screen_disclaimer
     FROM trials t JOIN edits e ON e.id = t.edit_id JOIN scripts s ON s.id = e.script_id JOIN speakers sp ON sp.id = s.speaker_id
     ${where} ORDER BY t.id DESC LIMIT 200`,
  );
}
