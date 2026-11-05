import fs from "node:fs";
import { env } from "@/lib/config";
import { call, qs, sleep } from "./http";

/**
 * LinkedIn personal profiles: posting works with the self-serve "Share on LinkedIn"
 * product (w_member_social). Post numbers for personal profiles need LinkedIn's
 * Community Management approval, so until then they're typed in weekly.
 */
export const LINKEDIN_SCOPES = ["openid", "profile", "w_member_social"];

const rest = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  "LinkedIn-Version": env.linkedinVersion(),
  "X-Restli-Protocol-Version": "2.0.0",
  ...extra,
});

export function linkedinAuthUrl(state: string, redirectUri: string) {
  return `https://www.linkedin.com/oauth/v2/authorization?${qs({ response_type: "code", client_id: env.linkedinClientId(), redirect_uri: redirectUri, state, scope: LINKEDIN_SCOPES.join(" ") })}`;
}

export async function linkedinExchange(code: string, redirectUri: string) {
  const r = await call<any>("LinkedIn", "https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: qs({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: env.linkedinClientId(), client_secret: env.linkedinClientSecret() }),
  });
  return { accessToken: r.access_token as string, refreshToken: r.refresh_token as string | undefined, expiresAt: new Date(Date.now() + (r.expires_in || 5184000) * 1000).toISOString() };
}

export async function linkedinMe(token: string) {
  const r = await call<any>("LinkedIn", "https://api.linkedin.com/v2/userinfo", { headers: { authorization: `Bearer ${token}` } });
  return { urn: `urn:li:person:${r.sub}`, name: r.name as string };
}

/**
 * LinkedIn's post text ("little text") treats ( ) [ ] { } < > @ # * _ ~ | \ as markup; unescaped,
 * a bracket can cut the post short. Escape them, and turn #words into real hashtags.
 */
export function littleText(text: string) {
  const parts = text.split(/(#[\p{L}\p{N}_]+)/u);
  return parts
    .map((p) => (/^#[\p{L}\p{N}_]+$/u.test(p) ? `{hashtag|\\#|${p.slice(1)}}` : p.replace(/[\\|{}@\[\]()<>#*_~]/g, (c) => `\\${c}`)))
    .join("");
}

/** A text-only post on the person's own profile. */
export async function linkedinPostText(o: { token: string; author: string; text: string }) {
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: rest(o.token, { "content-type": "application/json" }),
    body: JSON.stringify({
      author: o.author,
      commentary: littleText(o.text).slice(0, 2900),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn post ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const id = res.headers.get("x-restli-id") || "";
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null };
}

/** Upload in the parts LinkedIn asks for, finalise, wait until AVAILABLE, then post. */
export async function linkedinPostVideo(o: { token: string; author: string; file: string; text: string; title?: string }) {
  const size = fs.statSync(o.file).size;
  const init = await call<any>("LinkedIn", "https://api.linkedin.com/rest/videos?action=initializeUpload", {
    method: "POST",
    headers: rest(o.token, { "content-type": "application/json" }),
    body: JSON.stringify({ initializeUploadRequest: { owner: o.author, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false } }),
  });
  const v = init.value;
  const fd = fs.openSync(o.file, "r");
  const etags: string[] = [];
  try {
    for (const ins of v.uploadInstructions as { uploadUrl: string; firstByte: number; lastByte: number }[]) {
      const len = ins.lastByte - ins.firstByte + 1;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, ins.firstByte);
      const put = await fetch(ins.uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${o.token}`, "content-type": "application/octet-stream" }, body: buf });
      if (!put.ok) throw new Error(`LinkedIn upload part ${put.status}: ${(await put.text()).slice(0, 200)}`);
      etags.push(put.headers.get("etag") || "");
    }
  } finally {
    fs.closeSync(fd);
  }
  await call("LinkedIn", "https://api.linkedin.com/rest/videos?action=finalizeUpload", {
    method: "POST",
    headers: rest(o.token, { "content-type": "application/json" }),
    body: JSON.stringify({ finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken || "", uploadedPartIds: etags } }),
  });
  for (let i = 0; i < 40; i++) {
    const st = await call<any>("LinkedIn", `https://api.linkedin.com/rest/videos/${encodeURIComponent(v.video)}`, { headers: rest(o.token) });
    if (st.status === "AVAILABLE") break;
    if (st.status === "PROCESSING_FAILED") throw new Error(`LinkedIn couldn't process the video: ${st.processingFailureReason || ""}`);
    await sleep(6000);
  }
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: rest(o.token, { "content-type": "application/json" }),
    body: JSON.stringify({
      author: o.author,
      commentary: littleText(o.text).slice(0, 2900),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { id: v.video, title: (o.title || "").slice(0, 200) } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn post ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const id = res.headers.get("x-restli-id") || "";
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null };
}
