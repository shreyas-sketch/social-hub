import fs from "node:fs";
import { env } from "@/lib/config";
import { call, qs } from "./http";

/**
 * YouTube: read stats for our channels, read public numbers for watchlist channels.
 * Uploading through the API is off until Google audits the app (before that,
 * every upload is locked to private). Until then the team uploads in YouTube Studio.
 */
const API = "https://www.googleapis.com/youtube/v3";

export function youtubeScopes() {
  const s = ["https://www.googleapis.com/auth/youtube.readonly"];
  if (env.youtubeUploadEnabled()) s.push("https://www.googleapis.com/auth/youtube.upload");
  return s;
}

export function googleAuthUrl(state: string, redirectUri: string) {
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs({
    client_id: env.googleClientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: youtubeScopes().join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  })}`;
}

export async function googleExchange(code: string, redirectUri: string) {
  const r = await call<any>("Google", "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: qs({ code, client_id: env.googleClientId(), client_secret: env.googleClientSecret(), redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  return {
    accessToken: r.access_token as string,
    refreshToken: r.refresh_token as string | undefined,
    expiresAt: new Date(Date.now() + (r.expires_in || 3600) * 1000).toISOString(),
    // What the channel owner actually allowed (a channel connected before uploads were switched on can only be read).
    canUpload: String(r.scope || "").includes("youtube.upload"),
  };
}

export async function googleRefresh(refreshToken: string) {
  const r = await call<any>("Google", "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: qs({ refresh_token: refreshToken, client_id: env.googleClientId(), client_secret: env.googleClientSecret(), grant_type: "refresh_token" }),
  });
  return { accessToken: r.access_token as string, expiresAt: new Date(Date.now() + (r.expires_in || 3600) * 1000).toISOString() };
}

const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

export async function myChannel(token: string) {
  const r = await call<any>("YouTube", `${API}/channels?${qs({ part: "snippet,statistics,contentDetails", mine: "true" })}`, auth(token));
  const c = r.items?.[0];
  if (!c) throw new Error("No YouTube channel on this Google account");
  return {
    id: c.id as string,
    title: c.snippet?.title as string,
    handle: c.snippet?.customUrl as string | undefined,
    subscribers: Number(c.statistics?.subscriberCount ?? 0),
    videos: Number(c.statistics?.videoCount ?? 0),
    uploads: c.contentDetails?.relatedPlaylists?.uploads as string,
  };
}

/** Public channel by @handle, with an API key (no sign-in). */
export async function channelByHandle(handle: string) {
  const key = env.youtubeApiKey();
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");
  const h = handle.startsWith("@") ? handle : `@${handle}`;
  const r = await call<any>("YouTube", `${API}/channels?${qs({ part: "snippet,statistics,contentDetails", forHandle: h, key })}`);
  const c = r.items?.[0];
  if (!c) throw new Error(`No channel for ${h}`);
  return { id: c.id as string, title: c.snippet?.title as string, subscribers: Number(c.statistics?.subscriberCount ?? 0), videos: Number(c.statistics?.videoCount ?? 0), uploads: c.contentDetails?.relatedPlaylists?.uploads as string };
}

/** Public channel by its UC… id, with an API key. */
export async function channelById(id: string) {
  const key = env.youtubeApiKey();
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");
  const r = await call<any>("YouTube", `${API}/channels?${qs({ part: "snippet,statistics,contentDetails", id, key })}`);
  const c = r.items?.[0];
  if (!c) throw new Error(`No channel ${id}`);
  return { id: c.id as string, title: c.snippet?.title as string, subscribers: Number(c.statistics?.subscriberCount ?? 0), uploads: c.contentDetails?.relatedPlaylists?.uploads as string };
}

/** Latest uploads with their numbers. Pass either an OAuth token or nothing (uses the API key). */
export async function recentVideos(uploadsPlaylist: string, token?: string, max = 25) {
  const key = token ? {} : { key: env.youtubeApiKey() };
  const init = token ? auth(token) : {};
  const items = await call<any>("YouTube", `${API}/playlistItems?${qs({ part: "contentDetails", playlistId: uploadsPlaylist, maxResults: max, ...key })}`, init);
  const ids = (items.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const vids = await call<any>("YouTube", `${API}/videos?${qs({ part: "snippet,statistics,contentDetails", id: ids.join(","), ...key })}`, init);
  return (vids.items || []).map((v: any) => ({
    id: v.id as string,
    title: v.snippet?.title as string,
    description: v.snippet?.description as string,
    publishedAt: v.snippet?.publishedAt as string,
    views: Number(v.statistics?.viewCount ?? 0),
    likes: Number(v.statistics?.likeCount ?? 0),
    comments: Number(v.statistics?.commentCount ?? 0),
    duration: v.contentDetails?.duration as string,
    isShort: /^PT(\d+S|[0-2]M(\d+S)?|3M)$/.test(v.contentDetails?.duration || "") ,
  }));
}

/** Resumable upload — only used once YOUTUBE_UPLOAD_ENABLED=1 (after Google's audit). */
export async function uploadVideo(o: { token: string; file: string; title: string; description: string; tags?: string[]; privacy?: "public" | "unlisted" | "private"; short?: boolean }) {
  const size = fs.statSync(o.file).size;
  const init = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?${qs({ uploadType: "resumable", part: "snippet,status" })}`, {
    method: "POST",
    headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(size), "x-upload-content-type": "video/mp4" },
    body: JSON.stringify({
      snippet: { title: o.title.slice(0, 100), description: o.description.slice(0, 4900), categoryId: "27", ...(o.tags?.length ? { tags: o.tags.slice(0, 30) } : {}) },
      status: { privacyStatus: o.privacy || "public", selfDeclaredMadeForKids: false },
    }),
  });
  if (!init.ok) throw new Error(`YouTube ${init.status}: ${(await init.text()).slice(0, 300)}`);
  const loc = init.headers.get("location");
  if (!loc) throw new Error("YouTube gave no upload URL");
  // Streamed from disk: a long video can be several GB.
  const stream = fs.createReadStream(o.file);
  const put = await fetch(loc, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(size) }, body: stream as any, duplex: "half" } as any);
  const body = await put.json().catch(() => ({}));
  if (!put.ok) throw new Error(`YouTube upload ${put.status}: ${body?.error?.message || ""}`);
  return { id: body.id as string, url: o.short === false ? `https://www.youtube.com/watch?v=${body.id}` : `https://www.youtube.com/shorts/${body.id}` };
}

export const uploadShort = (o: { token: string; file: string; title: string; description: string; privacy?: "public" | "unlisted" | "private" }) => uploadVideo({ ...o, short: true });
