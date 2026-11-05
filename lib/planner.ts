import { raw, one, run, now, json, istDay } from "@/db";
import { setting } from "@/lib/config";
import { audit } from "@/lib/secure";
import { speakers, speaker as getSpeaker, type Speaker } from "@/lib/speakers";

/**
 * The weekly plan: how many posts each speaker should put out on each platform, what's out, what's in the pipe,
 * what's short, and the shoots booked. Buffer's study of 2.1M posts: 10+ posts a week grew followers about
 * 5× faster than 1–2 a week, and empty weeks hurt — so the planner warns before a week goes empty.
 */
export const CADENCE_KEYS = ["instagram", "youtube", "youtube_long", "facebook", "linkedin", "x"] as const;
export type CadenceKey = (typeof CADENCE_KEYS)[number];
export const CADENCE_LABEL: Record<CadenceKey, string> = {
  instagram: "Instagram reels",
  youtube: "YouTube Shorts",
  youtube_long: "YouTube long videos",
  facebook: "Facebook reels",
  linkedin: "LinkedIn posts",
  x: "X posts",
};
/** The research plan's weekly targets per speaker (change them per speaker on the Planner page). */
export const DEFAULT_CADENCE: Record<CadenceKey, number> = { instagram: 14, youtube: 7, youtube_long: 1, facebook: 7, linkedin: 5, x: 7 };

export function cadenceFor(sp: Pick<Speaker, "cadence">): Record<CadenceKey, number> {
  const j = json<Partial<Record<CadenceKey, number>>>(sp.cadence, {});
  const out = { ...DEFAULT_CADENCE };
  for (const k of CADENCE_KEYS) if (j[k] !== undefined && Number.isFinite(Number(j[k]))) out[k] = Math.max(0, Math.min(70, Math.round(Number(j[k]))));
  return out;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Monday of the IST week that `day` falls in. */
export function weekStart(day = istDay()) {
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(day, -((wd + 6) % 7));
}

/** The IST week as UTC ISO times, for comparing with stored timestamps. */
export function weekRange(monday: string) {
  return { from: new Date(Date.parse(`${monday}T00:00:00+05:30`)).toISOString(), to: new Date(Date.parse(`${addDays(monday, 7)}T00:00:00+05:30`)).toISOString() };
}

/** What went out this week, per platform (everything the accounts posted, trials and hand posts included). */
export function weekCounts(speakerId: number, monday = weekStart()): Record<CadenceKey, number> {
  const { from, to } = weekRange(monday);
  const rows = raw<{ platform: string; media_type: string | null; n: number }>(
    `SELECT a.platform, p.media_type, COUNT(*) AS n FROM posts p JOIN accounts a ON a.id = p.account_id
     WHERE a.speaker_id = ? AND p.published_at >= ? AND p.published_at < ? GROUP BY a.platform, p.media_type`,
    [speakerId, from, to],
  );
  const out: Record<CadenceKey, number> = { instagram: 0, youtube: 0, youtube_long: 0, facebook: 0, linkedin: 0, x: 0 };
  for (const r of rows) {
    if (r.platform === "youtube") out[r.media_type === "VIDEO" ? "youtube_long" : "youtube"] += r.n;
    else if ((CADENCE_KEYS as readonly string[]).includes(r.platform)) out[r.platform as CadenceKey] += r.n;
  }
  return out;
}

/** What's on its way: approved scripts and cuts (Instagram), winners not yet sent (the other platforms), approved text posts, long videos in hand. */
export function pipeline(speakerId: number): Record<CadenceKey, number> {
  const n = (sql: string, p: unknown[]) => one<{ n: number }>(sql, p)?.n ?? 0;
  const unsent = (platform: string) =>
    n(
      `SELECT COUNT(*) AS n FROM trials t JOIN edits e ON e.id = t.edit_id JOIN scripts s ON s.id = e.script_id
       WHERE s.speaker_id = ? AND t.verdict = 'winner' AND NOT EXISTS (SELECT 1 FROM publishes p WHERE p.edit_id = t.edit_id AND p.platform = ? AND p.status NOT IN ('error','skipped'))`,
      [speakerId, platform],
    );
  const text = (platform: string) => n(`SELECT COUNT(*) AS n FROM text_posts WHERE speaker_id = ? AND platform = ? AND status IN ('approved','posting')`, [speakerId, platform]);
  return {
    instagram: n(`SELECT COUNT(*) AS n FROM scripts WHERE speaker_id = ? AND status IN ('approved','shot','edited')`, [speakerId]) + n(`SELECT COUNT(*) AS n FROM trials t JOIN accounts a ON a.id = t.account_id WHERE a.speaker_id = ? AND t.status IN ('queued','posting')`, [speakerId]),
    youtube: unsent("youtube"),
    youtube_long: n(`SELECT COUNT(*) AS n FROM longforms WHERE speaker_id = ? AND status IN ('draft','queued','cutting','ready','manual_todo','uploading')`, [speakerId]),
    facebook: unsent("facebook"),
    linkedin: unsent("linkedin") + text("linkedin"),
    x: unsent("x") + text("x"),
  };
}

export type PlanWarning = { tone: "red" | "amber"; text: string };

/** One row per speaker for the Planner page and the Today page's warnings. */
export function planRows(day = istDay()) {
  const monday = weekStart(day);
  const wd = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 Monday … 6 Sunday
  return speakers().map((sp) => {
    const target = cadenceFor(sp);
    const done = weekCounts(sp.id, monday);
    const pipe = pipeline(sp.id);
    const shoots = raw<any>(`SELECT * FROM shoots WHERE speaker_id = ? AND day >= ? AND day <= ? ORDER BY day, time`, [sp.id, monday, addDays(monday, 13)]);
    const ahead = shoots.filter((s) => s.status === "planned" && s.day >= day && s.day <= addDays(day, 7));
    const warnings: PlanWarning[] = [];
    for (const k of CADENCE_KEYS) {
      if (!target[k]) continue;
      const short = target[k] - done[k] - pipe[k];
      // Thursday or later with nothing out and nothing coming: this platform goes a week without a post.
      if (!done[k] && !pipe[k] && wd >= 3) warnings.push({ tone: "red", text: `${CADENCE_LABEL[k]}: nothing out and nothing coming this week.` });
      else if (short > 0 && wd >= 2) warnings.push({ tone: "amber", text: `${CADENCE_LABEL[k]}: ${done[k]} out, ${pipe[k]} coming — ${short} short of ${target[k]}.${k === "instagram" ? ` Approve and shoot about ${short} more scripts.` : ""}` });
    }
    if (!ahead.length) warnings.push({ tone: "amber", text: "No shoot booked in the next 7 days." });
    const longBooked = shoots.some((s) => s.kind === "long_session" && s.status !== "cancelled" && s.status !== "missed");
    const longDone = one(`SELECT id FROM sessions WHERE speaker_id = ? AND created_at >= ?`, [sp.id, weekRange(monday).from]);
    if (!longBooked && !longDone) warnings.push({ tone: "amber", text: "No long session booked this week or next — one a week feeds 10–15 clips and the YouTube video." });
    return { sp, target, done, pipe, shoots, warnings, mix: mixShares(sp.id) };
  });
}

/* ───────── the 70/20/10 mix ───────── */

export type Mix = "core" | "adjacent" | "personal";
export const MIXES: Mix[] = ["core", "adjacent", "personal"];
export const MIX_LABEL: Record<Mix, string> = { core: "core topic", adjacent: "next-door topic", personal: "personal story" };

export function mixTarget(): Record<Mix, number> {
  const [c, a, p] = setting("mix_target").split("/").map(Number);
  const ok = [c, a, p].every((x) => Number.isFinite(x) && x >= 0) && c + a + p > 0;
  return ok ? { core: c, adjacent: a, personal: p } : { core: 70, adjacent: 20, personal: 10 };
}

export function mixShares(speakerId: number, days = 28) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const rows = raw<{ mix: string | null; n: number }>(`SELECT mix, COUNT(*) AS n FROM scripts WHERE speaker_id = ? AND created_at >= ? AND status <> 'rejected' GROUP BY mix`, [speakerId, since]);
  const out = { core: 0, adjacent: 0, personal: 0, total: 0 };
  for (const r of rows) {
    const k = (MIXES as string[]).includes(r.mix || "") ? (r.mix as Mix) : "core";
    out[k] += r.n;
    out.total += r.n;
  }
  return out;
}

/**
 * Which kind each of today's n scripts should be, so the last four weeks move towards 70/20/10
 * (Hormozi: broad content raised views but not sales; he keeps 70% core, 20% adjacent, 10% personal).
 */
export function mixPlan(speakerId: number, n: number): Mix[] {
  const have = mixShares(speakerId);
  const t = mixTarget();
  const sum = t.core + t.adjacent + t.personal;
  const counts = { core: have.core, adjacent: have.adjacent, personal: have.personal };
  const out: Mix[] = [];
  for (let i = 0; i < n; i++) {
    const total = counts.core + counts.adjacent + counts.personal + 1;
    // The kind furthest below its share (after adding this one) goes next; ties go to core.
    const pick = MIXES.map((m) => ({ m, gap: (t[m] / sum) * total - counts[m] })).sort((a, b) => b.gap - a.gap || MIXES.indexOf(a.m) - MIXES.indexOf(b.m))[0].m;
    out.push(pick);
    counts[pick]++;
  }
  return out;
}

/* ───────── shoots ───────── */

export function addShoot(o: { speakerId: number; kind: string; day: string; time?: string; place?: string; notes?: string }, userId: number) {
  if (!getSpeaker(o.speakerId)) throw new Error("Pick a speaker.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.day)) throw new Error("Pick a date.");
  if (o.time && !/^\d{2}:\d{2}$/.test(o.time)) throw new Error("Time as HH:MM.");
  const kind = o.kind === "long_session" ? "long_session" : "teleprompter";
  const r = run(`INSERT INTO shoots (speaker_id, kind, day, time, place, notes, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)`, [
    o.speakerId, kind, o.day, o.time || null, o.place?.trim().slice(0, 120) || null, o.notes?.trim().slice(0, 300) || null, userId, now(), now(),
  ]);
  audit(userId, "add_shoot", "shoot", Number(r.lastInsertRowid));
  return Number(r.lastInsertRowid);
}

export function setShootStatus(id: number, status: string, userId: number) {
  if (!["planned", "done", "missed", "cancelled"].includes(status)) throw new Error("Unknown status");
  run(`UPDATE shoots SET status = ?, updated_at = ? WHERE id = ?`, [status, now(), id]);
  audit(userId, `shoot_${status}`, "shoot", id);
}

export function saveCadence(speakerId: number, values: Partial<Record<CadenceKey, number>>, userId: number) {
  const clean: Partial<Record<CadenceKey, number>> = {};
  for (const k of CADENCE_KEYS) {
    const v = values[k];
    if (v === undefined) continue;
    if (!Number.isFinite(v) || v < 0 || v > 70) throw new Error(`${CADENCE_LABEL[k]}: a number from 0 to 70 a week.`);
    clean[k] = Math.round(v);
  }
  run(`UPDATE speakers SET cadence = ? WHERE id = ?`, [JSON.stringify(clean), speakerId]);
  audit(userId, "edit_cadence", "speaker", speakerId, clean);
}

export { addDays };
