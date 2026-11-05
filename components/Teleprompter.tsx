"use client";
import { useEffect, useRef, useState } from "react";
import { Minus, Pause, Play, Plus, RotateCcw, FlipHorizontal } from "lucide-react";

/** Full-screen prompter for a phone or laptop behind the camera. Space = play/pause, arrows = speed. */
export function Teleprompter({ text, title }: { text: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(40);
  const [size, setSize] = useState(44);
  const [mirror, setMirror] = useState(false);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const el = box.current;
      if (el) el.scrollTop += ((t - last) / 1000) * speed;
      last = t;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (e.key === "ArrowUp") setSpeed((s) => Math.min(200, s + 5));
      if (e.key === "ArrowDown") setSpeed((s) => Math.max(5, s - 5));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2 text-sm">
        <span className="mr-auto truncate text-white/70">{title}</span>
        <button className="rounded bg-white/10 px-2 py-1" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
        <button className="rounded bg-white/10 px-2 py-1" aria-label="Back to the start" title="Back to the start" onClick={() => { if (box.current) box.current.scrollTop = 0; setPlaying(false); }}><RotateCcw className="h-4 w-4" /></button>
        <span className="text-white/60">speed</span>
        <button className="rounded bg-white/10 px-2 py-1" aria-label="Slower" title="Slower" onClick={() => setSpeed((s) => Math.max(5, s - 5))}><Minus className="h-4 w-4" /></button>
        <span className="w-8 text-center tabular-nums">{speed}</span>
        <button className="rounded bg-white/10 px-2 py-1" aria-label="Faster" title="Faster" onClick={() => setSpeed((s) => Math.min(200, s + 5))}><Plus className="h-4 w-4" /></button>
        <span className="text-white/60">size</span>
        <button className="rounded bg-white/10 px-2 py-1" aria-label="Smaller text" title="Smaller text" onClick={() => setSize((s) => Math.max(24, s - 4))}><Minus className="h-4 w-4" /></button>
        <button className="rounded bg-white/10 px-2 py-1" aria-label="Bigger text" title="Bigger text" onClick={() => setSize((s) => Math.min(96, s + 4))}><Plus className="h-4 w-4" /></button>
        <button className="rounded bg-white/10 px-2 py-1" onClick={() => setMirror((m) => !m)} aria-label="Mirror" title="Mirror for a beam-splitter prompter"><FlipHorizontal className="h-4 w-4" /></button>
        <a href="/shoot" className="rounded bg-white/10 px-2 py-1">Close</a>
      </div>
      <div ref={box} className="flex-1 overflow-y-auto px-6 md:px-24" style={{ transform: mirror ? "scaleX(-1)" : undefined }}>
        <div className="mx-auto max-w-4xl whitespace-pre-wrap py-[45vh] font-semibold leading-snug" style={{ fontSize: size }}>
          {text}
        </div>
      </div>
      <div className="pointer-events-none fixed left-0 right-0 top-1/2 h-0.5 bg-accent/60" />
    </div>
  );
}
