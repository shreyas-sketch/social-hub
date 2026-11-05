/**
 * Additive only: never ALTER away or DROP a column. New needs = a new migration
 * with a higher id. Every INSERT elsewhere names its columns.
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "core",
    sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'team',          -- owner | admin | team
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE speakers (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  niche TEXT NOT NULL,                        -- crypto | psychology | finance_trading | business_consulting | business_ai
  direction TEXT,                             -- one paragraph: what the account is about
  audience TEXT,                              -- who the account talks to
  bio TEXT,                                   -- Instagram bio we want
  lanes TEXT NOT NULL DEFAULT '[]',           -- JSON [{key,name,desc,share}]
  stop_list TEXT NOT NULL DEFAULT '[]',       -- JSON [string]
  voice_notes TEXT,                           -- how they speak
  program_url TEXT,                           -- the ₹99 webinar page tracking links go to
  caption_disclaimer TEXT,                    -- appended to every caption
  screen_disclaimer TEXT,                     -- burned small on screen
  scripts_per_day INTEGER NOT NULL DEFAULT 3,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  platform TEXT NOT NULL,                     -- instagram | facebook | youtube | linkedin | x
  handle TEXT,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'missing',     -- missing | not_connected | connected | error
  external_id TEXT,                           -- IG user id, page id, channel id, person urn, X user id
  token_enc TEXT,
  refresh_enc TEXT,
  token_expires_at TEXT,
  page_token_enc TEXT,                        -- facebook page token (also used for IG calls)
  meta TEXT NOT NULL DEFAULT '{}',
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (speaker_id, platform)
);

CREATE TABLE account_stats (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  day TEXT NOT NULL,
  followers INTEGER,
  posts INTEGER,
  source TEXT NOT NULL DEFAULT 'api',         -- api | manual
  raw TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (account_id, day)
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  external_id TEXT NOT NULL,
  permalink TEXT,
  caption TEXT,
  media_type TEXT,
  published_at TEXT,
  via_hub INTEGER NOT NULL DEFAULT 0,
  edit_id INTEGER,
  is_trial INTEGER NOT NULL DEFAULT 0,
  views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER, reach INTEGER,
  avg_watch_ms INTEGER,
  metrics TEXT,
  metrics_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (account_id, external_id)
);

CREATE TABLE refs (
  id INTEGER PRIMARY KEY,
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  name TEXT NOT NULL,
  platform TEXT NOT NULL,                     -- instagram | youtube
  handle TEXT,
  url TEXT,
  external_id TEXT,
  note TEXT,
  followers INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE ref_posts (
  id INTEGER PRIMARY KEY,
  ref_id INTEGER NOT NULL REFERENCES refs(id),
  external_id TEXT NOT NULL,
  caption TEXT,
  permalink TEXT,
  published_at TEXT,
  views INTEGER, likes INTEGER, comments INTEGER,
  outlier REAL,                               -- this post vs the creator's own median
  created_at TEXT NOT NULL,
  UNIQUE (ref_id, external_id)
);

CREATE TABLE briefs (
  id INTEGER PRIMARY KEY,
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | ready | error
  context TEXT,
  model TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE scripts (
  id INTEGER PRIMARY KEY,
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  brief_id INTEGER REFERENCES briefs(id),
  lane TEXT,
  hook_type TEXT,
  format TEXT,
  title TEXT NOT NULL,
  hook TEXT NOT NULL,
  body TEXT NOT NULL,
  cta TEXT,
  on_screen TEXT NOT NULL DEFAULT '[]',       -- JSON [{t, text}]
  caption TEXT,
  hashtags TEXT,
  length_sec INTEGER,
  why TEXT,
  inspired_by INTEGER REFERENCES ref_posts(id),
  compliance TEXT NOT NULL DEFAULT '{"status":"ok","issues":[]}',
  status TEXT NOT NULL DEFAULT 'proposed',    -- proposed | approved | rejected | shot | edited | trial | winner | not_winner
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE videos (
  id INTEGER PRIMARY KEY,
  script_id INTEGER NOT NULL REFERENCES scripts(id),
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  raw_path TEXT NOT NULL,
  raw_name TEXT,
  raw_size INTEGER,
  duration REAL,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE edits (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  script_id INTEGER NOT NULL REFERENCES scripts(id),
  version INTEGER NOT NULL DEFAULT 1,
  settings TEXT NOT NULL DEFAULT '{}',        -- {captionStyle, frame, cutSilence}
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | running | ready | approved | rejected | error
  output_path TEXT,
  thumb_path TEXT,
  duration REAL,
  transcript TEXT,
  warnings TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  notes TEXT,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE trials (
  id INTEGER PRIMARY KEY,
  edit_id INTEGER NOT NULL REFERENCES edits(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | posting | live | done | error
  container_id TEXT,
  media_id TEXT,
  permalink TEXT,
  caption TEXT,
  posted_at TEXT,
  read_at TEXT,
  views INTEGER, reach INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER,
  avg_watch_ms INTEGER,
  baseline_views INTEGER,
  verdict TEXT NOT NULL DEFAULT 'pending',    -- pending | winner | not_winner | too_early
  verdict_reason TEXT,
  approved_by INTEGER REFERENCES users(id),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE trial_snapshots (
  id INTEGER PRIMARY KEY,
  trial_id INTEGER NOT NULL REFERENCES trials(id),
  hours REAL NOT NULL,
  metrics TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE publishes (
  id INTEGER PRIMARY KEY,
  edit_id INTEGER NOT NULL REFERENCES edits(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  platform TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'api',           -- api | manual
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | running | done | manual_todo | error | skipped
  title TEXT,
  caption TEXT,
  link_code TEXT,
  external_id TEXT,
  permalink TEXT,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  done_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE links (
  code TEXT PRIMARY KEY,
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  script_id INTEGER REFERENCES scripts(id),
  platform TEXT,
  target_url TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  last_click_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | running | done | error
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  at TEXT NOT NULL
);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  speaker_id INTEGER NOT NULL,
  verifier TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_scripts_speaker ON scripts(speaker_id, status, created_at);
CREATE INDEX idx_jobs_due ON jobs(status, run_after);
CREATE INDEX idx_posts_account ON posts(account_id, published_at);
CREATE INDEX idx_trials_status ON trials(status);
CREATE INDEX idx_publishes_status ON publishes(status);
`,
  },
  {
    id: 2,
    name: "v1.1: verdict time, hand-set verdicts, watchlist notes",
    sql: `
ALTER TABLE trials ADD COLUMN verdict_at TEXT;
ALTER TABLE trials ADD COLUMN verdict_set_by INTEGER REFERENCES users(id);
ALTER TABLE refs ADD COLUMN added_by INTEGER REFERENCES users(id);
ALTER TABLE speakers ADD COLUMN caption_style TEXT;
CREATE INDEX IF NOT EXISTS idx_refs_speaker ON refs(speaker_id, active);
`,
  },
  {
    id: 3,
    name: "v1.2: trend watch, teachers, AI agents, playbook, better reel numbers",
    sql: `
-- Creators watched for everyone, not one speaker: 'trend' = popular creators outside our niches, 'teacher' = people who teach social media growth.
CREATE TABLE watch_sources (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                         -- trend | teacher
  name TEXT NOT NULL,
  platform TEXT NOT NULL,                     -- instagram | youtube | x | linkedin | facebook | other
  handle TEXT,
  external_id TEXT,
  url TEXT,
  note TEXT,
  language TEXT,
  followers INTEGER,
  active INTEGER NOT NULL DEFAULT 1,          -- 1 reading, 0 paused, -1 removed
  last_synced_at TEXT,
  last_error TEXT,
  added_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE watch_posts (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES watch_sources(id),
  external_id TEXT NOT NULL,
  caption TEXT,
  permalink TEXT,
  published_at TEXT,
  views INTEGER, likes INTEGER, comments INTEGER,
  outlier REAL,
  created_at TEXT NOT NULL,
  UNIQUE (source_id, external_id)
);

-- Every AI agent run: what it read, what it said, what it cost.
CREATE TABLE agent_runs (
  id INTEGER PRIMARY KEY,
  agent TEXT NOT NULL,                        -- trend_scout | playbook_coach | hook_doctor | weekly_review
  speaker_id INTEGER REFERENCES speakers(id),
  status TEXT NOT NULL DEFAULT 'running',     -- running | done | error
  input TEXT,
  output TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

-- Rules the script writer and the Hook Doctor follow. Agents only propose; a person turns a rule on.
CREATE TABLE playbook_rules (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'all',          -- all | instagram | youtube | linkedin | x | facebook | speaker:<id>
  rule TEXT NOT NULL,
  why TEXT,
  source_name TEXT,
  source_url TEXT,
  source_date TEXT,
  kind TEXT NOT NULL DEFAULT 'teacher',       -- official | teacher | learned | ours
  status TEXT NOT NULL DEFAULT 'proposed',    -- proposed | active | retired
  proposed_by TEXT NOT NULL DEFAULT 'seed',   -- seed | playbook_coach | weekly_review | person
  agent_run_id INTEGER REFERENCES agent_runs(id),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE scripts ADD COLUMN doctor TEXT;            -- Hook Doctor's JSON
ALTER TABLE scripts ADD COLUMN hook_score REAL;        -- its predicted score out of 10
ALTER TABLE scripts ADD COLUMN linkedin_text TEXT;     -- LinkedIn post text that matches the video
ALTER TABLE trials ADD COLUMN mode TEXT NOT NULL DEFAULT 'trial';   -- trial | regular (under 1,000 followers Instagram doesn't allow trials)
ALTER TABLE trials ADD COLUMN skip_rate REAL;          -- % who skipped in the first 3 seconds
ALTER TABLE trials ADD COLUMN total_watch_ms INTEGER;
ALTER TABLE posts ADD COLUMN skip_rate REAL;
ALTER TABLE links ADD COLUMN kind TEXT;                -- post | bio

CREATE INDEX idx_watch_posts_outlier ON watch_posts(outlier, published_at);
CREATE INDEX idx_agent_runs ON agent_runs(agent, speaker_id, created_at);
`,
  },
  {
    id: 4,
    name: "v1.3: long sessions → clips + YouTube long-form, planner, growth pace, comment-to-DM, replies, text posts, boosts, guests",
    sql: `
-- One long recording (talk, Q&A, podcast) per speaker per week: cut into many clips and one YouTube video.
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  kind TEXT NOT NULL DEFAULT 'talk',          -- talk | qa | podcast | live
  title TEXT NOT NULL,
  guest TEXT,
  shoot_id INTEGER,
  raw_path TEXT,
  raw_name TEXT,
  raw_size INTEGER,
  duration REAL,
  status TEXT NOT NULL DEFAULT 'waiting',     -- waiting (no file yet) | transcribing | picking | ready | error
  words_path TEXT,                            -- word timings for the whole recording (JSON file under MEDIA_DIR)
  picks TEXT,                                 -- what the clip picker said (JSON)
  error TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE scripts ADD COLUMN source TEXT NOT NULL DEFAULT 'writer';   -- writer | clip
ALTER TABLE scripts ADD COLUMN session_id INTEGER REFERENCES sessions(id);
ALTER TABLE scripts ADD COLUMN clip_start REAL;                         -- seconds into the session recording
ALTER TABLE scripts ADD COLUMN clip_end REAL;
ALTER TABLE scripts ADD COLUMN mix TEXT;                                -- core | adjacent | personal (aim 70/20/10)
ALTER TABLE videos ADD COLUMN session_id INTEGER REFERENCES sessions(id);
ALTER TABLE videos ADD COLUMN clip_start REAL;
ALTER TABLE videos ADD COLUMN clip_end REAL;
ALTER TABLE edits ADD COLUMN variant_of INTEGER REFERENCES edits(id);   -- hook tests: the cut this one is a variant of

-- The YouTube long-form video cut from a session.
CREATE TABLE longforms (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  status TEXT NOT NULL DEFAULT 'draft',       -- draft | queued | cutting | ready | uploading | manual_todo | uploaded | error
  cut_silence INTEGER NOT NULL DEFAULT 1,
  trim_start REAL,
  trim_end REAL,
  titles TEXT NOT NULL DEFAULT '[]',          -- title options
  title TEXT,                                 -- the one picked
  description TEXT,
  chapters TEXT NOT NULL DEFAULT '[]',        -- [{t: seconds into the recording, title}]
  tags TEXT,
  thumb_texts TEXT NOT NULL DEFAULT '[]',
  output_path TEXT,
  srt_path TEXT,
  thumbs TEXT NOT NULL DEFAULT '[]',          -- thumbnail image paths
  out_chapters TEXT NOT NULL DEFAULT '[]',    -- chapters on the finished video's timeline
  segs TEXT NOT NULL DEFAULT '[]',            -- the parts of the recording kept, so chapters can be re-placed without a re-cut
  duration REAL,
  compliance TEXT NOT NULL DEFAULT '{"status":"ok","issues":[]}',
  link_code TEXT,
  youtube_id TEXT,
  permalink TEXT,
  test_winner TEXT,                           -- the title that won YouTube's Test & Compare (typed in)
  warnings TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Planner: posts a week per platform, follower targets, text posts a day (JSON on the speaker).
ALTER TABLE speakers ADD COLUMN cadence TEXT;
ALTER TABLE speakers ADD COLUMN targets TEXT;
ALTER TABLE speakers ADD COLUMN text_per_day TEXT;

CREATE TABLE shoots (
  id INTEGER PRIMARY KEY,
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  kind TEXT NOT NULL DEFAULT 'teleprompter',  -- long_session | teleprompter
  day TEXT NOT NULL,                          -- YYYY-MM-DD, IST
  time TEXT,
  place TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'planned',     -- planned | done | missed | cancelled
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every click on a tracking link (the links table keeps the running total), and webinar sign-ups.
CREATE TABLE link_clicks (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE signups (
  id INTEGER PRIMARY KEY,
  speaker_id INTEGER REFERENCES speakers(id),
  day TEXT NOT NULL,
  platform TEXT,
  content TEXT,                               -- utm_content as it arrived (script-12, bio, dm-12, long-3)
  link_code TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  origin TEXT NOT NULL DEFAULT 'manual',      -- api | manual
  external_ref TEXT,                          -- the order or lead id, so a resent sign-up isn't counted twice
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (origin, external_ref)
);

-- Instagram comments: comment-to-DM and reply drafts.
CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  media_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  username TEXT,
  from_id TEXT,
  text TEXT,
  commented_at TEXT,
  edit_id INTEGER,
  script_id INTEGER,
  needs_reply INTEGER NOT NULL DEFAULT 0,
  dm_status TEXT,                             -- sent | dry_run | failed | skipped
  dm_rule_id INTEGER,
  dm_at TEXT,
  dm_error TEXT,
  dm_link_code TEXT,
  reply_status TEXT,                          -- drafted | posted | rejected | error
  reply_text TEXT,
  reply_by INTEGER REFERENCES users(id),
  reply_at TEXT,
  reply_external_id TEXT,
  reply_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (account_id, external_id)
);
CREATE TABLE dm_rules (
  id INTEGER PRIMARY KEY,
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  keyword TEXT NOT NULL,
  message TEXT NOT NULL,                      -- {link} becomes the tracking link
  public_reply TEXT,                          -- optional reply under the comment
  status TEXT NOT NULL DEFAULT 'draft',       -- draft | on | off
  compliance TEXT NOT NULL DEFAULT '{"status":"ok","issues":[]}',
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Text posts written for LinkedIn and X (not cross-posted video).
CREATE TABLE text_posts (
  id INTEGER PRIMARY KEY,
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  platform TEXT NOT NULL,                     -- linkedin | x
  day TEXT NOT NULL,
  body TEXT NOT NULL,
  angle TEXT,
  why TEXT,
  from_script_id INTEGER REFERENCES scripts(id),
  compliance TEXT NOT NULL DEFAULT '{"status":"ok","issues":[]}',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',    -- proposed | approved | rejected | posting | posted | error
  external_id TEXT,
  permalink TEXT,
  impressions INTEGER, likes INTEGER, comments INTEGER, reposts INTEGER,   -- typed in
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  posted_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Paid boosts of winners, logged by hand from Ads Manager.
CREATE TABLE boosts (
  id INTEGER PRIMARY KEY,
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  trial_id INTEGER REFERENCES trials(id),
  platform TEXT NOT NULL DEFAULT 'instagram',
  started_on TEXT NOT NULL,
  ended_on TEXT,
  spend_inr REAL NOT NULL DEFAULT 0,
  audience TEXT,
  follows INTEGER,
  clicks INTEGER,
  signups INTEGER,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Podcast-guest spots and collaborations.
CREATE TABLE guests (
  id INTEGER PRIMARY KEY,
  speaker_id INTEGER NOT NULL REFERENCES speakers(id),
  kind TEXT NOT NULL DEFAULT 'podcast',       -- podcast | collab | live | other
  name TEXT NOT NULL,
  url TEXT,
  audience INTEGER,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'idea',        -- idea | pitched | booked | recorded | live | declined
  next_on TEXT,
  live_on TEXT,
  live_url TEXT,
  pitch TEXT,
  prep TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_speaker ON sessions(speaker_id, created_at);
CREATE INDEX idx_scripts_session ON scripts(session_id);
CREATE INDEX idx_link_clicks ON link_clicks(code, at);
CREATE INDEX idx_signups_day ON signups(speaker_id, day);
CREATE INDEX idx_comments_account ON comments(account_id, commented_at);
CREATE INDEX idx_text_posts ON text_posts(speaker_id, status, day);
CREATE INDEX idx_shoots_day ON shoots(day, speaker_id);
`,
  },
  {
    id: 5,
    name: "v1.4: flagged parts cut out of the long video",
    sql: `
ALTER TABLE longforms ADD COLUMN removed TEXT NOT NULL DEFAULT '[]';     -- parts of the recording cut out because the rules flag them
ALTER TABLE longforms ADD COLUMN keep_flags TEXT NOT NULL DEFAULT '[]';  -- "check" (not blocking) parts an owner or admin chose to keep
ALTER TABLE longforms ADD COLUMN leftover TEXT NOT NULL DEFAULT '[]';    -- anything the rules still flag in the finished video
`,
  },
  {
    id: 6,
    name: "v1.4: long videos cut before automatic removal are cut again",
    sql: `
-- A long video cut by an earlier version, not yet approved, had nothing taken out: it goes back to be cut again.
UPDATE longforms SET status = 'draft', warnings = '["Cut it again: flagged sentences are now taken out automatically."]'
  WHERE status = 'ready' AND approved_by IS NULL AND removed = '[]' AND warnings NOT LIKE '%Cut out %';
`,
  },
];
