import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/config";
import { exec } from "@/lib/media";

/** One spoken word with its start and end, in seconds from the start of the cut video. */
export type Word = { w: string; s: number; e: number };

/**
 * Word timings for captions.
 *  local  = whisper.cpp on this server (free; install once, see DEPLOY.md)
 *  openai = OpenAI's Whisper API (paid per minute)
 *  none   = no captions
 * A sidecar file "<wav>.words.json" wins over both, so tests and hand-fixed transcripts work.
 */
export async function transcribe(wavPath: string, opts: { durationSec?: number } = {}): Promise<Word[]> {
  const sidecar = `${wavPath}.words.json`;
  if (fs.existsSync(sidecar)) return JSON.parse(fs.readFileSync(sidecar, "utf8"));
  const engine = env.transcribeEngine();
  if (engine === "none") return [];
  // OpenAI takes files up to 25 MB (about 13 minutes of 16 kHz WAV), so long recordings go in 10-minute pieces.
  if (engine === "openai") return (opts.durationSec ?? 0) > 600 ? openaiLong(wavPath) : openai(wavPath);
  // Local transcription runs at a few times real speed on a small server; give long recordings room.
  return whisperCpp(wavPath, Math.max(15 * 60e3, (opts.durationSec ?? 0) * 1500));
}

async function openaiLong(wavPath: string): Promise<Word[]> {
  const dir = path.join(path.dirname(wavPath), "pieces");
  fs.mkdirSync(dir, { recursive: true });
  await exec(env.ffmpeg(), ["-hide_banner", "-y", "-i", wavPath, "-f", "segment", "-segment_time", "600", "-c", "copy", path.join(dir, "p%03d.wav")], { timeoutMs: 10 * 60e3 });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).sort();
  const out: Word[] = [];
  for (let i = 0; i < files.length; i++) {
    const offset = i * 600;
    for (const w of await openai(path.join(dir, files[i]))) out.push({ w: w.w, s: +(w.s + offset).toFixed(3), e: +(w.e + offset).toFixed(3) });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

async function whisperCpp(wavPath: string, timeoutMs = 15 * 60e3): Promise<Word[]> {
  const model = env.whisperModel();
  if (!fs.existsSync(model)) throw new Error(`Whisper model not found at ${model}. Set WHISPER_MODEL or TRANSCRIBE_ENGINE.`);
  const outBase = wavPath.replace(/\.wav$/, "");
  // -ml 1 + -sow: one word per segment, split on word boundaries; -oj: JSON out
  await exec(env.whisperBin(), ["-m", model, "-f", wavPath, "-l", "en", "-ml", "1", "-sow", "-oj", "-of", outBase, "-np"], { timeoutMs });
  const j = JSON.parse(fs.readFileSync(`${outBase}.json`, "utf8"));
  return parseWhisperCpp(j);
}

export function parseWhisperCpp(j: any): Word[] {
  const segs: any[] = j?.transcription || [];
  return segs
    .map((s) => ({ w: String(s.text || "").trim(), s: (s.offsets?.from ?? 0) / 1000, e: (s.offsets?.to ?? 0) / 1000 }))
    .filter((x) => x.w && !/^\[.*\]$/.test(x.w)); // drop [BLANK_AUDIO], [Music] and the like
}

async function openai(wavPath: string): Promise<Word[]> {
  const key = env.openaiKey();
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(wavPath)], { type: "audio/wav" }), path.basename(wavPath));
  form.append("model", "whisper-1");
  form.append("language", "en");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Transcription failed ${res.status}: ${j?.error?.message || ""}`);
  return (j.words || []).map((x: any) => ({ w: String(x.word).trim(), s: Number(x.start), e: Number(x.end) })).filter((x: Word) => x.w);
}
