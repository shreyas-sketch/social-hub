# Going live — developer guide

About half a day of setup, most of it waiting on platform dashboards. Do it in this order.

---

## 1. Server (about 20 minutes)

The hub needs a VPS, not fly.io or Vercel: it runs ffmpeg and whisper.cpp on uploaded videos and keeps a second process (the worker) running all the time.

**Size:** Ubuntu 22.04/24.04, **4 vCPU, 8 GB RAM, 500 GB disk** (v1.3 — long sessions).

- Long recordings are big: 90 minutes at 1080p is about 5–10 GB. Five speakers a week is about 25–50 GB a week, plus the finished long videos (estimated).
- Cutting a 90-minute long video would take about 40–60 minutes on a 2-core machine (estimated from a measured 75 seconds for a 3-minute test). 4 cores should roughly halve that (untested).
- Delete old recordings once their clips and long video are done (see "Day to day").

1. DNS: an **A record** `social` → the server's IP. Wait until `ping social.yourdomain.com` answers.
2. Copy the folder up and run the setup script:

```bash
scp -r social-hub root@SERVER_IP:/opt/
ssh root@SERVER_IP
cd /opt/social-hub
bash deploy/vps-setup.sh social.yourdomain.com you@yourdomain.com
```

It installs Node 22, ffmpeg, Nginx, builds whisper.cpp with the `base.en` model (free captions), builds the app, creates the database in `/var/lib/social-hub`, writes `/etc/social-hub.env` with fresh secrets, starts two services (`social-hub` and `social-hub-worker`), gets HTTPS and schedules a nightly backup.

**Keep the two secrets the script writes.** `TOKEN_KEY` locks the platform sign-ins stored in the database and `SESSION_SECRET` signs people in. Changing `TOKEN_KEY` (or leaving it empty and changing `SESSION_SECRET`) means connecting every account again. Settings → Integrations warns if `TOKEN_KEY` is empty.

3. Open the setup link the script prints at the end (`https://social.yourdomain.com/setup?key=…`) and create the owner account. Without the key, nobody else can claim the empty install. Add the team in Settings → People.

Everything below adds keys to `/etc/social-hub.env`. After editing it:

```bash
systemctl restart social-hub social-hub-worker
```

Settings → Integrations shows what's still missing.

**Redirect URL pattern** (used by every platform app below):
`https://social.yourdomain.com/api/oauth/<meta|youtube|linkedin|x>/callback`

---

## 2. Claude API — the morning scripts (10 minutes)

1. console.anthropic.com → API keys → create one.
2. `ANTHROPIC_API_KEY=...` (model defaults to `claude-sonnet-5-5`; change with `ANTHROPIC_MODEL`).

The same key runs the AI helpers: Trend Scout, Playbook Coach, Hook Doctor, Weekly Review, and (v1.3) Clip Picker, Text Writer, Reply Drafter, Guest Helper.

Cost for five speakers, all on (estimated):

- morning scripts, including rewrites: about ₹1,000–1,300 a month
- Hook Doctor after every batch: about ₹400–600 a month
- the three weekly agents: about ₹150–250 a month
- Clip Picker, one long session per speaker a week: about ₹400–600 a month (it reads the whole transcript twice)
- Text Writer, 1–2 posts per speaker a day: about ₹250–400 a month
- Reply Drafter: about ₹200–500 a month, depending on how many comments ask something
- total: about ₹2,400–3,700 a month

Settings → AI agents shows the real token use for the last 30 days, priced at $3 / $15 per million tokens in / out. Check the current price for your model and change the figure if it differs.

To save money, set `hook_doctor` to off in Settings, or move the weekly agents to a quieter day.

Test: Scripts → "Write for everyone now". Scripts appear in about a minute, and Hook Doctor scores a minute or two later. Then Trends → "Run Trend Scout now" (it needs the morning reads first, so do this on day 2).

---

## 3. YouTube — numbers and watchlist (10 minutes)

YouTube numbers are public, so **only an API key is needed for now**.

1. console.cloud.google.com → new project "Mudita Social Hub".
2. APIs & Services → Library → **YouTube Data API v3** → Enable.
3. Credentials → Create credentials → **API key** → restrict it to YouTube Data API v3.
4. `YOUTUBE_API_KEY=...`

Daily use is about 200 of the free 10,000 quota units (estimated): the speakers' own channels plus about 54 YouTube creators on the watchlists, trend pool and teachers list, about 3 units each.

**Uploads, later.** Uploads from an app Google hasn't audited are forced to private, so the team uploads Shorts and long videos by hand (the Publish page lists Shorts with title and description to copy; each long video's session page has the video, captions file, 3 thumbnails, title, description and tags). To automate later: create an OAuth client (Web application, redirect URL above), set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, apply for the YouTube API audit, and once approved set `YOUTUBE_UPLOAD_ENABLED=1` and connect each channel on the Accounts page. **A channel connected before that switch only allowed reading, so connect it again** — until then its videos stay on the upload-by-hand list (the session page says so).

---

## 4. Meta — Instagram + Facebook (45 minutes, the important one)

This is internal use, so the app stays in **Development mode** and each speaker's login is added as a tester. No App Review is needed for posting, numbers and comments.

**One exception — comment-to-DM.** In Development mode Meta only lets the app message people who have a role on the app. To DM real commenters, the app needs App Review for `instagram_manage_messages` (Advanced Access) and Mudita's business verification (likely, per Meta's rules; not tested). Until then, switch a keyword on and test it with a team member's account commenting. Everything else works without it. If App Review is slow, a tool like ManyChat (about $15 a month, not checked) does the same job with its own approval.

**Before you start, for each speaker:**
- Instagram is a **Professional** account (Business or Creator).
- A **Facebook Page** exists and the Instagram account is linked to it (Instagram app → Settings → Business tools → Connect a Facebook Page, or from the Page's settings → Linked accounts).

**The app:**
1. developers.facebook.com → My Apps → Create app. Choose the use case for managing Instagram/Pages (or "Other" → type **Business**). Connect it to Mudita's Business portfolio.
2. Add the products **Facebook Login for Business** (or **Facebook Login**) and **Instagram** (the "API setup with Facebook login" option).
3. Facebook Login → Settings → **Valid OAuth Redirect URIs**: `https://social.yourdomain.com/api/oauth/meta/callback`
4. If the product is *Facebook Login for Business*, create a **Configuration** (user access token, permissions below) and set `META_CONFIG_ID` to its id. With classic *Facebook Login*, leave `META_CONFIG_ID` empty.
5. Permissions the hub asks for: `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `instagram_manage_comments`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`. (The two "manage" ones are new in v1.3: accounts connected before need connecting again to grant them.)
6. App settings → Basic → copy App ID and App Secret → `META_APP_ID`, `META_APP_SECRET`.
7. App roles → Roles → add as **Tester** the Facebook account that manages each speaker's Page. Each person accepts the invite (developers.facebook.com → notifications).

**Connect:** Accounts → Instagram → "Connect here", or "Link for <speaker>" to send the speaker a link on WhatsApp (works without a hub login, lasts 3 days). After the Facebook sign-in, a screen asks which Page belongs to which speaker — one login that manages several Pages can connect them all at once.

Meta asks people to sign in again about every 90 days; the Today page warns 10 days ahead.

**Test:** with `DRY_RUN=1`, approve a cut — the whole flow runs except the post. Then set `DRY_RUN=0` and approve one real cut. Check it appears as a trial reel in the Instagram app.

**Watchlist, trend pool and teachers:** once one Instagram account is connected, Meta reads every Instagram creator on these lists through it (about 43 creators a day). Check the Watchlist and Trends pages the next morning: any creator with a red error has a wrong handle — fix it or remove it.

**Comments (v1.3):** read every 15 minutes (Settings). Meta only sends comment webhooks to apps with Advanced Access, so the hub asks instead — a few calls per account per read. For DMs, each speaker's Instagram needs: Settings → Messages and story replies → Message controls → Connected tools → **Allow access to messages** on.

**Collab reels:** up to 3 collaborators per reel. They get an invite in the Instagram app and must accept it for the reel to show on their profile.

**Under 1,000 followers:** Instagram doesn't allow trial reels below 1,000 followers. The hub posts a normal reel for those accounts instead, and switches to trial reels by itself once the account passes 1,000.

Limits (Meta's): 50 API posts per Instagram account per 24 hours; reels 3 seconds to 15 minutes via the API, but only reels up to 3 minutes get recommended to non-followers; Facebook Page reels 30 per day; about 20 trial reels a day per account.

---

## 5. LinkedIn (20 minutes)

1. linkedin.com/developers → Create app (it must be tied to a LinkedIn Company Page — use Mudita's).
2. Products → add **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn** (both self-serve).
3. Auth → Authorized redirect URLs: `https://social.yourdomain.com/api/oauth/linkedin/callback`
4. `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`.
5. Connect Aarzoo and Chirag now; Deepak, Siddharth and Akshat once their profiles exist.

LinkedIn tokens last 60 days with no refresh, so each person reconnects every two months (the hub warns). LinkedIn doesn't give personal-profile numbers without its Community Management approval, so followers are typed in weekly on the Accounts page.

If the first post fails with a permissions error on `/rest/videos` or `/rest/posts`, check `LINKEDIN_VERSION` (format YYYYMM, a currently supported month) and that Share on LinkedIn shows as "Added".

---

## 6. X (20 minutes, ~₹600/month approved)

1. developer.x.com → sign up for pay-per-use, add credits.
2. Create a Project and an App → User authentication settings:
   - OAuth 2.0, type **Web App** (confidential client)
   - App permissions: **Read and write**
   - Callback URI: `https://social.yourdomain.com/api/oauth/x/callback`
   - Website: Mudita's site
3. Copy the OAuth 2.0 **Client ID** and **Client Secret** → `X_CLIENT_ID`, `X_CLIENT_SECRET`.
4. Connect Chirag (@chirag912, rename first) now; the others once their accounts exist.

---

## 7. Speakers' webinar links

Speakers → each speaker → "₹99 webinar page". Tracking links go there with UTM tags (`utm_source=<platform>`, `utm_medium=social`, `utm_campaign=social-hub`, `utm_content=script-<id>`, `bio`, `dm-…` or `long-…`, `utm_term=<speaker>`, `utm_id=<link>`) so the Performance Hub can tie sales back to a reel. The seed uses each speaker's website as a placeholder — **replace with the real ₹99 pages.**

**Where the link goes (default):**

- LinkedIn post text and YouTube descriptions: yes
- X and Facebook post text: no. An X API post with a link costs about $0.20 instead of $0.015 and reaches fewer people; Meta says captions without links do best. Change it in Settings → "Platforms whose post text carries the tracking link".
- Every account's bio: yes. Accounts → each account shows its own bio link with a copy button. Paste it into that profile's bio once. Clicks are counted.

**Sign-ups back into the hub (optional, v1.3).** So the Growth page can show webinar sign-ups per 1,000 views, have the webinar page (or a Zapier/Make step) send each sign-up:

```bash
curl -X POST https://social.yourdomain.com/api/signups \
  -H "x-hub-key: $SIGNUPS_KEY" -H "content-type: application/json" \
  -d '{"signups":[{"utm_id":"<from the URL>","utm_term":"<from the URL>","utm_content":"<from the URL>","ref":"<order or lead id>"}]}'
```

Set `SIGNUPS_KEY` in `/etc/social-hub.env` (any long random string; without it the hub uses `CRON_KEY`). `ref` stops a resend being counted twice. Without this, type sign-ups in on the Growth page.

---

## 8. Text posts, planner, growth (nothing to set up)

- Text posts: LinkedIn and X need to be connected (sections 5 and 6). They post at 10:00 IST after approval (Settings).
- Planner and Growth work from the numbers the hub already reads. Targets are changed on those pages.
- Draft DM keywords are seeded for every speaker, switched off. Read each one on Comments → Comment-to-DM, change the words if needed, then switch it on.

---

## Day to day

```bash
journalctl -u social-hub -u social-hub-worker -f     # live logs
systemctl restart social-hub social-hub-worker       # restart
bash deploy/update.sh                                # after copying up a new version
ls /var/lib/social-hub/backups                       # nightly database backups, last 14 kept
```

If "queued" keeps growing in Settings → Jobs, the worker isn't running: `systemctl status social-hub-worker`.

The weekly agents run on the weekday and IST hour set in Settings (Monday 9:00 by default). If an agent fails (for example, no Claude key), the error shows in Settings → AI agents; press "Run now" on the Trends or Playbook page to try again.

**Updating from v1.1, v1.2 or v1.3:** copy the new folder up and run `bash deploy/update.sh`, then `npm run seed` once. The database changes are additive (migrations 3–6) and run by themselves. The seed adds the trend pool, teachers and playbook rules (v1.2) and the text-post numbers and draft DM keywords (v1.3) without touching anything already there. Then reconnect each Instagram account once, for the comment and message permissions (v1.3).

From v1.4:

- Everyone signs in again once (a sign-in now ends when that person's password changes).
- A long video cut by v1.3 and not yet approved goes back to "cut it again", so the flagged sentences come out.
- Reels are now always transcribed, even with captions off, because the rules check reads what the take says. Keep `TRANSCRIBE_ENGINE` on `local` or `openai`; with `none`, the spoken words aren't checked (the Edit page says so).

Videos live in `/var/lib/social-hub/media` and are not in the nightly backup. Clear old raw files when the disk fills (`df -h`).

Long recordings are in `/var/lib/social-hub/media/raw/<speaker>/sessions/<session>/`. Once a session's clips are posted and its long video is on YouTube, delete the recording there to free space (the finished clips and long video are kept separately).

## Captions without whisper.cpp

`TRANSCRIBE_ENGINE=openai` with `OPENAI_API_KEY` uses OpenAI's Whisper API instead (paid per minute). `none` turns captions off — and with it the rules check on what each take actually says, so it's for testing only.
