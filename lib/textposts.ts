import { raw, one, run, now, json, istDay, daysAgo } from "@/db";
import { claude, extractJson } from "@/lib/claude";
import { checkText, type Check } from "@/lib/compliance";
import { speaker as getSpeaker, type Speaker } from "@/lib/speakers";
import { NICHE_RULES, MAX_REWRITES } from "@/lib/scripts";
import { activeRules, logUsage } from "@/lib/agents";
import { env, settingNum } from "@/lib/config";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/secure";
import { accessToken, accountFor, ensureAccount } from "@/lib/accounts";
import { xLength } from "@/lib/publish";
import { linkedinPostText } from "@/lib/platforms/linkedin";
import { xPostText } from "@/lib/platforms/x";

/**
 * Text posts written for LinkedIn and X — not the reel cross-posted. LinkedIn suits Akshat, Chirag and Aarzoo
 * (experts who aren't famous yet reach 100K–800K there); X is also a cheap place to test a hook before filming it.
 * Written every morning, approved by a named owner or admin, posted at the set IST hour.
 */
export type TextPlatform = "linkedin" | "x";
export const TEXT_PLATFORMS: TextPlatform[] = ["linkedin", "x"];

export function textPerDay(sp: { text_per_day?: string | null }): Record<TextPlatform, number> {
  const j = json<Partial<Record<TextPlatform, number>>>(sp.text_per_day, {});
  return { linkedin: Math.max(0, Math.min(3, Number(j.linkedin ?? 0))), x: Math.max(0, Math.min(5, Number(j.x ?? 0))) };
}

/** LinkedIn only on weekdays (its audience is at work); X every day. */
export function textPlan(sp: { text_per_day?: string | null }, day: string): { platform: TextPlatform; n: number }[] {
  const per = textPerDay(sp);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  return TEXT_PLATFORMS.map((p) => ({ platform: p, n: p === "linkedin" && weekend ? 0 : per[p] })).filter((x) => x.n > 0);
}

/** The platform's own limits, checked on top of the SEBI/ASCI rules. A post that breaks one is rewritten like a script. */
export function lengthIssues(platform: TextPlatform, body: string): Check["issues"] {
  const out: Check["issues"] = [];
  const tags = (body.match(/#[\p{L}\p{N}_]+/gu) || []).length;
  if (/https?:\/\//i.test(body)) out.push({ level: "block", rule: "Link in a text post", match: "link", fix: "No links in text posts — they reach fewer people (and on X cost 13× more). The link lives in the bio." });
  if (platform === "x") {
    const n = xLength(body);
    if (n > 280) out.push({ level: "block", rule: "Too long for X", match: `${n} characters`, fix: "X allows 280. Cut it down." });
    if (tags > 1) out.push({ level: "warn", rule: "Hashtags on X", match: `${tags} hashtags`, fix: "One at most on X." });
  } else {
    if (body.length > 1300) out.push({ level: "block", rule: "Too long for LinkedIn", match: `${body.length} characters`, fix: "Keep it under 1,300 characters — LinkedIn folds long posts after about 3 lines anyway." });
    if (tags > 3) out.push({ level: "warn", rule: "Hashtags on LinkedIn", match: `${tags} hashtags`, fix: "Three at most." });
  }
  return out;
}

export function checkTextPost(platform: TextPlatform, body: string, niche: Speaker["niche"]): Check {
  const c = checkText(body, niche);
  const issues = [...c.issues, ...lengthIssues(platform, body)];
  return { status: issues.some((i) => i.level === "block") ? "block" : issues.length ? "warn" : "ok", issues };
}

const SYSTEM = `You write text posts for LinkedIn and X for an Indian educator, in their own voice.
Plain, spoken English. Short lines. No slogans, no hype words, no emojis, no "Agree?" or "Comment YES" bait, no links.
LinkedIn: open with a concrete number, a mistake, or a sharp claim in the first line (under 120 characters); 5–12 short lines; say one useful thing well; at most 3 hashtags at the end.
X: one idea, under 260 characters, no thread, at most 1 hashtag. X posts are also a test of hooks the speaker may film, so make the first words carry it.
Reply with JSON only.`;

type Draft = { platform: TextPlatform; body: string; angle?: string; why?: string; from_script_id?: number | null };

function prompt(sp: Speaker, plan: { platform: TextPlatform; n: number }[], day: string) {
  const hooks = raw<any>(`SELECT id, hook, title FROM scripts WHERE speaker_id = ? AND created_at >= ? AND status <> 'rejected' ORDER BY id DESC LIMIT 6`, [sp.id, daysAgo(2)]);
  const recent = raw<any>(`SELECT platform, body FROM text_posts WHERE speaker_id = ? ORDER BY id DESC LIMIT 30`, [sp.id]).map((r) => `${r.platform}: ${String(r.body).split("\n")[0].slice(0, 120)}`);
  const best = raw<any>(`SELECT platform, body, impressions FROM text_posts WHERE speaker_id = ? AND impressions IS NOT NULL AND posted_at >= ? ORDER BY impressions DESC LIMIT 5`, [sp.id, daysAgo(60)]);
  const rules = activeRules(sp.id, ["all", "linkedin", "x"]).map((r) => `- ${r.rule}`).join("\n") || "- (none)";
  return `SPEAKER: ${sp.name}
DIRECTION: ${sp.direction || ""}
WHO THEY TALK TO: ${sp.audience || ""}
HOW THEY SPEAK: ${sp.voice_notes || "Plain, warm, direct."}
LANES: ${sp.lanes.map((l) => `${l.name} — ${l.desc}`).join(" | ")}
NEVER: ${sp.stop_list.join("; ")}
RULES FOR THIS NICHE:
${NICHE_RULES[sp.niche] || ""}
PLAYBOOK RULES:
${rules}

TODAY'S REEL HOOKS (an X post can test one of these; say which by its id): ${JSON.stringify(hooks.map((h) => ({ id: h.id, hook: h.hook })))}
OUR BEST TEXT POSTS (by impressions, typed in): ${JSON.stringify(best.map((b) => ({ platform: b.platform, impressions: b.impressions, first_line: String(b.body).split("\n")[0] })))}
DON'T REPEAT THESE RECENT OPENINGS: ${recent.join(" | ")}

DATE: ${day}. WRITE: ${plan.map((p) => `${p.n} for ${p.platform}`).join(", ")}.
Return {"posts": [{"platform": "linkedin" | "x", "body": the post, "angle": a few words, "why": one line, "from_script_id": the hook's id or null}]}`;
}

async function repair(sp: Speaker, d: Draft, check: Check, attempt: number): Promise<Draft> {
  const issues = check.issues.filter((i) => i.level === "block").map((i) => `- "${i.match}": ${i.fix}`).join("\n");
  const how = attempt === 1 ? "Fix only what's needed; keep the idea and the voice." : `Rewrite ${attempt} of ${MAX_REWRITES}: change the angle so it doesn't need those claims at all.`;
  const { text } = await claude({ system: SYSTEM, user: `This ${d.platform} post for ${sp.name} breaks these rules:\n${issues}\n\n${how} Same JSON shape, one object.\n\n${JSON.stringify(d)}`, maxTokens: 1500, temperature: attempt === 1 ? 0.4 : 0.7 });
  const out = extractJson<any>(text);
  return { platform: d.platform, body: String(out.body || "").trim(), angle: out.angle, why: out.why, from_script_id: d.from_script_id };
}

/** Writes the day's text posts for one speaker (once per day; "Write now" can add more). */
export async function writeTextPosts(speakerId: number, day = istDay(), force = false) {
  const sp = getSpeaker(speakerId);
  if (!sp) throw new Error(`No speaker ${speakerId}`);
  // "Write now" writes each platform's daily number, weekend or not.
  const per = textPerDay(sp);
  const plan = force ? TEXT_PLATFORMS.filter((p) => per[p] > 0).map((p) => ({ platform: p, n: per[p] })) : textPlan(sp, day);
  if (!plan.length) return [];
  if (!force && one(`SELECT id FROM text_posts WHERE speaker_id = ? AND day = ?`, [sp.id, day])) return [];
  const { text, model, usage } = await claude({ system: SYSTEM, user: prompt(sp, plan, day), maxTokens: 4000, temperature: 0.8 });
  logUsage("text_writer", sp.id, model, usage);
  const out = extractJson<{ posts: Draft[] }>(text);
  const want: Record<string, number> = Object.fromEntries(plan.map((p) => [p.platform, p.n]));
  const saved: number[] = [];
  for (const raw0 of out.posts || []) {
    const platform: TextPlatform = raw0.platform === "x" ? "x" : "linkedin";
    if (!want[platform]) continue;
    want[platform]--;
    let d: Draft = { platform, body: String(raw0.body || "").trim(), angle: raw0.angle, why: raw0.why, from_script_id: Number.isInteger(raw0.from_script_id) ? raw0.from_script_id : null };
    if (!d.body) continue;
    let check = checkTextPost(platform, d.body, sp.niche);
    let tries = 0;
    for (let attempt = 1; check.status === "block" && attempt <= MAX_REWRITES; attempt++) {
      try {
        d = await repair(sp, d, check, attempt);
        check = checkTextPost(platform, d.body, sp.niche);
        tries++;
      } catch {
        break;
      }
    }
    const note = !tries ? null : check.status === "block" ? `Still breaks a rule after ${tries} automatic rewrites — fix it by hand or reject it.` : `Rewritten automatically ${tries === 1 ? "once" : `${tries} times`} to meet the rules.`;
    const fromOk = d.from_script_id && one(`SELECT id FROM scripts WHERE id = ? AND speaker_id = ?`, [d.from_script_id, sp.id]) ? d.from_script_id : null;
    const r = run(
      `INSERT INTO text_posts (speaker_id, platform, day, body, angle, why, from_script_id, compliance, notes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
      [sp.id, platform, day, d.body, String(d.angle || "").slice(0, 80) || null, String(d.why || "").slice(0, 300) || null, fromOk, JSON.stringify(check), note, now(), now()],
    );
    saved.push(Number(r.lastInsertRowid));
  }
  return saved;
}

/** Minutes from now until HH:00 IST on `day` (0 if that's already past). */
export function minutesUntil(day: string, hourIst: number, at = Date.now()) {
  const target = Date.parse(`${day}T${String(hourIst).padStart(2, "0")}:00:00+05:30`);
  return Number.isFinite(target) ? Math.max(0, Math.ceil((target - at) / 60e3)) : 0;
}

export function decideTextPost(id: number, approve: boolean, userId: number, note?: string) {
  const t = one<any>(`SELECT * FROM text_posts WHERE id = ?`, [id]);
  if (!t) throw new Error("No such post");
  if (!["proposed", "rejected"].includes(t.status)) throw new Error("This post has already moved on.");
  if (!approve) {
    run(`UPDATE text_posts SET status = 'rejected', notes = COALESCE(NULLIF(?, ''), notes), decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?`, [note || "", userId, now(), now(), id]);
    audit(userId, "reject_text_post", "text_post", id);
    return "Rejected.";
  }
  if (json<any>(t.compliance, {}).status === "block") throw new Error("This post breaks a blocking rule — edit it first.");
  const acc = accountFor(t.speaker_id, t.platform);
  if (!acc || acc.status !== "connected") throw new Error(`Connect this speaker's ${t.platform === "x" ? "X" : "LinkedIn"} first (Accounts page).`);
  run(`UPDATE text_posts SET status = 'approved', decided_by = ?, decided_at = ?, error = NULL, updated_at = ? WHERE id = ?`, [userId, now(), now(), id]);
  const wait = minutesUntil(t.day, settingNum("text_post_hour_ist"));
  enqueue("post_text", { textPostId: id }, { inMinutes: wait });
  audit(userId, "approve_text_post", "text_post", id);
  return wait ? `Approved — it posts at ${settingNum("text_post_hour_ist")}:00 IST.` : "Approved — posting now.";
}

export function saveTextPost(id: number, body: string, canApproveIt: boolean, userId: number) {
  const t = one<any>(`SELECT tp.*, sp.niche FROM text_posts tp JOIN speakers sp ON sp.id = tp.speaker_id WHERE tp.id = ?`, [id]);
  if (!t) throw new Error("No such post");
  if (["posting", "posted"].includes(t.status)) throw new Error("It's already posted.");
  if (["approved", "error"].includes(t.status) && !canApproveIt) throw new Error("This post is approved. Only an owner or admin can change it now.");
  const text = body.trim();
  if (!text) throw new Error("The post is empty.");
  const check = checkTextPost(t.platform, text, t.niche);
  // Changing an approved (or failed) post's words means it needs approving again.
  const changed = text !== t.body;
  run(
    `UPDATE text_posts SET body = ?, compliance = ?, status = CASE WHEN ? AND status IN ('approved','error') THEN 'proposed' ELSE status END,
       decided_by = CASE WHEN ? AND status IN ('approved','error') THEN NULL ELSE decided_by END, error = CASE WHEN ? THEN NULL ELSE error END, updated_at = ? WHERE id = ?`,
    [text, JSON.stringify(check), changed ? 1 : 0, changed ? 1 : 0, changed ? 1 : 0, now(), id],
  );
  audit(userId, "edit_text_post", "text_post", id);
  return check;
}

/** Worker: post one approved text post. */
export async function postText(id: number) {
  const t = one<any>(`SELECT * FROM text_posts WHERE id = ?`, [id]);
  if (!t || t.status !== "approved") return;
  run(`UPDATE text_posts SET status = 'posting', updated_at = ? WHERE id = ?`, [now(), id]);
  try {
    const acc = ensureAccount(t.speaker_id, t.platform);
    let externalId = "dry-run";
    let permalink: string | null = null;
    if (!env.dryRun()) {
      if (t.platform === "linkedin") {
        const r = await linkedinPostText({ token: await accessToken(acc), author: acc.external_id!, text: t.body });
        externalId = r.id;
        permalink = r.url;
      } else {
        const r = await xPostText({ token: await accessToken(acc), text: t.body });
        externalId = r.id;
        permalink = `https://x.com/i/status/${r.id}`;
      }
    }
    run(`UPDATE text_posts SET status = 'posted', external_id = ?, permalink = ?, posted_at = ?, error = NULL, updated_at = ? WHERE id = ?`, [externalId, permalink, now(), now(), id]);
    run(
      `INSERT INTO posts (account_id, external_id, permalink, caption, media_type, published_at, via_hub, is_trial, created_at)
       VALUES (@a, @x, @l, @c, 'TEXT', @at, 1, 0, @at) ON CONFLICT(account_id, external_id) DO NOTHING`,
      { a: acc.id, x: externalId === "dry-run" ? `dry-run-text-${id}` : externalId, l: permalink, c: t.body.slice(0, 500), at: now() },
    );
    audit(t.decided_by, "text_posted", "text_post", id, { externalId });
  } catch (e) {
    run(`UPDATE text_posts SET status = 'error', error = ?, updated_at = ? WHERE id = ?`, [String((e as Error).message).slice(0, 800), now(), id]);
    throw e;
  }
}

export function retryTextPost(id: number, userId: number) {
  const t = one<any>(`SELECT tp.*, sp.niche FROM text_posts tp JOIN speakers sp ON sp.id = tp.speaker_id WHERE tp.id = ?`, [id]);
  if (!t || t.status !== "error") throw new Error("Only a post that failed can be tried again.");
  if (!t.decided_by) throw new Error("Approve it first.");
  if (checkTextPost(t.platform, t.body, t.niche).status === "block") throw new Error("It breaks a blocking rule now — edit it first.");
  run(`UPDATE text_posts SET status = 'approved', error = NULL, updated_at = ? WHERE id = ? AND status = 'error'`, [now(), id]);
  enqueue("post_text", { textPostId: id });
  audit(userId, "retry_text_post", "text_post", id);
}

/** LinkedIn and X don't give personal-post numbers through the API without extra approval, so they're typed in. */
export function logTextNumbers(id: number, n: { impressions?: number | null; likes?: number | null; comments?: number | null; reposts?: number | null }, userId: number) {
  run(`UPDATE text_posts SET impressions = ?, likes = ?, comments = ?, reposts = ?, updated_at = ? WHERE id = ?`, [n.impressions ?? null, n.likes ?? null, n.comments ?? null, n.reposts ?? null, now(), id]);
  audit(userId, "text_post_numbers", "text_post", id, n);
}
