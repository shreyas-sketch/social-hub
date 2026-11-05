import { raw, json } from "@/db";

export type Row = { group: string; value: string; trials: number; medianViews: number; winRate: number; medianWatchPct: number | null; medianSkip: number | null; medianSends: number | null };

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export function lengthBucket(sec: number | null | undefined) {
  if (!sec) return "unknown";
  if (sec < 30) return "under 30s";
  if (sec < 45) return "30–45s";
  if (sec < 60) return "45–60s";
  return "60s+";
}

/** Finished trials for a speaker, with everything we might group them by. */
export function finishedTrials(speakerId: number) {
  return raw<any>(
    `SELECT t.id, t.views, t.avg_watch_ms, t.verdict, t.skip_rate, t.reach, t.shares, e.duration, e.settings, s.lane, s.hook_type, s.format, s.title, s.hook
     FROM trials t JOIN edits e ON e.id = t.edit_id JOIN scripts s ON s.id = e.script_id
     WHERE s.speaker_id = ? AND t.status = 'done' AND t.views IS NOT NULL
     ORDER BY t.posted_at DESC LIMIT 400`,
    [speakerId],
  );
}

/** Ranks what has worked for one speaker: lanes, hook types, lengths, caption styles, formats. */
export function rankings(speakerId: number): Row[] {
  const trials = finishedTrials(speakerId);
  const groups: Record<string, (t: any) => string> = {
    lane: (t) => t.lane || "—",
    hook: (t) => t.hook_type || "—",
    length: (t) => lengthBucket(t.duration),
    captions: (t) => json<any>(t.settings, {}).captionStyle || "—",
    format: (t) => t.format || "—",
  };
  const out: Row[] = [];
  for (const [group, key] of Object.entries(groups)) {
    const buckets = new Map<string, any[]>();
    for (const t of trials) {
      const k = key(t);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(t);
    }
    for (const [value, ts] of buckets) {
      const watch = ts.filter((t) => t.avg_watch_ms && t.duration).map((t) => (t.avg_watch_ms / 1000 / t.duration) * 100);
      const skip = ts.filter((t) => t.skip_rate != null).map((t) => t.skip_rate);
      const sends = ts.filter((t) => t.reach > 0 && t.shares != null).map((t) => (t.shares / t.reach) * 10000);
      out.push({
        group,
        value,
        trials: ts.length,
        medianViews: median(ts.map((t) => t.views || 0)),
        winRate: ts.filter((t) => t.verdict === "winner").length / ts.length,
        medianWatchPct: watch.length ? Math.round(median(watch)) : null,
        medianSkip: skip.length ? Math.round(median(skip)) : null,
        medianSends: sends.length ? median(sends) / 10 : null,
      });
    }
  }
  return out.sort((a, b) => (a.group === b.group ? b.medianViews - a.medianViews : a.group.localeCompare(b.group)));
}

/**
 * Median trial views for the speaker — the bar a new trial has to beat. Trials are only compared with
 * trials, and normal reels with normal reels (Instagram ranks trial reels separately).
 */
export function baselineViews(speakerId: number, lastN = 20, mode: "trial" | "regular" = "trial"): { median: number; n: number } {
  const rows = raw<{ views: number }>(
    `SELECT t.views FROM trials t JOIN edits e ON e.id = t.edit_id JOIN scripts s ON s.id = e.script_id
     WHERE s.speaker_id = ? AND t.status = 'done' AND t.views IS NOT NULL AND COALESCE(t.mode, 'trial') = ? ORDER BY t.posted_at DESC LIMIT ?`,
    [speakerId, mode, lastN],
  );
  return { median: median(rows.map((r) => r.views)), n: rows.length };
}

/** Median shares per 1,000 reached — Instagram says sends are the strongest signal for reaching non-followers. */
export function baselineSends(speakerId: number, lastN = 20, mode: "trial" | "regular" = "trial"): { median: number; n: number } {
  const rows = raw<{ shares: number; reach: number }>(
    `SELECT t.shares, t.reach FROM trials t JOIN edits e ON e.id = t.edit_id JOIN scripts s ON s.id = e.script_id
     WHERE s.speaker_id = ? AND t.status = 'done' AND t.reach > 0 AND t.shares IS NOT NULL AND COALESCE(t.mode, 'trial') = ?
     ORDER BY t.posted_at DESC LIMIT ?`,
    [speakerId, mode, lastN],
  );
  const rates = rows.map((r) => (r.shares / r.reach) * 1000);
  if (!rates.length) return { median: 0, n: 0 };
  const sorted = [...rates].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2, n: rates.length };
}

/** A short plain-English summary for the script prompt. */
export function learningSummary(speakerId: number): string {
  const rows = rankings(speakerId).filter((r) => r.trials >= 2);
  if (!rows.length) return "No finished trials yet. Spread the hook types so we learn quickly.";
  const lines: string[] = [];
  for (const g of ["lane", "hook", "length", "format"]) {
    const rs = rows.filter((r) => r.group === g);
    if (rs.length < 2) continue;
    const best = rs[0];
    const worst = rs[rs.length - 1];
    lines.push(`${g}: best "${best.value}" (median ${best.medianViews} views, ${best.trials} trials); weakest "${worst.value}" (median ${worst.medianViews}).`);
  }
  return lines.join("\n") || "Too few trials per group to compare yet.";
}

export { median };
