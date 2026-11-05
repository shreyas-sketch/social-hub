/**
 * The worker: run with `npm run worker` (a second process next to the web app).
 *
 * Two lanes so a long video edit never holds up a post or a read:
 *   heavy — video edits (ffmpeg), one at a time
 *   light — everything else (posting, reading numbers, writing scripts)
 *
 * Plus a once-a-minute clock that adds the daily jobs at the IST hours set in Settings.
 */
import { db, istDay, one, run, now } from "@/db";
import { claim, finish, fail, releaseStuck, releaseAllOnStart, type Job } from "@/lib/jobs";
import { dailyTick } from "@/lib/daily";
import { pullStats } from "@/lib/accounts";
import { pullRefs } from "@/lib/refs";
import { writeBrief } from "@/lib/scripts";
import { runEdit } from "@/lib/edits";
import { postTrial, readTrial } from "@/lib/trials";
import { runPublish } from "@/lib/publish";
import { pullWatch } from "@/lib/watch";
import { trendScout, playbookCoach, hookDoctor, weeklyReview } from "@/lib/agents";
import { transcribeSession, pickClips, runLongform, remakeThumbs, uploadLongform } from "@/lib/sessions";
import { pullComments, draftReplies, postReply } from "@/lib/comments";
import { writeTextPosts, postText } from "@/lib/textposts";
import { guestHelper } from "@/lib/guests";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function handle(job: Job) {
  const p = job.payload;
  switch (job.kind) {
    case "pull_stats":
      return pullStats(p.accountId);
    case "pull_refs": {
      const errs = await pullRefs(p.speakerId);
      if (errs.length) log("watchlist:", errs.join(" | "));
      return;
    }
    case "write_brief":
      return void (await writeBrief(p.speakerId, p.day || istDay(), p.count));
    case "run_edit":
      return runEdit(p.editId);
    case "post_trial":
      return postTrial(p.trialId, job);
    case "read_trial":
      return readTrial(p.trialId, p.hours, !!p.verdict);
    case "publish":
      return runPublish(p.publishId);
    case "refresh_tokens":
      return;
    case "pull_watch": {
      const errs = await pullWatch(p.kind);
      if (errs.length) log("trend pool / teachers:", errs.slice(0, 5).join(" | "), errs.length > 5 ? `(+${errs.length - 5} more)` : "");
      return;
    }
    case "agent":
      if (p.agent === "trend_scout") return void (await trendScout());
      if (p.agent === "playbook_coach") return void (await playbookCoach());
      if (p.agent === "hook_doctor") return void (await hookDoctor(p.scriptIds || []));
      if (p.agent === "weekly_review") return void (await weeklyReview(p.speakerId));
      if (p.agent === "reply_drafter") return void (await draftReplies(p.speakerId));
      if (p.agent === "guest_helper") return void (await guestHelper(p.guestId, p.what === "prep" ? "prep" : "pitch"));
      throw new Error(`Unknown agent ${p.agent}`);
    case "session_transcribe":
      return transcribeSession(p.sessionId);
    case "session_pick":
      return void (await pickClips(p.sessionId, !!p.again));
    case "run_longform":
      return runLongform(p.longformId);
    case "longform_thumbs":
      return remakeThumbs(p.longformId);
    case "upload_longform":
      return uploadLongform(p.longformId);
    case "pull_comments":
      return void (await pullComments(p.accountId));
    case "post_reply":
      return postReply(p.commentId);
    case "write_text_posts":
      return void (await writeTextPosts(p.speakerId, p.day || istDay(), !!p.force));
    case "post_text":
      return postText(p.textPostId);
  }
}

/** After the last retry, show the failure where people look (with a Try again button), not only in Settings → Jobs. */
function gaveUp(job: Job, msg: string) {
  const p = job.payload;
  if (job.kind === "post_trial") run(`UPDATE trials SET status = 'error', error = ?, updated_at = ? WHERE id = ? AND status IN ('queued','posting')`, [msg.slice(0, 1000), now(), p.trialId]);
  if (job.kind === "run_edit") run(`UPDATE edits SET status = 'error', error = COALESCE(error, ?), updated_at = ? WHERE id = ? AND status IN ('queued','running')`, [msg.slice(0, 1000), now(), p.editId]);
  if (job.kind === "session_transcribe" || job.kind === "session_pick") run(`UPDATE sessions SET status = 'error', error = COALESCE(error, ?), updated_at = ? WHERE id = ? AND status IN ('transcribing','picking')`, [msg.slice(0, 1000), now(), p.sessionId]);
  if (job.kind === "run_longform") run(`UPDATE longforms SET status = 'error', error = COALESCE(error, ?), updated_at = ? WHERE id = ? AND status IN ('queued','cutting')`, [msg.slice(0, 1000), now(), p.longformId]);
}

async function lane(name: "heavy" | "light") {
  for (;;) {
    const job = claim(name);
    if (!job) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    const t0 = Date.now();
    try {
      await handle(job);
      // postTrial may have put itself back in the queue with later(); only finish if it's still ours and running.
      const still = one<{ status: string }>(`SELECT status FROM jobs WHERE id = ?`, [job.id]);
      if (still?.status === "running") finish(job.id);
      log(`[${name}] ${job.kind} #${job.id} ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      const msg = (e as Error).message;
      const outcome = fail(job, e);
      log(`[${name}] ${job.kind} #${job.id} failed (try ${job.attempts}${outcome === "gave_up" ? ", giving up" : ""}):`, msg);
      if (outcome === "gave_up") gaveUp(job, msg);
    }
  }
}

async function main() {
  db();
  log("worker up");
  releaseAllOnStart();
  setInterval(() => {
    try {
      releaseStuck();
      const did = dailyTick();
      if (did.length) log("daily:", did.join(", "), "queued");
    } catch (e) {
      log("clock error:", (e as Error).message);
    }
  }, 60e3);
  dailyTick();
  await Promise.all([lane("heavy"), lane("light")]);
}

if (process.argv[1]?.includes("worker")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
