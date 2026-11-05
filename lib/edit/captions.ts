import type { Word } from "./transcribe";

export type CaptionStyle = "bold_pop" | "clean" | "none";
export const CAPTION_STYLES: { key: CaptionStyle; label: string }[] = [
  { key: "bold_pop", label: "Bold, word-by-word highlight" },
  { key: "clean", label: "Clean two-line" },
  { key: "none", label: "No captions" },
];

export type Line = { start: number; end: number; words: Word[] };

/** Groups words into short caption lines: a few words, no long pauses inside a line. */
export function groupWords(words: Word[], maxWords = 3, maxChars = 18, maxGap = 0.6): Line[] {
  const lines: Line[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) lines.push({ start: cur[0].s, end: cur[cur.length - 1].e, words: cur });
    cur = [];
  };
  for (const w of words) {
    const last = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
    const endsSentence = last && /[.!?]$/.test(last.w);
    if (cur.length && (cur.length >= maxWords || chars > maxChars || w.s - last.e > maxGap || endsSentence)) flush();
    cur.push(w);
  }
  flush();
  // Keep each line on screen until the next starts (small gaps feel jumpy), but never more than 1.2s past its last word.
  for (let i = 0; i < lines.length - 1; i++) {
    const gap = lines[i + 1].start - lines[i].end;
    if (gap > 0 && gap < 1.2) lines[i].end = lines[i + 1].start;
  }
  return lines;
}

const t = (sec: number) => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const c2 = cs === 100 ? 99 : cs;
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(c2).padStart(2, "0")}`;
};

/** ASS treats { } as override tags and \ as escapes; keep viewers' text literal. */
export const escAss = (s: string) => s.replace(/\\/g, "/").replace(/[{}]/g, (c) => (c === "{" ? "(" : ")")).replace(/\r?\n/g, "\\N");

export type AssInput = {
  words: Word[];
  style: CaptionStyle;
  hook?: string | null;
  onScreen?: { t: number; text: string }[];
  screenDisclaimer?: string | null;
  duration: number;
  width?: number;
  height?: number;
};

/** Builds the subtitle file burned into the reel: captions, hook text, on-screen notes, disclaimer. */
export function buildAss(i: AssInput) {
  const W = i.width ?? 1080;
  const H = i.height ?? 1920;
  // Colours are &HAABBGGRR (AA = transparency). With BorderStyle 3 the box takes the OutlineColour.
  const styles = [
    "Style: Pop,Inter ExtraBold,84,&H00FFFFFF,&H00FFFFFF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,7,0,2,90,90,600,1",
    "Style: Clean,Inter SemiBold,62,&H00FFFFFF,&H00FFFFFF,&H60000000,&H00000000,0,0,0,0,100,100,0,0,3,14,0,2,110,110,580,1",
    "Style: Hook,Inter ExtraBold,70,&H00FFFFFF,&H00FFFFFF,&H30000000,&H00000000,-1,0,0,0,100,100,0,0,3,22,0,8,90,90,250,1",
    "Style: Note,Inter Bold,58,&H00101010,&H00101010,&H0000E5FF,&H0000E5FF,-1,0,0,0,100,100,0,0,3,16,0,8,110,110,300,1",
    // Disclaimer: above Instagram's bottom bar (username, caption, music cover roughly the last 380px), so it isn't hidden.
    "Style: Legal,Inter SemiBold,34,&H00FFFFFF,&H00FFFFFF,&H70000000,&H00000000,0,0,0,0,100,100,0,0,3,10,0,2,70,70,420,1",
  ];
  const ev: string[] = [];
  const dlg = (layer: number, s: number, e: number, style: string, text: string) =>
    ev.push(`Dialogue: ${layer},${t(s)},${t(Math.max(e, s + 0.05))},${style},,0,0,0,,${text}`);

  // Hook on top for the first 3 seconds (or until the first on-screen note).
  const notes = (i.onScreen || []).filter((o) => o.text && o.t > 0.5 && o.t < i.duration).sort((a, b) => a.t - b.t);
  if (i.hook && i.hook.trim()) {
    const hookEnd = Math.min(3.2, notes[0]?.t ?? 3.2, i.duration);
    dlg(3, 0, hookEnd, "Hook", `{\\fad(80,120)}${escAss(i.hook.trim())}`);
  }
  for (let k = 0; k < notes.length; k++) {
    const end = Math.min(notes[k].t + 2.6, notes[k + 1]?.t ?? Infinity, i.duration);
    dlg(3, notes[k].t, end, "Note", `{\\fad(80,120)}${escAss(notes[k].text)}`);
  }

  if (i.style !== "none" && i.words.length) {
    if (i.style === "bold_pop") {
      for (const line of groupWords(i.words, 3, 18)) {
        // One event per word: the whole line, with the word being spoken in yellow and slightly larger.
        line.words.forEach((w, idx) => {
          const s = idx === 0 ? line.start : w.s;
          const e = idx === line.words.length - 1 ? line.end : line.words[idx + 1].s;
          const text = line.words
            .map((x, j) => (j === idx ? `{\\c&H0000E5FF&\\fscx106\\fscy106}${escAss(x.w.toUpperCase())}{\\r}` : escAss(x.w.toUpperCase())))
            .join(" ");
          dlg(1, s, e, "Pop", text);
        });
      }
    } else {
      for (const line of groupWords(i.words, 7, 36, 0.8)) dlg(1, line.start, line.end, "Clean", escAss(line.words.map((x) => x.w).join(" ")));
    }
  }

  if (i.screenDisclaimer && i.screenDisclaimer.trim()) dlg(0, 0, i.duration, "Legal", escAss(i.screenDisclaimer.trim()));

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join("\n")}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join("\n")}
`;
}
