"use server";
import nodeCrypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { one, raw, run, now, istDay, json, tx } from "@/db";
import { COOKIE, checkPassword, hashPassword, signSession, currentUser, requireUser, requireApprover, requireOwner, userCount, createUser, canApprove, type User } from "@/lib/auth";
import { setSetting, SETTING_DEFAULTS } from "@/lib/config";
import { audit, connectToken } from "@/lib/secure";
import { enqueue, retryJob } from "@/lib/jobs";
import { recheckScript } from "@/lib/scripts";
import { createEdit, cutCheck, blocksRemoved } from "@/lib/edits";
import { startTrial, setVerdict } from "@/lib/trials";
import { sendEverywhere, markManualDone, retryPublish } from "@/lib/publish";
import { disconnect, saveManualStat, ensureAccount } from "@/lib/accounts";
import { savePicked, PLATFORM_OAUTH } from "@/lib/oauth";
import { addCreators, READABLE } from "@/lib/refs";
import { addSources } from "@/lib/watch";
import { applyLaneMix } from "@/lib/agents";
import { checkText } from "@/lib/compliance";
import { PLATFORMS, type Platform } from "@/lib/speakers";
import type { Word } from "@/lib/edit/transcribe";
import { env } from "@/lib/config";
import { createSession, saveLongform, startLongformCut, approveLongform, markLongformUploaded, logTestWinner, approveClip } from "@/lib/sessions";
import { addShoot, setShootStatus, saveCadence, CADENCE_KEYS } from "@/lib/planner";
import { saveTargets, addSignups, saveBoost, GROWTH_PLATFORMS } from "@/lib/growth";
import { saveDmRule, switchDmRule, approveReply } from "@/lib/comments";
import { decideTextPost, saveTextPost, logTextNumbers, retryTextPost } from "@/lib/textposts";
import { saveGuest } from "@/lib/guests";
import { sameAsSeen, scriptSeen, textPostSeen, dmRuleSeen, longformSeen } from "@/lib/seen";

type Result = { ok: boolean; msg: string } | null;

// Line breaks are stored one way (\n), whatever the browser or a pasted text used.
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").replace(/\r\n?/g, "\n").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k));

/** Runs an action, refreshes the pages, and returns a short message instead of crashing the page. */
async function act(paths: string[], fn: () => unknown | Promise<unknown>, okMsg = "Saved."): Promise<Result> {
  try {
    const r = await fn();
    for (const p of paths) revalidatePath(p, p === "/" ? "layout" : "page");
    return { ok: true, msg: typeof r === "string" ? r : okMsg };
  } catch (e: any) {
    if (String(e?.digest || "").startsWith("NEXT_REDIRECT")) throw e;
    return { ok: false, msg: e?.message || "Something went wrong." };
  }
}

const ALL = ["/"];

/* ───────── sign-in ───────── */

/** Only same-site paths after sign-in (no //host, no backslashes, no control characters). */
function safeNext(next: string) {
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\x00-\x1f]/.test(next)) return "/";
  try {
    const base = new URL(env.appUrl());
    const u = new URL(next, base);
    return u.origin === base.origin ? u.pathname + u.search : "/";
  } catch {
    return "/";
  }
}

/** Compares two secrets without leaking how much of them matched. */
function safeEqual(a: string, b: string) {
  const x = nodeCrypto.createHash("sha256").update(a).digest();
  const y = nodeCrypto.createHash("sha256").update(b).digest();
  return nodeCrypto.timingSafeEqual(x, y);
}

/** Slows down password guessing: 8 wrong tries per email in 15 minutes, then a wait. */
const tries = new Map<string, { n: number; until: number }>();

export async function login(_: Result, fd: FormData): Promise<Result> {
  const email = s(fd, "email").toLowerCase();
  const t = tries.get(email);
  if (t && t.n >= 8 && Date.now() < t.until) return { ok: false, msg: "Too many wrong tries. Wait 15 minutes and try again." };
  const u = one<any>(`SELECT * FROM users WHERE email = ?`, [email]);
  if (!u || u.password_hash === "removed" || !checkPassword(s(fd, "password"), u.password_hash)) {
    const cur = t && Date.now() < t.until ? t : { n: 0, until: Date.now() + 15 * 60e3 };
    tries.set(email, { n: cur.n + 1, until: cur.until });
    return { ok: false, msg: "Email or password is wrong." };
  }
  tries.delete(email);
  cookies().set(COOKIE, signSession(u.id), { httpOnly: true, sameSite: "lax", secure: env.appUrl().startsWith("https://"), path: "/", maxAge: 14 * 86400 });
  audit(u.id, "login", "user", u.id);
  redirect(safeNext(s(fd, "next")));
}

export async function logout() {
  cookies().delete(COOKIE);
  redirect("/login");
}

export async function setupOwner(_: Result, fd: FormData): Promise<Result> {
  if (userCount() > 0) return { ok: false, msg: "Already set up — sign in instead." };
  // On a public server the first visitor could otherwise claim the empty install, so a key is required there.
  const setupKey = process.env.SETUP_KEY || "";
  if (!setupKey && process.env.NODE_ENV === "production") return { ok: false, msg: "SETUP_KEY isn't set on the server. Set it, restart, then open /setup?key=<that value>." };
  if (setupKey && !safeEqual(s(fd, "key"), setupKey)) return { ok: false, msg: "Open the setup link printed by the server setup script (it has a key)." };
  const pw = s(fd, "password");
  if (pw.length < 10) return { ok: false, msg: "Use at least 10 characters for the password." };
  // Check and create in one step, so two people opening the setup link at once can't both become owner.
  const id = tx(() => (userCount() > 0 ? 0 : Number(createUser(s(fd, "email"), s(fd, "name"), pw, "owner").lastInsertRowid)));
  if (!id) return { ok: false, msg: "Already set up — sign in instead." };
  cookies().set(COOKIE, signSession(id), { httpOnly: true, sameSite: "lax", secure: env.appUrl().startsWith("https://"), path: "/", maxAge: 14 * 86400 });
  audit(id, "setup_owner", "user", id);
  redirect("/");
}

/* ───────── scripts ───────── */

export async function decideScript(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const id = n(fd, "id");
    const decision = s(fd, "decision");
    const sc = one<any>(`SELECT * FROM scripts WHERE id = ?`, [id]);
    if (!sc) throw new Error("No such script");
    if (!["proposed", "rejected"].includes(sc.status)) throw new Error("This script has already moved on (it's being shot or tested).");
    if (decision === "approve") {
      sameAsSeen(s(fd, "seen"), scriptSeen(sc));
      const c = json<any>(sc.compliance, { status: "ok" });
      if (c.status === "block") throw new Error("This script breaks a blocking rule — edit it first.");
      run(`UPDATE scripts SET status = 'approved', decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?`, [u.id, now(), now(), id]);
      audit(u.id, "approve_script", "script", id);
      // A clip from a long session needs no shoot: its cut starts straight away.
      if (sc.source === "clip") {
        approveClip(id, u.id);
        return "Approved — cutting the clip now. It shows on the Edits page in a few minutes.";
      }
      return "Approved — it's on the Shoot list.";
    }
    run(`UPDATE scripts SET status = 'rejected', notes = COALESCE(NULLIF(?, ''), notes), decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?`, [s(fd, "note"), u.id, now(), now(), id]);
    audit(u.id, "reject_script", "script", id, { note: s(fd, "note") });
    return "Rejected.";
  });
}

export async function saveScript(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const id = n(fd, "id");
    const cur = one<any>(`SELECT status, on_screen, source, body FROM scripts WHERE id = ?`, [id]);
    if (!cur) throw new Error("No such script");
    const afterApproval = cur.status !== "proposed" && cur.status !== "rejected";
    if (afterApproval && !canApprove(u)) throw new Error("This script is already approved. Only an owner or admin can change it now.");
    const prev = json<{ t?: number }[]>(cur.on_screen, []);
    const onScreen = s(fd, "on_screen")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((text, i) => ({ t: prev[i]?.t ?? i * 4, text }));
    run(
      `UPDATE scripts SET title = @title, hook = @hook, body = @body, cta = @cta, caption = @caption, hashtags = @hashtags,
         on_screen = @on_screen, notes = @notes, linkedin_text = @li, updated_at = @at WHERE id = @id`,
      {
        // A clip's spoken words are what's in the recording; editing the text wouldn't change the video, so it stays as transcribed.
        title: s(fd, "title"), hook: s(fd, "hook"), body: cur.source === "clip" ? cur.body : s(fd, "body"), cta: s(fd, "cta"), caption: s(fd, "caption"),
        // Instagram allows at most 5 hashtags.
        hashtags: (s(fd, "hashtags").match(/#[\p{L}\p{N}_]+/gu) || []).slice(0, 5).join(" "),
        on_screen: JSON.stringify(onScreen), notes: s(fd, "notes") || null, li: s(fd, "linkedin_text") || null, at: now(), id,
      },
    );
    const c = recheckScript(id);
    audit(u.id, afterApproval ? "edit_script_after_approval" : "edit_script", "script", id);
    return c?.status === "block" ? "Saved — but it still breaks a blocking rule (see the red notes)." : "Saved and re-checked.";
  });
}

export async function writeScriptsNow(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const ids = s(fd, "speaker") ? [n(fd, "speaker")] : raw<{ id: number }>(`SELECT id FROM speakers WHERE active = 1 AND scripts_per_day > 0`).map((r) => r.id);
    const count = Math.min(6, n(fd, "count") || 0) || undefined;
    for (const id of ids) enqueue("write_brief", { speakerId: id, day: istDay(), count, by: u.id, at: Date.now() });
    return `Writing now — new scripts show up here in about a minute.`;
  });
}

/* ───────── edits ───────── */

export async function reEdit(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const e = one<any>(`SELECT * FROM edits WHERE id = ?`, [n(fd, "editId")]);
    if (!e) throw new Error("No such edit");
    const words = json<Word[]>(e.transcript, []);
    const old = json<any>(e.settings, {});
    const cutSilence = fd.get("cutSilence") === "on";
    const frame = s(fd, "frame") === "fit_blur" ? "fit_blur" : "crop";
    const captionStyle = ["bold_pop", "clean", "none"].includes(s(fd, "captionStyle")) ? s(fd, "captionStyle") : "bold_pop";
    // Word timings only carry over if the timeline is the same; turning pause-cutting on/off changes it, so transcribe again.
    const sameTimeline = old.cutSilence === cutSilence;
    // Keeps what isn't on this form: a test hook, collaborators.
    const id = createEdit(e.video_id, { ...old, captionStyle: captionStyle as any, frame: frame as any, cutSilence }, sameTimeline && words.length ? words : null);
    if (e.variant_of) run(`UPDATE edits SET variant_of = ? WHERE id = ?`, [e.variant_of, id]);
    audit(u.id, "re_edit", "edit", id, { from: e.id });
    redirect(`/edits/${id}`);
  });
}

/** Keeps each word's timing; if the count changed, spreads the new words evenly over the old time span. */
function retime(old: Word[], text: string): Word[] {
  const next = text.split(/\s+/).filter(Boolean);
  if (!old.length || !next.length) return [];
  if (next.length === old.length) return old.map((w, i) => ({ ...w, w: next[i] }));
  const start = old[0].s;
  const end = old[old.length - 1].e;
  const step = (end - start) / next.length;
  return next.map((w, i) => ({ w, s: +(start + i * step).toFixed(2), e: +(start + (i + 1) * step).toFixed(2) }));
}

export async function fixWords(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const e = one<any>(`SELECT e.*, sp.niche FROM edits e JOIN scripts sc ON sc.id = e.script_id JOIN speakers sp ON sp.id = sc.speaker_id WHERE e.id = ?`, [n(fd, "editId")]);
    if (!e) throw new Error("No such edit");
    if (one(`SELECT id FROM trials WHERE edit_id = ? AND status NOT IN ('error','replaced')`, [e.id])) throw new Error("This cut has already gone out.");
    const words = retime(json<Word[]>(e.transcript, []), s(fd, "text"));
    if (!words.length) throw new Error("No words to keep.");
    // Fixing a misheard word is fine for anyone. Taking out words the rules flag is not: the audio still says them,
    // so only an owner or admin can make that change (and it's logged).
    const gone = blocksRemoved(cutCheck(e, e.niche), cutCheck({ transcript: JSON.stringify(words), settings: e.settings }, e.niche));
    if (gone.length && !canApprove(u)) {
      throw new Error(`This change takes out ${gone.map((i) => `"${i.match}"`).join(", ")}, which the rules flag. The audio still says it, so only an owner or admin can make this change. If the speaker really said it, re-shoot.`);
    }
    const id = createEdit(e.video_id, json(e.settings, {}), words);
    if (e.variant_of) run(`UPDATE edits SET variant_of = ? WHERE id = ?`, [e.variant_of, id]);
    audit(u.id, gone.length ? "fix_words_removed_flagged" : "fix_words", "edit", id, { from: e.id, removed: gone.map((i) => i.match) });
    redirect(`/edits/${id}`);
  });
}

export async function approveCut(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    startTrial(n(fd, "editId"), u.id);
    return "Approved — posting it as a trial reel now. It shows on the Trials page.";
  });
}

export async function rejectCut(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const id = n(fd, "editId");
    run(`UPDATE edits SET status = 'rejected', notes = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?`, [s(fd, "note") || null, u.id, now(), now(), id]);
    audit(u.id, "reject_cut", "edit", id, { note: s(fd, "note") });
    return "Marked as not usable.";
  });
}

/* ───────── trials + publishing ───────── */

export async function verdict(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const v = s(fd, "verdict") === "winner" ? "winner" : "not_winner";
    setVerdict(n(fd, "trialId"), v, u.id);
    return v === "winner" ? "Marked as a winner — send it everywhere below." : "Marked as not a winner.";
  });
}

export async function retryTrial(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const id = n(fd, "trialId");
    const t = one<any>(`SELECT edit_id FROM trials WHERE id = ?`, [id]);
    if (t && one(`SELECT id FROM trials WHERE edit_id = ? AND id > ?`, [t.edit_id, id])) throw new Error("This cut was approved again since, so this try is replaced. Nothing to retry.");
    const r = run(`UPDATE trials SET status = 'queued', error = NULL, updated_at = ? WHERE id = ? AND status = 'error'`, [now(), id]);
    if (!r.changes) throw new Error("This trial isn't in error any more — reload the page.");
    enqueue("post_trial", { trialId: id });
    audit(u.id, "retry_trial", "trial", id);
    return "Trying again.";
  });
}

export async function sendWinner(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const platforms = fd.getAll("platform").map(String).filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));
    if (!platforms.length) throw new Error("Tick at least one platform.");
    const ids = sendEverywhere(n(fd, "editId"), platforms, u.id);
    return ids.length ? `Sent — follow it on the Publish page.` : "Already sent to those platforms.";
  });
}

export async function manualDone(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const url = s(fd, "url");
    if (url && !/^https:\/\//i.test(url)) throw new Error("Paste the full link, starting with https://");
    markManualDone(n(fd, "id"), url || null, u.id);
    return "Marked as done.";
  });
}

export async function retryPost(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    retryPublish(n(fd, "id"), u.id);
    return "Trying again.";
  });
}

/* ───────── speakers + watchlist ───────── */

export async function saveSpeaker(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const id = n(fd, "id");
    const lanes = [0, 1, 2, 3, 4]
      .map((i) => ({ key: s(fd, `lane_key_${i}`) || s(fd, `lane_name_${i}`).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), name: s(fd, `lane_name_${i}`), desc: s(fd, `lane_desc_${i}`), share: n(fd, `lane_share_${i}`) || 0 }))
      .filter((l) => l.name && l.share > 0);
    const total = lanes.reduce((a, l) => a + Number(l.share || 0), 0);
    if (lanes.length && Math.abs(total - 100) > 1) throw new Error(`Lane shares add up to ${total}% — make them 100%.`);
    const programUrl = s(fd, "program_url");
    if (programUrl && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(programUrl)) throw new Error("The webinar page must be a full link, like https://example.com/webinar");
    // A form without the bio box leaves the bio as it is.
    const cur = one<any>(`SELECT bio FROM speakers WHERE id = ?`, [id]);
    if (!cur) throw new Error("No such speaker");
    const bio = fd.has("bio") ? s(fd, "bio") : cur.bio;
    if ([...(bio || "")].length > 150) throw new Error("Instagram bios are 150 characters at most.");
    run(
      `UPDATE speakers SET direction = @direction, audience = @audience, bio = @bio, voice_notes = @voice, program_url = @url,
         caption_disclaimer = @cd, screen_disclaimer = @sd, scripts_per_day = @spd, lanes = @lanes, stop_list = @stop, active = @active,
         caption_style = @style WHERE id = @id`,
      {
        direction: s(fd, "direction"),
        audience: s(fd, "audience"),
        bio: bio || null,
        voice: s(fd, "voice_notes"),
        url: programUrl || null,
        cd: s(fd, "caption_disclaimer") || null,
        sd: s(fd, "screen_disclaimer") || null,
        spd: Math.max(0, Math.min(6, n(fd, "scripts_per_day") || 0)),
        lanes: JSON.stringify(lanes),
        stop: JSON.stringify(s(fd, "stop_list").split("\n").map((x) => x.trim()).filter(Boolean)),
        active: fd.get("active") === "on" ? 1 : 0,
        style: ["bold_pop", "clean", "none"].includes(s(fd, "caption_style")) ? s(fd, "caption_style") : null,
        id,
      },
    );
    audit(u.id, "edit_speaker", "speaker", id);
  });
}

/** Anyone signed in can add creators: paste one link or handle per line. */
export async function addRef(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const speakerId = n(fd, "speakerId");
    if (!one(`SELECT id FROM speakers WHERE id = ?`, [speakerId])) throw new Error("Pick a speaker.");
    const lines = s(fd, "links").split(/[\n,]+/).map((l) => l.trim()).filter(Boolean).slice(0, 50);
    if (!lines.length) throw new Error("Paste at least one profile link or @handle.");
    const fallback = s(fd, "platform") === "youtube" ? "youtube" : "instagram";
    const { added, skipped } = addCreators(speakerId, lines, fallback, s(fd, "note") || null, s(fd, "name") || null, u.id);
    if (added.length) {
      audit(u.id, "add_ref", "speaker", speakerId, { added: added.map((a) => a.url) });
      enqueue("pull_refs", { speakerId });
    }
    const unread = added.filter((a) => !READABLE.includes(a.platform)).length;
    const parts = [
      added.length ? `Added ${added.length}${added.length > unread ? " — first numbers in a minute or two" : ""}.` : "Nothing new added.",
      unread ? `${unread} ${unread === 1 ? "is" : "are"} on a platform the hub can't read (kept as a link).` : "",
      skipped.length ? `Skipped: ${skipped.join("; ")}.` : "",
    ];
    if (!added.length) throw new Error(parts.filter(Boolean).join(" "));
    return parts.filter(Boolean).join(" ");
  });
}

export async function editRef(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const id = n(fd, "id");
    const name = s(fd, "name");
    if (!name) throw new Error("Give the creator a name.");
    run(`UPDATE refs SET name = ?, note = ? WHERE id = ?`, [name.slice(0, 120), s(fd, "note").slice(0, 300) || null, id]);
    audit(u.id, "edit_ref", "ref", id);
  });
}

/** Pause = keep but stop reading. Remove = hide from every list (kept in the database so old scripts still show their source). */
export async function toggleRef(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const id = n(fd, "id");
    if (s(fd, "do") === "remove") {
      run(`UPDATE refs SET active = -1 WHERE id = ?`, [id]);
      audit(u.id, "remove_ref", "ref", id);
      return "Removed from the watchlist.";
    }
    run(`UPDATE refs SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ? AND active >= 0`, [id]);
    audit(u.id, "toggle_ref", "ref", id);
  });
}

export async function pullWatchlist(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    requireUser();
    const ids = s(fd, "speaker") ? [n(fd, "speaker")] : raw<{ id: number }>(`SELECT id FROM speakers WHERE active = 1`).map((r) => r.id);
    for (const id of ids) enqueue("pull_refs", { speakerId: id });
    return "Checking the watchlist now.";
  });
}

/* ───────── accounts ───────── */

export async function saveAccount(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const id = n(fd, "id");
    const a = one<any>(`SELECT * FROM accounts WHERE id = ?`, [id]);
    if (!a) throw new Error("No such account");
    const url = s(fd, "url");
    if (url && !/^https:\/\//i.test(url)) throw new Error("The profile link must start with https://");
    const exists = fd.has("exists") ? fd.get("exists") === "on" : a.status !== "missing";
    const status = a.status === "connected" || a.status === "error" ? a.status : exists ? "not_connected" : "missing";
    run(`UPDATE accounts SET handle = ?, url = ?, status = ? WHERE id = ?`, [s(fd, "handle") || null, url || null, status, id]);
    audit(u.id, "edit_account", "account", id);
  });
}

export async function typeFollowers(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const f = n(fd, "followers");
    if (!Number.isFinite(f) || f < 0) throw new Error("Type a number.");
    saveManualStat(n(fd, "id"), Math.round(f));
    audit(u.id, "manual_followers", "account", n(fd, "id"), { followers: f });
    return "Saved for today.";
  });
}

export async function disconnectAccount(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    disconnect(n(fd, "id"));
    audit(u.id, "disconnect", "account", n(fd, "id"));
    return "Disconnected.";
  });
}

export async function pullNow(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    requireUser();
    enqueue("pull_stats", { accountId: n(fd, "id") });
    return "Pulling numbers now.";
  });
}

export async function makeConnectLink(_: Result, fd: FormData): Promise<Result> {
  try {
    const u = requireApprover();
    const platform = s(fd, "platform") as Platform;
    if (!(PLATFORMS as readonly string[]).includes(platform)) throw new Error("Unknown platform");
    const speakerId = n(fd, "speakerId");
    if (!one(`SELECT id FROM speakers WHERE id = ?`, [speakerId])) throw new Error("No such speaker");
    const acc = ensureAccount(speakerId, platform);
    const t = connectToken(speakerId, PLATFORM_OAUTH[platform]);
    audit(u.id, "make_connect_link", "account", acc.id, { platform });
    return { ok: true, msg: `${env.appUrl()}/connect/${t}` };
  } catch (e: any) {
    return { ok: false, msg: e.message };
  }
}

export async function pickPages(_: Result, fd: FormData): Promise<Result> {
  try {
    const u = currentUser();
    const choice: Record<string, number> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("page_") && Number(v)) choice[k.slice(5)] = Number(v);
    if (!Object.keys(choice).length) return { ok: false, msg: "Choose a speaker for at least one Page." };
    savePicked(s(fd, "state"), choice, u?.id ?? null, canApprove(u));
  } catch (e: any) {
    return { ok: false, msg: e.message };
  }
  redirect("/connect/done?ok=meta");
}

/* ───────── settings + people ───────── */

export async function saveSettings(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireOwner();
    const LIMITS: Record<string, [number, number]> = {
      stats_hour_ist: [0, 23], brief_hour_ist: [0, 23], trial_read_hours: [3, 168], winner_window_hours: [1, 168],
      winner_multiplier: [1, 5], min_trials_for_baseline: [1, 50], agents_weekday: [0, 6], agents_hour_ist: [0, 23],
      clips_per_session: [3, 20], trial_daily_cap: [1, 20], comments_poll_minutes: [0, 1440], dm_per_hour: [1, 200], text_post_hour_ist: [0, 23],
      growth_target_followers: [1000, 1e9],
    };
    if (fd.has("mix_target") && !/^\d{1,3}\/\d{1,3}\/\d{1,3}$/.test(s(fd, "mix_target"))) throw new Error("The script mix is three numbers like 70/20/10.");
    if (fd.has("growth_target_date") && !/^\d{4}-\d{2}-\d{2}$/.test(s(fd, "growth_target_date"))) throw new Error("The target date is YYYY-MM-DD, like 2029-11-30.");
    if (fd.has("link_platforms")) {
      const bad = s(fd, "link_platforms").split(/[\s,]+/).filter(Boolean).filter((x) => !["linkedin", "facebook", "x"].includes(x.toLowerCase()));
      if (bad.length) throw new Error(`Tracking-link platforms can only be linkedin, facebook or x (not ${bad.join(", ")}).`);
    }
    for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
      if (!fd.has(k)) continue;
      const v = Number(s(fd, k));
      if (s(fd, k) === "" || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`"${k.replace(/_/g, " ")}" must be a number from ${lo} to ${hi}.`);
    }
    for (const k of Object.keys(SETTING_DEFAULTS)) if (fd.has(k)) setSetting(k, s(fd, k));
    audit(u.id, "settings", "settings", null);
  });
}

export async function addUser(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireOwner();
    const pw = s(fd, "password");
    if (pw.length < 10) throw new Error("Use at least 10 characters for the password.");
    const role = ["owner", "admin", "team"].includes(s(fd, "role")) ? (s(fd, "role") as User["role"]) : "team";
    if (one(`SELECT id FROM users WHERE email = ?`, [s(fd, "email").toLowerCase()])) throw new Error("That email already has an account.");
    const r = createUser(s(fd, "email"), s(fd, "name"), pw, role);
    audit(u.id, "add_user", "user", Number(r.lastInsertRowid), { role });
    return "Added. Send them the address and password.";
  });
}

export async function setRole(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireOwner();
    const id = n(fd, "id");
    if (id === u.id) throw new Error("You can't change your own role.");
    const role = s(fd, "role");
    if (role === "remove") {
      run(`UPDATE users SET password_hash = 'removed', role = 'team' WHERE id = ?`, [id]);
      audit(u.id, "remove_user", "user", id);
      return "Removed — they can't sign in any more.";
    }
    if (!["owner", "admin", "team"].includes(role)) throw new Error("Unknown role");
    run(`UPDATE users SET role = ? WHERE id = ?`, [role, id]);
    audit(u.id, "set_role", "user", id, { role });
  });
}

export async function changePassword(_: Result, fd: FormData): Promise<Result> {
  return act([], () => {
    const u = requireUser();
    const row = one<any>(`SELECT password_hash FROM users WHERE id = ?`, [u.id]);
    if (!checkPassword(s(fd, "current"), row.password_hash)) throw new Error("Current password is wrong.");
    if (s(fd, "next").length < 10) throw new Error("Use at least 10 characters.");
    run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hashPassword(s(fd, "next")), u.id]);
    audit(u.id, "change_password", "user", u.id);
    // Every other device signed in with the old password is signed out; this one stays in.
    cookies().set(COOKIE, signSession(u.id), { httpOnly: true, sameSite: "lax", secure: env.appUrl().startsWith("https://"), path: "/", maxAge: 14 * 86400 });
    return "Password changed. Other devices are signed out.";
  });
}

export async function retryJobAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    requireApprover();
    retryJob(n(fd, "id"));
    return "Queued again.";
  });
}

export async function runDailyNow(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    requireApprover();
    const what = s(fd, "what");
    if (what === "stats") {
      for (const a of raw<{ id: number }>(`SELECT id FROM accounts WHERE status = 'connected'`)) enqueue("pull_stats", { accountId: a.id });
      return "Pulling numbers for every connected account.";
    }
    return "Nothing to do.";
  });
}

/* ───────── v1.2: AI agents, playbook, trend pool, hooks ───────── */

export async function runAgentNow(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const agent = s(fd, "agent");
    if (!["trend_scout", "playbook_coach", "weekly_review"].includes(agent)) throw new Error("Unknown agent");
    if (agent === "weekly_review") {
      const ids = s(fd, "speaker") ? [n(fd, "speaker")] : raw<{ id: number }>(`SELECT id FROM speakers WHERE active = 1`).map((r) => r.id);
      for (const id of ids) enqueue("agent", { agent, speakerId: id, by: u.id, at: Date.now() });
    } else {
      enqueue("agent", { agent, by: u.id, at: Date.now() });
    }
    audit(u.id, "run_agent", "agent", null, { agent });
    return "Running — the result shows here in a minute or two. Refresh to see it.";
  });
}

export async function doctorNow(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    requireUser();
    enqueue("agent", { agent: "hook_doctor", scriptIds: [n(fd, "id")], at: Date.now() });
    return "Hook Doctor is reading it — refresh in a minute.";
  });
}

/** Swaps in one of the Hook Doctor's hooks (or one typed by a person) and re-runs the rules check. */
export async function swapHook(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const id = n(fd, "id");
    const hook = s(fd, "hook");
    if (!hook) throw new Error("No hook given.");
    const sc = one<any>(`SELECT status, on_screen FROM scripts WHERE id = ?`, [id]);
    if (!sc) throw new Error("No such script");
    if (!["proposed", "rejected"].includes(sc.status) && !canApprove(u)) throw new Error("This script is already approved. Only an owner or admin can change it now.");
    const onScreen = json<{ t: number; text: string }[]>(sc.on_screen, []);
    run(`UPDATE scripts SET hook = ?, notes = TRIM(COALESCE(notes, '') || ' Hook swapped for a Hook Doctor suggestion.'), updated_at = ? WHERE id = ?`, [hook.slice(0, 200), now(), id]);
    if (onScreen[0] && onScreen[0].t === 0) {
      onScreen[0] = { ...onScreen[0], text: hook.split(/\s+/).slice(0, 6).join(" ") };
      run(`UPDATE scripts SET on_screen = ? WHERE id = ?`, [JSON.stringify(onScreen), id]);
    }
    const c = recheckScript(id);
    audit(u.id, "use_hook", "script", id, { hook });
    return c?.status === "block" ? "Swapped — but the new hook breaks a rule (see the red notes)." : "Hook swapped and re-checked.";
  });
}

/** Re-test a reel that didn't win: same video, a different hook on screen, a new cut to approve. */
export async function retestHook(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const e = one<any>(`SELECT e.*, s.speaker_id, sp.niche FROM edits e JOIN scripts s ON s.id = e.script_id JOIN speakers sp ON sp.id = s.speaker_id WHERE e.id = ?`, [n(fd, "editId")]);
    if (!e) throw new Error("No such cut");
    const hook = s(fd, "hook");
    if (!hook) throw new Error("Pick or type a new hook.");
    if (checkText(hook, e.niche).status === "block") throw new Error("That hook breaks a blocking rule.");
    const words = json<Word[]>(e.transcript, []);
    const id = createEdit(e.video_id, { ...json<any>(e.settings, {}), hookText: hook.slice(0, 120) }, words.length ? words : null);
    run(`UPDATE scripts SET status = 'edited', updated_at = ? WHERE id = ? AND status = 'not_winner'`, [now(), e.script_id]);
    audit(u.id, "retest_hook", "edit", id, { from: e.id, hook });
    redirect(`/edits/${id}`);
  });
}

export async function decideRule(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const id = n(fd, "id");
    const to = s(fd, "to");
    if (!["active", "retired", "proposed"].includes(to)) throw new Error("Unknown change");
    run(`UPDATE playbook_rules SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?`, [to, u.id, now(), id]);
    audit(u.id, `rule_${to}`, "playbook_rule", id);
    return to === "active" ? "Switched on — tomorrow's scripts follow it." : to === "retired" ? "Switched off." : "Moved back to proposed.";
  });
}

export async function saveRule(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const rule = s(fd, "rule");
    if (rule.length < 8) throw new Error("Write the rule as one clear line.");
    const scope = s(fd, "scope") || "all";
    const ok = ["all", "instagram", "youtube", "linkedin", "x", "facebook"].includes(scope) || /^speaker:\d+$/.test(scope);
    if (!ok) throw new Error("Unknown scope");
    const url = s(fd, "source_url");
    if (url && !/^https?:\/\//i.test(url)) throw new Error("The source must be a full link.");
    if (s(fd, "id")) {
      run(`UPDATE playbook_rules SET rule = ?, why = ?, scope = ?, source_url = COALESCE(NULLIF(?, ''), source_url) WHERE id = ?`, [rule.slice(0, 300), s(fd, "why") || null, scope, url, n(fd, "id")]);
      audit(u.id, "edit_rule", "playbook_rule", n(fd, "id"));
      return "Saved.";
    }
    const r = run(
      `INSERT INTO playbook_rules (scope, rule, why, source_name, source_url, kind, status, proposed_by, decided_by, decided_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'ours', 'active', 'person', ?, ?, ?)`,
      [scope, rule.slice(0, 300), s(fd, "why") || null, u.name, url || null, u.id, now(), now()],
    );
    audit(u.id, "add_rule", "playbook_rule", Number(r.lastInsertRowid));
    return "Added and switched on.";
  });
}

export async function addWatch(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const kind = s(fd, "kind") === "teacher" ? "teacher" : "trend";
    const lines = s(fd, "links").split(/[\n,]+/).map((l) => l.trim()).filter(Boolean).slice(0, 50);
    if (!lines.length) throw new Error("Paste at least one profile link or @handle.");
    const { added, skipped } = addSources(kind, lines, s(fd, "platform") === "youtube" ? "youtube" : "instagram", s(fd, "note") || null, u.id);
    if (added.length) {
      audit(u.id, "add_watch", "watch_source", null, { kind, added: added.map((a) => a.url) });
      enqueue("pull_watch", { kind });
    }
    if (!added.length) throw new Error(`Nothing new added.${skipped.length ? ` Skipped: ${skipped.join("; ")}.` : ""}`);
    return `Added ${added.length}.${skipped.length ? ` Skipped: ${skipped.join("; ")}.` : ""}`;
  });
}

export async function toggleWatch(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const id = n(fd, "id");
    if (s(fd, "do") === "remove") {
      run(`UPDATE watch_sources SET active = -1 WHERE id = ?`, [id]);
      audit(u.id, "remove_watch", "watch_source", id);
      return "Removed.";
    }
    run(`UPDATE watch_sources SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ? AND active >= 0`, [id]);
    audit(u.id, "toggle_watch", "watch_source", id);
  });
}

export async function editWatch(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const name = s(fd, "name");
    if (!name) throw new Error("Give it a name.");
    run(`UPDATE watch_sources SET name = ?, note = ? WHERE id = ?`, [name.slice(0, 120), s(fd, "note").slice(0, 300) || null, n(fd, "id")]);
    audit(u.id, "edit_watch", "watch_source", n(fd, "id"));
  });
}

export async function applyLaneMixAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const lanes = applyLaneMix(n(fd, "runId"), u.id);
    return `Lanes now: ${lanes.map((l) => `${l.name} ${l.share}%`).join(", ")}.`;
  });
}

/* ───────── v1.3: long sessions → clips + YouTube long-form ───────── */

export async function newSession(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const id = createSession({ speakerId: n(fd, "speakerId"), kind: s(fd, "kind"), title: s(fd, "title"), guest: s(fd, "guest") || null, shootId: n(fd, "shootId") || null }, u.id);
    redirect(`/sessions/${id}`);
  });
}

export async function retrySession(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const se = one<any>(`SELECT * FROM sessions WHERE id = ?`, [n(fd, "id")]);
    if (!se) throw new Error("No such session");
    if (!se.raw_path) throw new Error("Upload the recording first.");
    if (se.words_path) {
      run(`UPDATE sessions SET status = 'picking', error = NULL, updated_at = ? WHERE id = ?`, [now(), se.id]);
      enqueue("session_pick", { sessionId: se.id, at: Date.now() });
    } else {
      run(`UPDATE sessions SET status = 'transcribing', error = NULL, updated_at = ? WHERE id = ?`, [now(), se.id]);
      enqueue("session_transcribe", { sessionId: se.id, at: Date.now() });
    }
    audit(u.id, "retry_session", "session", se.id);
    return "Trying again — refresh in a few minutes.";
  });
}

export async function moreClips(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const se = one<any>(`SELECT * FROM sessions WHERE id = ?`, [n(fd, "id")]);
    if (!se?.words_path) throw new Error("The transcript isn't ready yet.");
    run(`UPDATE sessions SET status = 'picking', updated_at = ? WHERE id = ?`, [now(), se.id]);
    enqueue("session_pick", { sessionId: se.id, again: true, at: Date.now() });
    audit(u.id, "more_clips", "session", se.id);
    return "Looking for more clips (different parts of the recording) — refresh in a minute or two.";
  });
}

export async function saveLongformAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const r = saveLongform(
      n(fd, "id"),
      {
        title: s(fd, "title"),
        description: s(fd, "description"),
        chapters: s(fd, "chapters"),
        tags: s(fd, "tags"),
        thumbTexts: [s(fd, "thumb1"), s(fd, "thumb2"), s(fd, "thumb3")],
        trimStart: s(fd, "trim_start"),
        trimEnd: s(fd, "trim_end"),
        cutSilence: fd.get("cut_silence") === "on",
        // "Check" parts an owner or admin ticked to keep (only read for them).
        keepFlags: fd.has("keep_shown") ? fd.getAll("keep").map(String) : undefined,
      },
      u.id,
      canApprove(u),
    );
    const parts = ["Saved."];
    if (r.cutChanged) parts.push("The start, end or pause setting changed — cut it again.");
    else if (r.thumbsChanged) parts.push("New thumbnails in a minute.");
    if (r.compliance.status === "block") parts.push("It breaks a blocking rule (see the red notes).");
    return parts.join(" ");
  });
}

export async function cutLongformAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    startLongformCut(n(fd, "id"), u.id);
    return "Cutting the long video. A 90-minute recording can take an hour or more on the server — this page shows it when it's ready.";
  });
}

export async function approveLongformAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const lf = one<any>(`SELECT * FROM longforms WHERE id = ?`, [n(fd, "id")]);
    if (lf) sameAsSeen(s(fd, "seen"), longformSeen(lf));
    const viaApi = approveLongform(n(fd, "id"), u.id);
    return viaApi ? "Approved — uploading to YouTube now." : "Approved — upload it in YouTube Studio (everything you need is below), then paste the link.";
  });
}

export async function longformUploadedAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    markLongformUploaded(n(fd, "id"), s(fd, "url"), u.id);
    return "Saved — its numbers are read every morning.";
  });
}

export async function testWinnerAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    logTestWinner(n(fd, "id"), s(fd, "title"), u.id);
    return "Logged.";
  });
}

/* ───────── v1.3: hook variants and collab posts ───────── */

/** Launch one strong idea as 2–3 trial reels with different on-screen hooks (same video). */
export async function makeVariants(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const e = one<any>(`SELECT e.*, sp.niche FROM edits e JOIN scripts s ON s.id = e.script_id JOIN speakers sp ON sp.id = s.speaker_id WHERE e.id = ?`, [n(fd, "editId")]);
    if (!e) throw new Error("No such cut");
    if (e.variant_of) throw new Error("This cut is already a variant — make variants from the first cut.");
    if (!["ready", "approved"].includes(e.status)) throw new Error("Wait for the cut to be ready.");
    const hooks = [s(fd, "hook1"), s(fd, "hook2")].map((h) => h.trim()).filter(Boolean);
    if (!hooks.length) throw new Error("Type or pick at least one other hook.");
    const base = json<any>(e.settings, {});
    const current = (base.hookText || one<any>(`SELECT hook FROM scripts WHERE id = ?`, [e.script_id])?.hook || "").trim().toLowerCase();
    const seen = new Set([current]);
    const words = json<Word[]>(e.transcript, []);
    let made = 0;
    for (const h of hooks) {
      // Instagram spots near-copies, so every variant needs a clearly different hook.
      if (seen.has(h.toLowerCase())) throw new Error(`"${h}" is the same as another hook in this test.`);
      seen.add(h.toLowerCase());
      if (checkText(h, e.niche).status === "block") throw new Error(`"${h}" breaks a blocking rule.`);
      const id = createEdit(e.video_id, { ...base, hookText: h.slice(0, 120) }, words.length ? words : null);
      run(`UPDATE edits SET variant_of = ? WHERE id = ?`, [e.id, id]);
      audit(u.id, "make_variant", "edit", id, { of: e.id, hook: h });
      made++;
    }
    return `Making ${made} more cut${made > 1 ? "s" : ""} with different hooks. When they're ready, post all of them as trials from this page.`;
  });
}

export async function postVariants(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const baseId = n(fd, "editId");
    const group = raw<any>(`SELECT id, status FROM edits WHERE id = ? OR variant_of = ? ORDER BY id`, [baseId, baseId]);
    const ready = group.filter((g) => g.status === "ready" && !one(`SELECT id FROM trials WHERE edit_id = ? AND status NOT IN ('error','replaced')`, [g.id]));
    if (!ready.length) throw new Error("No cuts in this test are ready to post.");
    if (group.some((g) => ["queued", "running"].includes(g.status))) throw new Error("Wait until every variant has finished cutting.");
    // All or nothing: if one can't go (the rules, the daily cap), none of them post.
    tx(() => {
      for (const g of ready) startTrial(g.id, u.id);
    });
    return `Posting ${ready.length} trial reel${ready.length > 1 ? "s" : ""}. Compare them on the Trials page.`;
  });
}

export async function setCollaborators(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const e = one<any>(`SELECT * FROM edits WHERE id = ?`, [n(fd, "editId")]);
    if (!e) throw new Error("No such cut");
    if (one(`SELECT id FROM trials WHERE edit_id = ? AND status NOT IN ('error','replaced')`, [e.id])) throw new Error("This cut has already gone out.");
    const names = s(fd, "collaborators").split(/[\s,]+/).map((x) => x.replace(/^@/, "").trim()).filter(Boolean);
    const bad = names.filter((x) => !/^[a-z0-9._]{1,30}$/i.test(x));
    if (bad.length) throw new Error(`Not an Instagram username: ${bad.join(", ")}`);
    if (names.length > 3) throw new Error("Instagram allows up to 3 collaborators.");
    run(`UPDATE edits SET settings = ?, updated_at = ? WHERE id = ?`, [JSON.stringify({ ...json<any>(e.settings, {}), collaborators: names }), now(), e.id]);
    audit(u.id, "set_collaborators", "edit", e.id, { names });
    return names.length ? `Saved. It will post as a normal collab reel (Instagram doesn't allow collaborators on trial reels); ${names.map((x) => "@" + x).join(", ")} get an invite.` : "Collaborators removed.";
  });
}

/* ───────── v1.3: planner ───────── */

export async function addShootAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    addShoot({ speakerId: n(fd, "speakerId"), kind: s(fd, "kind"), day: s(fd, "day"), time: s(fd, "time"), place: s(fd, "place"), notes: s(fd, "notes") }, u.id);
    return "Booked.";
  });
}

export async function shootStatusAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    setShootStatus(n(fd, "id"), s(fd, "status"), u.id);
  });
}

export async function saveCadenceAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const vals: Record<string, number> = {};
    for (const k of CADENCE_KEYS) if (fd.has(k)) vals[k] = s(fd, k) === "" ? NaN : Number(s(fd, k));
    saveCadence(n(fd, "speakerId"), vals, u.id);
    const per: Record<string, number> = {};
    for (const p of ["linkedin", "x"]) if (fd.has(`text_${p}`)) per[p] = Math.max(0, Math.min(p === "x" ? 5 : 3, Math.round(Number(s(fd, `text_${p}`)) || 0)));
    if (Object.keys(per).length) run(`UPDATE speakers SET text_per_day = ? WHERE id = ?`, [JSON.stringify(per), n(fd, "speakerId")]);
    return "Saved.";
  });
}

/* ───────── v1.3: growth, sign-ups, boosts ───────── */

export async function saveTargetsAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const vals: Record<string, { followers: number; by: string }> = {};
    for (const p of GROWTH_PLATFORMS) if (s(fd, `${p}_followers`) || s(fd, `${p}_by`)) vals[p] = { followers: Number(s(fd, `${p}_followers`).replace(/[,\s]/g, "")), by: s(fd, `${p}_by`) };
    saveTargets(n(fd, "speakerId"), vals, u.id);
    return "Targets saved.";
  });
}

export async function addSignupAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const sp = one<any>(`SELECT slug FROM speakers WHERE id = ?`, [n(fd, "speakerId")]);
    if (!sp) throw new Error("Pick a speaker.");
    const count = n(fd, "count");
    if (!(count >= 1)) throw new Error("How many sign-ups?");
    const r = addSignups([{ utm_term: sp.slug, day: s(fd, "day"), count, utm_content: s(fd, "content") || "typed in", utm_source: s(fd, "platform") || undefined }], "manual", u.id);
    audit(u.id, "add_signups", "speaker", n(fd, "speakerId"), { count });
    return r.added ? "Saved." : "Nothing saved.";
  });
}

export async function saveBoostAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const num = (k: string) => (s(fd, k) === "" ? null : Number(s(fd, k).replace(/[,₹\s]/g, "")));
    saveBoost(
      { id: n(fd, "id") || undefined, speakerId: n(fd, "speakerId"), trialId: n(fd, "trialId") || null, platform: s(fd, "platform"), startedOn: s(fd, "started_on"), endedOn: s(fd, "ended_on") || null, spend: num("spend") ?? NaN, audience: s(fd, "audience"), follows: num("follows"), clicks: num("clicks"), signups: num("signups"), notes: s(fd, "notes") },
      u.id,
    );
    return "Saved.";
  });
}

/* ───────── v1.3: comments, comment-to-DM, replies ───────── */

export async function saveDmRuleAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const r = saveDmRule({ id: n(fd, "id") || undefined, speakerId: n(fd, "speakerId"), keyword: s(fd, "keyword"), message: s(fd, "message"), publicReply: s(fd, "public_reply") || null }, u.id);
    if ((r as any).unchanged) return "Nothing changed.";
    return r.check.status === "block" ? "Saved as a draft — but it breaks a blocking rule (see the red note)." : "Saved as a draft. An owner or admin switches it on.";
  });
}

export async function switchDmRuleAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const on = s(fd, "to") === "on";
    const r = one<any>(`SELECT * FROM dm_rules WHERE id = ?`, [n(fd, "id")]);
    // Switching on sends exactly these words to real people, so it must be the words the approver read.
    if (on && r) sameAsSeen(s(fd, "seen"), dmRuleSeen(r));
    switchDmRule(n(fd, "id"), on, u.id);
    return on ? "On — comments with this word from now on get the DM." : "Off.";
  });
}

export async function approveReplyAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    approveReply(n(fd, "id"), s(fd, "reply"), u.id);
    return "Approved — posting the reply.";
  });
}

export async function saveReplyDraft(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const c = one<any>(`SELECT reply_status FROM comments WHERE id = ?`, [n(fd, "id")]);
    if (!c) throw new Error("No such comment");
    if (["posting", "posted"].includes(c.reply_status)) throw new Error("Already replied.");
    if (s(fd, "do") === "skip") {
      run(`UPDATE comments SET reply_status = 'rejected', reply_by = ? WHERE id = ?`, [u.id, n(fd, "id")]);
      return "Skipped.";
    }
    if (s(fd, "do") === "approve") {
      const a = requireApprover();
      approveReply(n(fd, "id"), s(fd, "reply"), a.id);
      return "Approved — posting the reply.";
    }
    run(`UPDATE comments SET reply_status = 'drafted', reply_text = ? WHERE id = ?`, [s(fd, "reply").slice(0, 600), n(fd, "id")]);
    audit(u.id, "edit_reply", "comment", n(fd, "id"));
    return "Draft saved — an owner or admin approves it.";
  });
}

export async function commentsNow(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    if (s(fd, "what") === "drafts") {
      const ids = s(fd, "speaker") ? [n(fd, "speaker")] : raw<{ id: number }>(`SELECT id FROM speakers WHERE active = 1`).map((r) => r.id);
      for (const id of ids) enqueue("agent", { agent: "reply_drafter", speakerId: id, at: Date.now() });
      return "Drafting replies — refresh in a minute.";
    }
    if (s(fd, "what") === "retry_dm") {
      requireApprover();
      run(`UPDATE comments SET dm_status = NULL, dm_error = NULL WHERE id = ? AND dm_status = 'failed'`, [n(fd, "id")]);
      const c = one<any>(`SELECT account_id FROM comments WHERE id = ?`, [n(fd, "id")]);
      if (c) enqueue("pull_comments", { accountId: c.account_id, at: Date.now() });
      audit(u.id, "retry_dm", "comment", n(fd, "id"));
      return "Trying the DM again.";
    }
    for (const a of raw<{ id: number }>(`SELECT id FROM accounts WHERE platform = 'instagram' AND status = 'connected'`)) enqueue("pull_comments", { accountId: a.id, at: Date.now() });
    return "Reading new comments now.";
  });
}

/* ───────── v1.3: text posts ───────── */

export async function decideTextAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const approve = s(fd, "decision") === "approve";
    const t = one<any>(`SELECT * FROM text_posts WHERE id = ?`, [n(fd, "id")]);
    if (approve && t) sameAsSeen(s(fd, "seen"), textPostSeen(t));
    return decideTextPost(n(fd, "id"), approve, u.id, s(fd, "note"));
  });
}

export async function saveTextAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const c = saveTextPost(n(fd, "id"), s(fd, "body"), canApprove(u), u.id);
    return c.status === "block" ? "Saved — but it still breaks a blocking rule (see the red notes)." : "Saved and re-checked.";
  });
}

export async function writeTextNow(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    const ids = s(fd, "speaker") ? [n(fd, "speaker")] : raw<{ id: number }>(`SELECT id FROM speakers WHERE active = 1`).map((r) => r.id);
    for (const id of ids) enqueue("write_text_posts", { speakerId: id, day: istDay(), force: true, by: u.id, at: Date.now() });
    return "Writing now — new posts show up here in about a minute.";
  });
}

export async function textNumbersAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    const num = (k: string) => (s(fd, k) === "" ? null : Math.max(0, Math.round(Number(s(fd, k).replace(/[,\s]/g, "")) || 0)));
    logTextNumbers(n(fd, "id"), { impressions: num("impressions"), likes: num("likes"), comments: num("comments"), reposts: num("reposts") }, u.id);
    return "Saved.";
  });
}

export async function retryTextAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireApprover();
    retryTextPost(n(fd, "id"), u.id);
    return "Trying again.";
  });
}

/* ───────── v1.3: guests and collabs ───────── */

export async function saveGuestAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    const u = requireUser();
    saveGuest(
      {
        id: n(fd, "id") || undefined, speakerId: n(fd, "speakerId"), kind: s(fd, "kind"), name: s(fd, "name"), url: s(fd, "url"),
        audience: s(fd, "audience") ? Number(s(fd, "audience").replace(/[,\s]/g, "")) : null, contact: s(fd, "contact"), status: s(fd, "status") || "idea",
        nextOn: s(fd, "next_on"), liveOn: s(fd, "live_on"), liveUrl: s(fd, "live_url"), notes: s(fd, "notes"),
      },
      u.id,
    );
    return "Saved.";
  });
}

export async function guestHelperAction(_: Result, fd: FormData): Promise<Result> {
  return act(ALL, () => {
    requireUser();
    const what = s(fd, "what") === "prep" ? "prep" : "pitch";
    enqueue("agent", { agent: "guest_helper", guestId: n(fd, "id"), what, at: Date.now() });
    return what === "pitch" ? "Drafting the pitch — refresh in a minute. You send it yourself." : "Writing the prep brief — refresh in a minute.";
  });
}
