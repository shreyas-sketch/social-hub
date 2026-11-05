import { raw, one, run, now, json, istDay, iso } from "@/db";
import { seal, unseal } from "@/lib/secure";
import { env } from "@/lib/config";
import type { Platform } from "@/lib/speakers";
import { igProfile, igRecentMedia, igInsights, fbPage } from "@/lib/platforms/meta";
import { myChannel, channelByHandle, recentVideos, googleRefresh } from "@/lib/platforms/youtube";
import { xMe, xRefresh } from "@/lib/platforms/x";

export type Account = {
  id: number;
  speaker_id: number;
  platform: Platform;
  handle: string | null;
  url: string | null;
  status: "missing" | "not_connected" | "connected" | "error";
  external_id: string | null;
  token_enc: string | null;
  refresh_enc: string | null;
  token_expires_at: string | null;
  page_token_enc: string | null;
  meta: string;
  last_synced_at: string | null;
  last_error: string | null;
};

export function account(id: number) {
  return one<Account>(`SELECT * FROM accounts WHERE id = ?`, [id]);
}

export function accountFor(speakerId: number, platform: Platform) {
  return one<Account>(`SELECT * FROM accounts WHERE speaker_id = ? AND platform = ?`, [speakerId, platform]);
}

/** Every speaker has a row for every platform (status "missing" until the account exists). */
export function ensureAccount(speakerId: number, platform: Platform): Account {
  const a = accountFor(speakerId, platform);
  if (a) return a;
  run(`INSERT INTO accounts (speaker_id, platform, status, meta, created_at) VALUES (?, ?, 'missing', '{}', ?)`, [speakerId, platform, now()]);
  return accountFor(speakerId, platform)!;
}

export function accountsFor(speakerId: number) {
  return raw<Account>(`SELECT * FROM accounts WHERE speaker_id = ? ORDER BY id`, [speakerId]);
}

/** A fresh access token, refreshing it first where the platform allows. */
export async function accessToken(a: Account): Promise<string> {
  if (a.status !== "connected") throw new Error(`${a.platform} isn't connected for this speaker`);
  const soon = a.token_expires_at ? new Date(a.token_expires_at).getTime() - Date.now() < 5 * 60e3 : false;
  if (soon && a.refresh_enc && (a.platform === "youtube" || a.platform === "x")) {
    const rt = unseal(a.refresh_enc)!;
    const r = a.platform === "youtube" ? { ...(await googleRefresh(rt)), refreshToken: rt } : await xRefresh(rt);
    run(`UPDATE accounts SET token_enc = ?, refresh_enc = ?, token_expires_at = ? WHERE id = ?`, [seal(r.accessToken), seal(r.refreshToken), r.expiresAt, a.id]);
    return r.accessToken;
  }
  if (a.token_expires_at && new Date(a.token_expires_at).getTime() < Date.now()) {
    markError(a.id, "Sign-in expired — reconnect this account.");
    throw new Error(`${a.platform} sign-in expired — reconnect it on the Accounts page`);
  }
  return unseal(a.token_enc)!;
}

export function pageToken(a: Account) {
  return unseal(a.page_token_enc) || unseal(a.token_enc)!;
}

export function markError(id: number, msg: string) {
  run(`UPDATE accounts SET status = 'error', last_error = ? WHERE id = ?`, [msg.slice(0, 500), id]);
}

export function saveConnection(
  speakerId: number,
  platform: Platform,
  c: { externalId: string; handle?: string | null; url?: string | null; token: string; refresh?: string | null; expiresAt?: string | null; pageToken?: string | null; meta?: Record<string, unknown> },
) {
  const existing = accountFor(speakerId, platform);
  const vals = {
    speaker_id: speakerId,
    platform,
    external_id: c.externalId,
    handle: c.handle ?? existing?.handle ?? null,
    url: c.url ?? existing?.url ?? null,
    token_enc: seal(c.token),
    refresh_enc: seal(c.refresh || null),
    token_expires_at: c.expiresAt ?? null,
    page_token_enc: seal(c.pageToken || null),
    meta: JSON.stringify({ ...json(existing?.meta, {}), ...(c.meta || {}) }),
    at: now(),
  };
  if (existing) {
    run(
      `UPDATE accounts SET status = 'connected', external_id = @external_id, handle = @handle, url = @url, token_enc = @token_enc,
         refresh_enc = COALESCE(@refresh_enc, refresh_enc), token_expires_at = @token_expires_at, page_token_enc = @page_token_enc,
         meta = @meta, last_error = NULL WHERE id = @id`,
      { ...vals, id: existing.id },
    );
    return existing.id;
  }
  const r = run(
    `INSERT INTO accounts (speaker_id, platform, handle, url, status, external_id, token_enc, refresh_enc, token_expires_at, page_token_enc, meta, created_at)
     VALUES (@speaker_id, @platform, @handle, @url, 'connected', @external_id, @token_enc, @refresh_enc, @token_expires_at, @page_token_enc, @meta, @at)`,
    vals,
  );
  return Number(r.lastInsertRowid);
}

export function disconnect(id: number) {
  run(`UPDATE accounts SET status = 'not_connected', token_enc = NULL, refresh_enc = NULL, page_token_enc = NULL, token_expires_at = NULL WHERE id = ?`, [id]);
}

function saveStat(accountId: number, followers: number | null, posts: number | null, source: "api" | "manual", rawData?: unknown) {
  run(
    `INSERT INTO account_stats (account_id, day, followers, posts, source, raw, created_at) VALUES (@a, @d, @f, @p, @s, @r, @at)
     ON CONFLICT(account_id, day) DO UPDATE SET followers = excluded.followers, posts = excluded.posts, source = excluded.source, raw = excluded.raw`,
    { a: accountId, d: istDay(), f: followers, p: posts, s: source, r: rawData ? JSON.stringify(rawData) : null, at: now() },
  );
}

/** LinkedIn (and anything without an API) — numbers typed in by the team. */
export function saveManualStat(accountId: number, followers: number) {
  saveStat(accountId, followers, null, "manual");
}

function upsertPost(accountId: number, p: { externalId: string; permalink?: string | null; caption?: string | null; mediaType?: string | null; publishedAt?: string | null; views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null; saves?: number | null; reach?: number | null; avgWatchMs?: number | null; skipRate?: number | null; raw?: unknown }) {
  run(
    `INSERT INTO posts (account_id, external_id, permalink, caption, media_type, published_at, views, likes, comments, shares, saves, reach, avg_watch_ms, skip_rate, metrics, metrics_at, created_at)
     VALUES (@a, @x, @permalink, @caption, @mediaType, @publishedAt, @views, @likes, @comments, @shares, @saves, @reach, @avgWatchMs, @skipRate, @raw, @at, @at)
     ON CONFLICT(account_id, external_id) DO UPDATE SET
       permalink = COALESCE(excluded.permalink, permalink), caption = COALESCE(excluded.caption, caption),
       views = COALESCE(excluded.views, views), likes = COALESCE(excluded.likes, likes), comments = COALESCE(excluded.comments, comments),
       shares = COALESCE(excluded.shares, shares), saves = COALESCE(excluded.saves, saves), reach = COALESCE(excluded.reach, reach),
       avg_watch_ms = COALESCE(excluded.avg_watch_ms, avg_watch_ms), skip_rate = COALESCE(excluded.skip_rate, skip_rate),
       metrics = COALESCE(excluded.metrics, metrics), metrics_at = excluded.metrics_at`,
    {
      a: accountId,
      x: p.externalId,
      permalink: p.permalink ?? null,
      caption: p.caption ?? null,
      mediaType: p.mediaType ?? null,
      publishedAt: iso(p.publishedAt),
      views: p.views ?? null,
      likes: p.likes ?? null,
      comments: p.comments ?? null,
      shares: p.shares ?? null,
      saves: p.saves ?? null,
      reach: p.reach ?? null,
      avgWatchMs: p.avgWatchMs ?? null,
      skipRate: p.skipRate ?? null,
      raw: p.raw ? JSON.stringify(p.raw) : null,
      at: now(),
    },
  );
}

/** Pulls followers and recent post numbers for one connected account. */
/** YouTube numbers are public, so a channel with a handle is read with the API key even before anyone connects it. */
/** Uploading through the API needs it switched on (after Google's audit) and a channel connected with upload permission. */
export const youtubeCanUpload = (a: Pick<Account, "platform" | "status" | "meta"> | null | undefined) =>
  !!a && a.platform === "youtube" && a.status === "connected" && env.youtubeUploadEnabled() && json<any>(a.meta, {}).canUpload === true;

export const publicYoutube = (a: Pick<Account, "platform" | "status" | "handle">) => a.platform === "youtube" && a.status !== "connected" && a.status !== "missing" && !!a.handle && !!env.youtubeApiKey();

export async function pullStats(accountId: number) {
  const a = account(accountId);
  if (!a || (a.status !== "connected" && !publicYoutube(a))) return;
  try {
    if (a.platform === "instagram") {
      const token = await accessToken(a);
      const prof = await igProfile(a.external_id!, token);
      saveStat(a.id, prof.followers_count, prof.media_count, "api");
      const media = await igRecentMedia(a.external_id!, token, 30);
      const monthAgo = Date.now() - 30 * 864e5;
      let reads = 0;
      for (const m of media) {
        const isReel = m.media_product_type === "REELS";
        const fresh = new Date(m.timestamp).getTime() > monthAgo;
        let ins: Awaited<ReturnType<typeof igInsights>> | null = null;
        if (fresh && reads < 15) {
          reads++;
          ins = await igInsights(m.id, token, isReel).catch(() => null);
        }
        upsertPost(a.id, {
          externalId: m.id,
          permalink: m.permalink,
          caption: m.caption,
          mediaType: m.media_product_type || m.media_type,
          publishedAt: m.timestamp,
          likes: ins?.likes ?? m.like_count,
          comments: ins?.comments ?? m.comments_count,
          views: ins?.views ?? null,
          shares: ins?.shares ?? null,
          saves: ins?.saves ?? null,
          reach: ins?.reach ?? null,
          avgWatchMs: ins?.avgWatchMs ?? null,
          skipRate: ins?.skipRate ?? null,
          raw: ins?.raw,
        });
      }
    } else if (a.platform === "facebook") {
      const p = await fbPage(a.external_id!, pageToken(a));
      saveStat(a.id, p.followers_count ?? p.fan_count ?? null, null, "api");
    } else if (a.platform === "youtube") {
      const token = a.status === "connected" ? await accessToken(a) : undefined;
      const ch = token ? await myChannel(token) : await channelByHandle(a.handle!);
      if (!token && a.external_id !== ch.id) run(`UPDATE accounts SET external_id = ? WHERE id = ?`, [ch.id, a.id]);
      saveStat(a.id, ch.subscribers, ch.videos, "api");
      for (const v of await recentVideos(ch.uploads, token, 30)) {
        upsertPost(a.id, { externalId: v.id, permalink: v.isShort ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`, caption: v.title, mediaType: v.isShort ? "SHORT" : "VIDEO", publishedAt: v.publishedAt, views: v.views, likes: v.likes, comments: v.comments });
      }
    } else if (a.platform === "x") {
      const token = await accessToken(a);
      const me = await xMe(token);
      saveStat(a.id, me.followers, me.posts, "api");
    }
    run(`UPDATE accounts SET last_synced_at = ?, last_error = NULL WHERE id = ?`, [now(), a.id]);
  } catch (e) {
    run(`UPDATE accounts SET last_error = ? WHERE id = ?`, [String((e as Error).message).slice(0, 500), a.id]);
    throw e;
  }
}

/** Latest and 7-days-ago follower counts for the dashboard grid. */
export function followerGrid() {
  return raw<any>(
    `SELECT a.id, a.speaker_id, a.platform, a.status, a.handle, a.token_expires_at, a.last_error,
       (SELECT followers FROM account_stats s WHERE s.account_id = a.id ORDER BY day DESC LIMIT 1) AS followers,
       (SELECT followers FROM account_stats s WHERE s.account_id = a.id AND day <= @weekAgo ORDER BY day DESC LIMIT 1) AS followers_7d
     FROM accounts a`,
    { weekAgo: istDay(new Date(Date.now() - 7 * 864e5)) },
  );
}

export function expiringSoon(days = 10) {
  const cut = new Date(Date.now() + days * 864e5).toISOString();
  return raw<any>(
    `SELECT a.*, s.name AS speaker FROM accounts a JOIN speakers s ON s.id = a.speaker_id
     WHERE a.status = 'connected' AND a.token_expires_at IS NOT NULL AND a.token_expires_at < ? AND (a.refresh_enc IS NULL OR a.platform IN ('instagram','facebook','linkedin'))`,
    [cut],
  );
}

export const redirectUri = (platform: string) => `${env.appUrl()}/api/oauth/${platform}/callback`;
