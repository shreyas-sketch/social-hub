import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-hub-v13-"));
process.env.DRY_RUN = ""; // the tests stand in for the platforms themselves
process.env.DB_FILE = path.join(dir, "t.db");
process.env.MEDIA_DIR = path.join(dir, "media");
process.env.ANTHROPIC_API_KEY = "test";
process.env.TOKEN_KEY = "k";
process.env.APP_URL = "https://hub.example.com";

/** Fake network: Claude gets `reply`; Meta calls go to `meta(url, init)`. Every call is recorded. */
const calls: { url: string; body: any }[] = [];
let replies: unknown[] = [];
let meta: (url: string, init: any) => unknown = () => ({});
(globalThis as any).fetch = async (u: string, init: any = {}) => {
  const url = String(u);
  let body: any = init.body;
  try {
    body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
  } catch {
    /* form body */
  }
  calls.push({ url, body });
  if (url.includes("api.anthropic.com")) {
    const r = replies.length > 1 ? replies.shift() : replies[0];
    return new Response(JSON.stringify({ model: "claude-test", content: [{ type: "text", text: JSON.stringify(r) }], usage: { input_tokens: 100, output_tokens: 50 } }), { status: 200 });
  }
  return new Response(JSON.stringify(meta(url, init)), { status: 200 });
};

test("setup: one person to approve things", async () => {
  const { run, now } = await import("@/db");
  run(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (1, 'o@x.com', 'Owner', 'x', 'owner', ?)`, [now()]);
});

test("long-form timeline: kept parts, chapters, captions", async () => {
  const { prepareSegs, mapTime, fixChapters, mapWords, toSrt, stamp, selectExpr, keptDuration } = await import("@/lib/edit/longform");
  const segs = prepareSegs([{ s: 0, e: 10.01 }, { s: 12, e: 30 }, { s: 40, e: 100 }], 5, 90);
  assert.deepEqual(segs, [{ s: 5, e: 10 }, { s: 12, e: 30 }, { s: 40, e: 90 }], "trimmed to 5–90 and snapped to the 1/30 s grid");
  assert.equal(keptDuration(segs), 73);
  assert.equal(mapTime(12, segs), 5, "after the first cut");
  assert.equal(mapTime(11, segs), 5, "a moment inside a cut lands where the next part starts");
  assert.equal(mapTime(45, segs), 28);
  assert.equal(mapTime(2, segs), 0, "before the start");
  const ch = fixChapters([{ t: 3, title: "Intro" }, { t: 8, title: "Too close" }, { t: 30, title: "Why it fails" }, { t: 60, title: "What to do" }, { t: 70, title: "Last" }], 73);
  assert.deepEqual(ch.map((c) => c.t), [0, 30, 60], "first at 0:00, none within 10s of another or of the end");
  assert.deepEqual(fixChapters([{ t: 0, title: "A" }, { t: 30, title: "B" }], 100), [], "fewer than 3 → none");
  assert.equal(stamp(3729), "1:02:09");
  assert.equal(stamp(65), "1:05");
  const words = mapWords([{ w: "Hello", s: 12.1, e: 12.5 }, { w: "lost", s: 31, e: 31.4 }, { w: "world", s: 40.2, e: 40.6 }], segs);
  assert.deepEqual(words.map((w) => w.w), ["Hello", "world"], "words inside a cut are dropped");
  assert.equal(words[1].s, 23.2);
  assert.match(toSrt(words), /^1\n00:00:05,100 --> /);
  assert.match(selectExpr([{ s: 1, e: 2 }]), /^gte\(t,0\.98\d+\)\*lt\(t,1\.98\d+\)$/);
});

test("clips: edges on whole sentences, timed transcript lines", async () => {
  const { snapClip, transcriptLines, parseChapters, parseStamp, clipText } = await import("@/lib/sessions");
  // A sentence every 5 seconds: "Word0 … word9." with a pause before each sentence.
  const words: { w: string; s: number; e: number }[] = [];
  for (let k = 0; k < 40; k++) for (let j = 0; j < 10; j++) words.push({ w: j === 9 ? `w${k}.` : `w${k}`, s: k * 5 + j * 0.4, e: k * 5 + j * 0.4 + 0.3 });
  const c = snapClip(words, 51.3, 89.1)!;
  assert.equal(c.start, +(50 - 0.12).toFixed(3), "starts on the sentence that begins at 50s");
  assert.equal(c.end, +(85 + 3.6 + 0.3 + 0.35).toFixed(3), "ends after the sentence that finishes near 89s");
  assert.equal(snapClip(words, 10, 15), null, "under 12 seconds");
  assert.equal(snapClip(words, 0, 150), null, "over 95 seconds");
  assert.match(clipText(words, c.start, c.end), /^w10 /);
  const lines = transcriptLines(words);
  assert.ok(lines.length >= 20 && lines[0].t === 0);
  assert.deepEqual(parseChapters("0:00 Intro\n4:05 Why\nnot a chapter\n1:02:09 End"), [{ t: 0, title: "Intro" }, { t: 245, title: "Why" }, { t: 3729, title: "End" }]);
  assert.equal(parseStamp("2:30"), 150);
  assert.equal(parseStamp(""), null);
  assert.throws(() => parseStamp("soon"), /isn't a time/);
});

test("clip picker → clip scripts → approving a clip cuts it from the recording; the long video is drafted", async () => {
  const { run, now, one, raw } = await import("@/db");
  const { abs, ensureDir } = await import("@/lib/media");
  const sp = Number(run(`INSERT INTO speakers (slug, name, niche, lanes, stop_list, created_at) VALUES ('sid','Sid','finance_trading',?, '[]', ?)`, [JSON.stringify([{ key: "money", name: "Money", desc: "", share: 100 }]), now()]).lastInsertRowid);
  const words: { w: string; s: number; e: number }[] = [];
  for (let k = 0; k < 120; k++) for (let j = 0; j < 10; j++) words.push({ w: k === 50 && j === 2 ? "guaranteed" : j === 9 ? `w${k}.` : `w${k}`, s: k * 5 + j * 0.4, e: k * 5 + j * 0.4 + 0.3 });
  const { createSession } = await import("@/lib/sessions");
  const sid = createSession({ speakerId: sp, kind: "talk", title: "Why salaried traders lose" }, 1 as any);
  ensureDir(`sessions/${sid}`);
  fs.writeFileSync(abs(`sessions/${sid}/words.json`), JSON.stringify(words));
  run(`UPDATE sessions SET raw_path = 'raw/x.mp4', duration = 600, words_path = ?, status = 'picking' WHERE id = ?`, [`sessions/${sid}/words.json`, sid]);
  replies = [
    { clips: [
      { start: 100, end: 140, title: "The 2% rule", hook: "Most traders skip this rule", lane: "money", hook_type: "mistake", mix: "core", caption: "c", hashtags: "#a #b #c #d #e #f", linkedin: "li", why: "w" },
      { start: 102, end: 138, title: "Overlap", hook: "dup", lane: "money", hook_type: "mistake", mix: "core", caption: "c", hashtags: "", linkedin: "", why: "" },
      { start: 250, end: 290, title: "Guarantee", hook: "Returns", lane: "money", hook_type: "myth", mix: "core", caption: "c", hashtags: "", linkedin: "", why: "" },
      { start: 300, end: 305, title: "Too short", hook: "x", lane: "money", hook_type: "myth", mix: "core", caption: "c", hashtags: "", linkedin: "", why: "" },
    ] },
    { titles: ["Why salaried traders lose money", "The rule that saves your capital", "Trading with a job"], description: "What you'll learn.", chapters: [{ t: 0, title: "Start" }, { t: 120, title: "Rules" }, { t: 300, title: "Mistakes" }], tags: "trading, rules", thumb_texts: ["THE 2% RULE", "STOP LOSING", "JOB + TRADING"], trim_start: 20, trim_end: 580 },
  ];
  const { pickClips, approveClip, flagRanges } = await import("@/lib/sessions");
  const made = await pickClips(sid);
  assert.equal(made!.length, 2, "overlap and too-short left out");
  const clips = raw<any>(`SELECT * FROM scripts WHERE session_id = ? ORDER BY clip_start`, [sid]);
  assert.equal(clips[0].source, "clip");
  assert.equal(clips[0].hashtags.split(" ").length, 5);
  assert.equal(JSON.parse(clips[1].compliance).status, "block", "the speaker's own words broke a rule ('guaranteed')");
  assert.equal(one<any>(`SELECT status FROM sessions WHERE id = ?`, [sid]).status, "ready");
  const lf = one<any>(`SELECT * FROM longforms WHERE session_id = ?`, [sid]);
  assert.equal(lf.title, "Why salaried traders lose money");
  assert.equal(lf.trim_start, 20);
  const flagged = flagRanges(words, "finance_trading");
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].level, "block");
  assert.deepEqual([flagged[0].s, flagged[0].e], [+(250 - 0.08).toFixed(3), +(250 + 3.6 + 0.3 + 0.15).toFixed(3)], "the whole sentence at 250s, not just the word");
  // A retry after a failure doesn't pick a second set of clips.
  replies = [{ titles: [], description: "", chapters: [], tags: "", thumb_texts: [] }];
  await pickClips(sid);
  assert.equal(raw(`SELECT id FROM scripts WHERE session_id = ?`, [sid]).length, 2);
  // Approving a clip makes its video from the recording and starts the cut.
  const editId = approveClip(clips[0].id, 1);
  const v = one<any>(`SELECT v.* FROM edits e JOIN videos v ON v.id = e.video_id WHERE e.id = ?`, [editId]);
  assert.equal(v.raw_path, "raw/x.mp4");
  assert.equal(v.clip_start, clips[0].clip_start);
  assert.equal(one<any>(`SELECT status FROM scripts WHERE id = ?`, [clips[0].id]).status, "shot");
  assert.ok(one(`SELECT id FROM jobs WHERE kind = 'run_edit' AND payload LIKE ?`, [`%"editId":${editId}%`]));
});

test("the 70/20/10 mix plan", async () => {
  const { run, now } = await import("@/db");
  const { mixPlan, mixShares, weekStart } = await import("@/lib/planner");
  const sp = Number(run(`INSERT INTO speakers (slug, name, niche, created_at) VALUES ('mx','Mx','psychology',?)`, [now()]).lastInsertRowid);
  const plan = mixPlan(sp, 10);
  assert.deepEqual([plan.filter((m) => m === "core").length, plan.filter((m) => m === "adjacent").length, plan.filter((m) => m === "personal").length], [7, 2, 1]);
  for (let i = 0; i < 9; i++) run(`INSERT INTO scripts (speaker_id, title, hook, body, mix, created_at, updated_at) VALUES (?, 't', 'h', 'b', 'core', ?, ?)`, [sp, now(), now()]);
  assert.equal(mixShares(sp).core, 9);
  assert.deepEqual(mixPlan(sp, 3), ["adjacent", "adjacent", "personal"], "after nine core scripts, the next go to the kinds that are short (2 to 1)");
  assert.equal(weekStart("2026-11-05"), "2026-11-02", "Thursday → Monday");
  assert.equal(weekStart("2026-11-08"), "2026-11-02", "Sunday → the Monday before");
});

test("comment-to-DM: keyword, once per comment, only after it's switched on, one a day per person", async () => {
  const { run, now, one, raw } = await import("@/db");
  const { seal } = await import("@/lib/secure");
  const { keywordHit, needsReply, pullComments, saveDmRule, switchDmRule } = await import("@/lib/comments");
  assert.ok(keywordHit("CLASS please!", "class"));
  assert.ok(keywordHit("send me the class", "CLASS"));
  assert.ok(!keywordHit("a classic mistake", "class"));
  assert.ok(needsReply("How do I start with ₹5,000?"));
  assert.ok(!needsReply("🔥🔥🔥"));
  assert.ok(!needsReply("nice"));

  const sp = Number(run(`INSERT INTO speakers (slug, name, niche, program_url, created_at) VALUES ('dk','Deepak','crypto','https://example.com/webinar',?)`, [now()]).lastInsertRowid);
  const acc = Number(run(`INSERT INTO accounts (speaker_id, platform, handle, status, external_id, token_enc, page_token_enc, meta, created_at) VALUES (?, 'instagram', 'cryptowithdeepak', 'connected', 'ig1', ?, ?, '{}', ?)`, [sp, seal("tok"), seal("ptok"), now()]).lastInsertRowid);

  assert.throws(() => saveDmRule({ speakerId: sp, keyword: "two words", message: "Here's the link {link}" }, 1), /one word/);
  const { id: ruleId } = saveDmRule({ speakerId: sp, keyword: "class", message: "Here's the ₹99 webinar: {link}" }, 1);
  assert.equal(one<any>(`SELECT status, keyword FROM dm_rules WHERE id = ?`, [ruleId]).keyword, "CLASS");
  const old = new Date(Date.now() - 3600e3).toISOString();
  const fresh = new Date(Date.now() + 1000).toISOString();
  meta = (url) => {
    if (url.includes("/ig1/media?")) return { data: [{ id: "m1", comments_count: 4, timestamp: new Date().toISOString() }] };
    if (url.includes("/m1/comments?"))
      return { data: [
        { id: "c-old", text: "CLASS", username: "early", from: { id: "u0" }, timestamp: old },
        { id: "c1", text: "Class please", username: "asha", from: { id: "u1" }, timestamp: fresh },
        { id: "c2", text: "CLASS!!", username: "asha", from: { id: "u1" }, timestamp: fresh },
        { id: "c3", text: "How do I keep my coins safe from scams?", username: "ravi", from: { id: "u2" }, timestamp: fresh },
        { id: "c4", text: "class", username: "cryptowithdeepak", timestamp: fresh },
      ] };
    if (url.includes("/ig1/messages")) return { recipient_id: "x", message_id: "mid" };
    return {};
  };
  // Draft keywords send nothing.
  await pullComments(acc);
  assert.equal(calls.filter((c) => c.url.includes("/ig1/messages")).length, 0);
  assert.equal(raw(`SELECT id FROM comments WHERE account_id = ?`, [acc]).length, 4, "the account's own comment is ignored");

  // Switched on: only comments after that moment, one DM per person per day.
  run(`UPDATE comments SET dm_status = NULL WHERE account_id = ?`, [acc]);
  switchDmRule(ruleId, true, 1);
  run(`UPDATE dm_rules SET approved_at = ? WHERE id = ?`, [new Date(Date.now() - 60e3).toISOString(), ruleId]);
  await pullComments(acc);
  const dms = calls.filter((c) => c.url.includes("/ig1/messages"));
  assert.equal(dms.length, 1, "asha gets one DM, not two; 'early' commented before it was on");
  assert.equal(dms[0].body.recipient.comment_id, "c1");
  assert.match(dms[0].body.message.text, /https:\/\/hub\.example\.com\/r\/\w+/);
  const st = Object.fromEntries(raw<any>(`SELECT external_id, dm_status FROM comments WHERE account_id = ?`, [acc]).map((r) => [r.external_id, r.dm_status]));
  assert.deepEqual(st, { "c-old": "skipped", c1: "sent", c2: "skipped", c3: "no_match" });
  assert.equal(one<any>(`SELECT needs_reply FROM comments WHERE external_id = 'c3'`).needs_reply, 1);
  // Running again never re-sends.
  await pullComments(acc);
  assert.equal(calls.filter((c) => c.url.includes("/ig1/messages")).length, 1);
  // Changing the words makes it a draft again.
  saveDmRule({ id: ruleId, speakerId: sp, keyword: "CLASS", message: "New words {link}" }, 1);
  assert.equal(one<any>(`SELECT status FROM dm_rules WHERE id = ?`, [ruleId]).status, "draft");
  // A DM that breaks a rule can't be switched on.
  const bad = saveDmRule({ speakerId: sp, keyword: "RICH", message: "Guaranteed returns, here: {link}" }, 1);
  assert.throws(() => switchDmRule(bad.id, true, 1), /blocking rule/);
});

test("reply drafts wait for a person; a draft that breaks a rule is dropped", async () => {
  const { run, one } = await import("@/db");
  const { draftReplies, approveReply } = await import("@/lib/comments");
  const sp = one<any>(`SELECT id FROM speakers WHERE slug = 'dk'`).id;
  const c3 = one<any>(`SELECT id FROM comments WHERE external_id = 'c3'`).id;
  replies = [[{ id: c3, reply: "Use a hardware wallet and never share your seed phrase.", why: "safety" }]];
  const r = await draftReplies(sp);
  assert.equal(r.drafted, 1);
  assert.equal(one<any>(`SELECT reply_status FROM comments WHERE id = ?`, [c3]).reply_status, "drafted");
  assert.throws(() => approveReply(c3, "This coin will 10x, guaranteed", 1), /blocking rule/);
  approveReply(c3, "Use a hardware wallet and never share your seed phrase.", 1);
  assert.equal(one<any>(`SELECT reply_status FROM comments WHERE id = ?`, [c3]).reply_status, "posting");
  assert.ok(one(`SELECT id FROM jobs WHERE kind = 'post_reply'`));
  run(`UPDATE comments SET reply_status = 'posted' WHERE id = ?`, [c3]);
  assert.throws(() => approveReply(c3, "again", 1), /Already replied/);
});

test("text posts: X length and links are rewritten; LinkedIn skips weekends; posting waits for the hour", async () => {
  const { run, now, one, raw } = await import("@/db");
  const { writeTextPosts, textPlan, minutesUntil, decideTextPost, checkTextPost } = await import("@/lib/textposts");
  const sp = Number(run(`INSERT INTO speakers (slug, name, niche, text_per_day, created_at) VALUES ('ak','Akshat','business_consulting','{"linkedin":1,"x":1}',?)`, [now()]).lastInsertRowid);
  assert.deepEqual(textPlan({ text_per_day: '{"linkedin":1,"x":1}' }, "2026-11-07").map((p) => p.platform), ["x"], "Saturday: no LinkedIn");
  assert.equal(textPlan({ text_per_day: '{"linkedin":1,"x":1}' }, "2026-11-05").length, 2);
  assert.equal(checkTextPost("x", "a".repeat(281), "business_consulting").status, "block");
  assert.equal(checkTextPost("linkedin", "Read this https://x.com/a", "business_consulting").status, "block");
  replies = [
    { posts: [{ platform: "linkedin", body: "73% of owners still sign every cheque.\n\nHere's why that caps you at ₹5 Cr.", angle: "number", why: "w" }, { platform: "x", body: "x".repeat(300), angle: "hook", why: "w" }] },
    { body: "Most owners are the bottleneck. Not the market." },
  ];
  const ids = await writeTextPosts(sp, "2026-11-05");
  assert.equal(ids.length, 2);
  const x = one<any>(`SELECT * FROM text_posts WHERE platform = 'x' AND speaker_id = ?`, [sp]);
  assert.equal(x.body, "Most owners are the bottleneck. Not the market.");
  assert.match(x.notes, /Rewritten automatically once/);
  assert.deepEqual(await writeTextPosts(sp, "2026-11-05"), [], "once a day");
  assert.equal(minutesUntil("2026-11-05", 10, Date.parse("2026-11-05T09:00:00+05:30")), 60);
  assert.equal(minutesUntil("2026-11-05", 10, Date.parse("2026-11-05T11:00:00+05:30")), 0);
  assert.throws(() => decideTextPost(x.id, true, 1), /Connect this speaker's X/);
  run(`INSERT INTO accounts (speaker_id, platform, status, external_id, token_enc, meta, created_at) VALUES (?, 'x', 'connected', 'x1', 'enc', '{}', ?)`, [sp, now()]);
  decideTextPost(x.id, true, 1);
  assert.equal(one<any>(`SELECT status FROM text_posts WHERE id = ?`, [x.id]).status, "approved");
  assert.ok(raw(`SELECT id FROM jobs WHERE kind = 'post_text'`).length);
});

test("growth pace, sign-ups matched to the speaker and the reel, tracking links log each click", async () => {
  const { run, now, one, istDay } = await import("@/db");
  const { pace, addSignups, growthCard } = await import("@/lib/growth");
  const { speaker } = await import("@/lib/speakers");
  const { makeLink, linkTarget } = await import("@/lib/publish");
  const sp = Number(run(`INSERT INTO speakers (slug, name, niche, program_url, targets, created_at) VALUES ('gr','Gr','psychology','https://example.com/w', ?, ?)`, [JSON.stringify({ instagram: { followers: 1_000_000, by: "2029-11-30" } }), now()]).lastInsertRowid);
  const acc = Number(run(`INSERT INTO accounts (speaker_id, platform, status, meta, created_at) VALUES (?, 'instagram', 'connected', '{}', ?)`, [sp, now()]).lastInsertRowid);
  const day = (n: number) => istDay(new Date(Date.now() - n * 864e5));
  run(`INSERT INTO account_stats (account_id, day, followers, source, created_at) VALUES (?, ?, 10000, 'api', ?)`, [acc, day(30), now()]);
  run(`INSERT INTO account_stats (account_id, day, followers, source, created_at) VALUES (?, ?, 10500, 'api', ?)`, [acc, day(7), now()]);
  run(`INSERT INTO account_stats (account_id, day, followers, source, created_at) VALUES (?, ?, 10900, 'api', ?)`, [acc, day(0), now()]);
  const p = pace(speaker(sp)!, "instagram");
  assert.equal(p.followers, 10900);
  assert.equal(Math.round(p.net30!), 30, "900 in 30 days");
  assert.ok(Math.abs(p.net7! - 400 / 7) < 0.01);
  const left = Math.round((Date.parse("2029-11-30T00:00:00Z") - Date.parse(`${istDay()}T00:00:00Z`)) / 864e5);
  assert.ok(Math.abs(p.needPerDay! - (1_000_000 - 10900) / left) < 0.01, "followers still needed ÷ days left");
  assert.ok(p.ratio! < 0.05);
  run(`INSERT INTO posts (account_id, external_id, views, published_at, created_at) VALUES (?, 'p1', 300000, ?, ?)`, [acc, now(), now()]);
  assert.equal(Math.round(growthCard(speaker(sp)!).followsPer1k!), 3, "900 net follows ÷ 300K views");

  const code = makeLink(sp, null, "instagram", "dm")!;
  const url = new URL(linkTarget(code)!);
  assert.equal(url.searchParams.get("utm_term"), "gr");
  assert.equal(url.searchParams.get("utm_id"), code);
  assert.match(url.searchParams.get("utm_content")!, /^dm-/);
  assert.equal(one<any>(`SELECT COUNT(*) AS n FROM link_clicks WHERE code = ?`, [code]).n, 1);
  const r1 = addSignups([{ utm_id: code, ref: "order-1" }, { utm_term: "gr", ref: "order-2", count: 2 }, { utm_term: "nobody", ref: "x" }], "api", null);
  assert.equal(r1.added, 2);
  assert.equal(addSignups([{ utm_id: code, ref: "order-1" }], "api", null).added, 0, "a resend isn't counted twice");
  assert.equal(growthCard(speaker(sp)!).signups, 3);
});

test("trial cap and collab reels", async () => {
  const { run, now, one } = await import("@/db");
  const { setSetting } = await import("@/lib/config");
  const { startTrial } = await import("@/lib/trials");
  const sp = Number(run(`INSERT INTO speakers (slug, name, niche, created_at) VALUES ('tc','Tc','psychology',?)`, [now()]).lastInsertRowid);
  const acc = Number(run(`INSERT INTO accounts (speaker_id, platform, status, external_id, meta, created_at) VALUES (?, 'instagram', 'connected', 'igtc', '{}', ?)`, [sp, now()]).lastInsertRowid);
  run(`INSERT INTO account_stats (account_id, day, followers, source, created_at) VALUES (?, '2026-01-01', 5000, 'api', ?)`, [acc, now()]);
  const mk = (settings = "{}") => {
    const s = Number(run(`INSERT INTO scripts (speaker_id, title, hook, body, status, decided_by, created_at, updated_at) VALUES (?, 't', 'h', 'b', 'edited', 1, ?, ?)`, [sp, now(), now()]).lastInsertRowid);
    const v = Number(run(`INSERT INTO videos (script_id, speaker_id, raw_path, created_at) VALUES (?, ?, 'r.mp4', ?)`, [s, sp, now()]).lastInsertRowid);
    // The take's words (checked against the rules before posting).
    return Number(run(`INSERT INTO edits (video_id, script_id, settings, status, transcript, created_at, updated_at) VALUES (?, ?, ?, 'ready', '[{"w":"Hello","s":0,"e":0.4}]', ?, ?)`, [v, s, settings, now(), now()]).lastInsertRowid);
  };
  setSetting("trial_daily_cap", "2");
  startTrial(mk(), 1);
  startTrial(mk(), 1);
  assert.throws(() => startTrial(mk(), 1), /cap is 2/);
  const collab = startTrial(mk(JSON.stringify({ collaborators: ["someone.big"] })), 1);
  assert.equal(one<any>(`SELECT mode FROM trials WHERE id = ?`, [collab]).mode, "regular", "collab reels aren't trials, and don't count against the trial cap");
});

test("review fixes: approvals can't be edited around, the rules check covers everything that goes out", async () => {
  const { run, now, one } = await import("@/db");
  const { fixChapters } = await import("@/lib/edit/longform");
  const { saveLongform, approveLongform } = await import("@/lib/sessions");
  const { saveDmRule } = await import("@/lib/comments");
  const { saveTextPost, retryTextPost } = await import("@/lib/textposts");
  const { checkScript } = await import("@/lib/compliance");

  // Chapters that land on 0:00 after a new start time: the last one names it.
  assert.equal(fixChapters([{ t: 0, title: "Welcome" }, { t: 0, title: "Why traders lose" }, { t: 30, title: "B" }, { t: 60, title: "C" }], 100)[0].title, "Why traders lose");

  // The LinkedIn text is checked with the script.
  assert.equal(checkScript({ hook: "ok", linkedin: "Guaranteed returns every month" }, "finance_trading").status, "block");

  // A long video, once approved, can't be changed by the team; an owner's change sends it back for approval.
  const lf = one<any>(`SELECT id FROM longforms ORDER BY id LIMIT 1`).id;
  run(`UPDATE longforms SET status = 'ready', output_path = 'x.mp4', duration = 600, segs = '[]', trim_start = 20.4 WHERE id = ?`, [lf]);
  approveLongform(lf, 1);
  const form = (title: string) => ({ title, description: "What you'll learn.", chapters: "0:00 Start\n2:00 Rules\n5:00 Mistakes", tags: "trading", thumbTexts: ["A", "B", "C"], trimStart: "0:20", trimEnd: "9:40", cutSilence: true });
  assert.throws(() => saveLongform(lf, form("Guaranteed returns, risk-free"), 1, false), /Only an owner or admin/);
  saveLongform(lf, form("Why salaried traders lose money, part 2"), 1, true);
  const after = one<any>(`SELECT status, approved_by, trim_start FROM longforms WHERE id = ?`, [lf]);
  assert.deepEqual([after.status, after.approved_by], ["ready", null], "changed after approval → needs approving again");
  assert.equal(after.trim_start, 20.4, "0:20 on the page is the same start — not a change that needs a re-cut");
  run(`UPDATE longforms SET chapters = '[{"t":0,"title":"Guaranteed returns"}]' WHERE id = ?`, [lf]);
  const r = saveLongform(lf, { ...form("A title"), chapters: "0:00 Guaranteed returns\n2:00 B\n5:00 C" }, 1, true);
  assert.equal(r.compliance.status, "block", "chapter titles are checked");

  // A DM keyword is always checked against its own speaker's rules.
  const dk = one<any>(`SELECT id FROM speakers WHERE slug = 'dk'`).id;
  const ak = one<any>(`SELECT id FROM speakers WHERE slug = 'ak'`).id;
  const rule = saveDmRule({ speakerId: dk, keyword: "COINS", message: "Here: {link}" }, 1);
  const moved = saveDmRule({ id: rule.id, speakerId: ak, keyword: "COINS", message: "Free crypto here: {link}" }, 1);
  assert.equal(one<any>(`SELECT speaker_id FROM dm_rules WHERE id = ?`, [rule.id]).speaker_id, dk);
  assert.equal(moved.check.status, "warn", "crypto rules applied, not the consulting ones");

  // A failed text post: the team can't edit it, an owner's edit needs approving again, and "Try again" re-checks.
  const tp = one<any>(`SELECT id FROM text_posts WHERE platform = 'x' ORDER BY id LIMIT 1`).id;
  run(`UPDATE text_posts SET status = 'error', decided_by = 1 WHERE id = ?`, [tp]);
  assert.throws(() => saveTextPost(tp, "Changed", false, 1), /Only an owner or admin/);
  saveTextPost(tp, "Guaranteed returns, no risk", true, 1);
  assert.equal(one<any>(`SELECT status FROM text_posts WHERE id = ?`, [tp]).status, "proposed");
  run(`UPDATE text_posts SET status = 'error', decided_by = 1 WHERE id = ?`, [tp]);
  assert.throws(() => retryTextPost(tp, 1), /blocking rule/);
});

test("long video: flagged sentences are cut out, phrases split across lines are caught, a check part can be kept", async () => {
  const { flagRanges, removalPlan, flagsInRange } = await import("@/lib/sessions");
  const { subtractRanges, prepareSegs, mapWords } = await import("@/lib/edit/longform");
  const say = (t0: number, text: string) => text.split(" ").map((w, i) => ({ w, s: +(t0 + i * 0.4).toFixed(2), e: +(t0 + i * 0.4 + 0.3).toFixed(2) }));
  const words = [
    ...say(0, "Welcome to the session today."),
    ...say(5, "This plan gives guaranteed returns every month."),
    ...say(12, "Here is how risk works."),
    // 6+ seconds of one long line, so the phrase falls across two transcript lines
    ...say(20, "We looked at many funds and every single one of them promised something and the worst ones said assured"),
    ...say(30, "returns which is a lie."),
    ...say(40, "Today's market is crashing, so look at older data."),
    ...say(50, "Thanks for watching."),
  ];
  const f = flagRanges(words, "finance_trading");
  assert.equal(f.length, 3, JSON.stringify(f.map((x) => [x.s, x.e, x.issues.map((i) => i.match)])));
  assert.equal(f[0].level, "block");
  assert.ok(f[0].s <= 5 && f[0].e >= 7.5 && f[0].e < 12, "the whole 'guaranteed returns' sentence");
  assert.equal(f[1].level, "block", "'assured … returns' across two lines is caught");
  assert.ok(f[1].e >= 31.9);
  assert.equal(f[2].level, "warn", "'today's market' is a check, not a block");
  // Blocking parts are always cut; a check part only if nobody kept it.
  assert.equal(removalPlan(f, []).length, 3);
  assert.deepEqual(removalPlan(f, [f[2].key, f[0].key]).map((r) => r.key), [f[0].key, f[1].key], "a block can't be kept");
  assert.equal(flagsInRange(words, "finance_trading", 35, null).length, 1, "only parts after the new start");
  const kept = prepareSegs(subtractRanges([{ s: 0, e: 55 }], removalPlan(f, []).map((r) => ({ s: r.s, e: r.e }))), 0, 55);
  const left = mapWords(words, kept).map((w) => w.w).join(" ");
  assert.doesNotMatch(left, /guaranteed|assured|crashing/);
  assert.match(left, /Welcome .* Here is how risk works\. .*Thanks for watching\./);
  assert.deepEqual(subtractRanges([{ s: 0, e: 10 }, { s: 20, e: 30 }], [{ s: 5, e: 22 }]), [{ s: 0, e: 5 }, { s: 22, e: 30 }]);
});
