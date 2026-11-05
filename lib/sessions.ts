import fs from "node:fs";
import path from "node:path";
import { raw, one, run, now, json } from "@/db";
import { abs, ensureDir, exec } from "@/lib/media";
import { env, setting, settingNum } from "@/lib/config";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/secure";
import { claude, extractJson } from "@/lib/claude";
import { checkScript, checkText, type Check } from "@/lib/compliance";
import { speaker as getSpeaker, type Speaker } from "@/lib/speakers";
import { NICHE_RULES, HOOK_TYPES } from "@/lib/scripts";
import { activeRules, logUsage } from "@/lib/agents";
import { createEdit } from "@/lib/edits";
import { transcribe, type Word } from "@/lib/edit/transcribe";
import { makeLongform, thumbnails, stamp, chapterLines, mapTime, mapWords, fixChapters, type Chapter, type Seg } from "@/lib/edit/longform";
import { makeLink } from "@/lib/publish";
import { accessToken, accountFor, ensureAccount, youtubeCanUpload } from "@/lib/accounts";
import { uploadVideo } from "@/lib/platforms/youtube";

/**
 * Long sessions: the speaker records one 60–90 minute talk, Q&A or podcast a week.
 * The hub transcribes it, picks the best 10–15 clips (each becomes a script to approve, then a normal reel cut)
 * and drafts one YouTube long-form video from the same recording (titles, description, chapters, thumbnails).
 * Nothing is posted until a person approves it.
 */
export const SESSION_KINDS: Record<string, string> = { talk: "Talk", qa: "Q&A", podcast: "Podcast / conversation", live: "Live session" };

export function createSession(o: { speakerId: number; kind: string; title: string; guest?: string | null; shootId?: number | null }, userId: number) {
  if (!getSpeaker(o.speakerId)) throw new Error("Pick a speaker.");
  const kind = SESSION_KINDS[o.kind] ? o.kind : "talk";
  const title = o.title.trim().slice(0, 140);
  if (title.length < 3) throw new Error("Give the session a short title.");
  const r = run(
    `INSERT INTO sessions (speaker_id, kind, title, guest, shoot_id, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`,
    [o.speakerId, kind, title, o.guest?.trim().slice(0, 120) || null, o.shootId || null, userId, now(), now()],
  );
  const id = Number(r.lastInsertRowid);
  if (o.shootId) run(`UPDATE shoots SET status = 'done', updated_at = ? WHERE id = ? AND status = 'planned'`, [now(), o.shootId]);
  audit(userId, "create_session", "session", id, { title });
  return id;
}

/** Called when the upload of the recording finishes. */
/** Attaches the recording once. Returns false if the session already has one (a second upload never swaps it under checked clips). */
export function attachRecording(sessionId: number, rel: string, name: string, size: number, duration: number | null) {
  const r = run(`UPDATE sessions SET raw_path = ?, raw_name = ?, raw_size = ?, duration = ?, status = 'transcribing', error = NULL, updated_at = ? WHERE id = ? AND raw_path IS NULL`, [rel, name, size, duration, now(), sessionId]);
  if (!r.changes) return false;
  enqueue("session_transcribe", { sessionId });
  return true;
}

const fail = (id: number, msg: string) => run(`UPDATE sessions SET status = 'error', error = ?, updated_at = ? WHERE id = ?`, [msg.slice(0, 1000), now(), id]);

/** Worker (heavy lane): the sound out of the recording → word timings for the whole thing. */
export async function transcribeSession(sessionId: number) {
  const s = one<any>(`SELECT * FROM sessions WHERE id = ?`, [sessionId]);
  if (!s?.raw_path) return;
  run(`UPDATE sessions SET status = 'transcribing', error = NULL, updated_at = ? WHERE id = ?`, [now(), sessionId]);
  try {
    const dir = ensureDir(`sessions/${sessionId}`);
    const wav = path.join(dir, "session.wav");
    await exec(env.ffmpeg(), ["-hide_banner", "-y", "-i", abs(s.raw_path), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeoutMs: 60 * 60e3 });
    const words = await transcribe(wav, { durationSec: s.duration || 0 });
    fs.rmSync(wav, { force: true });
    if (!words.length) {
      throw new Error(
        env.transcribeEngine() === "none"
          ? "Transcription is switched off on this server (TRANSCRIBE_ENGINE=none), so the hub can't find clips. Turn it on and press Try again."
          : "No speech found in the recording.",
      );
    }
    const rel = `sessions/${sessionId}/words.json`;
    fs.writeFileSync(abs(rel), JSON.stringify(words));
    run(`UPDATE sessions SET words_path = ?, status = 'picking', updated_at = ? WHERE id = ?`, [rel, now(), sessionId]);
    enqueue("session_pick", { sessionId });
  } catch (e) {
    fail(sessionId, (e as Error).message);
    throw e;
  }
}

export function sessionWords(s: { words_path?: string | null }): Word[] {
  if (!s.words_path) return [];
  try {
    return JSON.parse(fs.readFileSync(abs(s.words_path), "utf8"));
  } catch {
    return [];
  }
}

/** The transcript as short timed lines, the way the clip picker reads it: "[12:34] text". */
export function transcriptLines(words: Word[]) {
  const lines: { t: number; e: number; text: string }[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) lines.push({ t: cur[0].s, e: cur[cur.length - 1].e, text: cur.map((w) => w.w).join(" ") });
    cur = [];
  };
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last) {
      const span = w.e - cur[0].s;
      if (w.s - last.e > 1.5 || span > 16 || (/[.?!]$/.test(last.w) && last.e - cur[0].s > 6)) flush();
    }
    cur.push(w);
  }
  flush();
  return lines;
}

const isSentenceStart = (words: Word[], k: number) => k === 0 || /[.?!]$/.test(words[k - 1].w) || words[k].s - words[k - 1].e >= 0.4;
const isSentenceEnd = (words: Word[], k: number) => k === words.length - 1 || /[.?!]$/.test(words[k].w) || words[k + 1].s - words[k].e >= 0.4;

/**
 * Moves a clip's edges onto whole words — and, within 2.5 seconds, onto the start and end of a sentence —
 * so no clip starts or stops mid-word. Too short (under 12s) or too long (over 95s) → null.
 */
export function snapClip(words: Word[], start: number, end: number): { start: number; end: number } | null {
  if (!words.length || !(end > start)) return null;
  let i = words.findIndex((w) => w.e > start);
  if (i < 0) return null;
  let best = -1;
  for (let k = 0; k < words.length; k++) {
    if (Math.abs(words[k].s - start) > 2.5) continue;
    if (isSentenceStart(words, k) && (best < 0 || Math.abs(words[k].s - start) < Math.abs(words[best].s - start))) best = k;
  }
  if (best >= 0) i = best;
  let j = -1;
  for (let k = words.length - 1; k >= 0; k--) if (words[k].s < end) { j = k; break; }
  if (j < i) return null;
  let bestEnd = -1;
  for (let k = i; k < words.length; k++) {
    if (Math.abs(words[k].e - end) > 2.5) continue;
    if (isSentenceEnd(words, k) && (bestEnd < 0 || Math.abs(words[k].e - end) < Math.abs(words[bestEnd].e - end))) bestEnd = k;
  }
  if (bestEnd >= i) j = bestEnd;
  const a = Math.max(0, +(words[i].s - 0.12).toFixed(3));
  const b = +(words[j].e + 0.35).toFixed(3);
  if (b - a < 12 || b - a > 95) return null;
  return { start: a, end: b };
}

export const wordsIn = (words: Word[], a: number, b: number) => words.filter((w) => w.s >= a - 0.01 && w.e <= b + 0.01);
export const clipText = (words: Word[], a: number, b: number) => wordsIn(words, a, b).map((w) => w.w).join(" ");

export type FlagIssue = { level: "block" | "warn"; rule: string; match: string; fix: string; soft?: boolean };
/** soft = only wording notes (like "cryptocurrency"): listed, left in the video. */
export type FlagRange = { key: string; s: number; e: number; level: "block" | "warn"; soft?: boolean; issues: FlagIssue[]; text: string };

/**
 * The parts of a recording where the speaker says something the SEBI/ASCI rules flag, widened to whole sentences
 * (cutting only the phrase would leave half a sentence). A phrase split across two transcript lines is caught too.
 * These parts are cut out of the long video when it's edited.
 */
export function flagRanges(words: Word[], niche: Speaker["niche"]): FlagRange[] {
  if (!words.length) return [];
  const lines = transcriptLines(words);
  const id = (i: FlagIssue) => `${i.rule}|${i.match.toLowerCase()}`;
  const single = lines.map((l) => checkText(l.text, niche).issues as FlagIssue[]);
  const hits: { a: number; b: number; issues: FlagIssue[] }[] = [];
  single.forEach((iss, k) => {
    if (iss.length) hits.push({ a: k, b: k, issues: iss });
  });
  for (let k = 0; k + 1 < lines.length; k++) {
    const seen = new Set([...single[k], ...single[k + 1]].map(id));
    const extra = (checkText(`${lines[k].text} ${lines[k + 1].text}`, niche).issues as FlagIssue[]).filter((i) => !seen.has(id(i)));
    if (extra.length) hits.push({ a: k, b: k + 1, issues: extra });
  }
  const ranges = hits.flatMap((h) => {
    const s0 = lines[h.a].t;
    const e0 = lines[h.b].e;
    // The line(s), widened to whole sentences…
    let i = Math.max(0, words.findIndex((w) => w.s >= s0 - 0.001));
    while (i > 0 && !isSentenceStart(words, i) && words[i].s > s0 - 8) i--;
    let j = words.length - 1;
    for (let k = words.length - 1; k >= 0; k--) {
      if (words[k].e <= e0 + 0.001) {
        j = k;
        break;
      }
    }
    while (j < words.length - 1 && !isSentenceEnd(words, j) && words[j].e < e0 + 8) j++;
    // …then only the sentence (or two sentences, if the phrase runs across them) that says it.
    const sentences: [number, number][] = [];
    for (let k = i, from = i; k <= j; k++) {
      if (isSentenceEnd(words, k) || k === j) {
        sentences.push([from, k]);
        from = k + 1;
      }
    }
    const rules = new Set(h.issues.map((x) => x.rule));
    const says = (a: number, b: number) => checkText(words.slice(a, b + 1).map((w) => w.w).join(" "), niche).issues.some((x) => rules.has(x.rule));
    let pick = sentences.filter(([a, b]) => says(a, b));
    if (!pick.length) for (let k = 0; k + 1 < sentences.length; k++) if (says(sentences[k][0], sentences[k + 1][1])) pick.push([sentences[k][0], sentences[k + 1][1]]);
    if (!pick.length) pick = [[i, j]];
    // Fluent speech with no full stops or pauses can make one "sentence" 20+ seconds long. Then cut only the words
    // that say it, out to the nearest short pause within 3 seconds either side.
    const narrow = ([a, b]: [number, number]): [number, number] => {
      if (words[b].e - words[a].s <= 12) return [a, b];
      let x = a;
      let y = b;
      while (x < y && says(x + 1, y)) x++;
      while (y > x && says(x, y - 1)) y--;
      let x2 = x;
      while (x2 > a && words[x].s - words[x2 - 1].s <= 3 && words[x2].s - words[x2 - 1].e < 0.25) x2--;
      let y2 = y;
      while (y2 < b && words[y2 + 1].e - words[y].e <= 3 && words[y2 + 1].s - words[y2].e < 0.25) y2++;
      return [x2, y2];
    };
    pick = pick.map(narrow);
    return pick.map(([a, b]) => ({ s: Math.max(0, +(words[a].s - 0.08).toFixed(3)), e: +(words[b].e + 0.15).toFixed(3), issues: h.issues }));
  });
  ranges.sort((a, b) => a.s - b.s);
  const merged: { s: number; e: number; issues: FlagIssue[] }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.s <= last.e + 0.3) {
      last.e = Math.max(last.e, r.e);
      for (const i of r.issues) if (!last.issues.some((x) => id(x) === id(i))) last.issues.push(i);
    } else merged.push({ ...r, issues: [...r.issues] });
  }
  return merged.map((m) => ({
    key: String(Math.round(m.s)),
    s: m.s,
    e: m.e,
    level: (m.issues.some((i) => i.level === "block") ? "block" : "warn") as "block" | "warn",
    soft: m.issues.every((i) => i.soft),
    issues: m.issues,
    text: clipText(words, m.s, m.e).slice(0, 300),
  }));
}

/** Flagged parts inside the kept part of the recording (between the start and end times). */
export function flagsInRange(words: Word[], niche: Speaker["niche"], from?: number | null, to?: number | null) {
  return flagRanges(words, niche).filter((f) => f.e > (from || 0) && (to == null || f.s < to));
}

/**
 * What the long-video edit cuts out: every blocking part, and every "check" part an owner or admin didn't choose to keep.
 * Wording notes (soft) stay in.
 */
export function removalPlan(flags: FlagRange[], keep: string[]) {
  return flags.filter((f) => f.level === "block" || (!f.soft && !keep.includes(f.key)));
}

/**
 * The removal plan for the kept part of the recording, then checked again on the words that will actually sit next to
 * each other once those parts are gone (a cut can join two halves into something the rules flag). Up to 3 rounds.
 */
export function planRemoval(words: Word[], niche: Speaker["niche"], from: number | null | undefined, to: number | null | undefined, keep: string[]) {
  const remove = removalPlan(flagsInRange(words, niche, from, to), keep);
  for (let round = 0; round < 3; round++) {
    const left = words.filter((w) => w.e > (from || 0) && (to == null || w.s < to) && !remove.some((r) => w.s < r.e && w.e > r.s));
    const more = removalPlan(flagRanges(left, niche), keep).filter((r) => !remove.some((x) => x.s <= r.s + 0.01 && x.e >= r.e - 0.01));
    if (!more.length) break;
    remove.push(...more);
  }
  return remove.sort((a, b) => a.s - b.s);
}

const SYSTEM = `You are the video editor for an Indian educator's social media. You read a timed transcript of one long recording
and pick the parts that work on their own as short vertical clips, and you plan the full recording as one YouTube video.
Write in plain, spoken English. No hype words, no emojis. Reply with JSON only.`;

function fmtLines(lines: ReturnType<typeof transcriptLines>) {
  return lines.map((l) => `[${stamp(l.t)}] ${l.text}`).join("\n");
}

type ClipDraft = { start: number; end: number; title: string; hook: string; lane: string; hook_type: string; mix: string; caption: string; hashtags: string; linkedin: string; why: string };

function clipPrompt(sp: Speaker, s: any, lines: ReturnType<typeof transcriptLines>, n: number, taken: { a: number; b: number }[]) {
  const rules = activeRules(sp.id).map((r) => `- ${r.rule}`).join("\n") || "- (none)";
  return `SPEAKER: ${sp.name}
WHO THE ACCOUNT TALKS TO: ${sp.audience || ""}
LANES: ${sp.lanes.map((l) => `${l.key} (${l.name})`).join(", ")}
NEVER: ${sp.stop_list.join("; ")}
RULES FOR THIS NICHE:
${NICHE_RULES[sp.niche] || ""}
PLAYBOOK RULES (switched on by the team):
${rules}

RECORDING: "${s.title}" (${s.kind}${s.guest ? `, with ${s.guest}` : ""}), ${Math.round((s.duration || 0) / 60)} minutes.
${taken.length ? `ALREADY CLIPPED (don't pick these again): ${taken.map((t) => `${stamp(t.a)}–${stamp(t.b)}`).join(", ")}\n` : ""}
Pick the ${n} best clips. Each clip:
- is 20–75 seconds long (best 30–60), using the [m:ss] marks for start and end, in seconds from the start of the recording
- starts on a line that stops the scroll (a surprising claim, a sharp question, a mistake, a story's turning point) — not on "so", "and" or a greeting
- makes sense on its own, without the rest of the talk, and ends on a finished thought
- never gives stock tips, price predictions, return or income promises, or diagnoses — skip those parts entirely
Spread the clips across the recording and across the lanes.

Return {"clips": [ ... ]}, each item:
{"start": seconds, "end": seconds, "title": internal title under 70 characters,
 "hook": text shown on screen for the first 3 seconds, under 9 words, saying the payoff,
 "lane": one of the lane keys, "hook_type": one of ${JSON.stringify(HOOK_TYPES)}, "mix": "core" | "adjacent" | "personal",
 "caption": Instagram caption, 2–4 short lines, no hashtags, "hashtags": 3–5 hashtags in one string,
 "linkedin": 3–5 short lines saying what the clip says, no bait, no hashtags, "why": one line on why it works on its own}

TRANSCRIPT:
${fmtLines(lines)}`;
}

function longPrompt(sp: Speaker, s: any, lines: ReturnType<typeof transcriptLines>) {
  return `SPEAKER: ${sp.name}
WHO THE CHANNEL TALKS TO: ${sp.audience || ""}
RULES FOR THIS NICHE:
${NICHE_RULES[sp.niche] || ""}

Plan this ${Math.round((s.duration || 0) / 60)}-minute recording ("${s.title}"${s.guest ? `, with ${s.guest}` : ""}) as one YouTube video.
Return JSON:
{"titles": 3 title options, each under 70 characters: a clear payoff for this viewer, no clickbait and no claims the rules forbid,
 "description": 2–4 short paragraphs on what the viewer will learn (no links, no hashtags — the hub adds the link and disclaimer),
 "chapters": [{"t": seconds from the [m:ss] marks, "title": under 50 characters}] — 5 to 12 chapters, the first at the real start,
 "tags": 10–15 search phrases in one comma-separated string,
 "thumb_texts": 3 options of 2–4 words for the thumbnail,
 "trim_start": seconds where the content really starts (skip setup chatter; 0 if none),
 "trim_end": seconds where it really ends (skip goodbyes and wrap-up admin), or null}

TRANSCRIPT:
${fmtLines(lines)}`;
}

const overlap = (a: { a: number; b: number }, b: { a: number; b: number }) => Math.max(0, Math.min(a.b, b.b) - Math.max(a.a, b.a)) / Math.min(a.b - a.a, b.b - b.a);

/** Worker (light lane): Claude picks the clips; each becomes a script waiting for approval. Also drafts the long-form video the first time. */
export async function pickClips(sessionId: number, again = false) {
  const s = one<any>(`SELECT * FROM sessions WHERE id = ?`, [sessionId]);
  if (!s) return;
  const sp = getSpeaker(s.speaker_id);
  if (!sp) throw new Error("No speaker");
  const words = sessionWords(s);
  if (!words.length) throw new Error("No transcript for this session yet.");
  run(`UPDATE sessions SET status = 'picking', error = NULL, updated_at = ? WHERE id = ?`, [now(), sessionId]);
  try {
    const lines = transcriptLines(words);
    const taken = raw<any>(`SELECT clip_start AS a, clip_end AS b FROM scripts WHERE session_id = ? AND clip_start IS NOT NULL`, [sessionId]);
    const n = Math.max(3, Math.min(20, settingNum("clips_per_session") || 12));
    // A retry after the clips were already saved (say the long-video plan failed) doesn't pick a second set.
    const pickNow = again || !taken.length;
    let clips: ClipDraft[] = [];
    if (pickNow) {
      const { text, model, usage } = await claude({ system: SYSTEM, user: clipPrompt(sp, s, lines, n, taken), maxTokens: 8000, temperature: 0.5 });
      logUsage("clip_picker", sp.id, model, usage);
      clips = extractJson<{ clips: ClipDraft[] }>(text).clips || [];
    }
    const laneKeys = sp.lanes.map((l) => l.key);
    const made: number[] = [];
    const skipped: string[] = [];
    for (const c of clips) {
      const snapped = snapClip(words, Number(c.start), Number(c.end));
      if (!snapped) {
        skipped.push(`${stamp(Number(c.start) || 0)} (too short or too long)`);
        continue;
      }
      const range = { a: snapped.start, b: snapped.end };
      if ([...taken, ...made.map((id) => one<any>(`SELECT clip_start AS a, clip_end AS b FROM scripts WHERE id = ?`, [id]))].some((t) => overlap(t, range) > 0.5)) {
        skipped.push(`${stamp(range.a)} (overlaps another clip)`);
        continue;
      }
      const body = clipText(words, range.a, range.b);
      const hook = String(c.hook || "").trim().slice(0, 90);
      const caption = String(c.caption || "").trim();
      const title = String(c.title || hook || "Clip").slice(0, 120);
      const tags = (String(c.hashtags || "").match(/#[\p{L}\p{N}_]+/gu) || []).slice(0, 5).join(" ");
      const check: Check = checkScript({ title, hook, body, caption, hashtags: tags, linkedin: String(c.linkedin || "") }, sp.niche);
      const r = run(
        `INSERT INTO scripts (speaker_id, lane, hook_type, format, title, hook, body, cta, on_screen, caption, hashtags, length_sec, why,
           compliance, notes, linkedin_text, status, source, session_id, clip_start, clip_end, mix, created_at, updated_at)
         VALUES (@sp, @lane, @ht, 'talking_head', @title, @hook, @body, '', '[]', @caption, @tags, @len, @why,
           @comp, @notes, @li, 'proposed', 'clip', @sid, @a, @b, @mix, @at, @at)`,
        {
          sp: sp.id,
          lane: laneKeys.includes(c.lane) ? c.lane : laneKeys[0] || "",
          ht: (HOOK_TYPES as readonly string[]).includes(c.hook_type) ? c.hook_type : "story",
          title,
          hook,
          body,
          caption,
          tags,
          len: Math.round(range.b - range.a),
          why: String(c.why || "").trim(),
          comp: JSON.stringify(check),
          notes: check.status === "block" ? "The speaker's own words in this part break a rule, so it can't be posted. Reject it, or pick a different part." : null,
          li: String(c.linkedin || "").trim() || null,
          sid: sessionId,
          a: range.a,
          b: range.b,
          mix: ["core", "adjacent", "personal"].includes(c.mix) ? c.mix : "core",
          at: now(),
        },
      );
      made.push(Number(r.lastInsertRowid));
    }
    if (!one(`SELECT id FROM longforms WHERE session_id = ?`, [sessionId])) await draftLongform(s, sp, lines, words);
    const picks = pickNow ? { clips: made.length, skipped, at: now() } : json<any>(s.picks, { clips: taken.length, skipped: [], at: now() });
    run(`UPDATE sessions SET status = 'ready', picks = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(picks), now(), sessionId]);
    if (made.length && setting("hook_doctor") !== "off") enqueue("agent", { agent: "hook_doctor", scriptIds: made });
    return made;
  } catch (e) {
    fail(sessionId, `Couldn't pick clips: ${(e as Error).message}`);
    throw e;
  }
}

async function draftLongform(s: any, sp: Speaker, lines: ReturnType<typeof transcriptLines>, words: Word[]) {
  const { text, model, usage } = await claude({ system: SYSTEM, user: longPrompt(sp, s, lines), maxTokens: 4000, temperature: 0.5 });
  logUsage("clip_picker", sp.id, model, usage);
  const d = extractJson<any>(text);
  const titles = (Array.isArray(d.titles) ? d.titles : []).map((t: any) => String(t).trim().slice(0, 100)).filter(Boolean).slice(0, 3);
  const chapters: Chapter[] = (Array.isArray(d.chapters) ? d.chapters : []).map((c: any) => ({ t: Math.max(0, Math.floor(Number(c.t) || 0)), title: String(c.title || "").trim().slice(0, 80) })).filter((c: Chapter) => c.title);
  const thumbTexts = (Array.isArray(d.thumb_texts) ? d.thumb_texts : []).map((t: any) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 3);
  const lf = {
    titles,
    title: titles[0] || s.title,
    description: String(d.description || "").trim(),
    chapters,
    tags: String(d.tags || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20).join(", "),
    thumbTexts,
    // Whole seconds, like the m:ss the page shows, so saving the form doesn't look like a change.
    trimStart: Number(d.trim_start) > 0 && Number(d.trim_start) < (s.duration || 0) / 3 ? Math.round(Number(d.trim_start)) : null,
    trimEnd: Number(d.trim_end) > (s.duration || 0) * 0.6 ? Math.round(Number(d.trim_end)) : null,
  };
  const compliance = longformCheck({ ...lf, chapters }, sp.niche);
  run(
    `INSERT INTO longforms (session_id, speaker_id, status, cut_silence, trim_start, trim_end, titles, title, description, chapters, tags, thumb_texts, compliance, warnings, created_at, updated_at)
     VALUES (@sid, @sp, 'draft', 1, @ts, @te, @titles, @title, @desc, @ch, @tags, @tt, @comp, @warn, @at, @at)`,
    {
      sid: s.id, sp: sp.id, ts: lf.trimStart, te: lf.trimEnd, titles: JSON.stringify(titles), title: lf.title, desc: lf.description,
      ch: JSON.stringify(chapters), tags: lf.tags, tt: JSON.stringify(thumbTexts), comp: JSON.stringify(compliance),
      warn: "[]",
      at: now(),
    },
  );
}

/** Rules check on everything the hub writes for the long video (titles, description, chapter titles, thumbnails). The speaker's own words are flagged separately with times. */
export function longformCheck(lf: { titles: string[]; title?: string | null; description: string; thumbTexts: string[]; chapters?: Chapter[] }, niche: Speaker["niche"]) {
  return checkText([...(lf.titles || []), lf.title || "", lf.description, ...(lf.thumbTexts || []), ...(lf.chapters || []).map((c) => c.title)].join("\n"), niche);
}


/** A clip script was approved: it needs no shoot — make its video from the recording and start the cut. */
export function approveClip(scriptId: number, userId: number) {
  const sc = one<any>(`SELECT s.*, se.raw_path, se.title AS session_title FROM scripts s JOIN sessions se ON se.id = s.session_id WHERE s.id = ?`, [scriptId]);
  if (!sc || sc.source !== "clip") throw new Error("Not a clip");
  if (!sc.raw_path) throw new Error("The recording for this clip is missing.");
  const r = run(
    `INSERT INTO videos (script_id, speaker_id, raw_path, raw_name, raw_size, duration, uploaded_by, session_id, clip_start, clip_end, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    [sc.id, sc.speaker_id, sc.raw_path, `${sc.session_title} · ${stamp(sc.clip_start)}–${stamp(sc.clip_end)}`, sc.clip_end - sc.clip_start, userId, sc.session_id, sc.clip_start, sc.clip_end, now()],
  );
  run(`UPDATE scripts SET status = 'shot', updated_at = ? WHERE id = ?`, [now(), scriptId]);
  return createEdit(Number(r.lastInsertRowid));
}

/* ───────── the long-form video ───────── */

/** "4:05 Why it fails" lines → chapters; "1:02:09" works too. */
export function parseChapters(text: string): Chapter[] {
  const out: Chapter[] = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+)$/);
    if (!m) continue;
    const t = (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
    out.push({ t, title: m[4].trim().slice(0, 80) });
  }
  return out;
}

export function parseStamp(s: string): number | null {
  const v = s.trim();
  if (!v) return null;
  const m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (m) return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return n;
  throw new Error(`"${s}" isn't a time — use m:ss, like 2:30.`);
}

export function saveLongform(
  id: number,
  f: { title: string; titles?: string[]; description: string; chapters: string; tags: string; thumbTexts: string[]; trimStart: string; trimEnd: string; cutSilence: boolean; keepFlags?: string[] },
  userId: number,
  canApproveIt = false,
) {
  const lf = one<any>(`SELECT l.*, sp.niche FROM longforms l JOIN speakers sp ON sp.id = l.speaker_id WHERE l.id = ?`, [id]);
  if (!lf) throw new Error("No such video");
  if (["uploading", "uploaded"].includes(lf.status)) throw new Error("This video has already gone to YouTube.");
  if (["queued", "cutting"].includes(lf.status)) throw new Error("It's being cut right now — save your changes after the cut finishes.");
  if (lf.approved_by && !canApproveIt) throw new Error("This video is approved. Only an owner or admin can change it now.");
  const title = f.title.trim();
  if (title.length < 5) throw new Error("The title is too short.");
  if (title.length > 100) throw new Error("YouTube titles can be at most 100 characters.");
  const ts = parseStamp(f.trimStart);
  const te = parseStamp(f.trimEnd);
  if (ts != null && te != null && te <= ts) throw new Error("The end has to come after the start.");
  const chapters = parseChapters(f.chapters);
  const titles = f.titles?.length ? f.titles : json<string[]>(lf.titles, []);
  const thumbTexts = f.thumbTexts.map((t) => t.trim().slice(0, 40)).filter(Boolean);
  const compliance = longformCheck({ titles, title, description: f.description, thumbTexts, chapters }, lf.niche);
  // New start/end times or pause-cutting change the video itself, so it needs cutting again (compared in whole seconds, as the page shows them).
  const sec = (v: number | null) => (v == null ? null : Math.floor(v));
  // Which "check" parts to keep in the video (blocking parts are always cut). Only an owner or admin decides; the team's form leaves it as it was.
  const oldKeep = json<string[]>(lf.keep_flags, []);
  let keep = oldKeep;
  if (canApproveIt && f.keepFlags) {
    const sess = one<any>(`SELECT words_path FROM sessions WHERE id = ?`, [lf.session_id]);
    const warnKeys = flagRanges(sessionWords(sess || {}), lf.niche).filter((r) => r.level === "warn" && !r.soft).map((r) => r.key);
    keep = f.keepFlags.filter((k) => warnKeys.includes(k)).sort();
  }
  const keepChanged = JSON.stringify(keep) !== JSON.stringify([...oldKeep].sort());
  const cutChanged = sec(lf.trim_start ?? null) !== sec(ts) || sec(lf.trim_end ?? null) !== sec(te) || !!lf.cut_silence !== f.cutSilence || keepChanged;
  const thumbsChanged = JSON.stringify(thumbTexts) !== lf.thumb_texts;
  // Chapters only need placing on the finished timeline again — no re-cut.
  const segs = json<Seg[]>(lf.segs, []);
  const outChapters = lf.output_path && segs.length && lf.duration ? fixChapters(chapters.map((c) => ({ t: mapTime(c.t, segs), title: c.title })), lf.duration) : json<Chapter[]>(lf.out_chapters, []);
  const keepTs = sec(lf.trim_start ?? null) === sec(ts) ? lf.trim_start : ts;
  const keepTe = sec(lf.trim_end ?? null) === sec(te) ? lf.trim_end : te;
  // Any change after approval needs approving again: a new cut goes back to draft, new words go back to "ready".
  const changed =
    cutChanged || thumbsChanged || title !== lf.title || f.description.trim() !== String(lf.description || "") ||
    JSON.stringify(chapters) !== JSON.stringify(json<Chapter[]>(lf.chapters, []).map((c) => ({ t: Math.floor(c.t), title: c.title }))) || f.tags.trim() !== String(lf.tags || "");
  const status =
    cutChanged && ["ready", "manual_todo", "error"].includes(lf.status) ? "draft" : changed && (lf.status === "manual_todo" || (lf.status === "error" && lf.approved_by)) ? "ready" : lf.status;
  run(
    `UPDATE longforms SET title = ?, titles = ?, description = ?, chapters = ?, out_chapters = ?, tags = ?, thumb_texts = ?, trim_start = ?, trim_end = ?, cut_silence = ?, compliance = ?,
       keep_flags = ?, status = ?, approved_by = CASE WHEN ? THEN NULL ELSE approved_by END, approved_at = CASE WHEN ? THEN NULL ELSE approved_at END, updated_at = ? WHERE id = ?`,
    [title, JSON.stringify(titles), f.description.trim(), JSON.stringify(chapters), JSON.stringify(outChapters), f.tags.trim(), JSON.stringify(thumbTexts), keepTs, keepTe, f.cutSilence ? 1 : 0, JSON.stringify(compliance), JSON.stringify(keep), status, changed ? 1 : 0, changed ? 1 : 0, now(), id],
  );
  if (thumbsChanged && !cutChanged && lf.output_path) enqueue("longform_thumbs", { longformId: id, at: Date.now() });
  audit(userId, "edit_longform", "longform", id);
  return { compliance, cutChanged, thumbsChanged };
}

/** Worker (heavy lane): only the three thumbnails again, after their text changed. */
export async function remakeThumbs(id: number) {
  const lf = one<any>(`SELECT * FROM longforms WHERE id = ?`, [id]);
  if (!lf?.output_path || !lf.duration) return;
  const rel = `longform/${id}`;
  const files = await thumbnails(abs(lf.output_path), lf.duration, json<string[]>(lf.thumb_texts, []), ensureDir(rel));
  for (let k = 1; k <= 3; k++) fs.rmSync(path.join(abs(rel), `thumb${k}.ass`), { force: true });
  run(`UPDATE longforms SET thumbs = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(files.map((t) => `${rel}/${path.basename(t)}`)), now(), id]);
}

export function startLongformCut(id: number, userId: number) {
  const lf = one<any>(`SELECT * FROM longforms WHERE id = ?`, [id]);
  if (!lf) throw new Error("No such video");
  if (["queued", "cutting"].includes(lf.status)) throw new Error("It's already being cut.");
  if (["uploading", "uploaded"].includes(lf.status)) throw new Error("This video has already gone to YouTube.");
  // A new cut is a new video: it needs approving again.
  run(`UPDATE longforms SET status = 'queued', error = NULL, approved_by = NULL, approved_at = NULL, updated_at = ? WHERE id = ?`, [now(), id]);
  enqueue("run_longform", { longformId: id, at: Date.now() });
  audit(userId, "cut_longform", "longform", id);
}

/** Worker (heavy lane): the long cut, captions file, chapters on the new timeline, thumbnails. */
export async function runLongform(id: number) {
  const lf = one<any>(`SELECT l.*, s.raw_path, s.words_path, sp.niche FROM longforms l JOIN sessions s ON s.id = l.session_id JOIN speakers sp ON sp.id = l.speaker_id WHERE l.id = ?`, [id]);
  if (!lf || !["queued", "cutting", "error"].includes(lf.status)) return;
  run(`UPDATE longforms SET status = 'cutting', error = NULL, updated_at = ? WHERE id = ?`, [now(), id]);
  const rel = `longform/${id}`;
  try {
    const words = sessionWords({ words_path: lf.words_path });
    // No transcript means no rules check, so no cut (it would go out unchecked).
    if (!words.length) throw new Error("The transcript couldn't be read, so the SEBI/ASCI check can't run. Transcribe the recording again (Try again on this session), then cut.");
    // Every sentence the SEBI/ASCI rules flag is cut out of the video (a "check" part stays only if an owner or admin chose to keep it),
    // checked again on the words that end up next to each other.
    const remove = planRemoval(words, lf.niche, lf.trim_start, lf.trim_end, json<string[]>(lf.keep_flags, []));
    const res = await makeLongform({
      input: abs(lf.raw_path),
      workDir: ensureDir(rel),
      words,
      cutSilence: !!lf.cut_silence,
      trimStart: lf.trim_start,
      trimEnd: lf.trim_end,
      chapters: json<Chapter[]>(lf.chapters, []),
      thumbTexts: json<string[]>(lf.thumb_texts, []),
      remove: remove.map((r) => ({ s: r.s, e: r.e })),
    });
    // Check the finished video's words again: nothing blocking may be left (times on the finished video).
    const leftover = flagRanges(mapWords(words, res.segs), lf.niche).filter((r) => r.level === "block");
    const removed = remove.map((r) => ({ key: r.key, s: r.s, e: r.e, level: r.level, soft: r.soft, text: r.text, issues: r.issues }));
    const warnings = [...res.warnings];
    if (removed.length) warnings.unshift(`Cut out ${removed.length} part${removed.length > 1 ? "s" : ""} the SEBI/ASCI rules flag (${Math.round(removed.reduce((n, r) => n + (r.e - r.s), 0))}s in all) — listed below.`);
    if (leftover.length) warnings.unshift(`The rules still flag ${leftover.length} part${leftover.length > 1 ? "s" : ""} of the finished video — it can't be approved until they're gone (cut again or trim).`);
    run(
      `UPDATE longforms SET status = 'ready', output_path = ?, srt_path = ?, thumbs = ?, out_chapters = ?, segs = ?, duration = ?, warnings = ?, removed = ?, leftover = ?, updated_at = ? WHERE id = ?`,
      [`${rel}/long.mp4`, `${rel}/captions.srt`, JSON.stringify(res.thumbs.map((t) => `${rel}/${path.basename(t)}`)), JSON.stringify(res.chapters), JSON.stringify(res.segs), res.duration, JSON.stringify(warnings), JSON.stringify(removed), JSON.stringify(leftover), now(), id],
    );
  } catch (e) {
    run(`UPDATE longforms SET status = 'error', error = ?, updated_at = ? WHERE id = ?`, [String((e as Error).message).slice(0, 1500), now(), id]);
    throw e;
  }
}

/** The description that goes up: what was written, the chapters, the tracking link, the disclaimer. */
export function finalDescription(lf: { description?: string | null; out_chapters?: string | null }, disclaimer: string | null, link: string | null) {
  // YouTube allows 5,000 characters. The link, disclaimer and chapters always fit; if anything gives way, it's the written part.
  const ch = json<Chapter[]>(lf.out_chapters, []);
  const tail = [link ? `₹99 webinar: ${link}` : "", disclaimer?.trim() || "", ch.length ? `Chapters\n${chapterLines(ch)}` : ""].filter(Boolean).join("\n\n");
  let head = String(lf.description || "").trim();
  const room = 4900 - tail.length - 2;
  if (head.length > room) head = head.slice(0, Math.max(0, room - 1)).trimEnd() + "…";
  return [head, tail].filter(Boolean).join("\n\n");
}

/** YouTube takes tags up to about 500 characters in all. */
export function fitTags(tags: string) {
  const out: string[] = [];
  let n = 0;
  for (const t of tags.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (n + t.length + 1 > 450) break;
    out.push(t);
    n += t.length + 1;
  }
  return out;
}

/** A named owner or admin approves the long video. Uploads by API once Google has audited the app; until then it's a by-hand step. */
export function approveLongform(id: number, userId: number) {
  const lf = one<any>(`SELECT l.*, sp.caption_disclaimer FROM longforms l JOIN speakers sp ON sp.id = l.speaker_id WHERE l.id = ?`, [id]);
  if (!lf) throw new Error("No such video");
  if (lf.status !== "ready") throw new Error("Cut the video first (or wait for the cut to finish).");
  if (json<any>(lf.compliance, {}).status === "block") throw new Error("The title, description or thumbnail text breaks a blocking rule — change it first.");
  // The edit cut out every blocking part; if the check on the finished video still finds one, it can't go out.
  if (json<any[]>(lf.leftover, []).length) throw new Error("The rules still flag part of the finished video. Cut it again (or trim the start/end) first.");
  const code = lf.link_code || makeLink(lf.speaker_id, null, "youtube", "long");
  const yt = accountFor(lf.speaker_id, "youtube") || ensureAccount(lf.speaker_id, "youtube");
  const viaApi = youtubeCanUpload(yt);
  run(`UPDATE longforms SET status = ?, link_code = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`, [viaApi ? "uploading" : "manual_todo", code, userId, now(), now(), id]);
  if (viaApi) enqueue("upload_longform", { longformId: id });
  audit(userId, "approve_longform", "longform", id, { viaApi, removed: json<any[]>(lf.removed, []).length, kept: json<string[]>(lf.keep_flags, []) });
  return viaApi;
}

export function longformDescription(id: number) {
  const lf = one<any>(`SELECT l.*, sp.caption_disclaimer FROM longforms l JOIN speakers sp ON sp.id = l.speaker_id WHERE l.id = ?`, [id]);
  if (!lf) return "";
  return finalDescription(lf, lf.caption_disclaimer, lf.link_code ? `${env.appUrl()}/r/${lf.link_code}` : null);
}

/** Worker (heavy lane): the upload itself. */
export async function uploadLongform(id: number) {
  const lf = one<any>(`SELECT * FROM longforms WHERE id = ?`, [id]);
  if (!lf || lf.status !== "uploading") return;
  try {
    const yt = accountFor(lf.speaker_id, "youtube")!;
    let ytId = "dry-run";
    let url = "https://www.youtube.com/";
    if (!env.dryRun()) {
      const r = await uploadVideo({ token: await accessToken(yt), file: abs(lf.output_path), title: lf.title, description: longformDescription(id), tags: fitTags(String(lf.tags || "")), short: false });
      ytId = r.id;
      url = r.url;
    }
    markUploaded(id, ytId, url, yt.id);
  } catch (e) {
    run(`UPDATE longforms SET status = 'error', error = ?, updated_at = ? WHERE id = ?`, [`Upload failed: ${String((e as Error).message).slice(0, 1000)}`, now(), id]);
    throw e;
  }
}

function markUploaded(id: number, ytId: string, url: string, accountId: number) {
  const lf = one<any>(`SELECT * FROM longforms WHERE id = ?`, [id]);
  run(`UPDATE longforms SET status = 'uploaded', youtube_id = ?, permalink = ?, error = NULL, updated_at = ? WHERE id = ?`, [ytId, url, now(), id]);
  run(
    `INSERT INTO posts (account_id, external_id, permalink, caption, media_type, published_at, via_hub, is_trial, created_at)
     VALUES (@a, @x, @l, @c, 'VIDEO', @at, 1, 0, @at) ON CONFLICT(account_id, external_id) DO UPDATE SET via_hub = 1`,
    { a: accountId, x: ytId, l: url, c: lf?.title || null, at: now() },
  );
}

/** The team uploaded it in YouTube Studio: paste the link. */
export function markLongformUploaded(id: number, url: string, userId: number) {
  const lf = one<any>(`SELECT * FROM longforms WHERE id = ?`, [id]);
  if (!lf) throw new Error("No such video");
  if (!lf.approved_by || !["manual_todo", "error", "uploaded"].includes(lf.status)) throw new Error("An owner or admin approves the video first.");
  const m = url.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/)([\w-]{11})/);
  if (!m) throw new Error("Paste the YouTube link of the uploaded video.");
  const yt = ensureAccount(lf.speaker_id, "youtube");
  markUploaded(id, m[1], `https://www.youtube.com/watch?v=${m[1]}`, yt.id);
  audit(userId, "longform_uploaded", "longform", id, { url });
}

/** YouTube's Test & Compare has no API: the team logs which title won, so the next titles learn from it. */
export function logTestWinner(id: number, title: string, userId: number) {
  run(`UPDATE longforms SET test_winner = ?, updated_at = ? WHERE id = ?`, [title.trim().slice(0, 100) || null, now(), id]);
  audit(userId, "longform_test_winner", "longform", id, { title });
}

export function sessionRows() {
  return raw<any>(
    `SELECT se.*, sp.name AS speaker, sp.slug,
       (SELECT COUNT(*) FROM scripts s WHERE s.session_id = se.id) AS clips,
       (SELECT COUNT(*) FROM scripts s WHERE s.session_id = se.id AND s.status = 'proposed') AS to_review,
       (SELECT COUNT(*) FROM scripts s WHERE s.session_id = se.id AND s.status NOT IN ('proposed','rejected')) AS approved,
       (SELECT status FROM longforms l WHERE l.session_id = se.id ORDER BY l.id DESC LIMIT 1) AS long_status
     FROM sessions se JOIN speakers sp ON sp.id = se.speaker_id ORDER BY se.id DESC LIMIT 100`,
  );
}
