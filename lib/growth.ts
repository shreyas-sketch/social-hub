import { raw, one, run, now, json, istDay, daysAgo } from "@/db";
import { setting } from "@/lib/config";
import { audit } from "@/lib/secure";
import { accountFor } from "@/lib/accounts";
import { median } from "@/lib/learn";
import { speaker as getSpeaker, type Speaker } from "@/lib/speakers";

/**
 * Growth pace: where each account is against its follower target, and the numbers that drive it —
 * follows per 1,000 views, how much of the views come from the top 10% of posts, trial win rate,
 * and clicks and webinar sign-ups per 1,000 views. Every input in the "1M followers" maths was an assumption;
 * these are the speaker's own numbers to redo it with.
 */
export const GROWTH_PLATFORMS = ["instagram", "youtube", "linkedin", "facebook", "x"] as const;
export type GrowthPlatform = (typeof GROWTH_PLATFORMS)[number];

export type Target = { followers: number; by: string };

export function targetsFor(sp: Pick<Speaker, "targets">): Record<GrowthPlatform, Target> {
  const j = json<Partial<Record<GrowthPlatform, Partial<Target>>>>(sp.targets, {});
  const def: Target = { followers: Number(setting("growth_target_followers")) || 1_000_000, by: setting("growth_target_date") || "2029-11-30" };
  const out = {} as Record<GrowthPlatform, Target>;
  for (const p of GROWTH_PLATFORMS) {
    const t = j[p] || {};
    out[p] = { followers: Number(t.followers) > 0 ? Number(t.followers) : def.followers, by: /^\d{4}-\d{2}-\d{2}$/.test(String(t.by || "")) ? String(t.by) : def.by };
  }
  return out;
}

export function saveTargets(speakerId: number, values: Partial<Record<GrowthPlatform, Target>>, userId: number) {
  for (const [p, t] of Object.entries(values)) {
    if (!t) continue;
    if (!(t.followers > 0)) throw new Error(`${p}: the target must be a number above 0.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.by) || t.by <= istDay()) throw new Error(`${p}: pick a date in the future.`);
  }
  run(`UPDATE speakers SET targets = ? WHERE id = ?`, [JSON.stringify(values), speakerId]);
  audit(userId, "edit_targets", "speaker", speakerId, values);
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
const istDaysAgo = (n: number) => istDay(new Date(Date.now() - n * 864e5));

function statOnOrBefore(accountId: number, day: string) {
  return one<{ day: string; followers: number }>(`SELECT day, followers FROM account_stats WHERE account_id = ? AND day <= ? AND followers IS NOT NULL ORDER BY day DESC LIMIT 1`, [accountId, day]);
}

/** Net new followers a day between two readings (measured), or null when there aren't two readings yet. */
function perDay(accountId: number, latest: { day: string; followers: number } | undefined, back: number) {
  if (!latest) return null;
  const then = statOnOrBefore(accountId, istDaysAgo(back)) || one<{ day: string; followers: number }>(`SELECT day, followers FROM account_stats WHERE account_id = ? AND followers IS NOT NULL AND day >= ? ORDER BY day LIMIT 1`, [accountId, istDaysAgo(back)]);
  if (!then || then.day >= latest.day) return null;
  return { rate: (latest.followers - then.followers) / dayDiff(latest.day, then.day), days: dayDiff(latest.day, then.day), gain: latest.followers - then.followers };
}

export type Pace = {
  platform: GrowthPlatform;
  followers: number | null;
  day: string | null;
  target: Target;
  net7: number | null;
  net30: number | null;
  window30: number | null;
  gain30: number | null;
  needPerDay: number | null;
  ratio: number | null;
  eta: string | null;
};

/** One platform's position against its target. */
export function pace(sp: Speaker, platform: GrowthPlatform, today = istDay()): Pace {
  const target = targetsFor(sp)[platform];
  const acc = accountFor(sp.id, platform);
  const latest = acc ? one<{ day: string; followers: number }>(`SELECT day, followers FROM account_stats WHERE account_id = ? AND followers IS NOT NULL ORDER BY day DESC LIMIT 1`, [acc.id]) : undefined;
  const w7 = acc ? perDay(acc.id, latest, 7) : null;
  const w30 = acc ? perDay(acc.id, latest, 30) : null;
  const left = Math.max(1, dayDiff(target.by, today));
  const need = latest ? Math.max(0, (target.followers - latest.followers) / left) : null;
  const rate = w30?.rate ?? null;
  const eta = latest && rate && rate > 0 ? new Date(Date.parse(`${today}T00:00:00Z`) + Math.ceil((target.followers - latest.followers) / rate) * 864e5).toISOString().slice(0, 10) : null;
  return {
    platform,
    followers: latest?.followers ?? null,
    day: latest?.day ?? null,
    target,
    net7: w7?.rate ?? null,
    net30: rate,
    window30: w30?.days ?? null,
    gain30: w30?.gain ?? null,
    needPerDay: need,
    ratio: need && rate != null ? rate / need : null,
    eta: latest && latest.followers >= target.followers ? "reached" : eta,
  };
}

/** Views, and how concentrated they are, for posts published in the window. */
export function viewStats(speakerId: number, platform?: GrowthPlatform, days = 30) {
  const rows = raw<{ views: number }>(
    `SELECT p.views FROM posts p JOIN accounts a ON a.id = p.account_id
     WHERE a.speaker_id = ? ${platform ? "AND a.platform = ?" : ""} AND p.views IS NOT NULL AND p.published_at >= ?`,
    platform ? [speakerId, platform, daysAgo(days)] : [speakerId, daysAgo(days)],
  );
  const views = rows.map((r) => r.views || 0);
  const total = views.reduce((a, b) => a + b, 0);
  const sorted = [...views].sort((a, b) => b - a);
  const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 10))).reduce((a, b) => a + b, 0);
  return { posts: views.length, total, median: median(views), top10Share: total > 0 && views.length >= 5 ? top / total : null };
}

/** Everything on one speaker's Growth card. */
export function growthCard(sp: Speaker) {
  const platforms = GROWTH_PLATFORMS.map((p) => pace(sp, p));
  const ig = platforms.find((p) => p.platform === "instagram")!;
  const igViews = viewStats(sp.id, "instagram");
  const allViews = viewStats(sp.id);
  const since = daysAgo(30);
  const decided = raw<{ verdict: string }>(
    `SELECT t.verdict FROM trials t JOIN accounts a ON a.id = t.account_id WHERE a.speaker_id = ? AND t.verdict IN ('winner','not_winner') AND COALESCE(t.verdict_at, t.updated_at) >= ?`,
    [sp.id, since],
  );
  const clicks = one<{ n: number }>(`SELECT COUNT(*) AS n FROM link_clicks k JOIN links l ON l.code = k.code WHERE l.speaker_id = ? AND k.at >= ?`, [sp.id, since])?.n ?? 0;
  const signups = one<{ n: number }>(`SELECT COALESCE(SUM(count), 0) AS n FROM signups WHERE speaker_id = ? AND day >= ?`, [sp.id, istDaysAgo(30)])?.n ?? 0;
  const dms = one<{ n: number }>(`SELECT COUNT(*) AS n FROM comments c JOIN accounts a ON a.id = c.account_id WHERE a.speaker_id = ? AND c.dm_status IN ('sent','dry_run') AND c.dm_at >= ?`, [sp.id, since])?.n ?? 0;
  const per1k = (x: number, v: number) => (v > 0 ? (x / v) * 1000 : null);
  return {
    platforms,
    // Approximate: net followers gained over the window ÷ views of the posts published in it.
    followsPer1k: ig.gain30 != null && igViews.total > 0 ? (ig.gain30 / igViews.total) * 1000 : null,
    igViews,
    allViews,
    trials: decided.length,
    winRate: decided.length ? decided.filter((d) => d.verdict === "winner").length / decided.length : null,
    clicks,
    clicksPer1k: per1k(clicks, allViews.total),
    signups,
    signupsPer1k: per1k(signups, allViews.total),
    dms,
  };
}

/** Followers at the end of each of the last N IST weeks, per platform (for the chart). */
export function weeklyFollowers(speakerId: number, weeks = 12) {
  const ends = Array.from({ length: weeks }, (_, i) => istDaysAgo((weeks - 1 - i) * 7));
  const series: { platform: GrowthPlatform; values: (number | null)[] }[] = [];
  for (const p of GROWTH_PLATFORMS) {
    const acc = accountFor(speakerId, p);
    if (!acc) continue;
    const values = ends.map((d) => statOnOrBefore(acc.id, d)?.followers ?? null);
    if (values.some((v) => v != null)) series.push({ platform: p, values });
  }
  return { ends, series };
}

/* ───────── sign-ups ───────── */

export type SignupIn = { utm_id?: string; utm_content?: string; utm_term?: string; utm_source?: string; day?: string; count?: number; ref?: string };

/** Sign-ups sent by the webinar side (or typed in), matched to a speaker and, where the link says so, to the reel. */
export function addSignups(items: SignupIn[], origin: "api" | "manual", userId: number | null) {
  let added = 0;
  const skipped: string[] = [];
  for (const it of items.slice(0, 500)) {
    const link = it.utm_id ? one<any>(`SELECT code, speaker_id FROM links WHERE code = ?`, [String(it.utm_id)]) : null;
    const sp = link ? { id: link.speaker_id } : it.utm_term ? one<any>(`SELECT id FROM speakers WHERE slug = ?`, [String(it.utm_term)]) : null;
    if (!sp) {
      skipped.push(it.ref || it.utm_id || it.utm_term || "a row with no speaker");
      continue;
    }
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(it.day || "")) ? String(it.day) : istDay();
    const count = Math.max(1, Math.min(10000, Math.round(Number(it.count) || 1)));
    const r = run(
      `INSERT INTO signups (speaker_id, day, platform, content, link_code, count, origin, external_ref, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(origin, external_ref) DO NOTHING`,
      [sp.id, day, it.utm_source || null, it.utm_content || null, link?.code || null, count, origin, it.ref ? String(it.ref).slice(0, 120) : null, userId, now()],
    );
    if (r.changes) added++;
    else skipped.push(`${it.ref} (already counted)`);
  }
  return { added, skipped };
}

/* ───────── paid boosts (logged by hand from Ads Manager) ───────── */

export type BoostIn = { speakerId: number; trialId?: number | null; platform: string; startedOn: string; endedOn?: string | null; spend: number; audience?: string | null; follows?: number | null; clicks?: number | null; signups?: number | null; notes?: string | null };

export function saveBoost(b: BoostIn & { id?: number }, userId: number) {
  if (!getSpeaker(b.speakerId)) throw new Error("Pick a speaker.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.startedOn)) throw new Error("Pick the start date.");
  if (b.endedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(b.endedOn) || b.endedOn < b.startedOn)) throw new Error("The end date must be on or after the start.");
  if (!(b.spend >= 0)) throw new Error("Type what was spent, in rupees.");
  const vals = [b.speakerId, b.trialId || null, ["instagram", "facebook"].includes(b.platform) ? b.platform : "instagram", b.startedOn, b.endedOn || null, b.spend, b.audience?.trim() || null, b.follows ?? null, b.clicks ?? null, b.signups ?? null, b.notes?.trim() || null];
  if (b.id) {
    run(`UPDATE boosts SET speaker_id = ?, trial_id = ?, platform = ?, started_on = ?, ended_on = ?, spend_inr = ?, audience = ?, follows = ?, clicks = ?, signups = ?, notes = ?, updated_at = ? WHERE id = ?`, [...vals, now(), b.id]);
    audit(userId, "edit_boost", "boost", b.id);
    return b.id;
  }
  const r = run(`INSERT INTO boosts (speaker_id, trial_id, platform, started_on, ended_on, spend_inr, audience, follows, clicks, signups, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...vals, userId, now(), now()]);
  audit(userId, "add_boost", "boost", Number(r.lastInsertRowid));
  return Number(r.lastInsertRowid);
}

export function boostRows() {
  return raw<any>(
    `SELECT b.*, sp.name AS speaker, s.title AS reel FROM boosts b JOIN speakers sp ON sp.id = b.speaker_id
     LEFT JOIN trials t ON t.id = b.trial_id LEFT JOIN edits e ON e.id = t.edit_id LEFT JOIN scripts s ON s.id = e.script_id
     ORDER BY b.started_on DESC, b.id DESC LIMIT 100`,
  ).map((b) => {
    const acc = accountFor(b.speaker_id, b.platform);
    const before = acc ? statOnOrBefore(acc.id, b.started_on) : undefined;
    const after = acc && b.ended_on ? statOnOrBefore(acc.id, b.ended_on) : undefined;
    return {
      ...b,
      // Measured, but includes followers who came without the ad.
      followerChange: before && after && after.day > before.day ? after.followers - before.followers : null,
      perFollow: b.follows ? b.spend_inr / b.follows : null,
      perClick: b.clicks ? b.spend_inr / b.clicks : null,
      perSignup: b.signups ? b.spend_inr / b.signups : null,
    };
  });
}
