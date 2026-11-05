import { raw, one, run, now, json, daysAgo } from "@/db";
import { account, accessToken } from "@/lib/accounts";
import { env, setting, settingNum } from "@/lib/config";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/secure";
import { checkText, type Check } from "@/lib/compliance";
import { claude, extractJson } from "@/lib/claude";
import { speaker as getSpeaker } from "@/lib/speakers";
import { NICHE_RULES } from "@/lib/niche";
import { logUsage } from "@/lib/agents";
import { dmLink } from "@/lib/publish";
import { igRecentMedia, igComments, igCommentCount, igPrivateReply, igReplyComment } from "@/lib/platforms/meta";

/**
 * Instagram comments, read every 15 minutes (Meta only sends comment webhooks to apps with Advanced Access
 * and business verification; this hub stays in Development mode, so it asks instead).
 *
 *  Comment-to-DM — someone comments the speaker's keyword ("CLASS") → one DM with the tracked webinar link.
 *    The DM text is written by the team and switched on by an owner or admin; the hub only ever sends that text.
 *    Meta allows one private reply per comment, within 7 days of it.
 *  Reply drafts — comments that ask something get a drafted reply; a person approves each one before it posts.
 */

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The keyword as a whole word, any case: "class", "CLASS!" and "Class please" all count; "classic" doesn't. */
export function keywordHit(text: string, keyword: string) {
  const k = keyword.trim();
  if (!k) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(k)}($|[^\\p{L}\\p{N}])`, "iu").test(text || "");
}

/** Worth a reply: a question, or a real sentence — not just "🔥🔥" or "nice". */
export function needsReply(text: string) {
  const t = (text || "").trim();
  if (!t) return false;
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (letters < 4) return false;
  if (/\?/.test(t)) return true;
  if (/^(how|what|why|when|where|which|who|can|could|should|is|are|do|does|will|kya|kaise|kab)\b/i.test(t)) return true;
  return letters >= 40;
}

export const DM_STATUSES = ["sent", "dry_run", "failed", "skipped", "no_match", "sending"] as const;

/** Worker: new comments on the last week's posts for one Instagram account, then any DMs they call for. */
export async function pullComments(accountId: number) {
  const a = account(accountId);
  if (!a || a.platform !== "instagram" || a.status !== "connected") return { added: 0 };
  const token = await accessToken(a);
  const meta = json<any>(a.meta, {});
  const seen: Record<string, number> = meta.commentCounts || {};
  const weekAgo = Date.now() - 7 * 864e5;
  const media = (await igRecentMedia(a.external_id!, token, 25)).filter((m: any) => new Date(m.timestamp).getTime() > weekAgo);
  const counts: Record<string, number> = {};
  for (const m of media) counts[m.id] = Number(m.comments_count ?? 0);
  // Trial reels don't always show in the recent-media list, so the hub's own live trials are checked by id.
  const trials = raw<any>(`SELECT media_id FROM trials WHERE account_id = ? AND media_id IS NOT NULL AND media_id <> 'dry-run' AND posted_at >= ?`, [a.id, daysAgo(7)]);
  for (const t of trials.slice(0, 15)) if (counts[t.media_id] === undefined) counts[t.media_id] = await igCommentCount(t.media_id, token).catch(() => seen[t.media_id] ?? 0);
  let added = 0;
  const own = String(a.handle || "").replace(/^@/, "").toLowerCase();
  for (const [mediaId, count] of Object.entries(counts)) {
    if (count <= (seen[mediaId] ?? 0)) continue;
    const link = one<any>(`SELECT p.edit_id, e.script_id FROM posts p LEFT JOIN edits e ON e.id = p.edit_id WHERE p.account_id = ? AND p.external_id = ?`, [a.id, mediaId]);
    for (const c of await igComments(mediaId, token)) {
      const user = c.username || c.from?.username || "";
      if (own && user.toLowerCase() === own) continue;
      const r = run(
        `INSERT INTO comments (account_id, media_id, external_id, username, from_id, text, commented_at, edit_id, script_id, needs_reply, created_at)
         VALUES (@a, @m, @x, @u, @f, @t, @at, @e, @s, @nr, @now) ON CONFLICT(account_id, external_id) DO NOTHING`,
        { a: a.id, m: mediaId, x: c.id, u: user || null, f: c.from?.id || null, t: c.text || "", at: c.timestamp ? new Date(c.timestamp).toISOString() : now(), e: link?.edit_id ?? null, s: link?.script_id ?? null, nr: needsReply(c.text) ? 1 : 0, now: now() },
      );
      if (r.changes) added++;
    }
  }
  run(`UPDATE accounts SET meta = ? WHERE id = ?`, [JSON.stringify({ ...meta, commentCounts: counts }), a.id]);
  const dms = await sendPendingDms(a.id);
  if (added && setting("reply_drafts") !== "off") {
    const waiting = one<{ n: number }>(`SELECT COUNT(*) AS n FROM comments WHERE account_id = ? AND needs_reply = 1 AND reply_status IS NULL AND COALESCE(dm_status, '') NOT IN ('sent','dry_run')`, [a.id])?.n ?? 0;
    if (waiting) enqueue("agent", { agent: "reply_drafter", speakerId: a.speaker_id });
  }
  return { added, dms };
}

/** Every comment not yet looked at for a DM, against the speaker's switched-on keywords. */
export async function sendPendingDms(accountId: number) {
  const a = account(accountId);
  if (!a) return 0;
  const pending = raw<any>(`SELECT * FROM comments WHERE account_id = ? AND dm_status IS NULL AND commented_at >= ? ORDER BY commented_at`, [a.id, daysAgo(7)]);
  let sent = 0;
  for (const c of pending) {
    // Read the switched-on keywords fresh for every comment: one switched off (or edited) mid-batch stops at once.
    const rules = raw<any>(`SELECT * FROM dm_rules WHERE speaker_id = ? AND status = 'on'`, [a.speaker_id]);
    const rule = rules.find((r) => keywordHit(c.text, r.keyword));
    if (!rule) {
      run(`UPDATE comments SET dm_status = 'no_match' WHERE id = ?`, [c.id]);
      continue;
    }
    // Only comments made after the keyword was switched on — never DM people about old comments.
    if (!rule.approved_at || c.commented_at < rule.approved_at) {
      run(`UPDATE comments SET dm_status = 'skipped', dm_error = 'Commented before this keyword was switched on.', dm_rule_id = ? WHERE id = ?`, [rule.id, c.id]);
      continue;
    }
    const lastHour = one<{ n: number }>(`SELECT COUNT(*) AS n FROM comments WHERE account_id = ? AND dm_status IN ('sent','dry_run') AND dm_at >= ?`, [a.id, new Date(Date.now() - 3600e3).toISOString()])?.n ?? 0;
    if (lastHour >= settingNum("dm_per_hour")) break; // the rest wait for the next round
    const who = c.from_id || c.username;
    const already = who
      ? one(`SELECT id FROM comments WHERE account_id = ? AND id <> ? AND (from_id = ? OR username = ?) AND dm_status IN ('sent','dry_run') AND dm_at >= ?`, [a.id, c.id, who, who, new Date(Date.now() - 24 * 3600e3).toISOString()])
      : null;
    if (already) {
      run(`UPDATE comments SET dm_status = 'skipped', dm_error = 'Already sent this person the link in the last 24 hours.', dm_rule_id = ? WHERE id = ?`, [rule.id, c.id]);
      continue;
    }
    const code = dmLink(a.speaker_id, c.script_id ?? null);
    const url = code ? `${env.appUrl()}/r/${code}` : "";
    const text = rule.message.includes("{link}") ? rule.message.replace(/\{link\}/g, url) : `${rule.message.trim()}\n\n${url}`.trim();
    // Claim the comment first, so two reads running at once can never DM the same person twice.
    if (!run(`UPDATE comments SET dm_status = 'sending', dm_rule_id = ? WHERE id = ? AND dm_status IS NULL`, [rule.id, c.id]).changes) continue;
    try {
      if (env.dryRun()) {
        run(`UPDATE comments SET dm_status = 'dry_run', dm_rule_id = ?, dm_at = ?, dm_link_code = ? WHERE id = ?`, [rule.id, now(), code, c.id]);
      } else {
        await igPrivateReply(a.external_id!, await accessToken(a), c.external_id, text);
        run(`UPDATE comments SET dm_status = 'sent', dm_rule_id = ?, dm_at = ?, dm_link_code = ?, dm_error = NULL WHERE id = ?`, [rule.id, now(), code, c.id]);
        if (rule.public_reply) await igReplyComment(c.external_id, await accessToken(a), rule.public_reply).catch(() => null);
      }
      sent++;
    } catch (e) {
      run(`UPDATE comments SET dm_status = 'failed', dm_rule_id = ?, dm_error = ? WHERE id = ?`, [rule.id, String((e as Error).message).slice(0, 500), c.id]);
    }
  }
  return sent;
}

/* ───────── DM keywords ───────── */

export function saveDmRule(o: { id?: number; speakerId: number; keyword: string; message: string; publicReply?: string | null }, userId: number) {
  // An existing keyword always keeps its own speaker (the form can't move it, or check it against another niche).
  const existing = o.id ? one<any>(`SELECT speaker_id FROM dm_rules WHERE id = ?`, [o.id]) : null;
  if (o.id && !existing) throw new Error("No such keyword");
  const sp = getSpeaker(existing ? existing.speaker_id : o.speakerId);
  if (!sp) throw new Error("Pick a speaker.");
  const keyword = o.keyword.trim().replace(/^["'#]|["']$/g, "");
  if (!/^[\p{L}\p{N}]{2,20}$/u.test(keyword)) throw new Error("The keyword is one word, 2–20 letters or numbers (like CLASS).");
  const nl = (x: string | null | undefined) => String(x || "").replace(/\r\n?/g, "\n").trim();
  const message = nl(o.message);
  if (message.length < 10) throw new Error("Write the DM people get.");
  if (message.length > 900) throw new Error("Keep the DM under 900 characters.");
  const clash = one<any>(`SELECT id FROM dm_rules WHERE speaker_id = ? AND lower(keyword) = lower(?) AND id <> ?`, [sp.id, keyword, o.id || 0]);
  if (clash) throw new Error("This speaker already has that keyword.");
  const check: Check = checkText([message, o.publicReply || ""].join("\n"), sp.niche);
  if (o.id) {
    const cur = one<any>(`SELECT keyword, message, public_reply FROM dm_rules WHERE id = ?`, [o.id]);
    // Saving with nothing changed keeps it as it is (a live keyword stays on).
    if (cur && cur.keyword === keyword.toUpperCase() && nl(cur.message) === message && (nl(cur.public_reply) || null) === (nl(o.publicReply) || null)) return { id: o.id, check, unchanged: true };
    // Any change to the words needs switching on again by an owner or admin.
    run(`UPDATE dm_rules SET keyword = ?, message = ?, public_reply = ?, compliance = ?, status = 'draft', approved_by = NULL, approved_at = NULL, updated_at = ? WHERE id = ?`, [
      keyword.toUpperCase(), message, o.publicReply?.trim() || null, JSON.stringify(check), now(), o.id,
    ]);
    audit(userId, "edit_dm_rule", "dm_rule", o.id);
    return { id: o.id, check };
  }
  const r = run(
    `INSERT INTO dm_rules (speaker_id, keyword, message, public_reply, status, compliance, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    [sp.id, keyword.toUpperCase(), message, o.publicReply?.trim() || null, JSON.stringify(check), userId, now(), now()],
  );
  audit(userId, "add_dm_rule", "dm_rule", Number(r.lastInsertRowid));
  return { id: Number(r.lastInsertRowid), check };
}

export function switchDmRule(id: number, on: boolean, userId: number) {
  const r = one<any>(`SELECT * FROM dm_rules WHERE id = ?`, [id]);
  if (!r) throw new Error("No such keyword");
  if (on && json<any>(r.compliance, {}).status === "block") throw new Error("The DM breaks a blocking rule — change the words first.");
  if (on) run(`UPDATE dm_rules SET status = 'on', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`, [userId, now(), now(), id]);
  else run(`UPDATE dm_rules SET status = 'off', updated_at = ? WHERE id = ?`, [now(), id]);
  audit(userId, on ? "dm_rule_on" : "dm_rule_off", "dm_rule", id);
}

/** The keyword the scripts should ask for, if this speaker has one switched on. */
export function activeKeyword(speakerId: number) {
  return one<{ keyword: string }>(`SELECT keyword FROM dm_rules WHERE speaker_id = ? AND status = 'on' ORDER BY id LIMIT 1`, [speakerId])?.keyword || null;
}

/* ───────── reply drafts ───────── */

const SYSTEM = `You reply to Instagram comments for an Indian educator, in their voice: warm, short, specific, plain English.
One or two sentences. Never give advice the rules below forbid. If a comment asks for personal advice (which stock, which coin,
a diagnosis, how much they'll earn), say kindly that you can't advise one person here and point to the free education instead.
Skip spam, abuse, and comments with nothing to answer. Reply with JSON only.`;

/** Agent: drafts replies for this speaker's comments that ask something. A person approves each one. */
export async function draftReplies(speakerId: number) {
  const sp = getSpeaker(speakerId);
  if (!sp) return { drafted: 0 };
  const rows = raw<any>(
    `SELECT c.id, c.text, c.username, s.hook, s.title FROM comments c JOIN accounts a ON a.id = c.account_id LEFT JOIN scripts s ON s.id = c.script_id
     WHERE a.speaker_id = ? AND c.needs_reply = 1 AND c.reply_status IS NULL AND COALESCE(c.dm_status, '') NOT IN ('sent','dry_run') AND c.commented_at >= ?
     ORDER BY c.commented_at DESC LIMIT 25`,
    [speakerId, daysAgo(7)],
  );
  if (!rows.length) return { drafted: 0 };
  const user = `SPEAKER: ${sp.name}. HOW THEY SPEAK: ${sp.voice_notes || "plain, warm, direct"}.
RULES FOR THIS NICHE:
${NICHE_RULES[sp.niche] || ""}
NEVER: ${sp.stop_list.join("; ")}

COMMENTS (with the reel they're on):
${rows.map((r) => JSON.stringify({ id: r.id, on_reel: r.hook || r.title || "", from: r.username, comment: r.text })).join("\n")}

Return [{"id": the comment id, "reply": the reply, or null to skip, "why": a few words}].`;
  const { text, model, usage } = await claude({ system: SYSTEM, user, maxTokens: 3000, temperature: 0.6 });
  logUsage("reply_drafter", speakerId, model, usage);
  const out = extractJson<{ id: number; reply: string | null; why?: string }[]>(text);
  let drafted = 0;
  for (const d of Array.isArray(out) ? out : []) {
    const row = rows.find((r) => r.id === Number(d.id));
    if (!row) continue;
    const reply = String(d.reply || "").trim();
    if (!reply) {
      run(`UPDATE comments SET reply_status = 'rejected', reply_error = ? WHERE id = ? AND reply_status IS NULL`, [`Skipped by the drafter: ${String(d.why || "nothing to answer").slice(0, 200)}`, row.id]);
      continue;
    }
    // A draft that breaks a blocking rule isn't saved as a draft at all.
    if (checkText(reply, sp.niche).status === "block") continue;
    run(`UPDATE comments SET reply_status = 'drafted', reply_text = ? WHERE id = ? AND reply_status IS NULL`, [reply.slice(0, 600), row.id]);
    drafted++;
  }
  return { drafted };
}

/** An owner or admin approves a reply (as drafted, or edited); it posts under the comment. */
export function approveReply(commentId: number, text: string, userId: number) {
  const c = one<any>(`SELECT c.*, sp.niche FROM comments c JOIN accounts a ON a.id = c.account_id JOIN speakers sp ON sp.id = a.speaker_id WHERE c.id = ?`, [commentId]);
  if (!c) throw new Error("No such comment");
  if (c.reply_status === "posted" || c.reply_status === "posting") throw new Error("Already replied.");
  const reply = text.trim();
  if (reply.length < 2) throw new Error("Write the reply first.");
  if (checkText(reply, c.niche).status === "block") throw new Error("That reply breaks a blocking rule.");
  run(`UPDATE comments SET reply_status = 'posting', reply_text = ?, reply_by = ?, reply_error = NULL WHERE id = ?`, [reply.slice(0, 600), userId, commentId]);
  audit(userId, "approve_reply", "comment", commentId);
  enqueue("post_reply", { commentId });
}

/** Worker: post an approved reply. */
export async function postReply(commentId: number) {
  const c = one<any>(`SELECT * FROM comments WHERE id = ?`, [commentId]);
  if (!c || c.reply_status !== "posting") return;
  try {
    let id = "dry-run";
    if (!env.dryRun()) id = await igReplyComment(c.external_id, await accessToken(account(c.account_id)!), c.reply_text);
    run(`UPDATE comments SET reply_status = 'posted', reply_external_id = ?, reply_at = ? WHERE id = ?`, [id, now(), commentId]);
  } catch (e) {
    run(`UPDATE comments SET reply_status = 'error', reply_error = ? WHERE id = ?`, [String((e as Error).message).slice(0, 500), commentId]);
    throw e;
  }
}

export function commentRows(filter: "questions" | "dms" | "all", speakerId?: number) {
  const where =
    filter === "questions"
      ? `c.needs_reply = 1 AND (c.reply_status IS NULL OR c.reply_status IN ('drafted','error'))`
      : filter === "dms"
        ? `c.dm_status IN ('sent','dry_run','failed','skipped','sending')`
        : "1=1";
  return raw<any>(
    `SELECT c.*, sp.name AS speaker, sp.id AS speaker_id, p.permalink, s.hook, s.title, r.keyword
     FROM comments c JOIN accounts a ON a.id = c.account_id JOIN speakers sp ON sp.id = a.speaker_id
     LEFT JOIN posts p ON p.account_id = c.account_id AND p.external_id = c.media_id
     LEFT JOIN scripts s ON s.id = c.script_id LEFT JOIN dm_rules r ON r.id = c.dm_rule_id
     WHERE ${where} ${speakerId ? "AND sp.id = @sid" : ""} ORDER BY c.commented_at DESC LIMIT 200`,
    { sid: speakerId },
  );
}

/** For the Growth page: DMs sent and the clicks on DM links. */
export function dmStats(speakerId: number, days = 30) {
  const since = daysAgo(days);
  const sent = one<{ n: number }>(`SELECT COUNT(*) AS n FROM comments c JOIN accounts a ON a.id = c.account_id WHERE a.speaker_id = ? AND c.dm_status IN ('sent','dry_run') AND c.dm_at >= ?`, [speakerId, since])?.n ?? 0;
  const clicks = one<{ n: number }>(`SELECT COUNT(*) AS n FROM link_clicks k JOIN links l ON l.code = k.code WHERE l.speaker_id = ? AND l.kind = 'dm' AND k.at >= ?`, [speakerId, since])?.n ?? 0;
  return { sent, clicks };
}
