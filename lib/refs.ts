import { raw, one, run, now, iso, daysAgo } from "@/db";
import { readCreator, type CreatorPost } from "@/lib/creators";

/**
 * The watchlist: creators each speaker should learn from. Every day we pull
 * their latest posts and mark the ones that did far better than that creator
 * usually does — those "outliers" feed the next day's scripts.
 */
export function refsFor(speakerId: number) {
  return raw<any>(`SELECT * FROM refs WHERE speaker_id = ? AND active >= 0 ORDER BY active DESC, id`, [speakerId]);
}

/** Platforms the hub can read every day. Anything else is kept as a link for people to look at. */
export const READABLE = ["instagram", "youtube"];

export type ParsedCreator = { platform: string; handle: string | null; externalId: string | null; url: string; name: string };

/**
 * Turns whatever someone pastes — a profile link, an @handle, a YouTube channel id — into a watchlist entry.
 * `fallback` is the platform to assume for a bare handle.
 */
export function parseCreator(input: string, fallback: "instagram" | "youtube" = "instagram"): ParsedCreator | null {
  const raw = input.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (!raw) return null;
  const m = (re: RegExp) => raw.match(re);
  let r: RegExpMatchArray | null;
  if ((r = m(/instagram\.com\/([A-Za-z0-9._]+)/i)) && !["p", "reel", "reels", "explore", "stories"].includes(r[1].toLowerCase())) {
    return { platform: "instagram", handle: r[1], externalId: null, url: `https://www.instagram.com/${r[1]}/`, name: r[1] };
  }
  if ((r = m(/youtube\.com\/channel\/(UC[\w-]{22})/i))) return { platform: "youtube", handle: null, externalId: r[1], url: `https://www.youtube.com/channel/${r[1]}`, name: r[1] };
  if ((r = m(/youtube\.com\/(@[\w.-]+)/i))) return { platform: "youtube", handle: r[1], externalId: null, url: `https://www.youtube.com/${r[1]}`, name: r[1].slice(1) };
  if ((r = m(/youtube\.com\/(?:c|user)\/([\w.-]+)/i))) return { platform: "youtube", handle: `@${r[1]}`, externalId: null, url: `https://www.youtube.com/${r[1].startsWith("@") ? r[1] : "@" + r[1]}`, name: r[1] };
  if ((r = m(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/i))) return { platform: "x", handle: `@${r[1]}`, externalId: null, url: `https://x.com/${r[1]}`, name: r[1] };
  if ((r = m(/linkedin\.com\/(in|company)\/([^/\s]+)/i))) return { platform: "linkedin", handle: r[2], externalId: null, url: `https://www.linkedin.com/${r[1]}/${r[2]}/`, name: r[2] };
  if ((r = m(/facebook\.com\/([^/\s]+)/i))) return { platform: "facebook", handle: r[1], externalId: null, url: `https://www.facebook.com/${r[1]}`, name: r[1] };
  if (/^https?:\/\//i.test(raw)) return { platform: "other", handle: null, externalId: null, url: raw, name: raw.replace(/^https?:\/\/(www\.)?/i, "").slice(0, 60) };
  if (/^UC[\w-]{22}$/.test(raw)) return { platform: "youtube", handle: null, externalId: raw, url: `https://www.youtube.com/channel/${raw}`, name: raw };
  const h = raw.replace(/^@/, "");
  if (!/^[\w.-]{1,60}$/.test(h)) return null;
  return fallback === "youtube"
    ? { platform: "youtube", handle: `@${h}`, externalId: null, url: `https://www.youtube.com/@${h}`, name: h }
    : { platform: "instagram", handle: h, externalId: null, url: `https://www.instagram.com/${h}/`, name: h };
}

/** Adds creators for a speaker, skipping ones already on the list. Returns what was added and what was skipped. */
export function addCreators(speakerId: number, lines: string[], fallback: "instagram" | "youtube", note: string | null, name: string | null, userId: number | null) {
  const added: ParsedCreator[] = [];
  const skipped: string[] = [];
  for (const line of lines) {
    const c = parseCreator(line, fallback);
    if (!c) {
      if (line.trim()) skipped.push(`${line.trim()} (not a link or handle)`);
      continue;
    }
    const dup = one(
      `SELECT id FROM refs WHERE speaker_id = ? AND platform = ? AND active >= 0 AND (lower(COALESCE(handle,'')) = lower(?) OR COALESCE(external_id,'') = ?)`,
      [speakerId, c.platform, c.handle || "\u0000", c.externalId || "\u0000"],
    );
    if (dup) {
      skipped.push(`${c.handle || c.externalId || c.url} (already on the list)`);
      continue;
    }
    run(`INSERT INTO refs (speaker_id, name, platform, handle, url, external_id, note, active, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, [
      speakerId,
      (lines.length === 1 && name) || c.name,
      c.platform,
      c.handle,
      c.url,
      c.externalId,
      note,
      userId,
      now(),
    ]);
    added.push(c);
  }
  return { added, skipped };
}

function savePosts(refId: number, posts: CreatorPost[]) {
  for (const p of posts) {
    run(
      `INSERT INTO ref_posts (ref_id, external_id, caption, permalink, published_at, views, likes, comments, outlier, created_at)
       VALUES (@r, @x, @c, @l, @p, @v, @lk, @cm, @o, @at)
       ON CONFLICT(ref_id, external_id) DO UPDATE SET views = excluded.views, likes = excluded.likes, comments = excluded.comments, outlier = excluded.outlier`,
      { r: refId, x: p.id, c: p.caption, l: p.permalink, p: iso(p.publishedAt), v: p.views, lk: p.likes, cm: p.comments, o: p.outlier, at: now() },
    );
  }
}

export async function pullRefs(speakerId: number) {
  const errors: string[] = [];
  for (const r of raw<any>(`SELECT * FROM refs WHERE speaker_id = ? AND active = 1 AND platform IN ('instagram','youtube')`, [speakerId])) {
    try {
      const got = await readCreator(r, speakerId);
      savePosts(r.id, got.posts);
      run(
        `UPDATE refs SET followers = ?, external_id = COALESCE(?, external_id), last_synced_at = ?, last_error = NULL,
           name = CASE WHEN ? IS NOT NULL AND (name = ? OR name = ?) THEN ? ELSE name END WHERE id = ?`,
        [got.followers, got.externalId, now(), got.title, String(r.handle || "").replace(/^@/, ""), r.external_id || "", got.title, r.id],
      );
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 500);
      errors.push(`${r.name}: ${msg}`);
      run(`UPDATE refs SET last_error = ? WHERE id = ?`, [msg, r.id]);
    }
  }
  return errors;
}

export function outliers(speakerId?: number, days = 14, min = 1.8) {
  return raw<any>(
    `SELECT rp.*, r.name, r.platform, r.speaker_id, s.name AS speaker
     FROM ref_posts rp JOIN refs r ON r.id = rp.ref_id JOIN speakers s ON s.id = r.speaker_id
     WHERE rp.outlier >= @min AND rp.published_at >= @since ${speakerId ? "AND r.speaker_id = @sp" : ""}
     ORDER BY rp.outlier DESC LIMIT 60`,
    { min, since: daysAgo(days), sp: speakerId },
  );
}
