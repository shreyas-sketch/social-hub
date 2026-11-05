import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-hub-agents-"));
process.env.DRY_RUN = ""; // the tests stand in for the platforms themselves
process.env.DB_FILE = path.join(dir, "t.db");
process.env.ANTHROPIC_API_KEY = "test";
process.env.TOKEN_KEY = "k";
process.env.APP_URL = "https://hub.example.com";

/** Fake Claude: returns whatever the test sets, and records what was asked. */
const asked: string[] = [];
let reply: unknown = {};
(globalThis as any).fetch = async (_u: string, init: any) => {
  asked.push(JSON.parse(init.body).messages[0].content);
  return new Response(JSON.stringify({ model: "claude-test", content: [{ type: "text", text: JSON.stringify(reply) }], usage: { input_tokens: 1000, output_tokens: 200 } }), { status: 200 });
};

test("agents: trend scout, playbook coach, hook doctor, weekly review — they only propose", async () => {
  const { run, now, one, raw } = await import("@/db");
  const sp = Number(
    run(`INSERT INTO speakers (slug, name, niche, lanes, stop_list, created_at) VALUES ('d','Deepak','crypto',?, '["no airdrops"]', ?)`, [
      JSON.stringify([{ key: "safety", name: "Safety", desc: "", share: 60 }, { key: "basics", name: "Basics", desc: "", share: 40 }]),
      now(),
    ]).lastInsertRowid,
  );
  const w = Number(run(`INSERT INTO watch_sources (kind, name, platform, handle, active, created_at) VALUES ('trend','MrBeast','youtube','@mrbeast',1,?)`, [now()]).lastInsertRowid);
  const t = Number(run(`INSERT INTO watch_sources (kind, name, platform, handle, active, created_at) VALUES ('teacher','Kallaway','youtube','@k',1,?)`, [now()]).lastInsertRowid);
  run(`INSERT INTO watch_posts (source_id, external_id, caption, permalink, published_at, views, likes, comments, outlier, created_at) VALUES (?, 'v1', 'I bought every item', 'https://y/1', ?, 9000000, 1, 1, 3.2, ?)`, [w, now(), now()]);
  run(`INSERT INTO watch_posts (source_id, external_id, caption, permalink, published_at, views, likes, comments, outlier, created_at) VALUES (?, 'k1', 'The hook formula', 'https://y/2', ?, 50000, 1, 1, 2.1, ?)`, [t, now(), now()]);

  // Trend Scout
  const { trendScout, trendIdeasFor, playbookCoach, hookDoctor, weeklyReview, applyLaneMix, activeRules } = await import("@/lib/agents");
  reply = { headline: "Stakes in the first second", patterns: [{ pattern: "Stakes first", why: "x", examples: ["https://y/1"] }], per_speaker: [{ slug: "d", ideas: [{ idea: "The 3 scam texts", format: "stakes first", borrowed_from: "https://y/1" }] }], avoid: [] };
  await trendScout();
  assert.match(asked.at(-1)!, /I bought every item/);
  assert.equal(trendIdeasFor("d")!.ideas[0].idea, "The 3 scam texts");

  // Playbook Coach: proposals wait for a person
  reply = { proposals: [{ rule: "Say the number in the first sentence", why: "y", scope: "instagram", source_url: "https://y/2", source_name: "Kallaway" }], retire: [] };
  const coach = await playbookCoach();
  assert.equal(coach.added, 1);
  assert.equal(one<any>(`SELECT status FROM playbook_rules WHERE rule LIKE 'Say the number%'`).status, "proposed");
  assert.equal(activeRules(sp).length, 0, "nothing switches on by itself");
  run(`UPDATE playbook_rules SET status = 'active'`);

  // Script writer reads the playbook and this week's trend ideas
  const { writeBrief } = await import("@/lib/scripts");
  reply = [
    { lane: "safety", hook_type: "mistake", format: "talking_head", title: "A", hook: "Five words that mean scam", body: "b", cta: "c", on_screen: [], caption: "c", hashtags: "#a #b #c #d #e #f #g", linkedin: "LinkedIn text", length_sec: 35, why: "w", inspired_by: null },
  ];
  const ids = await writeBrief(sp, "2026-11-06", 1);
  const prompt = asked.at(-1)!;
  assert.match(prompt, /Say the number in the first sentence/);
  assert.match(prompt, /The 3 scam texts/);
  const sc = one<any>(`SELECT hashtags, linkedin_text FROM scripts WHERE id = ?`, [ids[0]]);
  assert.equal(sc.hashtags.split(" ").length, 5, "hashtags capped at 5");
  assert.equal(sc.linkedin_text, "LinkedIn text");
  assert.ok(one<any>(`SELECT id FROM jobs WHERE kind = 'agent' AND payload LIKE '%hook_doctor%'`), "Hook Doctor queued after the scripts");

  // Hook Doctor: saves a score; a "better" hook that breaks a rule is dropped
  reply = { scripts: [{ id: ids[0], score: 6, checks: [{ check: "number first", ok: false, note: "no number" }], better_hooks: ["This coin can do 100x", "Three texts that mean it's a scam", "Your bank never sends this message"], fix: "Lead with the number" }] };
  const notes = await hookDoctor(ids);
  assert.equal(notes[0].score, 6);
  assert.deepEqual(notes[0].better_hooks, ["Three texts that mean it's a scam", "Your bank never sends this message"]);
  assert.equal(one<any>(`SELECT hook_score FROM scripts WHERE id = ?`, [ids[0]]).hook_score, 6);

  // Weekly Review: suggests a lane mix; only a person applies it
  const acc = Number(run(`INSERT INTO accounts (speaker_id, platform, status, created_at) VALUES (?, 'instagram', 'connected', ?)`, [sp, now()]).lastInsertRowid);
  const v = Number(run(`INSERT INTO videos (script_id, speaker_id, raw_path, created_at) VALUES (?, ?, 'r.mp4', ?)`, [ids[0], sp, now()]).lastInsertRowid);
  const e = Number(run(`INSERT INTO edits (video_id, script_id, duration, created_at, updated_at) VALUES (?, ?, 35, ?, ?)`, [v, ids[0], now(), now()]).lastInsertRowid);
  run(`INSERT INTO trials (edit_id, account_id, status, views, reach, shares, skip_rate, posted_at, created_at, updated_at) VALUES (?, ?, 'done', 1200, 1000, 12, 41, ?, ?, ?)`, [e, acc, now(), now(), now()]);
  reply = { summary: "One trial.", worked: [], didnt: [], changes: [{ change: "Lead with a number", why: "skip 41%" }], lane_mix: { safety: 70, basics: 30 }, rule_proposals: [{ rule: "Name the scam in the first line", why: "best trial did" }] };
  const review = await weeklyReview(sp);
  assert.match(asked.at(-1)!, /"sends_per_1k":12/);
  const lanesBefore = JSON.parse(one<any>(`SELECT lanes FROM speakers WHERE id = ?`, [sp]).lanes);
  assert.equal(lanesBefore[0].share, 60, "not applied until a person says so");
  const uid = Number(run(`INSERT INTO users (email, name, password_hash, role, created_at) VALUES ('o@x','O','x','owner',?)`, [now()]).lastInsertRowid);
  applyLaneMix((review as any)._runId, uid);
  assert.equal(JSON.parse(one<any>(`SELECT lanes FROM speakers WHERE id = ?`, [sp]).lanes)[0].share, 70);
  assert.equal(one<any>(`SELECT status, scope FROM playbook_rules WHERE rule LIKE 'Name the scam%'`).status, "proposed");
  assert.ok(raw<any>(`SELECT * FROM agent_runs WHERE tokens_in = 1000`).length >= 4, "every run is logged with its tokens");
});

test("verdicts: strong sends go to a person; under 1,000 followers posts a normal reel", async () => {
  const { run, now, one } = await import("@/db");
  const { decide, trialMode } = await import("@/lib/trials");
  const { setSetting } = await import("@/lib/config");
  setSetting("min_trials_for_baseline", "3");
  const sp = Number(run(`INSERT INTO speakers (slug, name, niche, created_at) VALUES ('v','V','crypto',?)`, [now()]).lastInsertRowid);
  const acc = Number(run(`INSERT INTO accounts (speaker_id, platform, status, created_at) VALUES (?, 'instagram', 'connected', ?)`, [sp, now()]).lastInsertRowid);
  const mk = (views: number, reach: number, shares: number, status = "done", mode = "trial") => {
    const sc = Number(run(`INSERT INTO scripts (speaker_id, title, hook, body, created_at, updated_at) VALUES (?, 't','h','b',?,?)`, [sp, now(), now()]).lastInsertRowid);
    const v = Number(run(`INSERT INTO videos (script_id, speaker_id, raw_path, created_at) VALUES (?, ?, 'r', ?)`, [sc, sp, now()]).lastInsertRowid);
    const e = Number(run(`INSERT INTO edits (video_id, script_id, created_at, updated_at) VALUES (?, ?, ?, ?)`, [v, sc, now(), now()]).lastInsertRowid);
    const t = Number(run(`INSERT INTO trials (edit_id, account_id, status, views, reach, shares, mode, posted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [e, acc, status, views, reach, shares, mode, now(), now(), now()]).lastInsertRowid);
    return { sc, t };
  };
  for (let i = 0; i < 3; i++) mk(1000, 1000, 5);
  const shared = mk(1100, 1000, 15, "live");
  decide(shared.t, sp, shared.sc, 1100);
  const r = one<any>(`SELECT verdict, verdict_reason FROM trials WHERE id = ?`, [shared.t]);
  assert.equal(r.verdict, "pending");
  assert.match(r.verdict_reason, /shared 3\.0× more/);
  // Normal reels are judged only against normal reels
  const reg = mk(500, 400, 1, "live", "regular");
  decide(reg.t, sp, reg.sc, 500);
  assert.match(one<any>(`SELECT verdict_reason FROM trials WHERE id = ?`, [reg.t]).verdict_reason, /normal reel/);
  // Under 1,000 followers → normal reel
  run(`INSERT INTO account_stats (account_id, day, followers, source, created_at) VALUES (?, '2026-11-05', 369, 'api', ?)`, [acc, now()]);
  assert.equal(trialMode(acc), "regular");
});

test("publishing text: LinkedIn uses its own text; X and Facebook carry no link by default", async () => {
  const { captionFor, linkPlatforms } = await import("@/lib/publish");
  assert.deepEqual(linkPlatforms(), ["linkedin"]);
  const s = { hook: "Hook", caption: "IG caption", hashtags: "#a #b", linkedin_text: "What the video says.", caption_disclaimer: "Risk line." };
  const li = captionFor("linkedin", s, "https://hub/r/x");
  assert.match(li, /^What the video says\./);
  assert.doesNotMatch(li, /#a/);
  assert.match(li, /Risk line\./);
  const fb = captionFor("facebook", s, null);
  assert.doesNotMatch(fb, /https/);
});
