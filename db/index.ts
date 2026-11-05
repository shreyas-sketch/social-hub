import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations";

/**
 * One SQLite file for the whole app. The web app and the worker both open it;
 * WAL mode lets them read and write side by side.
 */
let _db: Database.Database | null = null;

export function dbFile() {
  return process.env.DB_FILE || path.join(process.cwd(), "data", "hub.db");
}

export function db(): Database.Database {
  if (_db) return _db;
  const file = dbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("busy_timeout = 8000");
  d.pragma("foreign_keys = ON");
  runMigrations(d);
  _db = d;
  return d;
}

export function runMigrations(d: Database.Database) {
  d.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const done = new Set((d.prepare(`SELECT id FROM _migrations`).all() as { id: number }[]).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    const tx = d.transaction(() => {
      d.exec(m.sql);
      d.prepare(`INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)`).run(m.id, m.name, new Date().toISOString());
    });
    tx();
  }
}

type Params = Record<string, unknown> | unknown[] | undefined;

function bind(stmt: Database.Statement, params: Params) {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
}

/** Rows for a SELECT. Named params use @name. */
export function raw<T = any>(sql: string, params?: Params): T[] {
  const s = db().prepare(sql);
  return s.all(...bind(s, params)) as T[];
}

/** First row or undefined. */
export function one<T = any>(sql: string, params?: Params): T | undefined {
  const s = db().prepare(sql);
  return s.get(...bind(s, params)) as T | undefined;
}

/** INSERT / UPDATE / DELETE. */
export function run(sql: string, params?: Params) {
  const s = db().prepare(sql);
  return s.run(...bind(s, params));
}

export function tx<T>(fn: () => T): T {
  return db().transaction(fn)();
}

export const now = () => new Date().toISOString();

/** An ISO timestamp N days ago — compare stored ISO times against this, not SQLite's datetime('now'), whose format differs. */
export const daysAgo = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

/** Any timestamp a platform sends (e.g. Instagram's "+0000" form) as one ISO format, so comparisons work. */
export const iso = (t: string | null | undefined) => {
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Today's date in IST, as YYYY-MM-DD. The whole business runs on IST. */
export function istDay(d: Date = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}

export function json<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
