import { env } from "@/lib/config";
import { call, qs } from "./http";

/**
 * Instagram + Facebook through one Meta app (Facebook Login for Business).
 * Internal use: the app can stay in development mode with each speaker's
 * account added as a tester, so no App Review is needed.
 */
const G = () => `https://graph.facebook.com/${env.metaVersion()}`;

export const META_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  // v1.3: read comments, reply to them, and send one private reply (DM) per comment.
  "instagram_manage_comments",
  "instagram_manage_messages",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "business_management",
];

/** With "Facebook Login for Business", Meta asks for a configuration id instead of a scope list (META_CONFIG_ID). */
export function metaAuthUrl(state: string, redirectUri: string) {
  const configId = process.env.META_CONFIG_ID || "";
  return `https://www.facebook.com/${env.metaVersion()}/dialog/oauth?${qs({
    client_id: env.metaAppId(),
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    ...(configId ? { config_id: configId, override_default_response_type: "true" } : { scope: META_SCOPES.join(",") }),
  })}`;
}

/** Code → short-lived token → long-lived user token (about 60 days). */
export async function metaExchange(code: string, redirectUri: string) {
  const short = await call<{ access_token: string }>("Meta", `${G()}/oauth/access_token?${qs({ client_id: env.metaAppId(), client_secret: env.metaAppSecret(), redirect_uri: redirectUri, code })}`);
  const long = await call<{ access_token: string; expires_in?: number }>(
    "Meta",
    `${G()}/oauth/access_token?${qs({ grant_type: "fb_exchange_token", client_id: env.metaAppId(), client_secret: env.metaAppSecret(), fb_exchange_token: short.access_token })}`,
  );
  const expires = long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : new Date(Date.now() + 60 * 864e5).toISOString();
  return { userToken: long.access_token, expiresAt: expires };
}

export type MetaPage = { id: string; name: string; access_token: string; ig?: { id: string; username: string; followers_count?: number } };

/** Pages this person manages, each with its linked Instagram professional account (if any). */
export async function metaPages(userToken: string): Promise<MetaPage[]> {
  const r = await call<any>("Meta", `${G()}/me/accounts?${qs({ fields: "id,name,access_token,instagram_business_account{id,username,followers_count}", limit: 100, access_token: userToken })}`);
  return (r.data || []).map((p: any) => ({ id: p.id, name: p.name, access_token: p.access_token, ig: p.instagram_business_account }));
}

export async function igProfile(igId: string, token: string) {
  return call<{ id: string; username: string; followers_count: number; media_count: number }>("Instagram", `${G()}/${igId}?${qs({ fields: "id,username,followers_count,media_count", access_token: token })}`);
}

export async function igRecentMedia(igId: string, token: string, limit = 30) {
  const r = await call<any>("Instagram", `${G()}/${igId}/media?${qs({ fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count", limit, access_token: token })}`);
  return (r.data || []) as any[];
}

// reels_skip_rate = % of views that swiped away in the first 3 seconds (added 2025); total time includes replays.
const REEL_METRICS = ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time", "reels_skip_rate"];
const REEL_METRICS_V1 = ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "ig_reels_avg_watch_time"];
const CORE_METRICS = ["views", "reach", "likes", "comments", "shares", "saved"];

/** Lifetime numbers for one post. Falls back to a core set if Meta rejects one of the reel metrics. */
export async function igInsights(mediaId: string, token: string, isReel = true) {
  const get = (metrics: string[]) => call<any>("Instagram", `${G()}/${mediaId}/insights?${qs({ metric: metrics.join(","), access_token: token })}`);
  let r: any;
  const tries = isReel ? [REEL_METRICS, REEL_METRICS_V1, CORE_METRICS] : [CORE_METRICS];
  for (let i = 0; i < tries.length; i++) {
    try {
      r = await get(tries[i]);
      break;
    } catch (e) {
      if (i === tries.length - 1) throw e;
    }
  }
  const out: Record<string, number> = {};
  for (const m of r.data || []) out[m.name] = Number(m.values?.[0]?.value ?? m.total_value?.value ?? 0);
  return {
    views: out.views ?? null,
    reach: out.reach ?? null,
    likes: out.likes ?? null,
    comments: out.comments ?? null,
    shares: out.shares ?? null,
    saves: out.saved ?? null,
    avgWatchMs: out.ig_reels_avg_watch_time ?? null, // Meta returns milliseconds
    totalWatchMs: out.ig_reels_video_view_total_time ?? null,
    skipRate: out.reels_skip_rate ?? null,
    raw: out,
  };
}

/** Step 1 of posting a reel: Meta downloads the video from our signed public URL. */
export async function igCreateReel(o: { igId: string; token: string; videoUrl: string; caption: string; trial?: "MANUAL" | "SS_PERFORMANCE" | null; shareToFeed?: boolean; collaborators?: string[] }) {
  const body: Record<string, string> = {
    media_type: "REELS",
    video_url: o.videoUrl,
    caption: o.caption,
    share_to_feed: String(o.shareToFeed ?? true),
    access_token: o.token,
  };
  if (o.trial) body.trial_params = JSON.stringify({ graduation_strategy: o.trial });
  // Collab posts: up to 3 Instagram usernames get an invite. Meta doesn't allow collaborators on trial reels.
  if (o.collaborators?.length && !o.trial) body.collaborators = JSON.stringify(o.collaborators.slice(0, 3));
  const r = await call<{ id: string }>("Instagram", `${G()}/${o.igId}/media`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: qs(body) });
  return r.id;
}

/** FINISHED | IN_PROGRESS | ERROR | EXPIRED | PUBLISHED */
export async function igContainerStatus(containerId: string, token: string) {
  const r = await call<{ status_code: string; status?: string }>("Instagram", `${G()}/${containerId}?${qs({ fields: "status_code,status", access_token: token })}`);
  return r;
}

export async function igPublish(igId: string, token: string, creationId: string) {
  const r = await call<{ id: string }>("Instagram", `${G()}/${igId}/media_publish`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: qs({ creation_id: creationId, access_token: token }) });
  return r.id;
}

export async function igMediaInfo(mediaId: string, token: string) {
  return call<{ id: string; permalink?: string; timestamp?: string }>("Instagram", `${G()}/${mediaId}?${qs({ fields: "id,permalink,timestamp", access_token: token })}`);
}

/** Public numbers for another professional account (the watchlist). Likes and comments only; Meta doesn't share their views. */
export async function igBusinessDiscovery(igId: string, token: string, username: string) {
  const fields = `business_discovery.username(${username}){username,followers_count,media_count,media.limit(20){id,caption,like_count,comments_count,timestamp,permalink,media_product_type}}`;
  const r = await call<any>("Instagram", `${G()}/${igId}?${qs({ fields, access_token: token })}`);
  const bd = r.business_discovery || {};
  return { username: bd.username as string, followers: bd.followers_count as number, media: (bd.media?.data || []) as any[] };
}

export type IgComment = { id: string; text: string; username?: string; timestamp?: string; from?: { id: string; username?: string }; like_count?: number };

/** Top-level comments on one of our posts, newest first. */
export async function igComments(mediaId: string, token: string, limit = 50, maxPages = 10): Promise<IgComment[]> {
  // Follows the pages: a reel can get hundreds of comments between two reads.
  const out: IgComment[] = [];
  let url: string | null = `${G()}/${mediaId}/comments?${qs({ fields: "id,text,username,timestamp,like_count,from{id,username}", limit, access_token: token })}`;
  for (let page = 0; url && page < maxPages; page++) {
    const r: any = await call<any>("Instagram", url);
    out.push(...((r.data || []) as IgComment[]));
    url = r.paging?.next || null;
  }
  return out;
}

/** How many comments a post has now (for posts that aren't in the recent-media list, like trial reels). */
export async function igCommentCount(mediaId: string, token: string) {
  const r = await call<{ comments_count?: number }>("Instagram", `${G()}/${mediaId}?${qs({ fields: "comments_count", access_token: token })}`);
  return Number(r.comments_count ?? 0);
}

/**
 * Private reply: one DM to the person who wrote a comment, within 7 days of the comment.
 * More messages only if they write back (and then within 24 hours). Needs "Allow access to messages" on in the Instagram app.
 */
export async function igPrivateReply(igId: string, token: string, commentId: string, text: string) {
  const send = (node: string) =>
    call<{ recipient_id?: string; message_id?: string }>("Instagram", `${G()}/${node}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: text.slice(0, 1000) } }),
    });
  try {
    // Meta's private-replies page uses the Instagram account id; older Messenger-style setups use the Page (/me with a Page token).
    return await send(igId);
  } catch (e: any) {
    // Only "wrong address" errors try the other address (nothing was sent). Permission, rate-limit and
    // "this person can't get messages" errors are real answers and are not retried.
    const msg = String(e?.message || "");
    const code = Number(e?.body?.error?.code);
    if ((e?.status === 400 || e?.status === 404) && ([3, 12, 100, 2500].includes(code) || /Unsupported post request|nonexisting field|Unknown path components|does not exist/i.test(msg))) return send("me");
    throw e;
  }
}

/** A public reply under a comment. */
export async function igReplyComment(commentId: string, token: string, message: string) {
  const r = await call<{ id: string }>("Instagram", `${G()}/${commentId}/replies`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: qs({ message: message.slice(0, 2200), access_token: token }),
  });
  return r.id;
}

export async function fbPage(pageId: string, pageToken: string) {
  return call<{ id: string; name: string; followers_count?: number; fan_count?: number }>("Facebook", `${G()}/${pageId}?${qs({ fields: "id,name,followers_count,fan_count", access_token: pageToken })}`);
}

/** Facebook Page reel: start a session, Meta pulls the file from our URL, then publish. */
export async function fbPublishReel(o: { pageId: string; pageToken: string; fileUrl: string; description: string }) {
  const start = await call<{ video_id: string; upload_url: string }>("Facebook", `${G()}/${o.pageId}/video_reels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ upload_phase: "start", access_token: o.pageToken }),
  });
  await call("Facebook", `https://rupload.facebook.com/video-upload/${env.metaVersion()}/${start.video_id}`, {
    method: "POST",
    headers: { authorization: `OAuth ${o.pageToken}`, file_url: o.fileUrl },
  });
  await call("Facebook", `${G()}/${o.pageId}/video_reels?${qs({ access_token: o.pageToken, video_id: start.video_id, upload_phase: "finish", video_state: "PUBLISHED", description: o.description })}`, { method: "POST" });
  return start.video_id;
}

export async function fbVideoStatus(videoId: string, token: string) {
  return call<any>("Facebook", `${G()}/${videoId}?${qs({ fields: "status,permalink_url", access_token: token })}`);
}
