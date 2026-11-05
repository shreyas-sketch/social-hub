import Link from "next/link";
import type { ReactNode } from "react";

/** AI output is saved as it came back; a list that came back as anything else shows as empty instead of breaking the page. */
export const arr = <T = any,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/** Only plain web links are clickable (a link written by an AI from someone's caption could be a script). */
export const safeHref = (x: unknown): string | null => (typeof x === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(x.trim()) ? x.trim() : null);

export function PageHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {sub ? <p className="mt-1 text-sm text-muted">{sub}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

export function Kpi({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "warn" | "ok" | "bad" }) {
  const ring = tone === "warn" ? "border-amber-200" : tone === "bad" ? "border-red-200" : tone === "ok" ? "border-emerald-200" : "border-line";
  const inner = (
    <div className={`card h-full p-4 ${ring} ${href ? "hover:border-accent transition" : ""}`}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card p-8 text-center">
      <div className="text-sm font-medium">{title}</div>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div> : null}
    </div>
  );
}

const TONES: Record<string, string> = {
  gray: "bg-gray-100 text-gray-700",
  violet: "bg-accentSoft text-accent",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  blue: "bg-sky-50 text-sky-700",
};

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>{children}</span>;
}

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  proposed: "violet", approved: "blue", rejected: "gray", shot: "blue", edited: "blue", trial: "amber", winner: "green", not_winner: "gray",
  queued: "gray", running: "amber", ready: "violet", error: "red", live: "amber", posting: "amber", done: "green", pending: "gray",
  manual_todo: "amber", skipped: "gray", connected: "green", not_connected: "amber", missing: "red",
  ok: "green", warn: "amber", block: "red",
};

const STATUS_LABEL: Record<string, string> = {
  proposed: "to review", not_winner: "not a winner", manual_todo: "do by hand", not_connected: "not connected", missing: "doesn't exist yet",
  block: "blocked", warn: "check", ok: "clear",
};

export function Status({ s }: { s: string | null | undefined }) {
  const k = s || "—";
  return <Badge tone={STATUS_TONE[k] || "gray"}>{STATUS_LABEL[k] || k.replace(/_/g, " ")}</Badge>;
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-IN");
}

export function ago(iso: string | null | undefined) {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ist(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function SpeakerTabs({ base, speakers, active, extra }: { base: string; speakers: { slug: string; name: string }[]; active?: string; extra?: string }) {
  const q = (slug?: string) => {
    const p = new URLSearchParams(extra || "");
    if (slug) p.set("speaker", slug);
    else p.delete("speaker");
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  return (
    <div className="mb-5 flex flex-wrap gap-1.5">
      <Link href={q()} className={`rounded-full px-3 py-1 text-sm ${!active ? "bg-ink text-white" : "bg-white border border-line hover:border-accent"}`}>All</Link>
      {speakers.map((s) => (
        <Link key={s.slug} href={q(s.slug)} className={`rounded-full px-3 py-1 text-sm ${active === s.slug ? "bg-ink text-white" : "bg-white border border-line hover:border-accent"}`}>
          {s.name.split(" ")[0]}
        </Link>
      ))}
    </div>
  );
}
