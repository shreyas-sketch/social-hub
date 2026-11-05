import { raw, one, run, now, json, istDay } from "@/db";
import { audit } from "@/lib/secure";
import { claude, extractJson } from "@/lib/claude";
import { speaker as getSpeaker } from "@/lib/speakers";
import { NICHE_RULES } from "@/lib/niche";
import { logUsage } from "@/lib/agents";
import { accountFor } from "@/lib/accounts";

/**
 * Podcast-guest spots and collaborations: who to pitch, where each one stands, and what it did for followers.
 * Thin evidence so far (no Indian before/after numbers were found), so the hub measures it: followers on the
 * day it went live and a week later.
 */
export const GUEST_KINDS: Record<string, string> = { podcast: "Podcast guest", collab: "Collab post", live: "Joint live", other: "Other" };
export const GUEST_STATUSES = ["idea", "pitched", "booked", "recorded", "live", "declined"] as const;

export type GuestIn = { id?: number; speakerId: number; kind: string; name: string; url?: string; audience?: number | null; contact?: string; status: string; nextOn?: string; liveOn?: string; liveUrl?: string; notes?: string };

const date = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export function saveGuest(g: GuestIn, userId: number) {
  if (!getSpeaker(g.speakerId)) throw new Error("Pick a speaker.");
  const name = g.name.trim();
  if (name.length < 2) throw new Error("Name the show or creator.");
  for (const u of [g.url, g.liveUrl]) if (u && !/^https?:\/\//i.test(u)) throw new Error("Links must start with https://");
  const status = (GUEST_STATUSES as readonly string[]).includes(g.status) ? g.status : "idea";
  if (status === "live" && !date(g.liveOn)) throw new Error("Add the date it went live — the hub measures followers from that day.");
  const vals = [g.speakerId, GUEST_KINDS[g.kind] ? g.kind : "podcast", name.slice(0, 120), g.url?.trim() || null, g.audience && g.audience > 0 ? Math.round(g.audience) : null, g.contact?.trim().slice(0, 200) || null, status, date(g.nextOn), date(g.liveOn), g.liveUrl?.trim() || null, g.notes?.trim().slice(0, 1000) || null];
  if (g.id) {
    run(`UPDATE guests SET speaker_id = ?, kind = ?, name = ?, url = ?, audience = ?, contact = ?, status = ?, next_on = ?, live_on = ?, live_url = ?, notes = ?, updated_at = ? WHERE id = ?`, [...vals, now(), g.id]);
    audit(userId, "edit_guest", "guest", g.id, { status });
    return g.id;
  }
  const r = run(`INSERT INTO guests (speaker_id, kind, name, url, audience, contact, status, next_on, live_on, live_url, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...vals, userId, now(), now()]);
  audit(userId, "add_guest", "guest", Number(r.lastInsertRowid));
  return Number(r.lastInsertRowid);
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Followers on the main platforms the day it went live and 7 days later (measured; other posts that week count too). */
function lift(speakerId: number, liveOn: string | null) {
  if (!liveOn) return null;
  const out: { platform: string; before: number | null; after: number | null }[] = [];
  for (const p of ["instagram", "youtube", "linkedin"]) {
    const a = accountFor(speakerId, p as any);
    if (!a) continue;
    const at = (d: string) => one<{ followers: number }>(`SELECT followers FROM account_stats WHERE account_id = ? AND day <= ? AND followers IS NOT NULL ORDER BY day DESC LIMIT 1`, [a.id, d])?.followers ?? null;
    const before = at(liveOn);
    const after = addDays(liveOn, 7) <= istDay() ? at(addDays(liveOn, 7)) : null;
    if (before != null) out.push({ platform: p, before, after });
  }
  return out;
}

export function guestRows() {
  return raw<any>(`SELECT g.*, sp.name AS speaker FROM guests g JOIN speakers sp ON sp.id = g.speaker_id ORDER BY CASE g.status WHEN 'booked' THEN 0 WHEN 'recorded' THEN 1 WHEN 'pitched' THEN 2 WHEN 'idea' THEN 3 WHEN 'live' THEN 4 ELSE 5 END, COALESCE(g.next_on, '9999'), g.id DESC LIMIT 300`).map((g) => ({
    ...g,
    lift: g.status === "live" ? lift(g.speaker_id, g.live_on) : null,
    prepJson: json<any>(g.prep, null),
  }));
}

const SYSTEM = `You help an Indian educator get booked on podcasts and collaborate with bigger creators.
Plain, short, specific English. No flattery clichés ("huge fan", "love your content"), no hype, no emojis. Reply with JSON only.`;

/** Agent: a short pitch to the host, or a prep brief before recording. A person sends the pitch themselves. */
export async function guestHelper(guestId: number, what: "pitch" | "prep") {
  const g = one<any>(`SELECT * FROM guests WHERE id = ?`, [guestId]);
  if (!g) throw new Error("No such entry");
  const sp = getSpeaker(g.speaker_id)!;
  const about = `SPEAKER: ${sp.name}
DIRECTION: ${sp.direction || ""}
AUDIENCE: ${sp.audience || ""}
LANES: ${sp.lanes.map((l) => `${l.name}: ${l.desc}`).join(" | ")}
RULES FOR THIS NICHE:
${NICHE_RULES[sp.niche] || ""}
SHOW / CREATOR: ${g.name} (${GUEST_KINDS[g.kind] || g.kind})${g.url ? `, ${g.url}` : ""}${g.audience ? `, about ${g.audience} followers` : ""}
NOTES: ${g.notes || ""}`;
  const ask =
    what === "pitch"
      ? `${about}

Write the first message ${sp.name} (or their team) sends the host. Under 140 words: who they are in one line, three episode ideas that fit the show's audience (one line each), why those listeners would care, and a simple next step. Return {"pitch": the message, "topics": [the three ideas]}.`
      : `${about}

Write a prep brief for the recording. Return {"stories": 3 short stories or examples to tell (from the speaker's work), "questions": [{"q": a likely question, "angle": how to answer in one line}] (5 of them), "avoid": things not to say (from the rules), "plug": one line telling listeners where to find the speaker}.`;
  const { text, model, usage } = await claude({ system: SYSTEM, user: ask, maxTokens: 2000, temperature: 0.7 });
  logUsage("guest_helper", sp.id, model, usage);
  const out = extractJson<any>(text);
  if (what === "pitch") run(`UPDATE guests SET pitch = ?, updated_at = ? WHERE id = ?`, [String(out.pitch || "").trim() + (Array.isArray(out.topics) && out.topics.length ? `\n\nIdeas:\n${out.topics.map((t: string) => `- ${t}`).join("\n")}` : ""), now(), guestId]);
  else run(`UPDATE guests SET prep = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(out), now(), guestId]);
  return out;
}
