import { raw, one, json } from "@/db";
import type { Niche } from "@/lib/compliance";

export type Lane = { key: string; name: string; desc: string; share: number };

export type Speaker = {
  id: number;
  slug: string;
  name: string;
  niche: Niche;
  direction: string | null;
  audience: string | null;
  bio: string | null;
  lanes: Lane[];
  stop_list: string[];
  voice_notes: string | null;
  program_url: string | null;
  caption_disclaimer: string | null;
  screen_disclaimer: string | null;
  scripts_per_day: number;
  caption_style: string | null;
  active: number;
  /** JSON: posts a week per platform (Planner). */
  cadence?: string | null;
  /** JSON: follower target and date per platform (Growth). */
  targets?: string | null;
  /** JSON: LinkedIn and X text posts a day. */
  text_per_day?: string | null;
};

export const PLATFORMS = ["instagram", "facebook", "youtube", "linkedin", "x"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
};

export const NICHE_LABEL: Record<Niche, string> = {
  crypto: "Crypto",
  psychology: "Psychology",
  finance_trading: "Personal finance + trading",
  business_consulting: "Business + consulting",
  business_ai: "Business AI",
};

function hydrate(r: any): Speaker {
  return { ...r, lanes: json<Lane[]>(r.lanes, []), stop_list: json<string[]>(r.stop_list, []) };
}

export function speakers(activeOnly = true): Speaker[] {
  return raw(`SELECT * FROM speakers ${activeOnly ? "WHERE active = 1" : ""} ORDER BY id`).map(hydrate);
}

export function speaker(idOrSlug: number | string): Speaker | undefined {
  const r = typeof idOrSlug === "number" ? one(`SELECT * FROM speakers WHERE id = ?`, [idOrSlug]) : one(`SELECT * FROM speakers WHERE slug = ?`, [idOrSlug]);
  return r ? hydrate(r) : undefined;
}

/**
 * Splits N scripts across lanes by their share (largest remainder), so a
 * 70/30 speaker gets 2 + 1 out of 3, not 3 + 0.
 */
export function lanePlan(lanes: Lane[], n: number): string[] {
  if (!lanes.length) return Array(n).fill("");
  const total = lanes.reduce((s, l) => s + (l.share || 0), 0) || lanes.length;
  const exact = lanes.map((l) => ({ key: l.key, v: ((l.share || 1) / total) * n }));
  const base = exact.map((e) => ({ key: e.key, k: Math.floor(e.v), r: e.v - Math.floor(e.v) }));
  let left = n - base.reduce((s, b) => s + b.k, 0);
  for (const b of [...base].sort((a, z) => z.r - a.r)) {
    if (left <= 0) break;
    b.k += 1;
    left -= 1;
  }
  return base.flatMap((b) => Array(b.k).fill(b.key));
}
