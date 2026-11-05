import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { one, run, now } from "@/db";
import { env } from "@/lib/config";

export const COOKIE = "social_session";
const DAYS = 14;

export type Role = "owner" | "admin" | "team";
export type User = { id: number; email: string; name: string; role: Role };

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function checkPassword(pw: string, stored: string) {
  const [kind, saltHex, hashHex] = stored.split("$");
  if (kind !== "scrypt") return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

/** A short tag of the password: changing a password ends every session signed in with the old one. */
const pwTag = (hash: string | null | undefined) => crypto.createHash("sha256").update(String(hash || "")).digest("hex").slice(0, 12);

/** Same token shape the middleware checks: base64url(json).base64url(hmac). */
export function signSession(userId: number) {
  const pv = pwTag(one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, [userId])?.password_hash);
  const body = b64url(Buffer.from(JSON.stringify({ u: userId, pv, exp: Date.now() + DAYS * 864e5 })));
  const sig = b64url(crypto.createHmac("sha256", env.sessionSecret()).update(body).digest());
  return `${body}.${sig}`;
}

function readSession(token: string | undefined): { u: number; pv: string } | null {
  if (!token || !token.includes(".") || !env.sessionSecret()) return null;
  const [body, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", env.sessionSecret()).update(body).digest());
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const j = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    return j.u && Date.now() < j.exp ? { u: Number(j.u), pv: String(j.pv || "") } : null;
  } catch {
    return null;
  }
}

export function currentUser(): User | null {
  const t = readSession(cookies().get(COOKIE)?.value);
  if (!t) return null;
  const row = one<User & { password_hash: string }>(`SELECT id, email, name, role, password_hash FROM users WHERE id = ? AND password_hash <> 'removed'`, [t.u]);
  if (!row || pwTag(row.password_hash) !== t.pv) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** For pages: signed in or off to /login. */
export function requireUser(): User {
  const u = currentUser();
  if (!u) redirect("/login");
  return u;
}

/** Approvals and settings are for owner/admin only. The team uploads and watches. */
export function requireApprover(): User {
  const u = requireUser();
  if (u.role === "team") throw new Error("Only an owner or admin can approve.");
  return u;
}

export function requireOwner(): User {
  const u = requireUser();
  if (u.role !== "owner") throw new Error("Only an owner can change this.");
  return u;
}

export function canApprove(u: User | null) {
  return !!u && u.role !== "team";
}

export function userCount() {
  return one<{ n: number }>(`SELECT COUNT(*) AS n FROM users`)?.n ?? 0;
}

export function createUser(email: string, name: string, password: string, role: Role) {
  return run(
    `INSERT INTO users (email, name, password_hash, role, created_at) VALUES (@email, @name, @hash, @role, @at)`,
    { email: email.trim().toLowerCase(), name: name.trim(), hash: hashPassword(password), role, at: now() },
  );
}
