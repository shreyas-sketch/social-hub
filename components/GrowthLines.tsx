"use client";
import { useMemo, useRef, useState } from "react";

/**
 * Growth since the first week, one line per speaker, on one platform. Indexed (start = 0%) so a 400-follower
 * account and a 14K one can be compared on one axis. Hover: a crosshair snaps to the week and lists every
 * speaker's growth and follower count. Direct labels at the line ends plus a legend, so colour never works alone.
 */
export type GrowthSeries = { name: string; color: string; growth: (number | null)[]; followers: (number | null)[] };

const W = 760;
const H = 300;
const M = { t: 16, r: 120, b: 28, l: 52 };

const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.abs(v) >= 10 ? Math.round(v) : v.toFixed(1)}%`;
const num = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-IN"));

function niceStep(span: number) {
  const raw = span / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) || p * 10;
}

export function GrowthLines({ weeks, series }: { weeks: string[]; series: GrowthSeries[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.growth.filter((v): v is number => v != null));
  const lo = Math.min(0, ...all);
  const hi = Math.max(1, ...all);
  const step = niceStep(hi - lo);
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hi / step) * step;
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const x = (i: number) => M.l + (weeks.length > 1 ? (i / (weeks.length - 1)) * iw : iw / 2);
  const y = (v: number) => M.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(+v.toFixed(6));

  // End labels: at each line's last value, nudged apart so none overlap.
  const ends = useMemo(() => {
    const items = series
      .map((s) => {
        let k = s.growth.length - 1;
        while (k >= 0 && s.growth[k] == null) k--;
        return k >= 0 ? { name: s.name, color: s.color, v: s.growth[k] as number, y: y(s.growth[k] as number) } : null;
      })
      .filter(Boolean) as { name: string; color: string; v: number; y: number }[];
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 14) items[i].y = items[i - 1].y + 14;
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, yMin, yMax]);

  const path = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((sx - M.l) / iw) * (weeks.length - 1));
    setHover(Math.max(0, Math.min(weeks.length - 1, i)));
  };

  const tipLeft = hover != null ? (x(hover) / W) * 100 : 0;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden><line x1="0" y1="4" x2="16" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" /></svg>
            {s.name}
          </span>
        ))}
      </div>
      {/* On a phone the chart keeps a readable size and scrolls sideways (the numbers table below has every value). */}
      <div className="overflow-x-auto">
      <div ref={wrap} className="relative min-w-[620px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Follower growth since the first week, per speaker">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#c9c7d6" : "#eceaf3"} strokeWidth="1" />
            <text x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="#8b8aa3">{pct(t)}</text>
          </g>
        ))}
        {weeks.map((w, i) =>
          i === 0 || i === weeks.length - 1 || i % 3 === 0 ? (
            <text key={w} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#8b8aa3">{w}</text>
          ) : null,
        )}
        {series.map((s) => (
          <path key={s.name} d={path(s.growth)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {ends.map((e) => (
          <text key={e.name} x={W - M.r + 8} y={e.y} dy="0.32em" fontSize="11" fill="#1f2033">
            {e.name} <tspan fill="#8b8aa3">{pct(e.v)}</tspan>
          </text>
        ))}
        {hover != null ? (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ih} stroke="#8b8aa3" strokeWidth="1" />
            {series.map((s) =>
              s.growth[hover] != null ? <circle key={s.name} cx={x(hover)} cy={y(s.growth[hover] as number)} r="4.5" fill={s.color} stroke="#ffffff" strokeWidth="2" /> : null,
            )}
          </g>
        ) : null}
        <rect x={M.l} y={M.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover != null ? (
        <div
          className="pointer-events-none absolute top-8 z-10 min-w-[180px] rounded-lg border border-line bg-white p-2.5 text-xs shadow-card"
          style={{ left: `${tipLeft}%`, transform: tipLeft > 60 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
        >
          <div className="mb-1 text-muted">Week ending {weeks[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-2 py-0.5">
              <svg width="12" height="6" aria-hidden><line x1="0" y1="3" x2="12" y2="3" stroke={s.color} strokeWidth="2" strokeLinecap="round" /></svg>
              <b className="tabular-nums">{s.growth[hover] != null ? pct(s.growth[hover] as number) : "—"}</b>
              <span className="tabular-nums text-muted">{num(s.followers[hover])}</span>
              <span className="ml-auto pl-2 text-muted">{s.name}</span>
            </div>
          ))}
        </div>
      ) : null}
      </div>
      </div>
    </div>
  );
}
