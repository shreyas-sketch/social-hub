import { raw, one, run, now, json, daysAgo, istDay } from "@/db";
import { claude, extractJson } from "@/lib/claude";
import { speakers, speaker as getSpeaker, type Speaker } from "@/lib/speakers";
import { watchOutliers, teacherLatest } from "@/lib/watch";
import { checkText } from "@/lib/compliance";
import { audit } from "@/lib/secure";

/**
 * The hub's AI agents. Each one reads what the hub already knows, writes a short structured answer,
 * and stops there: nothing here posts, approves or changes a speaker on its own. People act on it.
 *
 *  trend_scout     weekly — what's breaking out in the trend pool and with the teachers; ideas per speaker
 *  playbook_coach  weekly — turns the teachers' latest advice into rules a person can switch on
 *  hook_doctor     after every batch of scripts — scores each opening line, offers better ones
 *  weekly_review   weekly, per speaker — what worked, what didn't, what to change next week
 */
export type AgentName =
  | "trend_scout" | "playbook_coach" | "hook_doctor" | "weekly_review"
  | "clip_picker" | "text_writer" | "reply_drafter" | "guest_helper"
  | "script_writer";

export const AGENTS: { key: Exclude<AgentName, "script_writer">; name: string; what: string; when: string }[] = [
  { key: "trend_scout", name: "Trend Scout", what: "Reads the trend pool and the teachers' breakout posts; writes what's working and ideas for each speaker.", when: "Every week" },
  { key: "playbook_coach", name: "Playbook Coach", what: "Reads what the teachers are teaching right now and proposes rules for the scripts. A person switches each rule on.", when: "Every week" },
  { key: "hook_doctor", name: "Hook Doctor", what: "Scores every new script's opening against the playbook and offers three stronger hooks.", when: "After each morning's scripts" },
  { key: "weekly_review", name: "Weekly Review", what: "For each speaker: what worked, what didn't, and up to three changes for next week.", when: "Every week" },
  { key: "clip_picker", name: "Clip Picker", what: "Reads a long recording's transcript, picks the 10–15 parts that work as clips, and plans the YouTube video (titles, chapters, description).", when: "After each long session" },
  { key: "text_writer", name: "Text Writer", what: "Writes the day's LinkedIn and X text posts in each speaker's voice, within the same rules.", when: "Every morning" },
  { key: "reply_drafter", name: "Reply Drafter", what: "Drafts replies to Instagram comments that ask something. A person approves each reply before it posts.", when: "As comments come in" },
  { key: "guest_helper", name: "Guest Helper", what: "Drafts a pitch to a podcast or creator, and a prep brief before the recording.", when: "When you ask" },
];

const SYSTEM = `You are part of an internal tool that grows the short-form video accounts of five Indian educators.
Your audience is the owner and his team: write in plain, short English. Be specific and concrete, never generic.
You only advise: people decide. Never suggest anything that breaks the speaker's stop list or rules (no stock tips or calls,
no crypto price predictions or return promises, no income promises, no diagnosing viewers). Reply with JSON only.`;

/** Runs an agent, logs what it read, what it said and the tokens it used. */
async function record<T>(agent: AgentName, speakerId: number | null, input: unknown, call: () => Promise<{ out: T; model: string; usage: any }>): Promise<T> {
  const r = run(`INSERT INTO agent_runs (agent, speaker_id, status, input, created_at) VALUES (?, ?, 'running', ?, ?)`, [agent, speakerId, JSON.stringify(input).slice(0, 200_000), now()]);
  const id = Number(r.lastInsertRowid);
  try {
    const { out, model, usage } = await call();
    run(`UPDATE agent_runs SET status = 'done', output = ?, model = ?, tokens_in = ?, tokens_out = ?, finished_at = ? WHERE id = ?`, [
      JSON.stringify(out), model, usage?.input_tokens ?? null, usage?.output_tokens ?? null, now(), id,
    ]);
    return Object.assign(out as any, { _runId: id });
  } catch (e) {
    run(`UPDATE agent_runs SET status = 'error', error = ?, finished_at = ? WHERE id = ?`, [String((e as Error).message).slice(0, 1000), now(), id]);
    throw e;
  }
}

/** Logs a call made elsewhere (the script writer) so the Settings page can show what Claude costs. */
export function logUsage(agent: AgentName, speakerId: number | null, model: string, usage: any) {
  run(`INSERT INTO agent_runs (agent, speaker_id, status, model, tokens_in, tokens_out, created_at, finished_at) VALUES (?, ?, 'done', ?, ?, ?, ?, ?)`, [
    agent, speakerId, model, usage?.input_tokens ?? null, usage?.output_tokens ?? null, now(), now(),
  ]);
}

export function latestRun(agent: AgentName, speakerId?: number | null) {
  return one<any>(
    `SELECT * FROM agent_runs WHERE agent = ? AND status = 'done' AND output IS NOT NULL ${speakerId ? "AND speaker_id = ?" : ""} ORDER BY id DESC LIMIT 1`,
    speakerId ? [agent, speakerId] : [agent],
  );
}

/** Active playbook rules for a speaker: everything for all, Instagram (trials run there), and that speaker's own. */
export function activeRules(speakerId?: number, platforms: string[] = ["all", "instagram"]) {
  const scopes = [...platforms, ...(speakerId ? [`speaker:${speakerId}`] : [])];
  return raw<any>(`SELECT * FROM playbook_rules WHERE status = 'active' AND scope IN (${scopes.map(() => "?").join(",")}) ORDER BY kind = 'official' DESC, id`, scopes);
}

const brief = (sp: Speaker) => ({
  slug: sp.slug,
  name: sp.name,
  niche: sp.niche,
  audience: sp.audience,
  lanes: sp.lanes.map((l) => `${l.name} (${l.share}%): ${l.desc}`),
  never: sp.stop_list,
});

const trim = (s: string | null | undefined, n: number) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

/* ───────── Trend Scout ───────── */

export type TrendBrief = {
  headline: string;
  patterns: { pattern: string; why: string; examples: string[] }[];
  per_speaker: { slug: string; ideas: { idea: string; format: string; borrowed_from: string }[] }[];
  avoid: string[];
};

export async function trendScout() {
  const trends = watchOutliers("trend", 14, 2, 40).map((p) => ({ creator: p.name, platform: p.platform, outlier: Number(p.outlier).toFixed(1), views: p.views, text: trim(p.caption, 260), url: p.permalink }));
  const teachers = watchOutliers("teacher", 14, 1.5, 15).map((p) => ({ creator: p.name, outlier: Number(p.outlier).toFixed(1), text: trim(p.caption, 260), url: p.permalink }));
  const sp = speakers().map(brief);
  if (!trends.length && !teachers.length) throw new Error("No breakout posts in the last 14 days yet — the trend pool is read every morning once Instagram or the YouTube key is connected.");
  const input = { trends, teachers, speakers: sp };
  return record<TrendBrief>("trend_scout", null, input, async () => {
    const { text, model, usage } = await claude({
      system: SYSTEM,
      maxTokens: 4000,
      temperature: 0.5,
      user: `These posts did at least 2× better than each creator's own usual in the last 14 days. "trends" are popular creators outside our niches; "teachers" teach social-media growth.

TRENDS: ${JSON.stringify(trends)}
TEACHERS: ${JSON.stringify(teachers)}

OUR SPEAKERS: ${JSON.stringify(sp)}

Find the FORMATS and HOOK PATTERNS that are breaking out (not the topics — our speakers stay in their lanes). Then give each speaker 2–3 concrete ideas that borrow a pattern for their own lanes and buyer.

Return JSON:
{
 "headline": one sentence on the biggest pattern this week,
 "patterns": [{"pattern": short name + how it works in one line, "why": why it holds attention, "examples": [up to 3 urls from the lists]}] (3–6 items),
 "per_speaker": [{"slug": speaker slug, "ideas": [{"idea": a script idea in one line, in that speaker's lane, "format": the borrowed format, "borrowed_from": one url}]}],
 "avoid": [patterns that are breaking out but wrong for our buyers or rules] (0–3 items)
}`,
    });
    return { out: extractJson<TrendBrief>(text), model, usage };
  });
}

/** This week's ideas for one speaker, for the script writer. */
export function trendIdeasFor(slug: string) {
  const r = latestRun("trend_scout");
  if (!r || Date.now() - new Date(r.created_at).getTime() > 10 * 864e5) return null;
  const out = json<TrendBrief | null>(r.output, null);
  if (!out) return null;
  const mine = out.per_speaker?.find((p) => p.slug === slug)?.ideas || [];
  return { patterns: (out.patterns || []).map((p) => p.pattern), ideas: mine, avoid: out.avoid || [] };
}

/* ───────── Playbook Coach ───────── */

type CoachOut = { proposals: { rule: string; why: string; scope: string; source_url: string; source_name: string }[]; retire: { id: number; why: string }[] };

export async function playbookCoach() {
  const teaching = teacherLatest(21, 60).map((p) => ({ teacher: p.name, platform: p.platform, date: String(p.published_at || "").slice(0, 10), text: trim(p.caption, 420), url: p.permalink, outlier: p.outlier ? Number(p.outlier).toFixed(1) : null }));
  if (!teaching.length) throw new Error("No posts from the teachers in the last 3 weeks yet — they're read every morning once Instagram or the YouTube key is connected.");
  const rules = raw<any>(`SELECT id, scope, rule, status FROM playbook_rules WHERE status IN ('active','proposed') ORDER BY id`);
  const input = { teaching, rules };
  const out = await record<CoachOut>("playbook_coach", null, input, async () => {
    const { text, model, usage } = await claude({
      system: SYSTEM,
      maxTokens: 3500,
      temperature: 0.3,
      user: `These are the latest posts from people who teach social-media growth (titles, captions and the start of video descriptions):
${JSON.stringify(teaching)}

Our current playbook (rules the script writer follows; "proposed" ones are waiting for a person):
${JSON.stringify(rules)}

Propose up to 5 NEW rules worth testing for 30–60s talking-head educational reels for 35–55 Indian professionals. Only rules that are specific and checkable in a script or an edit (e.g. "first line names the viewer and the problem in under 12 words"), not vague advice ("be authentic"). Skip anything already covered. Each rule must come from one of the posts above — give its url. Also list existing rules that the teaching now contradicts (by id), if any.

Return JSON: {"proposals": [{"rule": one line, "why": one line, "scope": "all" | "instagram" | "youtube" | "linkedin" | "x" | "facebook", "source_url": url, "source_name": teacher name}], "retire": [{"id": rule id, "why": one line}]}`,
    });
    return { out: extractJson<CoachOut>(text), model, usage };
  });
  // Proposals wait for a person; nothing switches on by itself.
  const have = new Set(raw<{ rule: string }>(`SELECT lower(rule) AS rule FROM playbook_rules`).map((r) => r.rule));
  const scopes = ["all", "instagram", "youtube", "linkedin", "x", "facebook"];
  let added = 0;
  for (const p of (out.proposals || []).slice(0, 5)) {
    if (!p.rule || have.has(p.rule.toLowerCase())) continue;
    run(
      `INSERT INTO playbook_rules (scope, rule, why, source_name, source_url, source_date, kind, status, proposed_by, agent_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'teacher', 'proposed', 'playbook_coach', ?, ?)`,
      [scopes.includes(p.scope) ? p.scope : "all", p.rule.slice(0, 300), (p.why || "").slice(0, 400), p.source_name || null, /^https?:\/\//.test(p.source_url || "") ? p.source_url : null, istDay(), (out as any)._runId, now()],
    );
    added++;
  }
  return { added, retire: out.retire || [] };
}

/* ───────── Hook Doctor ───────── */

export type DoctorNote = {
  id: number;
  score: number;
  checks: { check: string; ok: boolean; note: string }[];
  better_hooks: string[];
  fix: string;
};

export async function hookDoctor(scriptIds: number[]) {
  const rows = raw<any>(
    `SELECT s.id, s.speaker_id, s.title, s.hook, s.body, s.cta, s.on_screen, s.length_sec, s.lane, s.hook_type, s.format, sp.niche
     FROM scripts s JOIN speakers sp ON sp.id = s.speaker_id WHERE s.id IN (${scriptIds.map(() => "?").join(",") || "NULL"})`,
    scriptIds,
  );
  if (!rows.length) return [];
  const speakerId = rows[0].speaker_id;
  const sp = getSpeaker(speakerId)!;
  const rules = activeRules(speakerId).map((r) => r.rule);
  const scripts = rows.map((r) => ({ id: r.id, hook: r.hook, body: r.body, cta: r.cta, on_screen: json(r.on_screen, []), seconds: r.length_sec, hook_type: r.hook_type }));
  const input = { speaker: brief(sp), rules, scripts };
  const out = await record<{ scripts: DoctorNote[] }>("hook_doctor", speakerId, input, async () => {
    const { text, model, usage } = await claude({
      system: SYSTEM,
      maxTokens: 3000,
      temperature: 0.4,
      user: `Speaker: ${JSON.stringify(brief(sp))}

Playbook rules these scripts must follow:
${rules.map((r) => `- ${r}`).join("\n") || "- (none yet)"}

Scripts:
${JSON.stringify(scripts)}

For each script, judge the first 3 seconds the way a viewer scrolling past would. Score 1–10 how likely it is to stop a 35–55 professional in this speaker's audience and keep them watching (be strict: 7+ only if it would clearly beat this speaker's usual). Check it against the playbook rules (only the ones that apply to a hook or the structure). Then write 3 better hooks: each under 15 words, spoken, in the speaker's voice, following the rules and the speaker's never-list.

Return JSON: {"scripts": [{"id": script id, "score": number, "checks": [{"check": short rule name, "ok": true|false, "note": under 12 words}], "better_hooks": [3 strings], "fix": the single most useful change to the script, one line}]}`,
    });
    return { out: extractJson<{ scripts: DoctorNote[] }>(text), model, usage };
  });
  const saved: DoctorNote[] = [];
  for (const d of out.scripts || []) {
    const row = rows.find((r) => r.id === Number(d.id));
    if (!row) continue;
    // A better hook that would break a rule never reaches the screen.
    // Saved only in the shape the page expects, whatever came back.
    const hooks = (Array.isArray(d.better_hooks) ? d.better_hooks : []).map((h: unknown) => String(h || "").trim()).filter((h: string) => h && checkText(h, row.niche).status !== "block").slice(0, 3);
    const checks = (Array.isArray(d.checks) ? d.checks : []).filter((c: any) => c && typeof c === "object").map((c: any) => ({ check: String(c.check || ""), ok: !!c.ok, note: String(c.note || "") })).slice(0, 8);
    const note: DoctorNote = { id: row.id, score: Math.max(1, Math.min(10, Number(d.score) || 0)), checks, better_hooks: hooks, fix: String(d.fix || "") };
    run(`UPDATE scripts SET doctor = ?, hook_score = ? WHERE id = ?`, [JSON.stringify(note), note.score, row.id]);
    saved.push(note);
  }
  return saved;
}

/* ───────── Weekly Review ───────── */

export type Review = {
  summary: string;
  worked: string[];
  didnt: string[];
  changes: { change: string; why: string }[];
  lane_mix: Record<string, number> | null;
  rule_proposals: { rule: string; why: string }[];
};

export async function weeklyReview(speakerId: number) {
  const sp = getSpeaker(speakerId);
  if (!sp) throw new Error("No such speaker");
  const since = daysAgo(7);
  const trials = raw<any>(
    `SELECT s.title, s.lane, s.hook_type, s.format, s.hook, s.hook_score, e.duration, t.mode, t.views, t.reach, t.shares, t.saves, t.likes,
       t.skip_rate, t.avg_watch_ms, t.verdict, t.verdict_reason
     FROM trials t JOIN edits e ON e.id = t.edit_id JOIN scripts s ON s.id = e.script_id
     WHERE s.speaker_id = ? AND t.posted_at >= ? ORDER BY t.posted_at`,
    [speakerId, since],
  ).map((t) => ({
    ...t,
    watched_pct: t.avg_watch_ms && t.duration ? Math.round((t.avg_watch_ms / 1000 / t.duration) * 100) : null,
    sends_per_1k: t.reach ? +((t.shares / t.reach) * 1000).toFixed(1) : null,
  }));
  const rejected = raw<any>(`SELECT title, hook, notes FROM scripts WHERE speaker_id = ? AND status = 'rejected' AND decided_at >= ?`, [speakerId, since]);
  const approved = one<any>(`SELECT COUNT(*) AS n FROM scripts WHERE speaker_id = ? AND decided_at >= ? AND decided_by IS NOT NULL AND status <> 'rejected'`, [speakerId, since])?.n ?? 0;
  const followers = raw<any>(
    `SELECT a.platform,
       (SELECT followers FROM account_stats st WHERE st.account_id = a.id ORDER BY day DESC LIMIT 1) AS now,
       (SELECT followers FROM account_stats st WHERE st.account_id = a.id AND day <= ? ORDER BY day DESC LIMIT 1) AS week_ago
     FROM accounts a WHERE a.speaker_id = ?`,
    [istDay(new Date(Date.now() - 7 * 864e5)), speakerId],
  );
  if (!trials.length && !rejected.length) throw new Error(`No trials or decisions for ${sp.name} in the last 7 days — nothing to review yet.`);
  const input = { speaker: brief(sp), trials, rejected_scripts: rejected, approved_scripts: approved, followers, rules: activeRules(speakerId).map((r) => r.rule) };
  const out = await record<Review>("weekly_review", speakerId, input, async () => {
    const { text, model, usage } = await claude({
      system: SYSTEM,
      maxTokens: 3000,
      temperature: 0.3,
      user: `Weekly review for ${sp.name}. Data from the last 7 days:
${JSON.stringify(input)}

Notes: "skip_rate" = % who swiped away in the first 3 seconds (lower is better). "sends_per_1k" = shares per 1,000 people reached (Instagram's strongest signal for reaching new people). "hook_score" was the Hook Doctor's prediction — say whether it matched. With fewer than 5 trials, say the evidence is thin and keep changes small.

Return JSON:
{
 "summary": 2 sentences, with numbers,
 "worked": [up to 3 one-liners with the evidence],
 "didnt": [up to 3 one-liners with the evidence],
 "changes": [{"change": one concrete change for next week, "why": the evidence}] (max 3),
 "lane_mix": {lane key: share %} adding to 100 — ONLY if the evidence clearly supports a shift, otherwise null. Lane keys: ${JSON.stringify(sp.lanes.map((l) => l.key))},
 "rule_proposals": [{"rule": a checkable rule for this speaker's scripts, "why": evidence}] (0–2)
}`,
    });
    return { out: extractJson<Review>(text), model, usage };
  });
  const have = new Set(raw<{ rule: string }>(`SELECT lower(rule) AS rule FROM playbook_rules`).map((r) => r.rule));
  for (const p of (out.rule_proposals || []).slice(0, 2)) {
    if (!p.rule || have.has(p.rule.toLowerCase())) continue;
    run(
      `INSERT INTO playbook_rules (scope, rule, why, source_name, kind, status, proposed_by, agent_run_id, created_at)
       VALUES (?, ?, ?, 'Weekly Review', 'learned', 'proposed', 'weekly_review', ?, ?)`,
      [`speaker:${speakerId}`, p.rule.slice(0, 300), (p.why || "").slice(0, 400), (out as any)._runId, now()],
    );
  }
  return out;
}

/** A person applies the review's suggested lane mix. */
export function applyLaneMix(runId: number, userId: number) {
  const r = one<any>(`SELECT * FROM agent_runs WHERE id = ? AND agent = 'weekly_review'`, [runId]);
  if (!r) throw new Error("No such review");
  const out = json<Review | null>(r.output, null);
  const mix = out?.lane_mix;
  if (!mix) throw new Error("This review didn't suggest a lane change.");
  const sp = getSpeaker(r.speaker_id)!;
  const lanes = sp.lanes.map((l) => ({ ...l, share: Math.round(Number(mix[l.key] ?? l.share)) }));
  const total = lanes.reduce((a, l) => a + l.share, 0);
  if (Math.abs(total - 100) > 2) throw new Error(`The suggested shares add up to ${total}%, not 100%. Change them by hand on the Speakers page.`);
  run(`UPDATE speakers SET lanes = ? WHERE id = ?`, [JSON.stringify(lanes), sp.id]);
  audit(userId, "apply_lane_mix", "speaker", sp.id, { from: sp.lanes.map((l) => [l.key, l.share]), to: lanes.map((l) => [l.key, l.share]) });
  return lanes;
}

export function agentRuns(limit = 30) {
  return raw<any>(`SELECT r.id, r.agent, r.status, r.tokens_in, r.tokens_out, r.error, r.created_at, r.finished_at, s.name AS speaker FROM agent_runs r LEFT JOIN speakers s ON s.id = r.speaker_id ORDER BY r.id DESC LIMIT ?`, [limit]);
}

/** Tokens used in the last 30 days, per agent — the Settings page turns this into an estimated cost. */
export function agentUsage() {
  return raw<any>(
    `SELECT agent, COUNT(*) AS runs, COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout FROM agent_runs WHERE created_at >= ? GROUP BY agent ORDER BY agent`,
    [daysAgo(30)],
  );
}
