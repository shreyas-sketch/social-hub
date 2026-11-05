import { one, raw, run, now, json } from "@/db";
import { accessToken, pageToken, ensureAccount, youtubeCanUpload } from "@/lib/accounts";
import { env, setting } from "@/lib/config";
import { abs } from "@/lib/media";
import { publicMediaUrl, randomCode, audit } from "@/lib/secure";
import { finalCaption } from "@/lib/compliance";
import { PLATFORM_LABEL, type Platform } from "@/lib/speakers";
import { enqueue } from "@/lib/jobs";
import { fbPublishReel } from "@/lib/platforms/meta";
import { linkedinPostVideo } from "@/lib/platforms/linkedin";
import { xPostVideo } from "@/lib/platforms/x";
import { uploadShort } from "@/lib/platforms/youtube";

/** A short tracking link per post, so we can see which reel sent people to the ₹99 webinar. */
export function makeLink(speakerId: number, scriptId: number | null, platform: string, kind: "post" | "dm" | "long" | "text" = "post"): string | null {
  const sp = one<any>(`SELECT program_url FROM speakers WHERE id = ?`, [speakerId]);
  if (!sp?.program_url) return null;
  const code = randomCode();
  run(`INSERT INTO links (code, speaker_id, script_id, platform, target_url, clicks, kind, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`, [code, speakerId, scriptId, platform, sp.program_url, kind, now()]);
  return code;
}

/** One DM link per speaker and reel (or per speaker when the reel isn't one of ours), reused for every DM it sends. */
export function dmLink(speakerId: number, scriptId: number | null) {
  const have = one<any>(`SELECT code FROM links WHERE speaker_id = ? AND kind = 'dm' AND platform = 'instagram' AND script_id IS ?`, [speakerId, scriptId]);
  return have?.code || makeLink(speakerId, scriptId, "instagram", "dm");
}

/** What a tracking link says in utm_content, so the webinar side can tell bio, reel, DM and long video apart. */
export function utmContent(l: { kind?: string | null; script_id?: number | null; code: string }) {
  if (l.kind === "bio") return "bio";
  if (!l.kind || l.kind === "post") return `script-${l.script_id}`;
  return `${l.kind}-${l.script_id ?? l.code}`;
}

/** Platforms whose post text carries the tracking link (Settings). Off by default on X (a post with a link costs ~13× more through the API and reaches fewer people) and Facebook (Meta says captions without links do best). */
export function linkPlatforms(): string[] {
  return setting("link_platforms").split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/** One fixed tracking link per speaker and platform for the profile bio, so bio clicks are counted too. */
export function bioLink(speakerId: number, platform: string) {
  const sp = one<any>(`SELECT slug, program_url FROM speakers WHERE id = ?`, [speakerId]);
  if (!sp?.program_url) return null;
  const code = `${sp.slug}-${platform}`.toLowerCase();
  const have = one<any>(`SELECT code, clicks FROM links WHERE code = ?`, [code]);
  if (!have) run(`INSERT INTO links (code, speaker_id, script_id, platform, target_url, clicks, kind, created_at) VALUES (?, ?, NULL, ?, ?, 0, 'bio', ?)`, [code, speakerId, platform, sp.program_url, now()]);
  // Follows the webinar page if it changes (writes only when it did).
  else run(`UPDATE links SET target_url = ? WHERE code = ? AND target_url IS NOT ?`, [sp.program_url, code, sp.program_url]);
  return { url: `${env.appUrl()}/r/${code}`, clicks: have?.clicks ?? 0 };
}

export function linkTarget(code: string) {
  const l = one<any>(`SELECT l.*, sp.slug FROM links l LEFT JOIN speakers sp ON sp.id = l.speaker_id WHERE l.code = ?`, [code]);
  if (!l) return null;
  run(`UPDATE links SET clicks = clicks + 1, last_click_at = ? WHERE code = ?`, [now(), code]);
  // Each click is kept with its time, so the Growth page can show clicks per 1,000 views over any window.
  run(`INSERT INTO link_clicks (code, at) VALUES (?, ?)`, [code, now()]);
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(l.target_url) ? l.target_url : `https://${l.target_url}`);
  } catch {
    return env.appUrl();
  }
  u.searchParams.set("utm_source", l.platform || "social");
  u.searchParams.set("utm_medium", "social");
  u.searchParams.set("utm_campaign", "social-hub");
  u.searchParams.set("utm_content", utmContent(l));
  // utm_term = the speaker and utm_id = the link, so a sign-up can be sent back to the hub and counted against the right reel.
  if (l.slug) u.searchParams.set("utm_term", l.slug);
  u.searchParams.set("utm_id", code);
  return u.toString();
}

const linkUrl = (code: string | null) => (code ? `${env.appUrl()}/r/${code}` : null);

/**
 * Length the way X counts it: links are 23, most Latin text 1 per character,
 * everything else (Devanagari, emoji, CJK) 2 per character.
 */
export function xLength(text: string) {
  const urls = text.match(/https?:\/\/\S+/g) || [];
  let rest = text;
  for (const u of urls) rest = rest.replace(u, "");
  let n = urls.length * 23;
  for (const ch of Array.from(rest)) {
    const c = ch.codePointAt(0)!;
    n += c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037) ? 1 : 2;
  }
  return n;
}

/** What goes out on each platform, built from one script. */
export function captionFor(platform: Platform, s: any, link: string | null) {
  if (platform === "x") {
    // Hook + link + short legal line, and never over 280: the hook gives way, never the disclaimer.
    const tail = [link, s.screen_disclaimer || s.caption_disclaimer || ""].filter(Boolean).join("\n\n");
    const room = 280 - (tail ? xLength(tail) + 2 : 0);
    let head = String(s.hook || "");
    if (xLength(head) > room) {
      const chars = Array.from(head);
      while (chars.length && xLength(chars.join("") + "…") > room) chars.pop();
      head = chars.join("").trimEnd() + "…";
    }
    return tail ? `${head}\n\n${tail}` : head;
  }
  if (platform === "linkedin") {
    // LinkedIn holds back posts whose text doesn't match the video, and engagement bait: use the script's own LinkedIn text, no hashtags.
    const body = String(s.linkedin_text || "").trim() || [s.hook, s.caption].filter(Boolean).join("\n\n");
    return finalCaption(body, null, s.caption_disclaimer, link ? `Free webinar: ${link}` : null);
  }
  return finalCaption(s.caption || s.hook, s.hashtags, s.caption_disclaimer, link ? `Free webinar: ${link}` : null);
}

/**
 * A named person sends a winner to the other platforms.
 * Instagram: the trial graduates in the app (Meta has no API for it), so it's a manual step.
 * YouTube: a manual upload until Google audits the app.
 */
export function sendEverywhere(editId: number, platforms: Platform[], userId: number) {
  const e = one<any>(
    `SELECT e.*, s.id AS sid, s.speaker_id, s.title, s.hook, s.caption, s.hashtags, s.compliance, s.linkedin_text, sp.caption_disclaimer, sp.screen_disclaimer
     FROM edits e JOIN scripts s ON s.id = e.script_id JOIN speakers sp ON sp.id = s.speaker_id WHERE e.id = ?`,
    [editId],
  );
  if (!e) throw new Error("No such edit");
  const t = one<any>(`SELECT verdict FROM trials WHERE edit_id = ? ORDER BY id DESC LIMIT 1`, [editId]);
  if (t?.verdict !== "winner") throw new Error("Only a winning trial can be sent everywhere.");
  if (json<any>(e.compliance, {}).status === "block") throw new Error("The script now breaks a blocking rule. Fix it on the script page first.");
  const made: number[] = [];
  for (const p of platforms) {
    const dup = one(`SELECT id FROM publishes WHERE edit_id = ? AND platform = ? AND status NOT IN ('error','skipped')`, [editId, p]);
    if (dup) continue;
    const acc = ensureAccount(e.speaker_id, p);
    let mode = "api";
    let status = "queued";
    let error: string | null = null;
    if (p === "instagram") {
      mode = "manual";
      status = setting("trial_graduation") === "SS_PERFORMANCE" ? "skipped" : "manual_todo";
      error = status === "skipped" ? "Instagram graduates trials on its own (setting)." : null;
    } else if (p === "youtube" && !youtubeCanUpload(acc)) {
      mode = "manual";
      status = "manual_todo";
      // Uploads are switched on, but this channel was connected without upload permission.
      if (env.youtubeUploadEnabled() && acc.status === "connected") error = "This channel was connected without upload permission — connect it again on Accounts. Upload this one by hand.";
    } else if (acc.status !== "connected") {
      status = "skipped";
      error = `${PLATFORM_LABEL[p]} isn't connected for this speaker.`;
    }
    // Instagram keeps the trial caption (no clickable links there); skipped posts get no link.
    // YouTube descriptions always carry the link (it's free and expected there); others follow Settings.
    const wantsLink = p === "youtube" || linkPlatforms().includes(p);
    const code = p === "instagram" || status === "skipped" || !wantsLink ? null : makeLink(e.speaker_id, e.sid, p);
    const link = linkUrl(code);
    const title = p === "youtube" ? `${e.hook}`.slice(0, 92) + " #shorts" : e.title;
    const r = run(
      `INSERT INTO publishes (edit_id, account_id, platform, mode, status, title, caption, link_code, approved_by, approved_at, error, created_at, updated_at)
       VALUES (@e, @a, @p, @mode, @status, @title, @caption, @code, @u, @at, @err, @at, @at)`,
      { e: editId, a: acc.id, p, mode, status, title, caption: captionFor(p, e, link), code, u: userId, at: now(), err: error },
    );
    const id = Number(r.lastInsertRowid);
    made.push(id);
    if (status === "queued") enqueue("publish", { publishId: id });
  }
  audit(userId, "send_everywhere", "edit", editId, { platforms });
  return made;
}

/** Worker: one post to one platform. */
export async function runPublish(publishId: number) {
  const p = one<any>(`SELECT pb.*, e.output_path FROM publishes pb JOIN edits e ON e.id = pb.edit_id WHERE pb.id = ?`, [publishId]);
  if (!p || p.status !== "queued") return;
  run(`UPDATE publishes SET status = 'running', updated_at = ? WHERE id = ?`, [now(), publishId]);
  try {
    const acc = one<any>(`SELECT * FROM accounts WHERE id = ?`, [p.account_id]);
    if (!acc) throw new Error("No account");
    let externalId = "";
    let permalink: string | null = null;
    if (env.dryRun()) {
      externalId = "dry-run";
    } else if (p.platform === "facebook") {
      externalId = await fbPublishReel({ pageId: acc.external_id, pageToken: pageToken(acc), fileUrl: publicMediaUrl(p.output_path, 24), description: p.caption });
      permalink = `https://www.facebook.com/reel/${externalId}`;
    } else if (p.platform === "linkedin") {
      const r = await linkedinPostVideo({ token: await accessToken(acc), author: acc.external_id, file: abs(p.output_path), text: p.caption, title: p.title });
      externalId = r.id;
      permalink = r.url;
    } else if (p.platform === "x") {
      const r = await xPostVideo({ token: await accessToken(acc), file: abs(p.output_path), text: p.caption });
      externalId = r.id;
      permalink = `https://x.com/i/status/${r.id}`;
    } else if (p.platform === "youtube") {
      const r = await uploadShort({ token: await accessToken(acc), file: abs(p.output_path), title: p.title, description: p.caption });
      externalId = r.id;
      permalink = r.url;
    } else {
      throw new Error(`Can't post to ${p.platform} automatically`);
    }
    run(`UPDATE publishes SET status = 'done', external_id = ?, permalink = ?, done_at = ?, error = NULL, updated_at = ? WHERE id = ?`, [externalId, permalink, now(), now(), publishId]);
    run(
      `INSERT INTO posts (account_id, external_id, permalink, caption, media_type, published_at, via_hub, edit_id, is_trial, created_at)
       VALUES (@a, @x, @l, @c, @mt, @at, 1, @e, 0, @at) ON CONFLICT(account_id, external_id) DO NOTHING`,
      // A reel sent to YouTube is a Short — the Planner counts long videos separately.
      { a: acc.id, x: externalId, l: permalink, c: p.caption, mt: p.platform === "youtube" ? "SHORT" : "VIDEO", e: p.edit_id, at: now() },
    );
    audit(p.approved_by, "published", "publish", publishId, { platform: p.platform, externalId });
  } catch (err) {
    run(`UPDATE publishes SET status = 'error', error = ?, updated_at = ? WHERE id = ?`, [String((err as Error).message).slice(0, 1000), now(), publishId]);
    throw err;
  }
}

/** The team did a manual step (YouTube upload, Instagram graduation). */
export function markManualDone(publishId: number, url: string | null, userId: number) {
  const p = one<any>(`SELECT * FROM publishes WHERE id = ?`, [publishId]);
  if (!p) throw new Error("No such post");
  if (p.status !== "manual_todo") throw new Error("Only a by-hand step can be marked done here.");
  run(`UPDATE publishes SET status = 'done', permalink = COALESCE(?, permalink), done_at = ?, updated_at = ? WHERE id = ?`, [url || null, now(), now(), publishId]);
  // A YouTube link ties the Short to this reel, so the daily numbers pull credits the right script.
  const yt = p.platform === "youtube" && url ? url.match(/(?:shorts\/|v=|youtu\.be\/)([\w-]{11})/) : null;
  if (yt) {
    run(`UPDATE publishes SET external_id = ? WHERE id = ?`, [yt[1], publishId]);
    run(
      `INSERT INTO posts (account_id, external_id, permalink, media_type, published_at, via_hub, edit_id, is_trial, created_at)
       VALUES (@a, @x, @l, 'SHORT', @at, 1, @e, 0, @at)
       ON CONFLICT(account_id, external_id) DO UPDATE SET via_hub = 1, edit_id = excluded.edit_id`,
      { a: p.account_id, x: yt[1], l: url, e: p.edit_id, at: now() },
    );
  }
  audit(userId, "manual_done", "publish", publishId, { url });
}

export function retryPublish(publishId: number, userId: number) {
  run(`UPDATE publishes SET status = 'queued', error = NULL, updated_at = ? WHERE id = ? AND status = 'error'`, [now(), publishId]);
  audit(userId, "retry_publish", "publish", publishId);
  enqueue("publish", { publishId });
}

export function publishRows() {
  return raw<any>(
    `SELECT pb.*, e.thumb_path, e.output_path, s.title AS script_title, s.hook, sp.name AS speaker,
       (SELECT clicks FROM links WHERE code = pb.link_code) AS clicks
     FROM publishes pb JOIN edits e ON e.id = pb.edit_id JOIN scripts s ON s.id = e.script_id JOIN speakers sp ON sp.id = s.speaker_id
     ORDER BY CASE pb.status WHEN 'manual_todo' THEN 0 WHEN 'error' THEN 1 WHEN 'queued' THEN 2 WHEN 'running' THEN 3 ELSE 4 END, pb.id DESC LIMIT 300`,
  );
}
