import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-hub-brief-"));
process.env.DRY_RUN = ""; // the tests stand in for the platforms themselves
process.env.DB_FILE = path.join(dir, "t.db");
process.env.ANTHROPIC_API_KEY = "test";

test("morning scripts: lanes, rules check, one automatic rewrite of a blocked script", async () => {
  const { run, now, raw } = await import("@/db");
  const { writeBrief } = await import("@/lib/scripts");
  const lanes = [
    { key: "psy", name: "Psychology", desc: "", share: 70 },
    { key: "lead", name: "Leadership", desc: "", share: 30 },
  ];
  const sp = Number(
    run(`INSERT INTO speakers (slug, name, niche, lanes, stop_list, created_at) VALUES ('a','Aarzoo','finance_trading',?, '["no tips"]', ?)`, [JSON.stringify(lanes), now()]).lastInsertRowid,
  );

  const prompts: string[] = [];
  let repairs = 0;
  const draft = (over: Record<string, unknown>) => ({
    lane: "psy", hook_type: "myth", format: "talking_head", title: "T", hook: "Why your brain does this", body: "Line one\nLine two",
    cta: "Follow for part 2", on_screen: [{ t: 0, text: "Hook" }], caption: "Caption", hashtags: "#a #b", length_sec: 40, why: "because", inspired_by: null, ...over,
  });
  (globalThis as any).fetch = async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    prompts.push(body.messages[0].content);
    const isRepair = body.messages[0].content.includes("breaks these rules");
    if (isRepair) repairs++;
    // The first rewrite still breaks a rule; the second one fixes it.
    const payload = isRepair
      ? repairs === 1
        ? draft({ lane: "lead", title: "Still bad", hook: "This stock could jump 20% soon" })
        : draft({ lane: "lead", title: "Fixed", hook: "How to judge any tip before you act" })
      : [draft({}), draft({ title: "Second", hook_type: "question" }), draft({ lane: "lead", title: "Bad", hook: "This stock could jump 33% next week" })];
    return new Response(JSON.stringify({ model: "claude-test", content: [{ type: "text", text: "Here you go:\n```json\n" + JSON.stringify(payload) + "\n```" }], usage: {} }), { status: 200 });
  };

  const ids = await writeBrief(sp, "2026-11-05");
  assert.equal(ids.length, 3);
  assert.match(prompts[0], /WRITE 3 SCRIPTS/);
  assert.match(prompts[0], /1\. lane "psy"[^\n]*\n2\. lane "psy"[^\n]*\n3\. lane "lead"/);
  assert.match(prompts[0], /no tips/);
  assert.equal(prompts.length, 3, "two rewrite calls: the first rewrite still broke a rule");
  assert.match(prompts[2], /rewrite 2 of 3/);
  const rows = raw<any>(`SELECT title, lane, status, compliance FROM scripts ORDER BY id`);
  assert.deepEqual(rows.map((r) => r.title), ["T", "Second", "Fixed"]);
  assert.ok(rows.every((r) => r.status === "proposed"));
  assert.equal(JSON.parse(rows[2].compliance).status, "ok");
  assert.match(raw<any>(`SELECT notes FROM scripts WHERE title = 'Fixed'`)[0].notes, /2 times/);
  assert.equal(raw<any>(`SELECT status, model FROM briefs`)[0].status, "ready");
});

test("a script that keeps breaking the rules stops after 3 rewrites and stays blocked", async () => {
  const { run, now, raw } = await import("@/db");
  const { writeBrief } = await import("@/lib/scripts");
  const sp = Number(
    run(`INSERT INTO speakers (slug, name, niche, lanes, stop_list, created_at) VALUES ('b','B','crypto','[{"key":"x","name":"X","desc":"","share":100}]','[]', ?)`, [now()]).lastInsertRowid,
  );
  let calls = 0;
  (globalThis as any).fetch = async () => {
    calls++;
    const bad = { lane: "x", hook_type: "myth", format: "talking_head", title: "Always bad", hook: "This coin can do 100x", body: "b", cta: "c", on_screen: [], caption: "c", hashtags: "", length_sec: 30, why: "", inspired_by: null };
    return new Response(JSON.stringify({ model: "m", content: [{ type: "text", text: JSON.stringify(calls === 1 ? [bad] : bad) }] }), { status: 200 });
  };
  await writeBrief(sp, "2026-11-05", 1);
  assert.equal(calls, 4, "1 write + 3 rewrites");
  const row = raw<any>(`SELECT compliance, notes, status FROM scripts WHERE speaker_id = ?`, [sp])[0];
  assert.equal(JSON.parse(row.compliance).status, "block");
  assert.match(row.notes, /after 3 automatic rewrites/);
});
