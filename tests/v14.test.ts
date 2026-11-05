import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-hub-v14-"));
process.env.DRY_RUN = ""; // the tests stand in for the platforms themselves
process.env.DB_FILE = path.join(dir, "t.db");
process.env.MEDIA_DIR = path.join(dir, "media");
process.env.ANTHROPIC_API_KEY = "test";
process.env.TOKEN_KEY = "k";
process.env.APP_URL = "https://hub.example.com";
process.env.TRANSCRIBE_ENGINE = "local";

const calls: { url: string; body: any }[] = [];
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
  return new Response(JSON.stringify(meta(url, init)), { status: 200 });
};

test("setup", async () => {
  const { run, now } = await import("@/db");
  run(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (1, 'o@x.com', 'Owner', 'x', 'owner', ?)`, [now()]);
});

test("rules: the × sign, spoken money claims and price targets are caught; ordinary sentences aren't", async () => {
  const { checkText, checkScript } = await import("@/lib/compliance");
  const block = [
    ["10× returns in a year", "crypto"],
    ["turned 10,000 rupees into 1 lakh", "finance_trading"],
    ["I turned 10,000 into 1 lakh", "finance_trading"],
    ["this coin can go 10 times", "crypto"],
    ["it can give you ten times your money", "crypto"],
    ["my target for Nifty is 25,000", "finance_trading"],
    ["Nifty will touch 26000 by Diwali", "finance_trading"],
  ] as const;
  for (const [t, n] of block) assert.equal(checkText(t, n).status, "block", t);
  const fine = [
    ["I go 3 times a week to the gym", "finance_trading"],
    ["I failed 5 times before it worked", "finance_trading"],
    ["our target audience is 25 year olds", "finance_trading"],
    ["10x faster with AI", "crypto"],
    ["I'm 10x calmer now", "psychology"],
    ["₹5,000 a month SIP for 20 years", "finance_trading"],
  ] as const;
  for (const [t, n] of fine) assert.equal(checkText(t, n).status, "ok", t);
  assert.equal(checkText("Target at 1,500, stop at 1,450 (example)", "finance_trading").status, "warn", "a possible target is for a person to judge");
  // A warning is not a claim: the speaker's own risk lines stay in.
  for (const t of ["There are no guaranteed returns.", "Koi bhi guarantee nahi de sakta.", "Beware of anyone who promises guaranteed returns.", "At 12%, money doubles in 6 years.", "Volume grew 3 times.", "Nifty can go to 15,000 or 30,000, nobody knows.", "My target for the year is 100 students."])
    assert.equal(checkText(t, "finance_trading").status, "ok", t);
  // …but a claim with a disclaimer in another clause still counts.
  for (const t of ["Not financial advice, but this is a sure shot.", "There's no risk in this trade, guaranteed.", "Rs 10,000 into 1 lakh in a year.", "10 guna return milega.", "Aapka paisa double ho jayega."])
    assert.equal(checkText(t, "finance_trading").status, "block", t);
  assert.equal(checkText("Cryptocurrency explained", "crypto").issues[0].soft, true, "wording notes are marked soft");
  assert.equal(checkScript({ hook: "ok", hashtags: "#10xReturns #crypto" }, "crypto").status, "block", "hashtags are checked");
  assert.equal(checkScript({ title: "Double your money", hook: "ok" }, "crypto").status, "block", "the title is checked (it's the LinkedIn video title)");
});

async function reel(o: { niche?: string; words?: string; settings?: string; followers?: number | null } = {}) {
  const { run, now } = await import("@/db");
  const slug = `s${Math.random().toString(36).slice(2, 8)}`;
  const sp = Number(run(`INSERT INTO speakers (slug, name, niche, created_at) VALUES (?, 'S', ?, ?)`, [slug, o.niche || "crypto", now()]).lastInsertRowid);
  const acc = Number(run(`INSERT INTO accounts (speaker_id, platform, status, external_id, meta, created_at) VALUES (?, 'instagram', 'connected', ?, '{}', ?)`, [sp, `ig-${slug}`, now()]).lastInsertRowid);
  if (o.followers !== null) run(`INSERT INTO account_stats (account_id, day, followers, created_at) VALUES (?, '2026-11-01', ?, ?)`, [acc, o.followers ?? 5000, now()]);
  const s = Number(run(`INSERT INTO scripts (speaker_id, title, hook, body, status, decided_by, created_at, updated_at) VALUES (?, 't', 'h', 'b', 'edited', 1, ?, ?)`, [sp, now(), now()]).lastInsertRowid);
  const v = Number(run(`INSERT INTO videos (script_id, speaker_id, raw_path, created_at) VALUES (?, ?, 'r.mp4', ?)`, [s, sp, now()]).lastInsertRowid);
  const words = (o.words || "a plain safe sentence").split(" ").map((w, i) => ({ w, s: i, e: i + 0.5 }));
  const e = Number(run(`INSERT INTO edits (video_id, script_id, settings, status, transcript, output_path, created_at, updated_at) VALUES (?, ?, ?, 'ready', ?, 'edits/x/reel.mp4', ?, ?)`, [v, s, o.settings || "{}", JSON.stringify(words), now(), now()]).lastInsertRowid);
  return { sp, acc, s, v, e };
}

test("a reel can't go out if the take itself says something the rules block", async () => {
  const { startTrial } = await import("@/lib/trials");
  const ad = await reel({ words: "and this coin can easily do 50x from here" });
  assert.throws(() => startTrial(ad.e, 1), /50x".*blocking rule/);
  const hook = await reel({ settings: JSON.stringify({ hookText: "Double your money in 30 days" }) });
  assert.throws(() => startTrial(hook.e, 1), /blocking rule/, "the on-screen test hook is checked too");
  const ok = await reel();
  assert.ok(startTrial(ok.e, 1) > 0);
  // A take with sound but no transcript can't be checked, so it can't go out.
  const { run } = await import("@/db");
  const deaf = await reel();
  run(`UPDATE edits SET transcript = '[]' WHERE id = ?`, [deaf.e]);
  assert.throws(() => startTrial(deaf.e, 1), /couldn't be checked/);
  run(`UPDATE edits SET warnings = '["The file has no sound."]' WHERE id = ?`, [deaf.e]);
  assert.ok(startTrial(deaf.e, 1) > 0, "a take with no sound has no words to check");
});

test("an errored trial that already reached Instagram is retried, never re-posted", async () => {
  const { run, one } = await import("@/db");
  const { startTrial } = await import("@/lib/trials");
  const r = await reel();
  const t = startTrial(r.e, 1);
  run(`UPDATE trials SET status = 'error', container_id = 'cont-1', error = 'already posted, not found' WHERE id = ?`, [t]);
  assert.throws(() => startTrial(r.e, 1), /may already be on Instagram/);
  run(`UPDATE trials SET container_id = NULL WHERE id = ?`, [t]);
  assert.notEqual(startTrial(r.e, 1), t, "no container: a fresh try is fine");
  assert.equal(one<any>(`SELECT COUNT(*) AS n FROM trials WHERE edit_id = ?`, [r.e]).n, 2);
});

test("first trial on an account with no follower numbers: checks followers before posting", async () => {
  const { one } = await import("@/db");
  const { startTrial, postTrial } = await import("@/lib/trials");
  const r = await reel({ followers: null });
  const t = startTrial(r.e, 1);
  meta = (url) => (url.includes("fields=id%2Cusername%2Cfollowers_count") ? { id: "x", username: "x", followers_count: 420 } : {});
  const before = calls.length;
  await postTrial(t, { id: 0, kind: "post_trial", payload: { trialId: t }, attempts: 0 });
  const row = one<any>(`SELECT status, error FROM trials WHERE id = ?`, [t]);
  assert.equal(row.status, "error");
  assert.match(row.error, /420 followers.*Nothing was posted/);
  assert.ok(!calls.slice(before).some((c) => c.url.includes("/media") && c.body && String(c.body).includes("trial_params")), "no reel container was made");
  // Approving again now goes out as a normal reel.
  const again = startTrial(r.e, 1);
  assert.equal(one<any>(`SELECT mode FROM trials WHERE id = ?`, [again]).mode, "regular");
});

test("fixing caption words: anyone can fix a mishearing; taking out flagged words needs an owner or admin", async () => {
  const { blocksRemoved, cutCheck } = await import("@/lib/edits");
  const before = cutCheck({ transcript: JSON.stringify([{ w: "guaranteed" }, { w: "returns" }]) }, "crypto");
  const after = cutCheck({ transcript: JSON.stringify([{ w: "great" }, { w: "returns" }]) }, "crypto");
  assert.equal(blocksRemoved(before, after).length, 1);
  assert.equal(blocksRemoved(after, after).length, 0);
});

test("comment-to-DM: re-reads the keyword per comment, refuses rules with no switch-on time, never DMs the same comment twice", async () => {
  const { run, one, raw, now } = await import("@/db");
  const { seal } = await import("@/lib/secure");
  const { saveDmRule, switchDmRule, sendPendingDms } = await import("@/lib/comments");
  const sp = Number(run(`INSERT INTO speakers (slug, name, niche, program_url, created_at) VALUES ('dm','Dm','crypto','https://example.com/w',?)`, [now()]).lastInsertRowid);
  const acc = Number(run(`INSERT INTO accounts (speaker_id, platform, handle, status, external_id, token_enc, meta, created_at) VALUES (?, 'instagram', 'dm', 'connected', 'igdm', ?, '{}', ?)`, [sp, seal("tok"), now()]).lastInsertRowid);
  const { id } = saveDmRule({ speakerId: sp, keyword: "CLASS", message: "Here you go: {link}" }, 1);
  switchDmRule(id, true, 1);
  // Saving with nothing changed keeps it on.
  const same = saveDmRule({ id, speakerId: sp, keyword: "class", message: "Here you go: {link}" }, 1) as any;
  assert.equal(same.unchanged, true);
  assert.equal(one<any>(`SELECT status FROM dm_rules WHERE id = ?`, [id]).status, "on");

  const add = (ext: string, from: string) => run(`INSERT INTO comments (account_id, media_id, external_id, username, from_id, text, commented_at, needs_reply, created_at) VALUES (?, 'm', ?, ?, ?, 'CLASS', ?, 0, ?)`, [acc, ext, from, from, new Date(Date.now() + 1000).toISOString(), now()]);
  add("k1", "p1");
  add("k2", "p2");
  meta = (url) => {
    // Someone switches the keyword off while the first DM is going out.
    if (url.includes("/messages")) run(`UPDATE dm_rules SET status = 'off' WHERE id = ?`, [id]);
    return { recipient_id: "r", message_id: "m" };
  };
  await sendPendingDms(acc);
  const st = Object.fromEntries(raw<any>(`SELECT external_id, dm_status FROM comments WHERE account_id = ?`, [acc]).map((r) => [r.external_id, r.dm_status]));
  assert.deepEqual(st, { k1: "sent", k2: "no_match" }, "switched off mid-batch: the next comment gets nothing");

  // A rule marked on with no switch-on time (seed or hand edit) sends nothing.
  run(`UPDATE dm_rules SET status = 'on', approved_at = NULL WHERE id = ?`, [id]);
  add("k3", "p3");
  await sendPendingDms(acc);
  assert.equal(one<any>(`SELECT dm_status FROM comments WHERE external_id = 'k3'`).dm_status, "skipped");

  // A comment already claimed by another read is left alone.
  run(`UPDATE dm_rules SET approved_at = ? WHERE id = ?`, [new Date(Date.now() - 60e3).toISOString(), id]);
  add("k4", "p4");
  run(`UPDATE comments SET dm_status = 'sending' WHERE external_id = 'k4'`);
  const n = calls.filter((c) => c.url.includes("/messages")).length;
  await sendPendingDms(acc);
  assert.equal(calls.filter((c) => c.url.includes("/messages")).length, n);
});

test("approvals refuse words that changed since the page was opened", async () => {
  const { sameAsSeen, dmRuleSeen } = await import("@/lib/seen");
  const r = { keyword: "CLASS", message: "Old words", public_reply: null };
  const shown = dmRuleSeen(r);
  assert.doesNotThrow(() => sameAsSeen(shown, dmRuleSeen(r)));
  assert.throws(() => sameAsSeen(shown, dmRuleSeen({ ...r, message: "New words" })), /changed since you opened/);
});

test("a long session keeps its first recording; a long cut needs a readable transcript", async () => {
  const { run, one, now } = await import("@/db");
  const { attachRecording, runLongform } = await import("@/lib/sessions");
  const sp = Number(run(`INSERT INTO speakers (slug, name, niche, created_at) VALUES ('ls','Ls','finance_trading',?)`, [now()]).lastInsertRowid);
  const se = Number(run(`INSERT INTO sessions (speaker_id, kind, title, status, created_by, created_at, updated_at) VALUES (?, 'talk', 'T', 'waiting', 1, ?, ?)`, [sp, now(), now()]).lastInsertRowid);
  assert.equal(attachRecording(se, "raw/a.mp4", "a.mp4", 10, 60), true);
  assert.equal(attachRecording(se, "raw/b.mp4", "b.mp4", 10, 60), false);
  assert.equal(one<any>(`SELECT raw_path FROM sessions WHERE id = ?`, [se]).raw_path, "raw/a.mp4");
  run(`UPDATE sessions SET words_path = 'sessions/missing.json' WHERE id = ?`, [se]);
  const lf = Number(run(`INSERT INTO longforms (session_id, speaker_id, status, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?)`, [se, sp, now(), now()]).lastInsertRowid);
  await assert.rejects(runLongform(lf), /transcript couldn't be read/);
  assert.equal(one<any>(`SELECT status FROM longforms WHERE id = ?`, [lf]).status, "error");
});

test("restart: only posting work that had started is flagged; work still in the queue just runs", async () => {
  const { run, one, now } = await import("@/db");
  const { releaseAllOnStart, enqueue } = await import("@/lib/jobs");
  const acc = one<any>(`SELECT id FROM accounts WHERE external_id = 'igdm'`).id;
  const mk = (ext: string) => Number(run(`INSERT INTO comments (account_id, media_id, external_id, text, commented_at, needs_reply, reply_status, reply_text, created_at) VALUES (?, 'm', ?, 'q?', ?, 1, 'posting', 'hi', ?)`, [acc, ext, now(), now()]).lastInsertRowid);
  const waiting = mk("r1");
  const midway = mk("r2");
  enqueue("post_reply", { commentId: waiting });
  const j = enqueue("post_reply", { commentId: midway });
  run(`UPDATE jobs SET status = 'running' WHERE id = ?`, [j]);
  run(`UPDATE comments SET dm_status = 'sending' WHERE external_id = 'k4'`);
  releaseAllOnStart();
  assert.equal(one<any>(`SELECT reply_status FROM comments WHERE id = ?`, [waiting]).reply_status, "posting", "never started: left to run");
  assert.equal(one<any>(`SELECT reply_status FROM comments WHERE id = ?`, [midway]).reply_status, "error", "mid-way: a person checks");
  assert.equal(one<any>(`SELECT dm_status FROM comments WHERE external_id = 'k4'`).dm_status, "failed");
});

test("edit lists show every hook-test variant, not just the newest cut of the video", async () => {
  const { run, raw, now } = await import("@/db");
  const { LATEST_CUT } = await import("@/lib/edits");
  const r = await reel();
  const v1 = Number(run(`INSERT INTO edits (video_id, script_id, settings, status, variant_of, created_at, updated_at) VALUES (?, ?, ?, 'ready', ?, ?, ?)`, [r.v, r.s, JSON.stringify({ hookText: "Other hook" }), r.e, now(), now()]).lastInsertRowid);
  const v1b = Number(run(`INSERT INTO edits (video_id, script_id, settings, status, variant_of, created_at, updated_at) VALUES (?, ?, ?, 'ready', ?, ?, ?)`, [r.v, r.s, JSON.stringify({ hookText: "Other hook" }), r.e, now(), now()]).lastInsertRowid);
  const ids = raw<{ id: number }>(`SELECT e.id FROM edits e WHERE e.video_id = ? AND ${LATEST_CUT} ORDER BY e.id`, [r.v]).map((x) => x.id);
  assert.deepEqual(ids, [r.e, v1b], "the first cut and the newest version of the variant");
  assert.ok(!ids.includes(v1));
});

test("long video: fluent speech with no full stops loses only the flagged words; wording notes stay in; the speaker's own warnings stay in", async () => {
  const { flagRanges, removalPlan, planRemoval } = await import("@/lib/sessions");
  // 24 seconds, no punctuation, no pauses — one "sentence".
  const said = "dekho bhai market mein bahut log aate hain aur sochte hain ki jaldi paisa banega lekin main aapko bataata hoon yeh coin pakka profit dega aur phir aap dekhoge ki kaise sab log isko follow karte hain aur seekhte hain";
  const words = said.split(" ").map((w, i) => ({ w, s: +(i * 0.6).toFixed(2), e: +(i * 0.6 + 0.45).toFixed(2) }));
  const r = flagRanges(words, "crypto");
  assert.equal(r.length, 1);
  assert.ok(r[0].e - r[0].s <= 8, `cut ${r[0].e - r[0].s}s, not the whole 24s`);
  assert.match(r[0].text, /pakka profit/);
  // "Koi bhi guarantee nahi de sakta" is the speaker's own warning: not flagged at all.
  const warn = "Koi bhi guarantee nahi de sakta. Isliye risk samjho.".split(" ").map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 }));
  assert.equal(flagRanges(warn, "crypto").length, 0);
  // "Cryptocurrency" is a wording note: listed, not cut.
  const soft = "Cryptocurrency is a new kind of asset. Learn how it works.".split(" ").map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 }));
  const f = flagRanges(soft, "crypto");
  assert.equal(f.length, 1);
  assert.equal(f[0].soft, true);
  assert.equal(removalPlan(f, []).length, 0);
  assert.equal(planRemoval(soft, "crypto", null, null, []).length, 0);
});
