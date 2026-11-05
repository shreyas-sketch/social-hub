import crypto from "node:crypto";
import { one, run, now } from "@/db";
import { env } from "@/lib/config";
import { seal, unseal, audit } from "@/lib/secure";
import { saveConnection, redirectUri } from "@/lib/accounts";
import { enqueue } from "@/lib/jobs";
import type { Platform } from "@/lib/speakers";
import { metaAuthUrl, metaExchange, metaPages, type MetaPage } from "@/lib/platforms/meta";
import { googleAuthUrl, googleExchange, myChannel } from "@/lib/platforms/youtube";
import { linkedinAuthUrl, linkedinExchange, linkedinMe } from "@/lib/platforms/linkedin";
import { pkce, xAuthUrl, xExchange, xMe } from "@/lib/platforms/x";

/**
 * Connecting an account = the speaker (or whoever holds the login) signs in to
 * the platform and says yes. We never see or store their password — only the
 * token the platform hands back, encrypted.
 *
 * Instagram and Facebook connect together through one Meta sign-in. If the
 * person manages several Pages (e.g. the team is admin on all five speakers'
 * Pages), one sign-in can connect them all from the picker.
 */
export type OAuthPlatform = "meta" | "youtube" | "linkedin" | "x";

export function configured(p: OAuthPlatform) {
  if (p === "meta") return !!(env.metaAppId() && env.metaAppSecret());
  if (p === "youtube") return !!(env.googleClientId() && env.googleClientSecret());
  if (p === "linkedin") return !!(env.linkedinClientId() && env.linkedinClientSecret());
  return !!(env.xClientId() && env.xClientSecret());
}

export function startUrl(p: OAuthPlatform, speakerId: number, userId: number | null) {
  if (!configured(p)) throw new Error(`The ${p} app keys aren't set on the server yet (see Settings → Integrations).`);
  const state = crypto.randomBytes(18).toString("base64url");
  let verifier: string | null = null;
  let url: string;
  const ru = redirectUri(p);
  if (p === "meta") url = metaAuthUrl(state, ru);
  else if (p === "youtube") url = googleAuthUrl(state, ru);
  else if (p === "linkedin") url = linkedinAuthUrl(state, ru);
  else {
    const k = pkce();
    verifier = k.verifier;
    url = xAuthUrl(state, ru, k.challenge);
  }
  run(`DELETE FROM oauth_states WHERE created_at < ?`, [new Date(Date.now() - 864e5).toISOString()]);
  run(`INSERT INTO oauth_states (state, platform, speaker_id, verifier, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [state, p, speakerId, verifier, userId, now()]);
  return url;
}

function takeState(state: string, p: OAuthPlatform) {
  const s = one<any>(`SELECT * FROM oauth_states WHERE state = ? AND platform = ?`, [state, p]);
  if (!s) throw new Error("This sign-in link has expired. Start again from the Accounts page.");
  if (Date.now() - new Date(s.created_at).getTime() > 20 * 60e3) throw new Error("This sign-in took too long. Start again from the Accounts page.");
  return s;
}

/** Returns where to send the person next. */
export async function finishOAuth(p: OAuthPlatform, code: string, state: string): Promise<string> {
  const s = takeState(state, p);
  const ru = redirectUri(p);
  const speakerId = Number(s.speaker_id);
  const userId = s.user_id ? Number(s.user_id) : null;

  if (p === "meta") {
    const { userToken } = await metaExchange(code, ru);
    const pages = await metaPages(userToken);
    if (!pages.length) throw new Error("This Facebook login doesn't manage any Pages. The Instagram account must be a Business/Creator account linked to a Facebook Page.");
    // Keep the list (tokens sealed) for the picker, then let a person choose which Page belongs to which speaker.
    run(`UPDATE oauth_states SET verifier = ?, created_at = ? WHERE state = ?`, [seal(JSON.stringify(pages)), now(), state]);
    return `/connect/pick?state=${encodeURIComponent(state)}`;
  }

  run(`DELETE FROM oauth_states WHERE state = ?`, [state]);
  if (p === "youtube") {
    const t = await googleExchange(code, ru);
    const ch = await myChannel(t.accessToken);
    const id = saveConnection(speakerId, "youtube", {
      externalId: ch.id,
      handle: ch.handle || ch.title,
      url: ch.handle ? `https://www.youtube.com/${ch.handle}` : `https://www.youtube.com/channel/${ch.id}`,
      token: t.accessToken,
      refresh: t.refreshToken,
      expiresAt: t.expiresAt,
      meta: { uploads: ch.uploads, title: ch.title, canUpload: t.canUpload },
    });
    after(id, userId, "youtube");
  } else if (p === "linkedin") {
    const t = await linkedinExchange(code, ru);
    const me = await linkedinMe(t.accessToken);
    const id = saveConnection(speakerId, "linkedin", { externalId: me.urn, token: t.accessToken, refresh: t.refreshToken, expiresAt: t.expiresAt, meta: { name: me.name } });
    after(id, userId, "linkedin");
  } else {
    const t = await xExchange(code, ru, s.verifier);
    const me = await xMe(t.accessToken);
    const id = saveConnection(speakerId, "x", { externalId: me.id, handle: `@${me.username}`, url: `https://x.com/${me.username}`, token: t.accessToken, refresh: t.refreshToken, expiresAt: t.expiresAt });
    after(id, userId, "x");
  }
  return `/connect/done?ok=${p}`;
}

function after(accountId: number, userId: number | null, platform: string) {
  audit(userId, "connect_account", "account", accountId, { platform });
  enqueue("pull_stats", { accountId });
}

/** The Meta picker: the Pages from the sign-in, for the screen that assigns them to speakers. */
export function pickerPages(state: string): { pages: MetaPage[]; speakerId: number } {
  const s = takeState(state, "meta");
  const pages = JSON.parse(unseal(s.verifier) || "[]") as MetaPage[];
  return { pages, speakerId: Number(s.speaker_id) };
}

/** Saves the Pages a person assigned. Page tokens from a long-lived login don't expire, but Meta asks people to sign in again every ~90 days. */
export function savePicked(state: string, choice: Record<string, number>, userId: number | null, canAssignAny: boolean) {
  const { pages, speakerId: linkSpeaker } = pickerPages(state);
  const picked = Object.entries(choice).filter(([pageId, sp]) => sp && pages.some((p) => p.id === pageId));
  if (!picked.length) throw new Error("Choose a speaker for at least one Page.");
  // Someone using a speaker's connect link (no hub sign-in, or a team login) can only connect that speaker.
  if (!canAssignAny && picked.some(([, sp]) => sp !== linkSpeaker)) throw new Error("This link can only connect its own speaker's Page.");
  const seen = new Set<number>();
  for (const [, sp] of picked) {
    if (seen.has(sp)) throw new Error("Two Pages are set to the same speaker. Each speaker gets one Page.");
    seen.add(sp);
  }
  const expires = new Date(Date.now() + 85 * 864e5).toISOString();
  let n = 0;
  for (const pg of pages) {
    const speakerId = choice[pg.id];
    if (!speakerId) continue;
    const fb = saveConnection(speakerId, "facebook", { externalId: pg.id, handle: pg.name, url: `https://www.facebook.com/${pg.id}`, token: pg.access_token, pageToken: pg.access_token, expiresAt: expires });
    after(fb, userId, "facebook");
    n++;
    if (pg.ig) {
      const ig = saveConnection(speakerId, "instagram", {
        externalId: pg.ig.id,
        handle: `@${pg.ig.username}`,
        url: `https://www.instagram.com/${pg.ig.username}/`,
        token: pg.access_token,
        pageToken: pg.access_token,
        expiresAt: expires,
        meta: { page_id: pg.id },
      });
      after(ig, userId, "instagram");
      n++;
    }
  }
  run(`DELETE FROM oauth_states WHERE state = ?`, [state]);
  return n;
}

export const PLATFORM_OAUTH: Record<Platform, OAuthPlatform> = { instagram: "meta", facebook: "meta", youtube: "youtube", linkedin: "linkedin", x: "x" };

