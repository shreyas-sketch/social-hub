import path from "node:path";
import { one, run } from "@/db";

/** Everything the app reads from the environment, in one place. */
export const env = {
  appUrl: () => (process.env.APP_URL || "http://localhost:3100").replace(/\/$/, ""),
  sessionSecret: () => process.env.SESSION_SECRET || "",
  tokenKey: () => process.env.TOKEN_KEY || process.env.SESSION_SECRET || "",
  cronKey: () => process.env.CRON_KEY || "",
  mediaDir: () => process.env.MEDIA_DIR || path.join(process.cwd(), "data", "media"),
  ffmpeg: () => process.env.FFMPEG_BIN || "ffmpeg",
  ffprobe: () => process.env.FFPROBE_BIN || "ffprobe",
  fontsDir: () => process.env.FONTS_DIR || path.join(process.cwd(), "assets", "fonts"),

  anthropicKey: () => process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",

  /** local = whisper.cpp on this server (free) · openai = Whisper API · none = no captions */
  transcribeEngine: () => (process.env.TRANSCRIBE_ENGINE || "local") as "local" | "openai" | "none",
  whisperBin: () => process.env.WHISPER_CPP_BIN || "whisper-cli",
  whisperModel: () => process.env.WHISPER_MODEL || "/opt/whisper/ggml-base.en.bin",
  openaiKey: () => process.env.OPENAI_API_KEY || "",

  metaAppId: () => process.env.META_APP_ID || "",
  metaAppSecret: () => process.env.META_APP_SECRET || "",
  metaVersion: () => process.env.META_GRAPH_VERSION || "v26.0",

  googleClientId: () => process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: () => process.env.GOOGLE_CLIENT_SECRET || "",
  youtubeApiKey: () => process.env.YOUTUBE_API_KEY || "",
  /** Only after Google audits the app. Before that, uploads are locked to private. */
  youtubeUploadEnabled: () => process.env.YOUTUBE_UPLOAD_ENABLED === "1",

  linkedinClientId: () => process.env.LINKEDIN_CLIENT_ID || "",
  linkedinClientSecret: () => process.env.LINKEDIN_CLIENT_SECRET || "",
  linkedinVersion: () => process.env.LINKEDIN_VERSION || "202609",

  xClientId: () => process.env.X_CLIENT_ID || "",
  xClientSecret: () => process.env.X_CLIENT_SECRET || "",

  /** Set to 1 to run everything except the final post call (for testing a fresh install). */
  dryRun: () => process.env.DRY_RUN === "1",

  /** The key the webinar side uses to send sign-ups to /api/signups (falls back to CRON_KEY). */
  signupsKey: () => process.env.SIGNUPS_KEY || process.env.CRON_KEY || "",
};

/** Settings people change from the app, stored in the database. */
export const SETTING_DEFAULTS: Record<string, string> = {
  brief_hour_ist: "7",            // write the day's scripts at 07:00 IST
  stats_hour_ist: "6",            // pull numbers at 06:00 IST
  trial_read_hours: "24",         // judge a trial reel after this many hours
  winner_window_hours: "24",      // a winner should be approved and sent everywhere within this many hours of the verdict
  winner_multiplier: "1.2",       // a winner beats the speaker's median trial views by 20%
  min_trials_for_baseline: "3",   // before this many trials, you pick winners by hand
  trial_graduation: "MANUAL",     // MANUAL (you graduate in the app) | SS_PERFORMANCE (Instagram decides)
  caption_style: "bold_pop",      // default caption look for new edits
  frame_mode: "crop",             // crop | fit_blur for landscape footage
  agents_weekday: "1",            // weekly agents run on this IST weekday (0 = Sunday, 1 = Monday)
  agents_hour_ist: "9",           // …at this IST hour, after the morning numbers
  link_platforms: "linkedin",     // which platforms get the tracking link in the post text (see Settings for why X and Facebook are off)
  hook_doctor: "on",              // score every new script's hook automatically
  // v1.3
  clips_per_session: "12",        // clips the Clip Picker looks for in each long session
  trial_daily_cap: "15",          // trial reels a day per Instagram account (Instagram allows about 20)
  mix_target: "70/20/10",         // core / next-door topic / personal story, across each speaker's scripts
  comments_poll_minutes: "15",    // how often new Instagram comments are read (0 = off)
  dm_per_hour: "40",              // most comment-to-DM messages per account per hour
  reply_drafts: "on",             // draft replies to comments that ask something (a person approves each)
  text_post_hour_ist: "10",       // approved LinkedIn and X text posts go out at this IST hour
  growth_target_followers: "1000000", // the default follower target per platform (change per speaker on Growth)
  growth_target_date: "2029-11-30",   // …and the date for it
};

export function setting(key: string): string {
  const row = one<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row?.value ?? SETTING_DEFAULTS[key] ?? "";
}

export function setSetting(key: string, value: string) {
  run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
}

export function settingNum(key: string): number {
  const n = Number(setting(key));
  return Number.isFinite(n) ? n : Number(SETTING_DEFAULTS[key] || 0);
}

/** Which integrations have their keys in place — shown in Settings. */
export function integrationStatus() {
  return [
    { name: "Claude API (scripts)", ok: !!env.anthropicKey(), need: "ANTHROPIC_API_KEY" },
    {
      name: "Captions (transcription)",
      ok: env.transcribeEngine() === "none" ? false : env.transcribeEngine() === "openai" ? !!env.openaiKey() : true,
      need: env.transcribeEngine() === "openai" ? "OPENAI_API_KEY" : "WHISPER_CPP_BIN + WHISPER_MODEL on the server",
    },
    { name: "Meta (Instagram + Facebook)", ok: !!(env.metaAppId() && env.metaAppSecret()), need: "META_APP_ID, META_APP_SECRET" },
    { name: "YouTube numbers + watchlist", ok: !!env.youtubeApiKey(), need: "YOUTUBE_API_KEY" },
    { name: "YouTube sign-in (only for uploads, after Google's audit)", ok: !!(env.googleClientId() && env.googleClientSecret()), need: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (optional for now)" },
    { name: "LinkedIn", ok: !!(env.linkedinClientId() && env.linkedinClientSecret()), need: "LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET" },
    { name: "X", ok: !!(env.xClientId() && env.xClientSecret()), need: "X_CLIENT_ID, X_CLIENT_SECRET" },
    { name: "Public URL (Meta fetches videos from it)", ok: env.appUrl().startsWith("https://"), need: "APP_URL=https://…" },
    { name: "Sign-ups from the webinar side (optional)", ok: !!env.signupsKey(), need: "SIGNUPS_KEY (optional — sign-ups can also be typed in on Growth)" },
  ];
}
