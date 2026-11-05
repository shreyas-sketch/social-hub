/**
 * Makes a 20-second landscape test clip with three pauses, runs the full edit on it,
 * and prints what came out. No transcription engine needed: it uses a sample word file.
 *   npm run edit-sample            → writes to ./data/sample/
 *   npm run edit-sample -- /some/dir
 */
import fs from "node:fs";
import path from "node:path";
import { exec } from "@/lib/media";
import { env } from "@/lib/config";
import { editVideo, DEFAULT_EDIT, probe } from "@/lib/edit/ffmpeg";

async function main() {
  const dir = path.resolve(process.argv[2] || path.join(process.cwd(), "data", "sample"));
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, "raw.mp4");
  // Tone for 4s, silence 1.5s, tone 5s, silence 2s, tone 4s, silence 1.2s, tone 2.3s = 20s
  const tone = (d: number) => `sine=frequency=220:duration=${d}`;
  const quiet = (d: number) => `anullsrc=r=48000:cl=mono:d=${d}`;
  const pieces = [tone(4), quiet(1.5), tone(5), quiet(2), tone(4), quiet(1.2), tone(2.3)];
  const inputs = pieces.flatMap((p) => ["-f", "lavfi", "-i", p]);
  const concat = pieces.map((_, i) => `[${i + 1}:a]aresample=48000,aformat=channel_layouts=mono[a${i}]`).join(";") +
    ";" + pieces.map((_, i) => `[a${i}]`).join("") + `concat=n=${pieces.length}:v=0:a=1[aout]`;
  await exec(env.ffmpeg(), [
    "-hide_banner", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=20",
    ...inputs,
    "-filter_complex", concat,
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-shortest", src,
  ]);

  const work = path.join(dir, "work");
  fs.mkdirSync(work, { recursive: true });
  // Fake word timings on the cut timeline, standing in for Whisper.
  const words = "Most part time traders lose money for one reason. They break their own rules. Here is the fix that takes ten minutes a day."
    .split(" ")
    .map((w, i) => ({ w, s: 0.3 + i * 0.55, e: 0.3 + i * 0.55 + 0.45 }));
  fs.writeFileSync(path.join(work, "cut.wav.words.json"), JSON.stringify(words));

  const t0 = Date.now();
  const res = await editVideo({
    input: src,
    workDir: work,
    output: path.join(dir, "edited.mp4"),
    settings: { ...DEFAULT_EDIT, frame: (process.env.FRAME as any) || "fit_blur" },
    hook: "You're not losing money. Your rules are.",
    onScreen: [{ t: 0, text: "Hook" }, { t: 5, text: "Rule 1: fixed stop loss" }, { t: 9, text: "Rule 2: one trade a day" }],
    screenDisclaimer: "Education only. Not investment advice.",
  });
  const p = await probe(res.output);
  console.log(JSON.stringify({ seconds: (Date.now() - t0) / 1000, input: 20, output: Math.round(p.duration * 10) / 10, cut: Math.round(res.cutSeconds * 10) / 10, size: `${p.width}x${p.height}`, warnings: res.warnings, out: res.output, thumb: res.thumb }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
