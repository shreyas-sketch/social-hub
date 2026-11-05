import { one } from "@/db";
import { accessToken, type Account } from "@/lib/accounts";
import { igBusinessDiscovery } from "@/lib/platforms/meta";
import { channelByHandle, channelById, recentVideos } from "@/lib/platforms/youtube";
import { median } from "@/lib/learn";

/**
 * Reading other people's public accounts — used by the speakers' watchlists, the trend pool and the teachers.
 * Instagram goes through Meta's business discovery (it needs one of our Instagram accounts connected);
 * YouTube uses the API key.
 */
export type CreatorPost = { id: string; caption: string; permalink: string; publishedAt: string; views: number | null; likes: number; comments: number; outlier: number | null };
export type CreatorRead = { followers: number | null; externalId: string | null; title: string | null; posts: CreatorPost[] };

export function anyConnectedIg(preferSpeakerId?: number): Account | undefined {
  return (
    (preferSpeakerId ? one<Account>(`SELECT * FROM accounts WHERE speaker_id = ? AND platform = 'instagram' AND status = 'connected'`, [preferSpeakerId]) : undefined) ??
    one<Account>(`SELECT * FROM accounts WHERE platform = 'instagram' AND status = 'connected' ORDER BY id LIMIT 1`)
  );
}

/** Each post against that creator's own median, so a small creator's breakout counts as much as a big one's. */
export function scoreOutliers(posts: Omit<CreatorPost, "outlier">[], score: (p: Omit<CreatorPost, "outlier">) => number): CreatorPost[] {
  const base = median(posts.map(score).filter((n) => n > 0));
  return posts.map((p) => ({ ...p, outlier: base > 0 ? score(p) / base : null }));
}

export async function readCreator(r: { platform: string; handle: string | null; external_id: string | null }, preferSpeakerId?: number): Promise<CreatorRead> {
  if (r.platform === "instagram") {
    if (!r.handle) throw new Error("No Instagram username — edit this creator and add it.");
    const ig = anyConnectedIg(preferSpeakerId);
    if (!ig) throw new Error("Connect at least one Instagram account first — Meta reads other accounts through it.");
    const bd = await igBusinessDiscovery(ig.external_id!, await accessToken(ig), String(r.handle).replace(/^@/, ""));
    const posts = bd.media.map((m: any) => ({ id: m.id, caption: m.caption || "", permalink: m.permalink, publishedAt: m.timestamp, views: null, likes: m.like_count || 0, comments: m.comments_count || 0 }));
    // Business discovery has no view counts, so likes + comments (weighted) stand in.
    return { followers: bd.followers ?? null, externalId: null, title: null, posts: scoreOutliers(posts, (p) => p.likes + 3 * p.comments) };
  }
  if (r.platform === "youtube") {
    const ch = String(r.external_id || "").startsWith("UC") ? await channelById(r.external_id!) : await channelByHandle(r.handle || "");
    const vids = await recentVideos(ch.uploads, undefined, 25);
    const posts = vids.map((v: any) => ({
      id: v.id,
      // Title first; the start of the description helps the agents see what the video teaches.
      caption: [v.title, String(v.description || "").replace(/\s+/g, " ").trim().slice(0, 400)].filter(Boolean).join("\n\n"),
      permalink: v.isShort ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
      publishedAt: v.publishedAt,
      views: v.views,
      likes: v.likes,
      comments: v.comments,
    }));
    return { followers: ch.subscribers, externalId: ch.id, title: ch.title || null, posts: scoreOutliers(posts, (p) => p.views || 0) };
  }
  throw new Error("The hub can only read Instagram and YouTube.");
}
