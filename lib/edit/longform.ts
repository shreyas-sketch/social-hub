import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/config";
import { exec } from "@/lib/media";
import { probe, detectSilence, keepSegments, canToneMap, TONEMAP } from "./ffmpeg";
import { groupWords, escAss } from "./captions";
import type { Word } from "./transcribe";

/**
 * The YouTube long-form video, cut from a long session recording:
 * long pauses out, 16:9, HDR to normal colour, loudness levelled, plus chapters on the new timeline,
 * an .srt caption file and three thumbnail options.
 */
export type Seg = { s: number; e: number };
export type Chapter = { t: number; title: string };

const FPS = 30;
/** Cut points sit on the 1/30 s frame grid, so sound and picture stay in step after hundreds of cuts. */
const snap = (t: number) => Math.round(t * FPS) / FPS;

/** The parts to keep, limited to [from, to], on the frame grid, touching parts merged. */
export function prepareSegs(segs: Seg[], from: number, to: number): Seg[] {
  const out: Seg[] = [];
  for (const g of segs) {
    const s = snap(Math.max(g.s, from));
    const e = snap(Math.min(g.e, to));
    if (e - s < 1 / FPS) continue;
    const last = out[out.length - 1];
    if (last && s - last.e < 0.5 / FPS) last.e = e;
    else out.push({ s, e });
  }
  return out;
}

/** The kept parts with some ranges taken out (the flagged sentences). */
export function subtractRanges(segs: Seg[], cut: Seg[]): Seg[] {
  let out = segs.map((g) => ({ ...g }));
  for (const c of cut) {
    const next: Seg[] = [];
    for (const g of out) {
      if (c.e <= g.s || c.s >= g.e) {
        next.push(g);
        continue;
      }
      if (c.s > g.s) next.push({ s: g.s, e: c.s });
      if (c.e < g.e) next.push({ s: c.e, e: g.e });
    }
    out = next;
  }
  return out;
}

/** Where a moment in the recording lands in the finished video. A moment inside a cut lands where the next kept part starts. */
export function mapTime(t: number, segs: Seg[]): number {
  let out = 0;
  for (const g of segs) {
    if (t < g.s) return out;
    if (t <= g.e) return out + (t - g.s);
    out += g.e - g.s;
  }
  return out;
}

export const keptDuration = (segs: Seg[]) => segs.reduce((n, g) => n + (g.e - g.s), 0);

/** YouTube's chapter rules: the first at 0:00, at least three, each at least 10 seconds long. Fewer than three → none. */
export function fixChapters(ch: Chapter[], duration: number): Chapter[] {
  const sorted = ch
    .filter((c) => c && String(c.title || "").trim() && Number.isFinite(Number(c.t)))
    .map((c) => ({ t: Math.max(0, Number(c.t)), title: String(c.title).trim().slice(0, 80) }))
    .sort((a, b) => a.t - b.t);
  // Chapters that land on the same moment (say, several before a new start time all land on 0:00): the last one names it.
  const dedup: Chapter[] = [];
  for (const c of sorted) {
    if (dedup.length && Math.floor(dedup[dedup.length - 1].t) === Math.floor(c.t)) dedup[dedup.length - 1] = c;
    else dedup.push(c);
  }
  const out: Chapter[] = [];
  for (const c of dedup) {
    if (c.t > duration - 10) continue;
    if (!out.length) {
      out.push({ t: 0, title: c.title });
      continue;
    }
    if (c.t - out[out.length - 1].t < 10) continue;
    out.push({ t: Math.floor(c.t), title: c.title });
  }
  return out.length >= 3 ? out : [];
}

/** 0:00, 4:05, 1:02:09 — the form YouTube reads chapters in. */
export function stamp(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export const chapterLines = (ch: Chapter[]) => ch.map((c) => `${stamp(c.t)} ${c.title}`).join("\n");

/** Words on the finished video's timeline (words inside a cut are dropped). */
export function mapWords(words: Word[], segs: Seg[]): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    const mid = (w.s + w.e) / 2;
    if (!segs.some((g) => mid >= g.s && mid <= g.e)) continue;
    out.push({ w: w.w, s: +mapTime(w.s, segs).toFixed(3), e: +mapTime(w.e, segs).toFixed(3) });
  }
  return out;
}

const srtTime = (sec: number) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600e3);
  const m = Math.floor((ms % 3600e3) / 60e3);
  const s = Math.floor((ms % 60e3) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** A caption file to upload in YouTube Studio (YouTube's own captions are often wrong on Indian names and terms). */
export function toSrt(words: Word[]) {
  return groupWords(words, 8, 42, 0.9)
    .map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(Math.max(l.end, l.start + 0.3))}\n${l.words.map((w) => w.w).join(" ")}\n`)
    .join("\n");
}

/**
 * A selection expression over the kept parts: frames whose time falls in [s, e), offset half a frame against rounding.
 * It goes inside single quotes in the filter script, where commas are literal.
 */
export function selectExpr(segs: Seg[]) {
  const h = 0.5 / FPS;
  return segs.map((g) => `gte(t,${(g.s - h).toFixed(4)})*lt(t,${(g.e - h).toFixed(4)})`).join("+");
}

/**
 * One pass over the recording. select/aselect keep the parts (fine for hundreds of cuts, unlike trim + concat),
 * the sound is cut in 1/30 s blocks on the same grid as the frames, so it never drifts out of sync.
 */
export async function cutLongform(o: { input: string; output: string; segs: Seg[]; toneMap: boolean; vertical: boolean; hasAudio: boolean; workDir: string }) {
  const expr = selectExpr(o.segs);
  const v: string[] = [`[0:v]setpts=PTS-STARTPTS,fps=${FPS}`];
  if (o.toneMap) v.push(TONEMAP);
  v.push(`select='${expr}',setpts=N/${FPS}/TB`);
  const parts: string[] = [];
  if (o.vertical) {
    parts.push(`${v.join(",")},split=2[bgsrc][fgsrc]`);
    parts.push(`[bgsrc]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=30:2,eq=brightness=-0.08[bg]`);
    parts.push(`[fgsrc]scale=1920:1080:force_original_aspect_ratio=decrease[fg]`);
    parts.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p,setsar=1[vf]`);
  } else {
    parts.push(`${v.join(",")},scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p,setsar=1[vf]`);
  }
  const args = ["-hide_banner", "-y", "-i", o.input];
  if (o.hasAudio) {
    parts.push(`[0:a]asetpts=PTS-STARTPTS,aresample=48000:async=1:first_pts=0,asetnsamples=n=${48000 / FPS}:p=0,aselect='${expr}',asetpts=N/SR/TB,loudnorm=I=-14:TP=-1.5:LRA=11[af]`);
  } else {
    args.push("-f", "lavfi", "-t", String(keptDuration(o.segs)), "-i", "anullsrc=r=48000:cl=mono");
    parts.push(`[1:a]anull[af]`);
  }
  const script = path.join(o.workDir, "long.filter");
  fs.writeFileSync(script, parts.join(";\n"));
  args.push(
    "-filter_complex_script", script,
    "-map", "[vf]", "-map", "[af]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart",
    o.output,
  );
  // A 90-minute recording takes a while on a 2-core server; allow up to 5 hours.
  await exec(env.ffmpeg(), args, { timeoutMs: 5 * 3600e3 });
}

/** Thumbnail text, burned onto a still with the same font as the reels. */
export function thumbAss(text: string) {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Thumb,Inter Black,112,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,9,4,1,70,560,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,Thumb,,0,0,0,,${escAss(text.toUpperCase())}
`;
}

const filterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

export async function thumbnails(video: string, duration: number, texts: string[], dir: string) {
  const out: string[] = [];
  const at = [0.22, 0.5, 0.78];
  for (let k = 0; k < 3; k++) {
    const ass = path.join(dir, `thumb${k + 1}.ass`);
    fs.writeFileSync(ass, thumbAss(texts[k] || texts[0] || ""));
    const file = path.join(dir, `thumb${k + 1}.jpg`);
    const vf = `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,eq=brightness=-0.04:contrast=1.08,ass='${filterPath(ass)}':fontsdir='${filterPath(env.fontsDir())}'`;
    await exec(env.ffmpeg(), ["-hide_banner", "-y", "-ss", (duration * at[k]).toFixed(2), "-i", video, "-frames:v", "1", "-vf", vf, "-q:v", "3", file], { timeoutMs: 120e3 });
    out.push(file);
  }
  return out;
}

export type LongformResult = { output: string; srt: string; thumbs: string[]; duration: number; chapters: Chapter[]; warnings: string[]; segs: Seg[] };

/** The whole long-form job. */
export async function makeLongform(o: {
  input: string;
  workDir: string;
  words: Word[];
  cutSilence: boolean;
  trimStart?: number | null;
  trimEnd?: number | null;
  chapters: Chapter[];
  thumbTexts: string[];
  /** Parts of the recording to cut out (the sentences the SEBI/ASCI rules flag). */
  remove?: Seg[];
}): Promise<LongformResult> {
  fs.mkdirSync(o.workDir, { recursive: true });
  const warnings: string[] = [];
  const p = await probe(o.input);
  const from = Math.max(0, o.trimStart || 0);
  const to = Math.min(p.duration, o.trimEnd && o.trimEnd > from ? o.trimEnd : p.duration);
  let segs: Seg[] = [{ s: 0, e: p.duration }];
  if (o.cutSilence && p.hasAudio) {
    // Long-form keeps a natural pace: only pauses over a second come out.
    const sil = await detectSilence(o.input, -35, 1.0);
    segs = keepSegments(sil, p.duration, 0.25, 0.4);
  }
  if (o.remove?.length) segs = subtractRanges(segs, o.remove);
  segs = prepareSegs(segs, from, to);
  if (!segs.length) throw new Error("Nothing left to keep — check the start and end times.");
  let toneMap = false;
  if (p.hdr) {
    toneMap = await canToneMap();
    warnings.push(toneMap ? "Shot in HDR — converted to normal colours." : "Shot in HDR and this server can't convert it; colours may look washed out.");
  }
  if (p.width < 1280 && p.height < 1280) warnings.push(`The recording is only ${p.width}×${p.height}. Record long sessions at 1080p.`);
  const output = path.join(o.workDir, "long.mp4");
  await cutLongform({ input: o.input, output, segs, toneMap, vertical: p.height > p.width, hasAudio: p.hasAudio, workDir: o.workDir });
  const outProbe = await probe(output);
  const kept = keptDuration(segs);
  if (Math.abs(outProbe.duration - kept) > 2) warnings.push(`The finished video is ${Math.round(outProbe.duration)}s but ${Math.round(kept)}s were kept — check the end for missing sound or picture.`);
  if (outProbe.duration < 8 * 60) warnings.push(`It's ${Math.round(outProbe.duration / 60)} minutes. Long-form does best from about 8 minutes up — consider using this one only for clips.`);

  const srtFile = path.join(o.workDir, "captions.srt");
  fs.writeFileSync(srtFile, toSrt(mapWords(o.words, segs)));
  const chapters = fixChapters(o.chapters.map((c) => ({ t: mapTime(Number(c.t), segs), title: c.title })), outProbe.duration);
  if (!chapters.length && o.chapters.length) warnings.push("Fewer than 3 usable chapters, so none are added (YouTube needs 3, each 10s or longer).");
  const thumbs = await thumbnails(output, outProbe.duration, o.thumbTexts, o.workDir);
  for (const f of ["long.filter", "thumb1.ass", "thumb2.ass", "thumb3.ass"]) fs.rmSync(path.join(o.workDir, f), { force: true });
  return { output, srt: srtFile, thumbs, duration: outProbe.duration, chapters, warnings, segs };
}
