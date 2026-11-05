import crypto from "node:crypto";

/**
 * A short fingerprint of the words a person is approving. The approve form carries the fingerprint of what was on
 * screen; if someone changed the words since the page was opened, the approval is refused instead of approving
 * text nobody read.
 */
export const seen = (...parts: unknown[]) => crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 16);

export const scriptSeen = (s: any) => seen(s.title, s.hook, s.body, s.cta, s.caption, s.hashtags, s.on_screen, s.linkedin_text);
export const textPostSeen = (t: any) => seen(t.platform, t.body);
export const dmRuleSeen = (r: any) => seen(r.keyword, r.message, r.public_reply);
export const longformSeen = (l: any) => seen(l.title, l.titles, l.description, l.tags, l.chapters, l.thumb_texts, l.keep_flags, l.trim_start, l.trim_end, l.output_path, l.segs, l.duration, l.removed);

export function sameAsSeen(fromForm: string | null | undefined, current: string) {
  if (fromForm && fromForm !== current) throw new Error("This changed since you opened the page (someone edited it). Reload and read it again before approving.");
}
