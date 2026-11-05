import { raw, one, run, now, json, daysAgo } from "@/db";
import { claude, extractJson } from "@/lib/claude";
import { checkScript, type Check } from "@/lib/compliance";
import { speaker as getSpeaker, lanePlan, type Speaker } from "@/lib/speakers";
import { learningSummary } from "@/lib/learn";
import { activeRules, trendIdeasFor, latestRun, logUsage } from "@/lib/agents";
import { enqueue } from "@/lib/jobs";
import { setting } from "@/lib/config";
import { mixPlan, MIXES, type Mix } from "@/lib/planner";
import { activeKeyword } from "@/lib/comments";

export const HOOK_TYPES = ["question", "mistake", "myth", "story", "number", "contrarian", "how_to", "case"] as const;
export const FORMATS = ["talking_head", "screen_demo", "story"] as const;

type Draft = {
  lane: string;
  mix?: Mix;
  hook_type: string;
  format: string;
  title: string;
  hook: string;
  body: string;
  cta: string;
  on_screen: { t: number; text: string }[];
  caption: string;
  hashtags: string;
  linkedin: string;
  length_sec: number;
  why: string;
  inspired_by?: number | null;
};

export { NICHE_RULES } from "@/lib/niche";
import { NICHE_RULES } from "@/lib/niche";

const SYSTEM = `You write short-form video scripts (Instagram Reels, YouTube Shorts) for an Indian educator.
Write in plain, spoken English. Short sentences. No slogans, no hype words, no emojis in the spoken lines.
Each script must sound like the speaker talking to one person, and be something they can shoot in one take on a phone.
Length 30–60 seconds spoken (about 2.4 words a second). Never over 75 seconds.
The first line (hook) must stop the scroll in under 3 seconds and speak to the specific viewer described.
Reply with JSON only.`;

function contextFor(sp: Speaker) {
  const ourBest = raw<any>(
    `SELECT p.caption, p.views, p.likes, a.platform FROM posts p JOIN accounts a ON a.id = p.account_id
     WHERE a.speaker_id = ? AND p.views IS NOT NULL AND p.published_at >= ?
     ORDER BY p.views DESC LIMIT 6`,
    [sp.id, daysAgo(45)],
  ).map((p) => ({ platform: p.platform, views: p.views, caption: (p.caption || "").slice(0, 160) }));

  const ourWorst = raw<any>(
    `SELECT p.caption, p.views FROM posts p JOIN accounts a ON a.id = p.account_id
     WHERE a.speaker_id = ? AND p.views IS NOT NULL AND p.published_at >= ?
     ORDER BY p.views ASC LIMIT 3`,
    [sp.id, daysAgo(45)],
  ).map((p) => ({ views: p.views, caption: (p.caption || "").slice(0, 120) }));

  const outliers = raw<any>(
    `SELECT rp.id, rp.caption, rp.views, rp.likes, rp.comments, rp.outlier, r.name
     FROM ref_posts rp JOIN refs r ON r.id = rp.ref_id
     WHERE r.speaker_id = ? AND r.active = 1 AND rp.published_at >= ? AND rp.outlier >= 1.8
     ORDER BY rp.outlier DESC LIMIT 8`,
    [sp.id, daysAgo(21)],
  ).map((o) => ({ ref_post_id: o.id, creator: o.name, outlier: Number(o.outlier?.toFixed?.(1) ?? o.outlier), caption: (o.caption || "").slice(0, 220) }));

  const recentTitles = raw<{ title: string }>(`SELECT title FROM scripts WHERE speaker_id = ? ORDER BY id DESC LIMIT 40`, [sp.id]).map((r) => r.title);

  // Playbook rules a person switched on, this week's trend ideas, and last week's review.
  const rules = activeRules(sp.id).map((r) => r.rule);
  const trends = trendIdeasFor(sp.slug);
  const review = json<any>(latestRun("weekly_review", sp.id)?.output, null);
  const changes = review?.changes?.map((c: any) => c.change).filter(Boolean) || [];

  return { ourBest, ourWorst, outliers, recentTitles, learnings: learningSummary(sp.id), rules, trends, changes };
}

const MIX_HELP = `KINDS: "core" = the speaker's main topic, straight down a lane; "adjacent" = a next-door topic the same viewer cares about (still useful to them, still within the stop list); "personal" = the speaker's own story, mistake or behind-the-scenes moment that ties back to the topic.`;

function buildPrompt(sp: Speaker, plan: string[], ctx: ReturnType<typeof contextFor>, mixes: Mix[] = [], keyword: string | null = null) {
  const lanes = sp.lanes.map((l) => `- ${l.key}: ${l.name} — ${l.desc}`).join("\n");
  const want = plan.map((k, i) => `${i + 1}. lane "${k}"${mixes[i] ? `, kind "${mixes[i]}"` : ""}`).join("\n");
  return `SPEAKER: ${sp.name}
DIRECTION: ${sp.direction || ""}
WHO THE ACCOUNT TALKS TO: ${sp.audience || ""}
HOW THEY SPEAK: ${sp.voice_notes || "Plain, warm, direct."}

LANES:
${lanes}

NEVER DO (keep-out list and stop list):
${sp.stop_list.map((s) => `- ${s}`).join("\n")}

RULES FOR THIS NICHE:
${NICHE_RULES[sp.niche] || ""}

WHAT HAS WORKED (our trial results):
${ctx.learnings}

OUR BEST RECENT POSTS: ${JSON.stringify(ctx.ourBest)}
OUR WEAKEST RECENT POSTS: ${JSON.stringify(ctx.ourWorst)}

OUTLIER POSTS FROM SIMILAR CREATORS (these beat that creator's own average; borrow the angle or structure, never copy words):
${JSON.stringify(ctx.outliers)}

PLAYBOOK — RULES EVERY SCRIPT MUST FOLLOW (switched on by the team):
${ctx.rules.map((r) => `- ${r}`).join("\n") || "- (none yet)"}

THIS WEEK'S TREND IDEAS FOR THIS SPEAKER (formats breaking out elsewhere — borrow the format, stay in the lanes):
${ctx.trends ? JSON.stringify({ patterns: ctx.trends.patterns, ideas: ctx.trends.ideas, avoid: ctx.trends.avoid }) : "(none this week)"}

CHANGES FROM LAST WEEK'S REVIEW:
${ctx.changes.map((c: string) => `- ${c}`).join("\n") || "- (no review yet)"}

DON'T REPEAT THESE RECENT TITLES:
${ctx.recentTitles.slice(0, 40).join(" | ")}

WRITE ${plan.length} SCRIPTS:
${want}
${MIX_HELP}
Use different hook types across the set (${HOOK_TYPES.join(", ")}).
${keyword ? `When a call to action fits, ask viewers to comment the word "${keyword}" to get the webinar link by DM (the hub sends it). Not on every script — at most every other one.` : ""}
${plan.length >= 3 ? "Make the LAST script an experiment: a format we haven't tried, ideally borrowed from this week's trend ideas, and say so in \"why\". The others use formats that have worked." : ""}

Return a JSON array. Each item:
{
 "lane": one of the lane keys above,
 "mix": "core" | "adjacent" | "personal" (as asked above),
 "hook_type": one of ${JSON.stringify(HOOK_TYPES)},
 "format": one of ${JSON.stringify(FORMATS)},
 "title": internal title, under 70 characters,
 "hook": the first spoken line, under 15 words,
 "body": the rest of the spoken script, as short lines separated by \\n,
 "cta": the last spoken line (follow for part 2, comment a word, or the free webinar in bio),
 "on_screen": [{"t": seconds from start, "text": under 6 words}] (2–4 items; the first at t=0 is the hook text),
 "caption": Instagram caption, 2–4 short lines, no hashtags,
 "hashtags": 3–5 hashtags in one string (Instagram allows at most 5),
 "linkedin": the LinkedIn post that goes with this video: 3–5 short lines that say what the video says, no "comment YES"-style bait, no hashtags,
 "length_sec": estimated spoken length in seconds,
 "why": one line on why this should work for this viewer,
 "inspired_by": the ref_post_id it borrows from, or null
}`;
}

function clean(d: any, sp: Speaker, fallbackLane: string, fallbackMix: Mix = "core"): Draft {
  const laneKeys = sp.lanes.map((l) => l.key);
  return {
    lane: laneKeys.includes(d.lane) ? d.lane : fallbackLane,
    mix: (MIXES as string[]).includes(d.mix) ? d.mix : fallbackMix,
    hook_type: HOOK_TYPES.includes(d.hook_type) ? d.hook_type : "how_to",
    format: FORMATS.includes(d.format) ? d.format : "talking_head",
    title: String(d.title || d.hook || "Untitled").slice(0, 120),
    hook: String(d.hook || "").trim(),
    body: String(d.body || "").trim(),
    cta: String(d.cta || "").trim(),
    on_screen: Array.isArray(d.on_screen)
      ? d.on_screen.filter((o: any) => o && o.text).slice(0, 6).map((o: any) => ({ t: Math.max(0, Number(o.t) || 0), text: String(o.text).slice(0, 60) }))
      : [],
    caption: String(d.caption || "").trim(),
    // Instagram caps hashtags at 5 (Dec 2025); Facebook says 5 or fewer do best.
    hashtags: (String(d.hashtags || "").match(/#[\p{L}\p{N}_]+/gu) || []).slice(0, 5).join(" "),
    linkedin: String(d.linkedin || "").trim(),
    length_sec: Math.min(90, Math.max(10, Math.round(Number(d.length_sec) || 45))),
    why: String(d.why || "").trim(),
    inspired_by: Number.isInteger(d.inspired_by) ? d.inspired_by : null,
  };
}

export const MAX_REWRITES = 3;

/** Asks Claude to rewrite a script that broke a blocking rule. Later attempts are told to change the angle, not just the words. */
async function repair(sp: Speaker, d: Draft, check: Check, attempt: number): Promise<Draft> {
  const issues = check.issues.filter((i) => i.level === "block").map((i) => `- "${i.match}": ${i.fix}`).join("\n");
  const how =
    attempt === 1
      ? "Rewrite only what's needed to fix them; keep the idea and the voice."
      : `This is rewrite ${attempt} of ${MAX_REWRITES} and it still breaks the rules. Change the angle so the script doesn't need those claims at all — teach the method or the mistake instead of a result, price or promise.`;
  const { text } = await claude({
    system: SYSTEM,
    user: `This script for ${sp.name} breaks these rules:\n${issues}\n\n${how} Same JSON shape, one object.\n\n${JSON.stringify(d)}`,
    maxTokens: 2500,
    temperature: attempt === 1 ? 0.4 : 0.7,
  });
  return clean(extractJson<any>(text), sp, d.lane, d.mix);
}

/** Writes the day's scripts for one speaker. Safe to call again: it adds a new brief each time. */
export async function writeBrief(speakerId: number, day: string, count?: number) {
  const sp = getSpeaker(speakerId);
  if (!sp) throw new Error(`No speaker ${speakerId}`);
  const n = count ?? sp.scripts_per_day;
  if (!n || n <= 0) return [];
  const plan = lanePlan(sp.lanes, n);
  // Which of today's scripts are core, next-door or personal, so the last four weeks head for 70/20/10.
  const mixes = mixPlan(sp.id, n);
  let rewrites = 0;
  const ctx = contextFor(sp);
  const brief = run(`INSERT INTO briefs (speaker_id, day, status, context, created_at) VALUES (?, ?, 'queued', ?, ?)`, [
    sp.id,
    day,
    JSON.stringify(ctx),
    now(),
  ]);
  const briefId = Number(brief.lastInsertRowid);
  try {
    const { text, model, usage } = await claude({ system: SYSTEM, user: buildPrompt(sp, plan, ctx, mixes, activeKeyword(sp.id)), maxTokens: 8000 });
    const drafts = extractJson<any[]>(text);
    if (!Array.isArray(drafts) || !drafts.length) throw new Error("The reply had no scripts");
    const saved: number[] = [];
    for (let i = 0; i < drafts.length; i++) {
      let d = clean(drafts[i], sp, plan[i] || plan[0], mixes[i] || "core");
      let check = checkScript({ title: d.title, hook: d.hook, body: d.body, cta: d.cta, caption: d.caption, hashtags: d.hashtags, linkedin: d.linkedin, onScreen: d.on_screen }, sp.niche);
      // A script that breaks a hard rule goes back for a rewrite — up to MAX_REWRITES times.
      // If it still breaks one after that, it's saved as blocked: it can't be approved until a person fixes it.
      let tries = 0;
      for (let attempt = 1; check.status === "block" && attempt <= MAX_REWRITES; attempt++) {
        try {
          d = await repair(sp, d, check, attempt);
          check = checkScript({ title: d.title, hook: d.hook, body: d.body, cta: d.cta, caption: d.caption, hashtags: d.hashtags, linkedin: d.linkedin, onScreen: d.on_screen }, sp.niche);
          tries++;
          rewrites++;
        } catch {
          break;
        }
      }
      const note = !tries
        ? null
        : check.status === "block"
          ? `Still breaks a rule after ${tries} automatic rewrites — fix it by hand or reject it.`
          : `Rewritten automatically ${tries === 1 ? "once" : `${tries} times`} to meet the rules.`;
      const validRef = d.inspired_by && one(`SELECT id FROM ref_posts WHERE id = ?`, [d.inspired_by]) ? d.inspired_by : null;
      const r = run(
        `INSERT INTO scripts (speaker_id, brief_id, lane, hook_type, format, title, hook, body, cta, on_screen, caption, hashtags,
           length_sec, why, inspired_by, compliance, notes, linkedin_text, mix, status, created_at, updated_at)
         VALUES (@speaker_id, @brief_id, @lane, @hook_type, @format, @title, @hook, @body, @cta, @on_screen, @caption, @hashtags,
           @length_sec, @why, @inspired_by, @compliance, @notes, @linkedin, @mix, 'proposed', @at, @at)`,
        {
          speaker_id: sp.id,
          brief_id: briefId,
          lane: d.lane,
          mix: d.mix || "core",
          hook_type: d.hook_type,
          format: d.format,
          title: d.title,
          hook: d.hook,
          body: d.body,
          cta: d.cta,
          on_screen: JSON.stringify(d.on_screen),
          caption: d.caption,
          hashtags: d.hashtags,
          length_sec: d.length_sec,
          why: d.why,
          inspired_by: validRef,
          compliance: JSON.stringify(check),
          notes: note,
          linkedin: d.linkedin || null,
          at: now(),
        },
      );
      saved.push(Number(r.lastInsertRowid));
    }
    run(`UPDATE briefs SET status = 'ready', model = ?, error = ? WHERE id = ?`, [model, rewrites ? `${rewrites} automatic rewrite(s) to meet the rules` : null, briefId]);
    logUsage("script_writer", sp.id, model, usage);
    if (saved.length && setting("hook_doctor") !== "off") enqueue("agent", { agent: "hook_doctor", scriptIds: saved });
    return saved;
  } catch (e) {
    run(`UPDATE briefs SET status = 'error', error = ? WHERE id = ?`, [String((e as Error).message).slice(0, 1000), briefId]);
    throw e;
  }
}

/** Re-runs the rules after a person edits a script. */
export function recheckScript(scriptId: number) {
  const s = one<any>(`SELECT s.*, sp.niche FROM scripts s JOIN speakers sp ON sp.id = s.speaker_id WHERE s.id = ?`, [scriptId]);
  if (!s) return null;
  const check = checkScript({ title: s.title, hook: s.hook, body: s.body, cta: s.cta, caption: s.caption, hashtags: s.hashtags, linkedin: s.linkedin_text, onScreen: json(s.on_screen, []) }, s.niche);
  run(`UPDATE scripts SET compliance = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(check), now(), scriptId]);
  return check;
}

/** What a person reads in the teleprompter: hook, body, CTA. */
export function spokenText(s: { hook: string; body: string; cta?: string | null }) {
  return [s.hook, s.body, s.cta].filter(Boolean).join("\n");
}

