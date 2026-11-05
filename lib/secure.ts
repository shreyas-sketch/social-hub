import crypto from "node:crypto";
import { env } from "@/lib/config";
import { run, now } from "@/db";

/** Platform tokens are stored encrypted (AES-256-GCM) with a key from TOKEN_KEY. */
function key() {
  const k = env.tokenKey();
  if (!k) throw new Error("TOKEN_KEY is not set");
  return crypto.createHash("sha256").update(k).digest();
}

export function seal(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function unseal(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [iv, tag, enc] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

/** A signed, expiring token for any small payload (media links, connect links for speakers). */
export function signToken(payload: Record<string, unknown>, hours: number) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + hours * 3600e3 })).toString("base64url");
  const sig = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readToken<T = Record<string, unknown>>(token: string): T | null {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const j = JSON.parse(Buffer.from(body, "base64url").toString());
    return Date.now() < j.exp ? (j as T) : null;
  } catch {
    return null;
  }
}

/**
 * Meta fetches our videos from a public URL. Each link is signed and expires,
 * so a leaked link stops working after a few hours.
 */
export function mediaToken(relPath: string, hours = 12) {
  return signToken({ p: relPath }, hours);
}

export function readMediaToken(token: string): string | null {
  const j = readToken<{ p: string }>(token);
  return j ? String(j.p) : null;
}

/** A link a speaker can open on their own phone to connect an account — no hub login needed. Lasts 3 days. */
export function connectToken(speakerId: number, oauth: string) {
  return signToken({ s: speakerId, o: oauth, k: "connect" }, 72);
}

export function readConnectToken(token: string) {
  const j = readToken<{ s: number; o: string; k: string }>(token);
  return j && j.k === "connect" ? { speakerId: Number(j.s), oauth: j.o } : null;
}

export function publicMediaUrl(relPath: string, hours = 12) {
  return `${env.appUrl()}/api/media/${mediaToken(relPath, hours)}`;
}

export function randomCode(len = 7) {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.randomBytes(len);
  return Array.from(b, (x) => abc[x % abc.length]).join("");
}

/** Every approval and every outward post is written here with the person's name. */
export function audit(userId: number | null, action: string, entity: string, entityId: number | null, detail?: unknown) {
  run(
    `INSERT INTO audit (user_id, action, entity, entity_id, detail, at) VALUES (@u, @a, @e, @id, @d, @at)`,
    { u: userId, a: action, e: entity, id: entityId, d: detail === undefined ? null : JSON.stringify(detail), at: now() },
  );
}
