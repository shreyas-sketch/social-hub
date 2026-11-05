import fs from "node:fs";
import crypto from "node:crypto";
import { env } from "@/lib/config";
import { call, qs, sleep } from "./http";

/** X (pay per use, about 1–1.5 cents a post). OAuth 2.0 with PKCE; media through the v2 upload endpoints. */
export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];

export function pkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function xAuthUrl(state: string, redirectUri: string, challenge: string) {
  return `https://x.com/i/oauth2/authorize?${qs({ response_type: "code", client_id: env.xClientId(), redirect_uri: redirectUri, scope: X_SCOPES.join(" "), state, code_challenge: challenge, code_challenge_method: "S256" })}`;
}

const basic = () => `Basic ${Buffer.from(`${env.xClientId()}:${env.xClientSecret()}`).toString("base64")}`;

export async function xExchange(code: string, redirectUri: string, verifier: string) {
  const r = await call<any>("X", "https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic() },
    body: qs({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, client_id: env.xClientId() }),
  });
  return { accessToken: r.access_token as string, refreshToken: r.refresh_token as string, expiresAt: new Date(Date.now() + (r.expires_in || 7200) * 1000).toISOString() };
}

/** X rotates refresh tokens: always store the new one. */
export async function xRefresh(refreshToken: string) {
  const r = await call<any>("X", "https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic() },
    body: qs({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: env.xClientId() }),
  });
  return { accessToken: r.access_token as string, refreshToken: (r.refresh_token as string) || refreshToken, expiresAt: new Date(Date.now() + (r.expires_in || 7200) * 1000).toISOString() };
}

export async function xMe(token: string) {
  const r = await call<any>("X", `https://api.x.com/2/users/me?${qs({ "user.fields": "public_metrics,username" })}`, { headers: { authorization: `Bearer ${token}` } });
  return { id: r.data.id as string, username: r.data.username as string, followers: Number(r.data.public_metrics?.followers_count ?? 0), posts: Number(r.data.public_metrics?.tweet_count ?? 0) };
}

/** A text-only post (about $0.015 through the API; a post with a link costs about $0.20). */
export async function xPostText(o: { token: string; text: string }) {
  const post = await call<any>("X", "https://api.x.com/2/tweets", {
    method: "POST",
    headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json" },
    body: JSON.stringify({ text: o.text }),
  });
  return { id: post.data.id as string };
}

const CHUNK = 4 * 1024 * 1024;

/** INIT → APPEND (4 MB parts) → FINALIZE → wait for processing → post. */
export async function xPostVideo(o: { token: string; file: string; text: string }) {
  const h = { authorization: `Bearer ${o.token}` };
  const size = fs.statSync(o.file).size;
  const init = await call<any>("X", "https://api.x.com/2/media/upload/initialize", {
    method: "POST",
    headers: { ...h, "content-type": "application/json" },
    body: JSON.stringify({ media_type: "video/mp4", total_bytes: size, media_category: "tweet_video" }),
  });
  const id = init.data?.id as string;
  const fd = fs.openSync(o.file, "r");
  try {
    for (let i = 0, off = 0; off < size; i++, off += CHUNK) {
      const len = Math.min(CHUNK, size - off);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, off);
      const form = new FormData();
      form.append("segment_index", String(i));
      form.append("media", new Blob([buf]), "chunk");
      await call("X", `https://api.x.com/2/media/upload/${id}/append`, { method: "POST", headers: h, body: form });
    }
  } finally {
    fs.closeSync(fd);
  }
  let fin = await call<any>("X", `https://api.x.com/2/media/upload/${id}/finalize`, { method: "POST", headers: h });
  for (let k = 0; k < 40 && fin.data?.processing_info && !["succeeded", "failed"].includes(fin.data.processing_info.state); k++) {
    await sleep(Math.max(2, fin.data.processing_info.check_after_secs || 5) * 1000);
    fin = await call<any>("X", `https://api.x.com/2/media/upload?${qs({ command: "STATUS", media_id: id })}`, { headers: h });
  }
  if (fin.data?.processing_info?.state === "failed") throw new Error(`X couldn't process the video: ${fin.data.processing_info.error?.message || ""}`);
  const post = await call<any>("X", "https://api.x.com/2/tweets", {
    method: "POST",
    headers: { ...h, "content-type": "application/json" },
    body: JSON.stringify({ text: o.text.slice(0, 280), media: { media_ids: [id] } }),
  });
  return { id: post.data.id as string };
}
