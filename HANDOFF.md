# Social Hub — handoff (v1.4, 5 Nov 2026)

## Where things stand

The app is built and runs end to end. It isn't live yet.

It still needs:

- a server
- the platform apps (Meta, LinkedIn, X) and the YouTube and Claude keys
- the missing accounts (Harsh's team is creating them)

v1.4 makes the SEBI/ASCI rules cut flagged sentences out of the YouTube long video during the edit, and fixes everything a full QA of the hub found.

## What changed in v1.4

**1. Flagged sentences are cut out of the long video automatically**

- Before the cut, the session page lists every sentence in the speaker's own words that the rules flag, with its time and a link to hear it.
- The edit cuts each one out — the sentence that says it, not the whole minute around it. In fast speech with no full stops, only the flagged words out to the nearest short pause.
- Red (a blocking rule): always cut.
- Amber (a "check" rule, like current market data): cut, unless an owner or admin ticks "keep".
- Grey (a wording note, like "cryptocurrency"): listed, left in.
- The speaker's own warnings aren't flagged: "there are no guaranteed returns", "koi bhi guarantee nahi de sakta", "beware of anyone selling sure-shot tips".
- After the cut, the finished video's words are checked again, including where two halves now sit next to each other. If anything blocking is left, it can't be approved.
- It can't be cut at all without a readable transcript.
- This replaces v1.3's two-tick override.

**2. The rules check catches more, and fewer false alarms**

- New: "10×", spoken money claims ("10,000 rupees into 1 lakh", "10k into 1 lakh", "this coin can go 10 times", "10 guna return", "paisa double ho jayega"), spoken targets ("my target for Nifty is 25,000", "Nifty will touch 26,000"), hashtags and the script title (it becomes the LinkedIn video title).
- No longer flagged: teaching lines like "money doubles in 6 years at 12%", "volume grew 3 times", "Nifty can go to 15,000 or 30,000, nobody knows", "Sensex is an index of 30 companies", "my target for the year is 100 students".
- One note per phrase (no repeats).

**3. A reel's own words are checked before it posts**

- What the speaker actually said in the take, and the hook on screen, get the same check as the script. A take that says something blocked can't be approved — re-shoot that part.
- Takes are always transcribed now, even with captions off, so there's always something to check. A take with sound but no transcript can't be approved.
- Fixing a misheard caption word is fine for anyone. Taking out words the rules flag needs an owner or admin (the audio still says them), and it's logged.

**4. Approvals approve what the approver read**

- Scripts, text posts, DM keywords and long videos: if someone changed the words after the approver opened the page, the approval is refused ("reload and read it again").
- A DM keyword switched off mid-batch stops at once. A comment is claimed before its DM goes, so two reads at once can't DM the same person twice.
- Saving a live keyword without changing the words keeps it on.

**5. No double posts**

- A failed reel that may already be on Instagram can only be retried, not approved again.
- A failed first try that's approved again is marked "replaced", so it can't also be retried.
- Hook tests post all variants or none.
- After a restart, only posting work that had actually started is flagged for a person to check; work still waiting just runs.

**6. Other fixes from the QA**

- Saving a speaker no longer wipes their Instagram bio (it now has its own box).
- Hook-test variants show on Edits, Today and the sidebar count.
- Insights: link clicks counted correctly (last 30 days, all tracking links, same as Growth); groups with under 3 trials marked untested; no "0" medians for new speakers.
- First trial on a new account checks followers first (Instagram refuses trials under 1,000); nothing posts, and approving again sends it as a normal reel.
- The edit page says "Approve and post as a normal reel" when that's what happens.
- Changing a password signs that person out on other devices.
- The public connect page only shows messages the hub wrote.
- AI output that comes back in the wrong shape can't break a page; AI-written links must be plain web links.
- YouTube upload permission is tracked per channel.
- Phone fixes: Settings, Insights tables, the long-video page, the growth chart (scrolls sideways at a readable size).
- Dates in IST everywhere; labelled boost dates; teleprompter buttons have names; clearer wording on Trials, Comments and Today.

## What changed in v1.3 (for reference)

**1. Long sessions → clips (new page: Long sessions)**

- A speaker records one 60–90 minute talk, Q&A or podcast a week. The team uploads it (up to 20 GB, in pieces).
- The hub writes the transcript, then the Clip Picker (Claude) picks the 10–15 parts that work on their own (number in Settings).
- Each clip waits for approval like a script, with a preview of that part of the recording.
- Approving a clip starts its cut straight away. No shoot needed. It then follows the normal path: cut → trial → winner → everywhere.
- A clip's words come from the recording, so they can't be edited. A clip whose words break a SEBI/ASCI rule can't be approved.

**2. YouTube long-form video from the same recording**

- The Clip Picker also plans one long video: 3 titles, a description, chapters, tags, 3 thumbnail texts, and where the talk really starts and ends.
- "Cut the long video" makes a 16:9 video with pauses over a second taken out, HDR converted, sound levelled.
- It also makes a captions file (.srt) and 3 thumbnails, and moves the chapters onto the finished video's timeline.
- Everything the speaker says that the rules flag is listed with its time. (v1.4: those sentences are now cut out automatically — see above.)
- An owner or admin approves it. Until Google audits the app, the team uploads it in YouTube Studio with everything shown on the page, then pastes the link. They also log which title won YouTube's Test & Compare.

**3. Planner (new page)**

- Weekly targets per speaker per platform. Defaults from the research: Instagram 14, YouTube Shorts 7, YouTube long 1, Facebook 7, LinkedIn 5, X 7.
- Shows what's out this week, what's coming, and what's short. It warns from Thursday if a platform has nothing out and nothing coming.
- Book shoots (teleprompter or long session) and mark them done, missed or cancelled. It warns when a speaker has no shoot in the next 7 days, or no long session this week or next.
- The 70/20/10 mix (core topic / next-door topic / personal story). The morning writer is told which kind each script should be, to keep the last 4 weeks near the aim.

**4. Comment-to-DM (new page: Comments)**

- Someone comments a speaker's keyword (for example WEBINAR) → one DM with the tracked ₹99 webinar link.
- The hub only ever sends the DM text an owner or admin switched on. Any change to the words turns it back into a draft.
- Guards: one DM per comment, only within 7 days of it, never for comments made before the keyword was switched on, one per person per day, a cap per hour.
- Draft keywords are seeded for all five speakers, switched off.
- Scripts are told to ask for the keyword when it fits (at most every other script).
- **Needs Meta App Review before it reaches real commenters** (see "Not tested yet").

**5. Growth (new page)**

- Per speaker and platform: followers, net new a day (7 and 30 days), needed a day to hit the target, pace, and the date at this pace.
- Targets default to 1M by 30 Nov 2029 (changeable per speaker and platform).
- The speaker's own numbers for redoing the "1M" maths: follows per 1,000 views (approximate), views from the top 10% of posts, trial win rate, link clicks and webinar sign-ups per 1,000 views.
- A chart of each speaker's growth since the start of the last 12 weeks, on one platform at a time.
- Every tracking-link click is now logged with its time. Links also carry utm_term (the speaker) and utm_id (the link).
- Webinar sign-ups: typed in, or sent by the webinar side to /api/signups with a key. A resent sign-up isn't counted twice.

**6. Hook tests**

- On a cut, make 2 more versions with different on-screen hooks (Hook Doctor's suggestions are offered). Post all three as trial reels at once and compare on Trials.
- Trial reels per account per day are capped (15 by default; Instagram allows about 20).

**7. Text posts for LinkedIn and X (new page)**

- Written every morning for the platform, not the reel cross-posted. LinkedIn on weekdays; X can test one of the day's reel hooks.
- Starting setup: LinkedIn 1 a day for Akshat, Chirag and Aarzoo; X 1 a day for all five (change on the Planner).
- Same rules check, plus platform limits: 280 for X, no links, few hashtags. Up to 3 automatic rewrites.
- An owner or admin approves; it posts at 10:00 IST. Impressions are typed in (no API numbers for personal profiles).

**8. Paid boosts (on Growth)**

- Log a boost of a winner from Ads Manager: dates, spend, follows, clicks, sign-ups. The hub works out cost per follow, click and sign-up, and the measured follower change in those dates.

**9. Guests & collabs (new page)**

- Podcast and creator targets per speaker: status, follow-up date, live date.
- Followers the day it went live and a week later (measured).
- "Draft a pitch" and "Prep brief" (Claude). You send the pitch yourself.
- Collab reels: up to 3 Instagram collaborators on a cut. It then posts as a normal reel (Instagram doesn't allow collaborators on trial reels).

**10. Comment replies**

- Comments that ask something get a drafted reply (Reply Drafter). The team can edit drafts; an owner or admin approves each reply before it posts.

**Also**

- New AI helpers: Clip Picker, Text Writer, Reply Drafter, Guest Helper. Usage and estimated cost are in Settings.
- The sidebar is grouped: Make, Post, Grow, Learn, Set up.
- Today shows text posts to review, replies to approve, long videos waiting, and this week's plan warnings.
- A form that's refused now keeps what you typed (before, it cleared it).

## QA (measured)

**v1.4 — full QA of the hub**

- **Independent code review, two rounds** (separate reviewers that hadn't seen the work):
  - Round 1, the whole hub (server and pages): 29 findings. All fixed.
  - Round 2, the fixes themselves: 10 findings (the main ones: the speaker's own warnings were being cut, fast Hinglish could lose 24 seconds, a reel with captions off went unchecked, one path could post twice). All fixed.
- **Automated tests: 42 pass** (12 new): the new rules and the warnings they must leave alone, the take's words, no double posts, DM claims and switch-off, approval fingerprints, one recording per session, no cut without a transcript, restarts, variants in lists, cuts in fast speech, wording notes.
- **Rules check on 42 sample sentences** (teaching lines, warnings, Hinglish, real claims): all as intended.
- **Real long cuts through the worker** on the 3-minute test recording:
  - Finance talk: 4 flagged sentences cut (13 seconds in all). The captions file has none of them; the next sentence is kept.
  - Crypto talk: the two claims cut; "There are no guaranteed returns" kept; "Cryptocurrency…" listed as a wording note.
  - Picture and sound stayed in step after removal (a frame check at 2:11 matched the source).
- **Browser, as owner, admin and team:** all 32 pages load for each, no page errors.
  - Team sees no approve, post or switch button anywhere.
  - Approving a long video or switching on a DM keyword after someone changed the words is refused; after reloading it works.
  - Team can't take flagged words out of captions; the reel with a flagged take can't be approved.
  - Changing a password keeps that device signed in and signs out another.
  - Phone width (390 px): no page wider than the screen.

**v1.3 (earlier):** 29 tests, a 75-second long cut of the 3-minute test, 70+ browser checks, 15 review fixes.

## Not tested yet (needs real accounts or keys)

- **Comment-to-DM to real people.**
  - While the Meta app is in Development mode, Meta only lets it message people who have a role on the app.
  - Sending to real commenters needs App Review for `instagram_manage_messages` (Advanced Access) and business verification (likely, per Meta's rules; not tested).
  - Until then, test it with a team member's account commenting.
- Reading comments and posting replies through Meta (expected to work in Development mode for the speaker's own posts; check with the first real comment).
- Real posts to Instagram, Facebook, LinkedIn and X; Instagram collab invites; text posts to LinkedIn and X.
- Real Claude calls for the clip picker, text writer, reply drafter and guest helper (tests used stand-in replies).
- Transcribing a real 90-minute recording with whisper.cpp (time not measured).
- Captions on real speech.
- The rules check on real Hinglish speech. The default whisper model (`base.en`) transcribes English; Hindi words come out as English-sounding guesses, so a Hindi claim can be missed. A multilingual model (for example `small`) should do better (untested).

The first real post on each platform is the test. Start with `DRY_RUN=1`, then one real reel per platform.

## Decisions built in

- Aarzoo: about 70% psychology, 30% leadership and communication. No finance.
- Siddharth: personal finance and trading together. No stock calls; market data at least 30 days old.
- Akshat: Business AI owner lane plus consulting lane. Confirm his background line with him before it goes public.
- Chirag: reuse and rename his Instagram and X. Business AI content goes on his existing LinkedIn. Normal reels until 1,000 Instagram followers.
- Instagram trial graduation is manual. YouTube uploads (Shorts and long videos) are by hand until Google's audit.
- Agents never post, approve or switch anything on by themselves. Automatic DMs send only the text an owner or admin switched on.
- In the long video, blocking sentences are always cut and can't be kept. "Check" sentences are cut unless an owner or admin keeps them (logged). Wording notes are left in. I'm not a lawyer — your compliance person decides where those lines are, and the rules list in `lib/compliance.ts` can be changed.

## Known limits

- Auto edits suit talking-head video. B-roll and motion graphics still need an editor.
- Clips are cut from the long recording as it was filmed; landscape recordings are cropped or fitted to 9:16.
- Only Instagram and YouTube creators can be read. X, LinkedIn and Facebook creators are kept as links.
- LinkedIn and X numbers are typed in.
- Meta sign-ins last about 90 days and LinkedIn 60; the Today page warns 10 days ahead.
- Raw videos and long recordings are kept on the server and not backed up nightly. Long recordings are big; plan disk space (GOING-LIVE).
- The rules check matches patterns of words. It catches the common ways a claim is said, not every way; a person still watches before approving.

## Where things are

```
app/(hub)/       pages: Today, Scripts, Long sessions, Shoot, Edits, Text posts, Trials, Publish, Comments,
                 Planner, Growth, Insights, Guests & collabs, Watchlist, Trends, Playbook, Speakers, Accounts, Settings
app/actions.ts   every button (server actions), each logged with who did it
app/api/         upload (takes and long recordings), files, media links, OAuth, cron, signups
lib/sessions.ts  long sessions: transcript, clip picker, approving clips, the long video, flagged sentences cut out
lib/edit/longform.ts  the long cut, chapters, captions file, thumbnails
lib/planner.ts   weekly targets, what's out and coming, shoots, the 70/20/10 mix
lib/growth.ts    pace against targets, per-1,000-views numbers, sign-ups, boosts
lib/comments.ts  comments, comment-to-DM, reply drafts
lib/textposts.ts LinkedIn and X text posts
lib/guests.ts    podcast and collab pipeline
lib/scripts.ts   morning script writer + rules check + up to 3 rewrites + mix and keyword
lib/agents.ts    Trend Scout, Playbook Coach, Hook Doctor, Weekly Review
lib/compliance.ts  SEBI / ASCI-style rules per niche (warnings like "no guaranteed returns" aren't flagged)
lib/seen.ts      what an approver read, so changed words can't be approved unseen
lib/trials.ts    trial or normal reels, the daily cap, collab reels, reads and verdicts
lib/publish.ts   send everywhere, tracking links, bio links, X length
lib/platforms/   Meta, YouTube, LinkedIn, X clients
worker/          the second process: edits and long cuts, posting, comments, daily and weekly jobs
db/              schema (additive migrations 1–6), seed, backup
deploy/          VPS setup, update, services, Nginx
```

I'm not a lawyer. The rules check is a guide; SEBI and ASCI questions should go past your compliance person.
