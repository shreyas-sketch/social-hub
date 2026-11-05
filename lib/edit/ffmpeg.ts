import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/config";
import { exec } from "@/lib/media";
import { buildAss, type CaptionStyle } from "./captions";
import { transcribe, type Word } from "./transcribe";

export type FrameMode = "crop" | "fit_blur";
export type EditSettings = { captionStyle: CaptionStyle; frame: FrameMode; cutSilence: boolean; silenceDb: number; minSilence: number; hookText?: string | null };
export const DEFAULT_EDIT: EditSettings = { captionStyle: "bold_pop", frame: "crop", cutSilence: true, silenceDb: -32, minSilence: 0.45 };

export type Probe = { duration: number; width: number; height: number; hasAudio: boolean; fps: number; hdr: boolean };

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await exec(env.ffprobe(), ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { timeoutMs: 60e3 });
  const j = JSON.parse(stdout);
  const v = (j.streams || []).find((s: any) => s.codec_type === "video");
  if (!v) throw new Error("No video stream in the file");
  const rot = Number(v.tags?.rotate ?? (v.side_data_list || []).find((d: any) => d.rotation !== undefined)?.rotation ?? 0);
  const sideways = Math.abs(rot) % 180 === 90;
  const [n, d] = String(v.avg_frame_rate || "30/1").split("/").map(Number);
  return {
    duration: Number(j.format?.duration ?? v.duration ?? 0),
    width: sideways ? v.height : v.width,
    height: sideways ? v.width : v.height,
    hasAudio: (j.streams || []).some((s: any) => s.codec_type === "audio"),
    fps: d ? n / d : 30,
    // iPhones record HDR (HLG) by default; without tone-mapping it looks washed out on Instagram.
    hdr: ["arib-std-b67", "smpte2084"].includes(String(v.color_transfer || "")),
  };
}

/** Finds pauses. Returns [{start, end}] in seconds. */
export async function detectSilence(file: string, noiseDb: number, minDur: number) {
  // -vn: only the sound is needed, which keeps this quick even on a 90-minute recording.
  const { stderr } = await exec(env.ffmpeg(), ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `silencedetect=noise=${noiseDb}dB:d=${minDur}`, "-f", "null", "-"], {
    timeoutMs: 30 * 60e3,
  });
  return parseSilence(stderr);
}

export function parseSilence(stderr: string) {
  const out: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start: (-?[\d.]+)/);
    if (s) start = Math.max(0, Number(s[1]));
    const e = line.match(/silence_end: ([\d.]+)/);
    if (e && start !== null) {
      out.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: Infinity });
  return out;
}

/** Turns pauses into the parts we keep, leaving a little air either side of each cut. */
export function keepSegments(silences: { start: number; end: number }[], duration: number, pad = 0.12, minKeep = 0.25) {
  const keep: { s: number; e: number }[] = [];
  let cursor = 0;
  for (const sl of silences) {
    const cutFrom = Math.min(duration, sl.start + pad);
    const cutTo = Math.max(0, Math.min(duration, sl.end) - pad);
    if (cutTo - cutFrom < 0.15) continue; // too short to bother cutting
    if (cutFrom - cursor >= minKeep) keep.push({ s: cursor, e: cutFrom });
    cursor = cutTo;
  }
  if (duration - cursor >= minKeep) keep.push({ s: cursor, e: duration });
  return keep.length ? keep : [{ s: 0, e: duration }];
}

function frameFilter(input: string, mode: FrameMode, out: string) {
  if (mode === "fit_blur") {
    return (
      `[${input}]split=2[bgsrc][fgsrc];` +
      `[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.06[bg];` +
      `[fgsrc]scale=1080:1920:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=30,format=yuv420p,setsar=1[${out}]`
    );
  }
  return `[${input}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p,setsar=1[${out}]`;
}

export const TONEMAP = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

let zscaleOk: boolean | null = null;
/** Tone-mapping needs ffmpeg's zscale filter (Ubuntu's ffmpeg has it). */
export async function canToneMap() {
  if (zscaleOk !== null) return zscaleOk;
  try {
    const { stdout } = await exec(env.ffmpeg(), ["-hide_banner", "-filters"], { timeoutMs: 20e3 });
    zscaleOk = /\szscale\s/.test(stdout) && /\stonemap\s/.test(stdout);
  } catch {
    zscaleOk = false;
  }
  return zscaleOk;
}

/** Step 1: cut the pauses and frame the shot at 1080×1920 (tone-mapping HDR footage to normal video first). */
export async function cutAndFrame(input: string, out: string, segs: { s: number; e: number }[], mode: FrameMode, hasAudio: boolean, toneMap = false) {
  const parts: string[] = [];
  const args = ["-hide_banner", "-y", "-i", input];
  if (!hasAudio) args.push("-f", "lavfi", "-t", String(segs[segs.length - 1].e), "-i", "anullsrc=r=48000:cl=mono");
  const aIn = hasAudio ? "0:a" : "1:a";
  if (toneMap) {
    parts.push(`[0:v]${TONEMAP}[sdr]`);
    parts.push(`[sdr]split=${segs.length}${segs.map((_, k) => `[src${k}]`).join("")}`);
  }
  segs.forEach((g, k) => {
    parts.push(`[${toneMap ? `src${k}` : "0:v"}]trim=start=${g.s.toFixed(3)}:end=${g.e.toFixed(3)},setpts=PTS-STARTPTS[v${k}]`);
    parts.push(`[${aIn}]atrim=start=${g.s.toFixed(3)}:end=${g.e.toFixed(3)},asetpts=PTS-STARTPTS[a${k}]`);
  });
  const ins = segs.map((_, k) => `[v${k}][a${k}]`).join("");
  parts.push(`${ins}concat=n=${segs.length}:v=1:a=1[vc][ac]`);
  parts.push(frameFilter("vc", mode, "vf"));
  parts.push(`[ac]aresample=48000[af]`);
  const script = path.join(path.dirname(out), "cut.filter");
  fs.writeFileSync(script, parts.join(";\n"));
  args.push(
    "-filter_complex_script", script,
    "-map", "[vf]", "-map", "[af]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
    "-c:a", "aac", "-b:a", "192k",
    out,
  );
  await exec(env.ffmpeg(), args, { timeoutMs: 30 * 60e3 });
}

const filterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

/** Step 3: burn captions + hook text, even out loudness, encode for Instagram (H.264/AAC, faststart). */
export async function finish(input: string, assFile: string, out: string) {
  const vf = `ass='${filterPath(assFile)}':fontsdir='${filterPath(env.fontsDir())}'`;
  await exec(
    env.ffmpeg(),
    [
      "-hide_banner", "-y", "-i", input,
      "-vf", vf,
      "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
      "-movflags", "+faststart",
      out,
    ],
    { timeoutMs: 30 * 60e3 },
  );
}

export async function thumbnail(input: string, out: string, at = 1) {
  await exec(env.ffmpeg(), ["-hide_banner", "-y", "-ss", String(at), "-i", input, "-frames:v", "1", "-q:v", "3", out], { timeoutMs: 60e3 });
}

export type EditResult = { output: string; thumb: string; duration: number; words: Word[]; warnings: string[]; cutSeconds: number };

/**
 * Takes one clip out of a long recording into the work folder (frame-accurate), converting HDR on the way,
 * so the rest of the edit treats it like a normal take.
 */
export async function extractClip(input: string, clip: { start: number; end: number }, workDir: string, warnings: string[]) {
  const src = path.join(workDir, "src.mp4");
  const p0 = await probe(input);
  const start = Math.max(0, clip.start);
  const dur = Math.max(1, Math.min(p0.duration, clip.end) - start);
  const tm = p0.hdr ? await canToneMap() : false;
  const args = ["-hide_banner", "-y", "-ss", start.toFixed(3), "-i", input, "-t", dur.toFixed(3), "-map", "0:v:0", "-map", "0:a:0?"];
  if (tm) args.push("-vf", TONEMAP);
  else args.push("-pix_fmt", "yuv420p");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-c:a", "aac", "-b:a", "192k", src);
  await exec(env.ffmpeg(), args, { timeoutMs: 20 * 60e3 });
  if (tm) warnings.push("The recording is HDR — converted to normal colours. Check the skin tones.");
  return src;
}

/**
 * The whole edit: probe → cut pauses + frame 9:16 → transcribe the cut → captions → final encode.
 * Works in `workDir`, writes `output` and a thumbnail next to it.
 */
export async function editVideo(opts: {
  input: string;
  workDir: string;
  output: string;
  settings: EditSettings;
  hook?: string | null;
  onScreen?: { t: number; text: string }[];
  screenDisclaimer?: string | null;
  /** A clip from a long session: only this part of the recording (seconds). */
  clip?: { start: number; end: number } | null;
}): Promise<EditResult> {
  const warnings: string[] = [];
  fs.mkdirSync(opts.workDir, { recursive: true });
  let input = opts.input;
  if (opts.clip) input = await extractClip(opts.input, opts.clip, opts.workDir, warnings);
  const p = await probe(input);
  if (p.width > p.height) warnings.push(`Shot in landscape (${p.width}×${p.height}). ${opts.settings.frame === "crop" ? "Cropped to the centre" : "Fitted on a blurred background"} — check the framing.`);
  if (!p.hasAudio) warnings.push("The file has no sound.");

  let segs = [{ s: 0, e: p.duration }];
  if (opts.settings.cutSilence && p.hasAudio) {
    const sil = await detectSilence(input, opts.settings.silenceDb, opts.settings.minSilence);
    segs = keepSegments(sil, p.duration);
  }
  const kept = segs.reduce((n, g) => n + (g.e - g.s), 0);
  const mid = path.join(opts.workDir, "cut.mp4");
  let toneMap = false;
  if (p.hdr) {
    toneMap = await canToneMap();
    warnings.push(toneMap ? "Shot in HDR — converted to normal colours. Check the skin tones." : "Shot in HDR and this server can't convert it, so colours may look washed out. Turn off HDR video in the phone's camera settings.");
  }
  await cutAndFrame(input, mid, segs, opts.settings.frame, p.hasAudio, toneMap);

  const wav = path.join(opts.workDir, "cut.wav");
  await exec(env.ffmpeg(), ["-hide_banner", "-y", "-i", mid, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeoutMs: 10 * 60e3 });
  // A transcript fixed by hand for an earlier version of this edit can be dropped in as cut.wav.words.json.
  const prev = path.join(opts.workDir, "transcript.json");
  if (fs.existsSync(prev) && !fs.existsSync(`${wav}.words.json`)) fs.copyFileSync(prev, `${wav}.words.json`);

  // The words are always transcribed, captions or not: the rules check reads what the take actually says.
  let words: Word[] = [];
  if (p.hasAudio) {
    try {
      words = await transcribe(wav);
      if (!words.length) warnings.push("No speech found, so the words in this take couldn't be checked against the rules.");
    } catch (e) {
      warnings.push(`No transcript (${(e as Error).message}), so the words in this take couldn't be checked against the rules.`);
    }
  }
  const midProbe = await probe(mid);
  const ass = buildAss({
    words: opts.settings.captionStyle === "none" ? [] : words,
    style: opts.settings.captionStyle,
    hook: opts.hook,
    onScreen: opts.onScreen,
    screenDisclaimer: opts.screenDisclaimer,
    duration: midProbe.duration,
  });
  const assFile = path.join(opts.workDir, "captions.ass");
  fs.writeFileSync(assFile, ass);
  fs.writeFileSync(prev, JSON.stringify(words));

  await finish(mid, assFile, opts.output);
  const outProbe = await probe(opts.output);
  // Reels up to 3 minutes are recommended to non-followers (Instagram, Jan 2025); Shorts are up to 3 minutes too.
  if (outProbe.duration > 180) warnings.push(`It's ${Math.round(outProbe.duration)}s. Over 3 minutes, Instagram won't recommend it to new people and YouTube won't treat it as a Short. Trim it.`);
  else if (outProbe.duration > 75) warnings.push(`It's ${Math.round(outProbe.duration)}s. Our best reels are 30–60s — check whether it can be tighter.`);
  if (outProbe.duration < 5) warnings.push("Under 5 seconds — check the take.");

  const thumb = opts.output.replace(/\.mp4$/, ".jpg");
  await thumbnail(opts.output, thumb, Math.min(1.5, outProbe.duration / 3));

  return { output: opts.output, thumb, duration: outProbe.duration, words, warnings, cutSeconds: Math.max(0, p.duration - kept) };
}
