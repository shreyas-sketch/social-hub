/**
 * Copies the database to BACKUP_DIR (default ./data/backups) with the date in the name,
 * and keeps the last 14. Videos are not included — back up MEDIA_DIR separately if needed.
 * Run nightly from cron: npm run backup
 */
import fs from "node:fs";
import path from "node:path";
import { db, istDay } from "./index";

const dir = process.env.BACKUP_DIR || path.join(process.cwd(), "data", "backups");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `hub-${istDay()}.db`);

db()
  .backup(file)
  .then(() => {
    const old = fs.readdirSync(dir).filter((f) => /^hub-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -14);
    for (const f of old) fs.rmSync(path.join(dir, f));
    console.log(`Backed up to ${file}`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
