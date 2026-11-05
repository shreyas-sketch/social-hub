# Social Hub

Mudita's internal app for growing five speakers on Instagram, Facebook, YouTube, LinkedIn and X:

- Deepak Choudhary: crypto for first-timers
- Aarzoo Shah: psychology, plus leadership and communication
- Siddharth Kapoor: personal finance and trading
- Akshat Dani: Business AI and consulting
- Chirag Jhumkhawala: Business AI, hands-on

The goal is millions of followers for each speaker, with every account sending people to that speaker's ₹99 webinar.

**Version:** 1.4 (5 Nov 2026).

**Status:** built and tested end to end. Not live yet. It still needs a server, the platform apps and keys, and the missing accounts.

**The one rule:** nothing posts without a named owner or admin approving it. The AI helpers only suggest. Every approval is logged with who did it.

---

## What it does, day by day

1. **06:00 IST: Watch.** Pulls followers and post numbers for every connected account. Also reads each speaker's watchlist creators, the trend pool and the teachers. Marks posts that did well above that creator's usual.

2. **07:00 IST: Write.** Claude writes 3 scripts per speaker in that speaker's lanes. Each script is checked against the SEBI/ASCI rules. One that breaks a hard rule is rewritten, up to 3 times. The Hook Doctor then scores each hook out of 10 and offers 3 better ones.

3. **Approve.** An owner or admin approves the scripts worth shooting.

4. **Shoot.** The team films on a phone with the built-in teleprompter, then uploads the raw take. Big files are fine, and uploads resume if the connection drops.

5. **Auto edit.** The hub cuts pauses, frames to 9:16 and converts iPhone HDR. It adds captions in the speaker's style, the hook on screen and an on-screen disclaimer for the money niches, then levels the sound.

6. **The take is checked.** What the speaker actually said, and the hook on screen, go through the same rules check as the script. A take that says something blocked can't be approved.

7. **Trial reel.** Approving the cut posts it as an Instagram trial reel, shown to non-followers first. Accounts under 1,000 followers get a normal reel instead. Numbers are read at 3, 6 and 12 hours.

8. **Verdict at 24 hours.** A reel that beats the speaker's median views by 20% is a winner. A loser can be re-tested with a new hook on screen, with no re-shoot. Up to 3 hooks can be tested at once.

9. **Post everywhere.** One click sends a winner to Facebook, LinkedIn and X. YouTube Shorts and the Instagram "share to followers" step are 2-minute jobs by hand.

10. **Learn.** Insights ranks lanes, hook types, lengths, formats and caption styles per speaker. The morning writer is told what's working.

11. **Long sessions, weekly.** Each speaker records a 60–90 minute talk, Q&A or podcast. The hub turns it into 10–15 clips and one YouTube long video, and cuts the flagged sentences out of the long video (see below).

12. **Comments, every 15 minutes.**
    - Someone comments the speaker's keyword (like WEBINAR) → one DM with the tracked webinar link.
    - Questions get a drafted reply that a person approves.

13. **Text posts.** LinkedIn and X posts are written for the platform each morning. Approved ones go out at 10:00 IST.

14. **Weekly, Monday 9:00 IST.**
    - The Trend Scout writes a trend brief.
    - The Playbook Coach proposes new rules.
    - The Weekly Review tells each speaker what worked.

---

## The SEBI/ASCI rules check

It runs on everything that goes out:

- Scripts: title, hook, body, call to action, caption, hashtags, on-screen notes and the LinkedIn text.
- The words in each take, and the hook on screen.
- The long video: what the speaker says, plus the title, description, chapters and thumbnail text.
- DM keyword messages, comment replies and text posts.

Two levels:

- **Block:** a return promise, "guaranteed", a stock call or target, a price prediction. These can't be approved.
- **Check:** current market data, a fund or stock pick, a diagnosis claim, an income claim. A person decides.

It catches spoken forms too:

- "10,000 rupees into 1 lakh"
- "this coin can go 10 times"
- "10 guna return"
- "my target for Nifty is 25,000"

It does not flag the speaker's own warnings:

- "There are no guaranteed returns."
- "Koi bhi guarantee nahi de sakta."
- "Beware of anyone selling sure-shot tips."

**In the long video, flagged sentences are cut out during the edit:**

- Red (block): always cut.
- Amber (check): cut, unless an owner or admin keeps it.
- Grey (a wording note only, like "cryptocurrency"): listed, left in.
- After the cut, the finished video is checked again. If anything blocking is left, it can't be approved.

I'm not a lawyer. The rules are a guide. Your compliance person decides where the lines sit, and the rules can be changed in `lib/compliance.ts`.

---

## Pages

**Make**

- **Today:** what needs doing, followers per account, anything broken.
- **Scripts:** approve, reject or edit the morning scripts and clips.
- **Long sessions:** upload a long recording, approve its clips, cut and approve the YouTube long video.
- **Shoot:** approved scripts, the teleprompter, raw video upload.
- **Edits:** check each cut, change captions or framing, fix misheard words, test other hooks.
- **Text posts:** LinkedIn and X posts to approve; type in their numbers.

**Post**

- **Trials:** trial numbers, verdicts, "Send everywhere" for winners.
- **Publish:** the by-hand steps, failed posts, link clicks.
- **Comments:** questions to answer and the comment-to-DM keywords.

**Grow**

- **Planner:** posts this week against target, per platform; shoots booked; the 70/20/10 mix.
- **Growth:** followers against target and pace, numbers per 1,000 views, sign-ups, paid boosts.
- **Guests & collabs:** podcast and creator targets, pitches, prep briefs, followers before and after.

**Learn**

- **Insights:** what's working per speaker, top posts, the Weekly Review.
- **Trends:** the trend brief, breakout posts, the trend pool and the teachers.
- **Playbook:** the rules every script follows.
- **Watchlist:** 10–16 creators per speaker to learn from.

**Set up**

- **Speakers:** direction, lanes, stop list, disclaimers, bio, caption style.
- **Accounts:** connect accounts, send a connect link to a speaker, tracked bio links.
- **Settings:** people and roles, timings, integrations, failed jobs, the activity log.

---

## The AI helpers

They only advise. Nothing they suggest posts, gets approved or gets switched on until a person says so.

- **Script writer:** 3 scripts per speaker every morning.
- **Hook Doctor:** a hook score and 3 better hooks for every script.
- **Clip Picker:** 10–15 clips and the long video's plan from each long session.
- **Text Writer:** LinkedIn and X posts in the speaker's voice.
- **Reply Drafter:** replies to comments that ask something.
- **Guest Helper:** a pitch to a podcast or creator, and a prep brief.
- **Trend Scout:** weekly breakout formats, turned into ideas per speaker.
- **Playbook Coach:** up to 5 new rules a week from what the teachers posted.
- **Weekly Review:** what worked, what didn't, what to change, per speaker.

---

## Who can do what

- **Owner:** everything, including people and settings.
- **Admin:**
  - approves scripts, clips, cuts, winners, text posts, replies and long videos;
  - switches DM keywords and Playbook rules on and off;
  - connects accounts and runs the AI helpers.
- **Team:**
  - uploads takes and long recordings, fixes caption words, books shoots and logs numbers;
  - drafts replies, DM keywords and text posts;
  - can't approve or post anything, can't change anything once it's approved, and can't take out words the rules flag.

---

## Safety built in

- **No double posts.** Retries and restarts never post the same reel twice. Work that was mid-way at a restart is flagged for a person to check.
- **Approve what you read.** If someone changed the words after the approver opened the page, the approval is refused.
- **Comment-to-DM guards:**
  - only the exact text an owner or admin switched on is sent;
  - one DM per comment, within 7 days, never for comments made before switch-on;
  - one per person a day, and at most 40 an hour per account.
- **Secrets:** platform sign-ins are locked in the database with `TOKEN_KEY`. A sign-in ends when that person's password changes.
- **Dry run:** `DRY_RUN=1` runs everything except the final post.

---

## Stack

- Next.js 14 (App Router), TypeScript, Tailwind.
- SQLite via better-sqlite3. Additive migrations 1–6.
- A second process, the worker, does edits, posting, reading numbers and the scheduled jobs.
- ffmpeg for editing. whisper.cpp for transcripts (free), or OpenAI's Whisper API (paid).
- Claude API for the AI helpers.
- Nginx, systemd and Let's Encrypt on a VPS.

---

## Going live

The full guide is `claude/Social-Hub-GOING-LIVE.md`. In short:

1. **Server:** Ubuntu, 4 vCPU, 8 GB RAM, 500 GB disk. Run `bash deploy/vps-setup.sh social.yourdomain.com you@yourdomain.com`, then open the setup link it prints and create the owner.
2. **Claude API key.**
3. **YouTube API key:** numbers and the watchlist. Uploads stay by hand until Google audits the app.
4. **Meta app:** Instagram and Facebook. It stays in Development mode; DMs to real commenters need App Review.
5. **LinkedIn app.**
6. **X app.**
7. **Each speaker's ₹99 webinar link** on the Speakers page.

Keys go in `/etc/social-hub.env`. Settings → Integrations shows what's still missing.

**Running cost (estimated):**

- Claude, all helpers on, five speakers: about ₹2,400–3,700 a month.
- X API: about ₹600 a month.
- The server: not included here.

---

## Day to day

```bash
journalctl -u social-hub -u social-hub-worker -f     # live logs
systemctl restart social-hub social-hub-worker       # restart
bash deploy/update.sh                                # after copying up a new version
ls /var/lib/social-hub/backups                       # nightly database backups, last 14 kept
```

- If "queued" keeps growing in Settings → Jobs, the worker isn't running.
- Videos are in `/var/lib/social-hub/media` and are not in the nightly backup.
- Long recordings are big: about 5–10 GB for 90 minutes at 1080p (estimated). Delete each recording once its clips and long video are done.
- Meta sign-ins last about 90 days and LinkedIn 60. The Today page warns 10 days ahead.

---

## Tested so far (measured)

- 42 automated tests pass.
- The rules check works as intended on 42 sample sentences: teaching lines, warnings, Hinglish and real claims.
- Real long cuts on a 3-minute test recording:
  - the flagged sentences came out;
  - the warnings stayed in;
  - picture and sound stayed in step.
- All 32 pages load for owner, admin and team. Team users see no approve or post buttons. Nothing is wider than a phone screen.
- A fresh install from the zip worked: setup, seed, tests, build and first sign-in.
- Two independent code reviews found 39 problems in all. All are fixed.

## Not tested yet

- Real posts to Instagram, Facebook, LinkedIn and X.
- Comment-to-DM to real commenters (needs Meta App Review first).
- Real Claude calls (the tests used stand-in replies).
- Transcribing a real 90-minute recording, and captions on real speech.
- **The rules check on real Hinglish speech.** The default whisper model transcribes English, so a claim made in Hindi can be missed. A multilingual model should do better (untested).

Start live with `DRY_RUN=1`, then post one real reel per platform.

---

## Known limits

- Auto edits suit talking-head video. B-roll, zooms, music and motion graphics still need an editor.
- Only Instagram and YouTube creators can be read. X, LinkedIn and Facebook creators are kept as links.
- LinkedIn and X numbers are typed in by hand.
- The rules check matches patterns of words. It catches the common ways a claim is said, not every way, so a person still watches before approving.

---

## Where things are

```
app/(hub)/            the pages
app/actions.ts        every button, each logged with who did it
app/api/              uploads, files, media links, OAuth, cron, sign-ups
lib/compliance.ts     the SEBI/ASCI rules
lib/sessions.ts       long sessions, clips, the long video, flagged sentences cut out
lib/edit/             ffmpeg editing, captions, transcripts, the long cut
lib/trials.ts         trial reels, verdicts, the daily cap, collab reels
lib/publish.ts        send everywhere, tracking links, bio links
lib/comments.ts       comments, comment-to-DM, reply drafts
lib/textposts.ts      LinkedIn and X text posts
lib/planner.ts        weekly targets, shoots, the 70/20/10 mix
lib/growth.ts         pace, numbers per 1,000 views, sign-ups, boosts
lib/agents.ts         Trend Scout, Playbook Coach, Hook Doctor, Weekly Review
lib/platforms/        the Meta, YouTube, LinkedIn and X clients
worker/               the second process
db/                   schema, seed, backup
deploy/               server setup, update, services, Nginx
```

---

## Rebuild from scratch

Everything needed to rebuild this exact hub is in this project. Nothing lives only on a laptop.

**What's in the project:**

- `claude/SOCIAL-HUB.md`: this file. What the hub does, how to restore it, and how it works inside.
- `claude/social-hub-source/`: the complete source code of v1.4, every text file, in 8 parts:
  - `social-hub-source-01-root-config-db-deploy-worker.md`: package.json, configs, README, HANDOFF, GOING-LIVE, `.env.example`, database (schema, seed, backup), deploy scripts, the worker
  - `social-hub-source-02-lib-core-platforms.md`: sign-in, secrets, settings, the job queue, the daily clock, the rules check, accounts, OAuth, the Meta, YouTube, LinkedIn and X clients
  - `social-hub-source-03-lib-content-edit-post.md`: the script writer, AI agents, learning, watchlist, video editing (ffmpeg, captions, transcripts, the long cut), trials, publishing
  - `social-hub-source-04-lib-sessions-comments-growth.md`: long sessions, comments and DMs, text posts, planner, growth, guests
  - `social-hub-source-05-app-actions-api-components.md`: every button (server actions), the API routes, sign-in and connect pages, shared components
  - `social-hub-source-06-app-pages.md`: every hub page
  - `social-hub-source-07-tests.md`: the 42 automated tests
  - `social-hub-source-08-package-lock.md`: exact versions of every package
- `claude/Social-Hub-HANDOFF.md`: what changed in each version, the QA, the decisions built in.
- `claude/Social-Hub-GOING-LIVE.md`: server and platform setup, step by step.
- `claude/Speaker-Growth-Research.md`: the research the growth features came from.

**Not in the project (they're binary files):** the 4 Inter fonts the captions and thumbnails use. Download Inter 4.0 (free, OFL licence) from github.com/rsms/inter/releases and put these in `assets/fonts/`:

- `Inter-SemiBold.otf`
- `Inter-Bold.otf`
- `Inter-ExtraBold.otf`
- `Inter-Black.otf`

Any 4.x release works.

### Restore the exact code (about 15 minutes)

1. Read the 8 source parts from the project (`project_read` each; large ones come back as local files).
2. Save this script as `restore.py` and run it with the folder to create and the 8 part files:

```python
import re, sys, pathlib
out = pathlib.Path(sys.argv[1])
n = 0
for f in sys.argv[2:]:
    t = pathlib.Path(f).read_text(encoding="utf-8")
    for path, noeol, body in re.findall(r"^### FILE: (.+?)(  \(no newline at end\))?\n~{8}[^\n]*\n(.*?)\n~{8}$", t, re.S | re.M):
        p = out / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body if noeol else body + "\n", encoding="utf-8")
        n += 1
print(n, "files restored into", out)
```

```bash
python3 restore.py social-hub social-hub-source-0*.md     # should say: 123 files restored
```

3. Add what isn't text:

```bash
cd social-hub
mkdir -p public assets/fonts      # public/ is empty but expected
# copy the 4 Inter .otf files into assets/fonts/
cp ../SOCIAL-HUB.md .             # this file, so the folder carries its own guide
```

4. Install and check:

```bash
npm ci                            # Node 20+ and ffmpeg needed
cp .env.example .env              # set SESSION_SECRET and TOKEN_KEY to long random strings
npm run migrate && npm run seed
npm test                          # expect 42 pass
npm run build                     # expect "Compiled successfully"
```

5. Run it: `npm run dev` and `npm run worker` on a laptop, or follow GOING-LIVE for the server.

This was checked on 5 Nov 2026 (measured):

- All 8 parts were read back from the project in full: 123 files, the same count per part as the listing at the top of each.
- The script above, copied out of this file, restored them into an empty folder: 123 files.
- The restored folder matched the original file for file (nothing different).
- The restored copy migrated, seeded, passed all 42 tests and built ("Compiled successfully").

### Changing it later

After changing the code, update the project so it stays the single source:

- rewrite the source parts (one `### FILE:` block per file, between two lines of 8 tildes)
- update this file and the HANDOFF
- bump the version in `package.json`

---

## How it works inside (technical reference)

### Architecture

- **Web app** (`next start`, port 3100): pages and server actions. It only reads, writes and queues jobs. It never posts or edits video itself.
- **Worker** (`npm run worker`): a second process that does the slow work.
  - The heavy lane runs one job at a time: video edits, session transcripts, long cuts, thumbnails, the YouTube long-video upload.
  - The light lane runs everything else: posting, reading numbers, writing scripts, AI helpers, comments.
  - A once-a-minute clock adds the daily and weekly jobs at the IST hours in Settings.
  - On start, it flags posting work that was mid-way, so nothing posts twice.
- **Database:** one SQLite file (`DB_FILE`). Migrations are additive and run when the database opens.
- **Media:** files under `MEDIA_DIR`:
  - `raw/`: takes and long recordings
  - `edits/<id>/`: finished reels
  - `sessions/<id>/`: transcripts
  - `longform/<id>/`: long videos, captions and thumbnails
- **Meta downloads videos** from `/api/media/<token>`: signed links that expire.
- **Sign-in:** an HMAC-signed cookie, checked by `middleware.ts` and again on every page and action. Roles are checked on every action.

### The database (by migration)

1. **v1.0 core:**
   - `users`: people and roles.
   - `settings`: the settings changed in the app.
   - `speakers`: direction, lanes with shares, stop list, disclaimers, ₹99 page, bio.
   - `accounts`: one per speaker per platform; tokens sealed.
   - `account_stats`: followers per IST day.
   - `posts`: what's on each account, with numbers.
   - `refs` and `ref_posts`: the watchlist and its posts.
   - `briefs`: each morning's writing run.
   - `scripts`, `videos` (takes), `edits` (versions of a cut).
   - `trials`: one Instagram post attempt; trial or normal reel; numbers; verdict.
   - `trial_snapshots`, `publishes` (cross-posts), `links` (tracking links), `jobs` (the queue), `audit` (who did what), `oauth_states`.
2. **v1.1:** verdict time and who set it; who added a watchlist creator; a caption style per speaker.
3. **v1.2:**
   - `watch_sources` and `watch_posts`: the trend pool and the teachers.
   - `agent_runs`: every AI helper run, with tokens.
   - `playbook_rules`.
   - Hook Doctor notes and the LinkedIn text on scripts; trial mode, skip rate and watch time; link kind.
4. **v1.3:**
   - `sessions` and `longforms`: long recordings and the YouTube long video.
   - `shoots`, `link_clicks`, `signups`, `comments`, `dm_rules`, `text_posts`, `boosts`, `guests`.
   - Clips on scripts and videos (source, session, start, end, mix); `variant_of` on edits; cadence, targets and text posts a day on speakers.
5. **v1.4:** `removed`, `keep_flags` and `leftover` on longforms (the flagged sentences).
6. **v1.4:** sends long videos cut before automatic removal back to be cut again.

The full schema, with a comment on every column, is `db/migrations.ts` in source part 01.

### Jobs

- `pull_stats`, `pull_refs` and `pull_watch`: read numbers, the watchlist and the trend pool.
- `write_brief`: the morning scripts. `agent`: any AI helper.
- `run_edit` (heavy): cut a reel.
- `post_trial`: create the Instagram container, wait, publish. `read_trial`: numbers at 3, 6, 12, 24 and 48 hours.
- `publish`: a cross-post.
- `refresh_tokens`.
- `session_transcribe` (heavy), `session_pick` (the Clip Picker).
- `run_longform`, `longform_thumbs` and `upload_longform` (all heavy).
- `pull_comments`: read comments, then send the DMs.
- `post_reply`, `write_text_posts`, `post_text`.

Failed jobs retry after 2, 8 and 30 minutes, then show as failed with a Try again button. A job stuck as running is released after 1 hour, or 6 hours for session transcripts, long cuts and the long-video upload.

### Schedule (IST, all changeable in Settings)

- 06:00: numbers for every connected account, the watchlist and the trend pool.
- 07:00: scripts for every active speaker, then the Hook Doctor. Text posts are written the same morning.
- 10:00: approved text posts go out.
- Every 15 minutes: Instagram comments, then the DMs.
- Monday 09:00: Trend Scout, Playbook Coach, Weekly Review.
- Nightly: a database backup (cron from the setup script), last 14 kept.
- `/api/cron/daily?key=<CRON_KEY>` runs the daily clock from outside, if ever needed (the worker already does it).

### Settings and their defaults

- `brief_hour_ist` 7, `stats_hour_ist` 6, `text_post_hour_ist` 10.
- `agents_weekday` 1 (Monday), `agents_hour_ist` 9.
- `trial_read_hours` 24: the verdict point.
- `winner_multiplier` 1.2: a winner beats the median by 20%.
- `min_trials_for_baseline` 3: before that, winners are picked by hand.
- `winner_window_hours` 24: send winners out within this.
- `trial_graduation` MANUAL, or SS_PERFORMANCE (Instagram decides).
- `trial_daily_cap` 15: Instagram allows about 20.
- `caption_style` bold_pop (or clean, or none). `frame_mode` crop (or fit_blur).
- `link_platforms` linkedin: which posts carry the tracking link.
- `hook_doctor` on. `reply_drafts` on.
- `clips_per_session` 12. `mix_target` 70/20/10.
- `comments_poll_minutes` 15 (0 = off). `dm_per_hour` 40.
- `growth_target_followers` 1,000,000. `growth_target_date` 2029-11-30.

### Environment variables (`.env.example` explains each)

- **Basics:** `APP_URL`, `SESSION_SECRET`, `TOKEN_KEY`, `CRON_KEY`, `SETUP_KEY`, `PORT`, `DB_FILE`, `MEDIA_DIR`, `BACKUP_DIR`.
- **Claude:** `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`.
- **Transcripts:** `TRANSCRIBE_ENGINE` (local, openai or none), `WHISPER_CPP_BIN`, `WHISPER_MODEL`, `OPENAI_API_KEY`.
- **Video:** `FFMPEG_BIN`, `FFPROBE_BIN`.
- **Meta:** `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION` (v26.0), `META_CONFIG_ID`.
- **Google:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_API_KEY`, `YOUTUBE_UPLOAD_ENABLED`.
- **LinkedIn:** `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_VERSION`.
- **X:** `X_CLIENT_ID`, `X_CLIENT_SECRET`.
- **Other:** `DRY_RUN`, `SIGNUPS_KEY`.

### Routes outside the pages

- `/api/upload`: takes and long recordings, in resumable pieces.
- `/api/files`: media for signed-in people.
- `/api/media/<token>`: signed, expiring video links for Meta.
- `/api/oauth/<meta|youtube|linkedin|x>/start` and `/callback`: connecting accounts.
- `/connect/<token>`: the 3-day connect link sent to a speaker.
- `/api/cron/daily`: the daily clock (needs `CRON_KEY`).
- `/api/signups`: webinar sign-ups sent back in (needs `SIGNUPS_KEY`).
- `/r/<code>`: tracking links. Logs the click, adds the UTM tags and sends the person to the ₹99 page.
- Public without sign-in: `/login`, `/setup` (needs `SETUP_KEY`), `/connect`, `/api/media`, `/api/oauth`, `/api/cron`, `/api/signups`, `/r`.

### How the main parts work

**Rules check** (`lib/compliance.ts`):

- A list of word patterns per niche, each "block" or "check". Wording notes are marked soft.
- A match is skipped when the same clause says it's a warning:
  - an English "no", "not", "never", "nobody" or "beware of anyone who…" just before it;
  - a Hindi "nahi" or "mat" just after it.
- One note per phrase.

**Script writer** (`lib/scripts.ts`):

- Splits the day's scripts by lane share, and by the 70/20/10 mix over the last 4 weeks.
- Gives Claude what worked, the outliers, the Playbook rules, the trend brief and the last review.
- Rewrites up to 3 times if a blocking rule is hit.

**Reel edit** (`lib/edit/ffmpeg.ts`):

1. Read the file and find pauses.
2. Cut and frame to 9:16, converting HDR.
3. Transcribe, always, for the rules check.
4. Burn in the captions, the hook box, the on-screen notes and the disclaimer.
5. Level the sound and make a thumbnail.

**Trial and verdict** (`lib/trials.ts`):

- Approving checks, in order:
  - the script was approved and is clean;
  - the take's own words and the hook on screen are clean;
  - Instagram is connected;
  - it hasn't already gone out;
  - today's trial cap isn't used up.
- Posting: create the container, wait while Meta processes it, publish. If Meta says "already published", it finds the reel instead of posting again.
- At the verdict point, the reel is compared with the speaker's median: trials against trials, normal reels against normal reels.

**Long video** (`lib/sessions.ts`, `lib/edit/longform.ts`):

1. Transcribe the recording. For OpenAI, it's sent in 10-minute pieces.
2. The Clip Picker chooses clips, snapped to whole sentences with no overlaps, and plans the video.
3. The removal plan: the flagged sentences, checked again on the words left next to each other, up to 3 rounds.
4. One ffmpeg pass keeps the chosen parts on a 1/30-second grid. Sound is cut in blocks of 1,600 samples, so picture and sound stay in step.
5. Chapters move onto the new timeline, then the captions file and 3 thumbnails are made.
6. The finished words are checked again.

**Comment-to-DM** (`lib/comments.ts`):

- Reads the last week's posts and the hub's own trial reels.
- For each new comment:
  1. re-reads the switched-on keywords;
  2. checks the guards;
  3. claims the comment;
  4. sends one private reply.

**Approvals** (`lib/seen.ts`): each approve form carries a fingerprint of the words on screen. A different fingerprint at approval means someone changed them, so the approval is refused.

### Version history

- **v1.0 (4 Nov 2026):** scripts, shoot, auto edit, trial reels, verdicts, post everywhere, accounts, watchlist, insights.
- **v1.1 (4 Nov):** verdict timing and hand-set verdicts, watchlist notes, a caption style per speaker.
- **v1.2 (5 Nov):** trend pool and teachers, the four AI agents, the Playbook, better reel numbers, LinkedIn text.
- **v1.3 (5 Nov):**
  - long sessions turned into clips and a YouTube long video;
  - Planner and Growth;
  - comment-to-DM and replies;
  - text posts, boosts, guests, hook tests, collab reels.
- **v1.4 (5 Nov):** flagged sentences cut out of the long video automatically, plus a full QA of the hub with every finding fixed.

