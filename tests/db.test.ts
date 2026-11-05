import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-hub-test-"));
process.env.DRY_RUN = ""; // the tests stand in for the platforms themselves
process.env.DB_FILE = path.join(dir, "t.db");
process.env.MEDIA_DIR = path.join(dir, "media");
process.env.TOKEN_KEY = "test-key";
process.env.APP_URL = "https://hub.example.com";

test("winner logic, tracking links, tokens, X caption length", async () => {
  const { run, now } = await import("@/db");
  const { decide } = await import("@/lib/trials");
  const { setSetting } = await import("@/lib/config");
  const { makeLink, linkTarget, captionFor, xLength } = await import("@/lib/publish");
  const { signToken, readToken, mediaToken, readMediaToken, seal, unseal } = await import("@/lib/secure");

  const sp = Number(run(`INSERT INTO speakers (slug, name, niche, program_url, created_at) VALUES ('t','Test','crypto','https://example.com/webinar?x=1',?)`, [now()]).lastInsertRowid);
  const acc = Number(run(`INSERT INTO accounts (speaker_id, platform, status, created_at) VALUES (?, 'instagram', 'connected', ?)`, [sp, now()]).lastInsertRowid);
  const mk = (views: number | null, status = "done") => {
    const sc = Number(run(`INSERT INTO scripts (speaker_id, title, hook, body, created_at, updated_at) VALUES (?, 't','h','b',?,?)`, [sp, now(), now()]).lastInsertRowid);
    const v = Number(run(`INSERT INTO videos (script_id, speaker_id, raw_path, created_at) VALUES (?, ?, 'raw/x.mp4', ?)`, [sc, sp, now()]).lastInsertRowid);
    const e = Number(run(`INSERT INTO edits (video_id, script_id, created_at, updated_at) VALUES (?, ?, ?, ?)`, [v, sc, now(), now()]).lastInsertRowid);
    const t = Number(run(`INSERT INTO trials (edit_id, account_id, status, views, posted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [e, acc, status, views, now(), now(), now()]).lastInsertRowid);
    return { sc, t };
  };

  // Too few trials: stays pending, a person decides.
  const first = mk(500, "live");
  decide(first.t, sp, first.sc, 500);
  const { one } = await import("@/db");
  assert.equal(one<any>(`SELECT verdict FROM trials WHERE id = ?`, [first.t]).verdict, "pending");

  for (const v of [1000, 1000, 1000]) mk(v);
  setSetting("winner_multiplier", "1.2");
  const win = mk(1300, "live");
  decide(win.t, sp, win.sc, 1300);
  assert.equal(one<any>(`SELECT verdict FROM trials WHERE id = ?`, [win.t]).verdict, "winner");
  assert.equal(one<any>(`SELECT status FROM scripts WHERE id = ?`, [win.sc]).status, "winner");
  const lose = mk(900, "live");
  decide(lose.t, sp, lose.sc, 900);
  assert.equal(one<any>(`SELECT verdict FROM trials WHERE id = ?`, [lose.t]).verdict, "not_winner");

  // A verdict made by hand is never overwritten by the automatic one.
  const { setVerdict } = await import("@/lib/trials");
  const uid = Number(run(`INSERT INTO users (email, name, password_hash, role, created_at) VALUES ('a@b.c','A','x','owner',?)`, [now()]).lastInsertRowid);
  const hand = mk(100, "live");
  setVerdict(hand.t, "winner", uid);
  decide(hand.t, sp, hand.sc, 100);
  const h = one<any>(`SELECT verdict, verdict_set_by, verdict_at FROM trials WHERE id = ?`, [hand.t]);
  assert.equal(h.verdict, "winner");
  assert.equal(h.verdict_set_by, uid);
  assert.ok(h.verdict_at);
  assert.equal(one<any>(`SELECT status FROM scripts WHERE id = ?`, [hand.sc]).status, "winner");

  // Tracking link keeps the page's own query and adds UTMs; each click counts.
  const code = makeLink(sp, win.sc, "linkedin")!;
  const to = new URL(linkTarget(code)!);
  assert.equal(to.searchParams.get("x"), "1");
  assert.equal(to.searchParams.get("utm_source"), "linkedin");
  assert.equal(to.searchParams.get("utm_content"), `script-${win.sc}`);
  linkTarget(code);
  assert.equal(one<any>(`SELECT clicks FROM links WHERE code = ?`, [code]).clicks, 2);
  // A badly typed webinar page doesn't break links already posted.
  run(`UPDATE links SET target_url = 'mudita.in/webinar' WHERE code = ?`, [code]);
  assert.match(linkTarget(code)!, /^https:\/\/mudita\.in\/webinar\?/);
  assert.equal(linkTarget("nope"), null);

  // Signed tokens: round-trip, tamper, expiry.
  const tok = signToken({ a: 1 }, 1);
  assert.equal(readToken<any>(tok)!.a, 1);
  assert.equal(readToken(tok.slice(0, -2) + "xx"), null);
  assert.equal(readToken(signToken({ a: 1 }, -1)), null);
  assert.equal(readMediaToken(mediaToken("edits/1/reel.mp4")), "edits/1/reel.mp4");
  assert.equal(unseal(seal("secret-token")), "secret-token");

  // X: always within 280 characters, link and disclaimer kept.
  const long = captionFor("x", { hook: "A".repeat(400), screen_disclaimer: "Education only." }, "https://hub.example.com/r/abc");
  assert.ok(xLength(long) <= 280, "X counts links as 23 characters");
  assert.ok(xLength(long) >= 270, "and uses the room it has");
  assert.match(long, /r\/abc/);
  assert.match(long, /Education only\./);
});

test("daily clock queues each day's jobs once", async () => {
  const { run, now, raw } = await import("@/db");
  const { setSetting } = await import("@/lib/config");
  const { dailyTick } = await import("@/lib/daily");
  run(`INSERT INTO speakers (slug, name, niche, created_at) VALUES ('d','D','psychology',?)`, [now()]);
  setSetting("stats_hour_ist", "0");
  setSetting("brief_hour_ist", "0");
  // Make sure today isn't the weekly-agents day, so the test is the same every day of the week.
  const istWeekday = new Date(Date.now() + 5.5 * 3600e3).getUTCDay();
  setSetting("agents_weekday", String((istWeekday + 3) % 7));
  setSetting("comments_poll_minutes", "0");
  assert.deepEqual(dailyTick(), ["numbers + watchlist + trend pool", "scripts"]);
  assert.deepEqual(dailyTick(), []);
  // Comments are read every N minutes, not once a day.
  const { one } = await import("@/db");
  if (one(`SELECT id FROM accounts WHERE platform = 'instagram' AND status = 'connected'`)) {
    setSetting("comments_poll_minutes", "15");
    assert.deepEqual(dailyTick(), ["comments"]);
    assert.deepEqual(dailyTick(), [], "not again within 15 minutes");
  }
  const briefs = raw<any>(`SELECT * FROM jobs WHERE kind = 'write_brief'`);
  assert.equal(briefs.length, 2);
});

test("Meta page picker: a connect link can only connect its own speaker; one Page per speaker", async () => {
  const { run, now, one } = await import("@/db");
  const { seal } = await import("@/lib/secure");
  const { savePicked } = await import("@/lib/oauth");
  const a = Number(run(`INSERT INTO speakers (slug, name, niche, created_at) VALUES ('pa','Pa','crypto',?)`, [now()]).lastInsertRowid);
  const bb = Number(run(`INSERT INTO speakers (slug, name, niche, created_at) VALUES ('pb','Pb','crypto',?)`, [now()]).lastInsertRowid);
  const pages = [
    { id: "p1", name: "Page one", access_token: "t1", ig: { id: "ig1", username: "one" } },
    { id: "p2", name: "Page two", access_token: "t2" },
  ];
  const state = (s: string) => run(`INSERT INTO oauth_states (state, platform, speaker_id, verifier, user_id, created_at) VALUES (?, 'meta', ?, ?, NULL, ?)`, [s, a, seal(JSON.stringify(pages)), now()]);
  state("s1");
  assert.throws(() => savePicked("s1", { p1: bb }, null, false), /only connect its own speaker/);
  assert.throws(() => savePicked("s1", { p1: a, p2: a }, null, true), /same speaker/);
  assert.equal(savePicked("s1", { p1: a }, null, false), 2);
  assert.equal(one<any>(`SELECT handle FROM accounts WHERE speaker_id = ? AND platform = 'instagram'`, [a]).handle, "@one");
  assert.throws(() => savePicked("s1", { p1: a }, null, false), /expired/);
});

test("worker restart: interrupted jobs go back in the queue, half-done posts wait for a person", async () => {
  const { run, now, one } = await import("@/db");
  const { releaseAllOnStart } = await import("@/lib/jobs");
  const j = Number(run(`INSERT INTO jobs (kind, payload, status, attempts, run_after, created_at, updated_at) VALUES ('publish','{}','running',1,?,?,?)`, [now(), now(), now()]).lastInsertRowid);
  const sp = Number(run(`INSERT INTO speakers (slug, name, niche, created_at) VALUES ('rs','R','crypto',?)`, [now()]).lastInsertRowid);
  const acc = Number(run(`INSERT INTO accounts (speaker_id, platform, status, created_at) VALUES (?, 'x', 'connected', ?)`, [sp, now()]).lastInsertRowid);
  const sc = Number(run(`INSERT INTO scripts (speaker_id, title, hook, body, created_at, updated_at) VALUES (?, 't','h','b',?,?)`, [sp, now(), now()]).lastInsertRowid);
  const v = Number(run(`INSERT INTO videos (script_id, speaker_id, raw_path, created_at) VALUES (?, ?, 'raw/x.mp4', ?)`, [sc, sp, now()]).lastInsertRowid);
  const e = Number(run(`INSERT INTO edits (video_id, script_id, created_at, updated_at) VALUES (?, ?, ?, ?)`, [v, sc, now(), now()]).lastInsertRowid);
  const pb = Number(run(`INSERT INTO publishes (edit_id, account_id, platform, status, created_at, updated_at) VALUES (?, ?, 'x', 'running', ?, ?)`, [e, acc, now(), now()]).lastInsertRowid);
  releaseAllOnStart();
  assert.equal(one<any>(`SELECT status FROM jobs WHERE id = ?`, [j]).status, "queued");
  const p = one<any>(`SELECT status, error FROM publishes WHERE id = ?`, [pb]);
  assert.equal(p.status, "error");
  assert.match(p.error, /Interrupted/);
});
