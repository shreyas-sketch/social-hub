import { raw, one, run, now, iso, daysAgo } from "@/db";
import { parseCreator, type ParsedCreator } from "@/lib/refs";
import { readCreator } from "@/lib/creators";

/**
 * Creators watched for everyone, not for one speaker:
 *  trend   — popular creators outside our niches, for formats and hooks that are breaking out
 *  teacher — people who teach what's working on social media right now
 * Read every morning with the speakers' watchlists. The Trend Scout and Playbook Coach agents read these.
 */
export type WatchKind = "trend" | "teacher";
export const WATCH_LABEL: Record<WatchKind, string> = { trend: "Trend pool", teacher: "Teachers" };

export function sources(kind?: WatchKind) {
  return raw<any>(
    `SELECT w.*, (SELECT COUNT(*) FROM watch_posts p WHERE p.source_id = w.id) AS posts
     FROM watch_sources w WHERE w.active >= 0 ${kind ? "AND w.kind = ?" : ""} ORDER BY w.active DESC, w.name`,
    kind ? [kind] : [],
  );
}

export function addSources(kind: WatchKind, lines: string[], fallback: "instagram" | "youtube", note: string | null, userId: number | null) {
  const added: ParsedCreator[] = [];
  const skipped: string[] = [];
  for (const line of lines) {
    const c = parseCreator(line, fallback);
    if (!c) {
      if (line.trim()) skipped.push(`${line.trim()} (not a link or handle)`);
      continue;
    }
    const dup = one(
      `SELECT id FROM watch_sources WHERE kind = ? AND platform = ? AND active >= 0 AND (lower(COALESCE(handle,'')) = lower(?) OR COALESCE(external_id,'') = ?)`,
      [kind, c.platform, c.handle || "\u0000", c.externalId || "\u0000"],
    );
    if (dup) {
      skipped.push(`${c.handle || c.externalId || c.url} (already on the list)`);
      continue;
    }
    run(`INSERT INTO watch_sources (kind, name, platform, handle, external_id, url, note, active, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, [
      kind, c.name, c.platform, c.handle, c.externalId, c.url, note, userId, now(),
    ]);
    added.push(c);
  }
  return { added, skipped };
}

export async function pullWatch(kind?: WatchKind) {
  const errors: string[] = [];
  const rows = raw<any>(`SELECT * FROM watch_sources WHERE active = 1 AND platform IN ('instagram','youtube') ${kind ? "AND kind = ?" : ""}`, kind ? [kind] : []);
  for (const w of rows) {
    try {
      const got = await readCreator(w);
      for (const p of got.posts) {
        run(
          `INSERT INTO watch_posts (source_id, external_id, caption, permalink, published_at, views, likes, comments, outlier, created_at)
           VALUES (@s, @x, @c, @l, @p, @v, @lk, @cm, @o, @at)
           ON CONFLICT(source_id, external_id) DO UPDATE SET views = excluded.views, likes = excluded.likes, comments = excluded.comments, outlier = excluded.outlier`,
          { s: w.id, x: p.id, c: p.caption, l: p.permalink, p: iso(p.publishedAt), v: p.views, lk: p.likes, cm: p.comments, o: p.outlier, at: now() },
        );
      }
      run(
        `UPDATE watch_sources SET followers = ?, external_id = COALESCE(?, external_id), last_synced_at = ?, last_error = NULL,
           name = CASE WHEN ? IS NOT NULL AND (name = ? OR name = ?) THEN ? ELSE name END WHERE id = ?`,
        [got.followers, got.externalId, now(), got.title, String(w.handle || "").replace(/^@/, ""), w.external_id || "", got.title, w.id],
      );
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 500);
      errors.push(`${w.name}: ${msg}`);
      run(`UPDATE watch_sources SET last_error = ? WHERE id = ?`, [msg, w.id]);
    }
  }
  return errors;
}

/** Breakout posts from the trend pool and/or teachers — each at least `min`× that creator's own usual. */
export function watchOutliers(kind?: WatchKind, days = 14, min = 2, limit = 60) {
  return raw<any>(
    `SELECT p.*, w.name, w.platform, w.kind, w.language, w.note AS source_note
     FROM watch_posts p JOIN watch_sources w ON w.id = p.source_id
     WHERE w.active = 1 AND p.outlier >= @min AND p.published_at >= @since ${kind ? "AND w.kind = @kind" : ""}
     ORDER BY p.outlier DESC LIMIT @limit`,
    { min, since: daysAgo(days), kind, limit },
  );
}

/** The teachers' latest posts (not only outliers): what they're teaching right now. */
export function teacherLatest(days = 21, limit = 60) {
  return raw<any>(
    `SELECT p.*, w.name, w.platform FROM watch_posts p JOIN watch_sources w ON w.id = p.source_id
     WHERE w.kind = 'teacher' AND w.active = 1 AND p.published_at >= ? ORDER BY p.published_at DESC LIMIT ?`,
    [daysAgo(days), limit],
  );
}
