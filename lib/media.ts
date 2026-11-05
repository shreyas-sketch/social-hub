import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { env } from "@/lib/config";

/** All video lives under MEDIA_DIR. The database stores paths relative to it. */
export function abs(rel: string) {
  const root = path.resolve(env.mediaDir());
  const p = path.resolve(root, rel);
  if (!p.startsWith(root + path.sep) && p !== root) throw new Error("Path outside media folder");
  return p;
}

export function ensureDir(rel: string) {
  const p = abs(rel);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+/, "").slice(-80) || "video.mp4";
}

/** Runs a command and resolves with stdout/stderr; rejects with the tail of stderr on a non-zero exit. */
export function exec(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 400_000) stderr = stderr.slice(-200_000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 20 * 60e3);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} could not start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(cmd)} exited ${code}: ${stderr.trim().split("\n").slice(-6).join(" | ")}`));
    });
  });
}
