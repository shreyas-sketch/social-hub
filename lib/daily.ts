import { raw, one, istDay } from "@/db";
import { setting, setSetting, settingNum } from "@/lib/config";
import { enqueue } from "@/lib/jobs";
import { textPlan } from "@/lib/textposts";

function istHour() {
  return new Date(Date.now() + 5.5 * 3600e3).getUTCHours();
}

/**
 * Adds the day's jobs once per IST day, at or after the set hour — so a
 * worker restarted at 9am still runs the 6am and 7am jobs. Returns what it queued.
 */
export function dailyTick(force = false) {
  const day = istDay();
  const hour = istHour();
  const did: string[] = [];
  if ((force || hour >= settingNum("stats_hour_ist")) && setting("last_stats_day") !== day) {
    setSetting("last_stats_day", day);
    // Connected accounts, plus YouTube channels with a handle (their numbers are public).
    for (const a of raw<{ id: number }>(`SELECT id FROM accounts WHERE status = 'connected' OR (platform = 'youtube' AND status = 'not_connected' AND handle IS NOT NULL)`)) enqueue("pull_stats", { accountId: a.id });
    for (const s of raw<{ id: number }>(`SELECT id FROM speakers WHERE active = 1`)) enqueue("pull_refs", { speakerId: s.id });
    enqueue("pull_watch", {});
    did.push("numbers + watchlist + trend pool");
  }
  if ((force || hour >= settingNum("brief_hour_ist")) && setting("last_brief_day") !== day) {
    setSetting("last_brief_day", day);
    for (const s of raw<{ id: number }>(`SELECT id FROM speakers WHERE active = 1 AND scripts_per_day > 0`)) {
      const has = one(`SELECT id FROM briefs WHERE speaker_id = ? AND day = ? AND status <> 'error'`, [s.id, day]);
      // Written after the numbers: give the pulls a 20-minute head start when both run together.
      if (!has) enqueue("write_brief", { speakerId: s.id, day }, { inMinutes: did.length ? 20 : 0 });
    }
    // Text posts after the scripts, so an X post can test one of the day's hooks.
    for (const s of raw<{ id: number; text_per_day: string | null }>(`SELECT id, text_per_day FROM speakers WHERE active = 1`)) {
      if (textPlan(s, day).length) enqueue("write_text_posts", { speakerId: s.id, day }, { inMinutes: did.length ? 35 : 15 });
    }
    did.push("scripts");
  }
  // Instagram comments every few minutes (Meta won't send comment webhooks to an app in Development mode).
  const every = settingNum("comments_poll_minutes");
  const last = Date.parse(setting("last_comments_poll") || "") || 0;
  if (every > 0 && Date.now() - last >= every * 60e3) {
    setSetting("last_comments_poll", new Date().toISOString());
    const igs = raw<{ id: number }>(`SELECT id FROM accounts WHERE platform = 'instagram' AND status = 'connected'`);
    for (const a of igs) enqueue("pull_comments", { accountId: a.id });
    if (igs.length) did.push("comments");
  }
  // Weekly agents: on the set IST weekday, at or after the set hour, once per week.
  const istNow = new Date(Date.now() + 5.5 * 3600e3);
  if (istNow.getUTCDay() === settingNum("agents_weekday") && (force || hour >= settingNum("agents_hour_ist")) && setting("last_agents_day") !== day) {
    setSetting("last_agents_day", day);
    enqueue("agent", { agent: "trend_scout" });
    enqueue("agent", { agent: "playbook_coach" });
    for (const s of raw<{ id: number }>(`SELECT id FROM speakers WHERE active = 1`)) enqueue("agent", { agent: "weekly_review", speakerId: s.id }, { inMinutes: 5 });
    did.push("weekly agents");
  }
  return did;
}
