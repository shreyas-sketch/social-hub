# Social Hub

Mudita's internal app for growing the five speakers' accounts — Deepak, Aarzoo, Siddharth, Akshat and Chirag — on Instagram, Facebook, YouTube, LinkedIn and X.

It's a separate app from the Performance Hub, built the same way (Next.js + SQLite), so the same developer can run it.

**Nothing posts without a named person approving it.** Every approval is logged with who did it.

---

## The daily loop

1. **06:00 IST — Watch.** Pulls followers and post numbers for every connected account, the latest posts from each speaker's watchlist creators, the trend pool and the teachers. Marks posts that did well above that creator's usual ("outliers": 1.8× on the watchlists, 2× in the trend pool).
2. **07:00 IST — Write.** Writes 3 scripts per speaker (changeable), in that speaker's lanes, using what worked for us, the outliers, the Playbook rules that are on, this week's trend ideas and last week's review. The last script each day is an experiment. Every script is checked against SEBI/ASCI-style rules. A script that breaks a hard rule is sent back for a rewrite, up to 3 times; if it still breaks one, it's marked "must fix" and can't be approved until a person fixes it. The Hook Doctor then scores each hook out of 10 and offers 3 better ones.
3. **You approve** the scripts worth shooting (Scripts page).
4. **Shoot.** The team films on a phone (teleprompter built in) and uploads the raw video (Shoot page). Big files are fine; uploads resume if the connection drops.
5. **Auto edit.** Pauses cut, 9:16 frame, iPhone HDR converted, captions in the speaker's style, hook on screen, disclaimer on screen for money niches (above Instagram's bottom bar), loudness levelled. You check the cut, fix any misheard caption words, re-cut if needed (Edits page). What the speaker actually said in the take, and the hook on screen, go through the same rules check as the script: a take that says something blocked can't be approved.
6. **Trial reel.** Approving the cut posts it to Instagram as a **trial reel** (shown to non-followers first). Accounts under 1,000 followers get a normal reel instead, because Instagram doesn't allow trials below that. Numbers (views, reach, shares, saves, watch time, skip rate) are read at 3h, 6h and 12h.
7. **Verdict at 24h.** A reel that beats that speaker's median views (trials against trials, normal reels against normal reels) by 20% is a winner. A reel with strong shares but fewer views goes to you as "your call". Until a speaker has 3 finished trials, you pick winners by hand. A verdict you make by hand is never overwritten. Winners should go out within 24 hours of the verdict; late ones are flagged on Today and Trials. A loser can be re-tested with a new on-screen hook. (All these numbers are in Settings.)
8. **Post everywhere.** One click sends a winner to Facebook, LinkedIn and X automatically. LinkedIn gets its own text and the tracking link to the speaker's ₹99 webinar page; X and Facebook go out without a link (cheaper and better reach), and every account has a tracked bio link instead. YouTube and the Instagram "share to followers" step are 2-minute jobs by hand, listed on the Publish page.
9. **Learn.** The Insights page ranks lanes, hook types, lengths, formats and caption styles per speaker. The morning scripts are told what's working.
10. **Long sessions.** Once a week each speaker records a 60–90 minute talk, Q&A or podcast. The hub writes the transcript, picks 10–15 clips (each approved like a script, then cut with no shoot) and plans one YouTube long video from it (titles, chapters, captions file, 3 thumbnails). **Every sentence the SEBI/ASCI rules flag is cut out of the long video during the edit**, listed with its time. A "check" sentence stays only if an owner or admin keeps it. A wording note (like "cryptocurrency") is listed and left in. The speaker's own warnings ("there are no guaranteed returns") aren't flagged.
11. **Comments.** Every 15 minutes the hub reads new Instagram comments. A speaker's keyword (for example WEBINAR) gets one DM with the tracked webinar link — only the text an owner or admin switched on. Questions get a drafted reply that a person approves.
12. **Text posts.** Each morning, LinkedIn and X posts written for the platform; approved ones go out at 10:00 IST.
13. **Plan and pace.** The Planner shows each speaker's posts this week against the target, what's coming, and the shoots booked. Growth shows followers against the target and the speaker's own numbers per 1,000 views.
14. **Every week (Monday 9:00 IST).** The Trend Scout writes a trend brief with ideas per speaker. The Playbook Coach proposes new rules from what the teachers posted. The Weekly Review tells each speaker what worked, what didn't and what to change. A person decides on each one.

## The AI agents

They only advise. Nothing they suggest posts, gets approved or gets switched on until a person says so.

| Agent | When | What it gives you |
|---|---|---|
| Clip Picker | after each long session | 10–15 clips to approve, and the long video's titles, chapters and description |
| Text Writer | every morning | LinkedIn and X text posts in the speaker's voice |
| Reply Drafter | as comments come in | Replies to comments that ask something; a person approves each |
| Guest Helper | when you ask | A pitch to a podcast or creator, and a prep brief |
| Trend Scout | weekly | Breakout formats from popular creators, turned into ideas per speaker |
| Playbook Coach | weekly | Up to 5 new rules from the teachers' latest posts, waiting on the Playbook page |
| Hook Doctor | after every batch of scripts | A hook score out of 10 and 3 better hooks; one click swaps one in |
| Weekly Review | weekly, per speaker | What worked, what didn't, changes for next week, a suggested lane mix |

## Pages

| Page | What it's for |
|---|---|
| Today | What needs doing, followers per account, anything broken |
| Scripts | Approve, reject or edit the morning scripts (and clips); "Write now" for more |
| Long sessions | Upload a long recording; approve its clips; cut, approve and upload the YouTube long video |
| Shoot | Approved scripts, teleprompter, raw video upload |
| Edits | Check each cut, change captions/framing, fix words, approve as a trial |
| Text posts | LinkedIn and X posts to approve; type in their numbers |
| Trials | Trial numbers, verdicts, "Send everywhere" for winners; hook tests side by side |
| Publish | Manual steps (YouTube upload, Instagram graduation), failed posts, link clicks |
| Comments | Questions to answer (drafted replies), comment-to-DM keywords and who got the DM |
| Planner | Posts this week vs target per platform, shoots booked, the 70/20/10 mix |
| Growth | Followers vs target and pace, per-1,000-views numbers, sign-ups, paid boosts |
| Insights | What's working per speaker, followers over 5 weeks, top posts, the Weekly Review |
| Guests & collabs | Podcast and creator targets, pitches, prep briefs, followers before and after |
| Trends | The trend brief, breakout posts from popular creators, the trend pool and teachers |
| Playbook | The rules every script follows; switch agent proposals on or off; add your own |
| Watchlist | 10–16 creators per speaker to learn from; paste any profile link to add more |
| Speakers | Each speaker's direction, lanes, stop list, disclaimers, bio, caption style |
| Accounts | Connect accounts, send a connect link to a speaker, type LinkedIn followers |
| Settings | People and roles, timings, integrations, failed jobs, activity log |

## Roles

- **Owner** — everything, including people and settings.
- **Admin** — approve scripts, clips, cuts, winners, text posts, comment replies and long videos; switch DM keywords and Playbook rules on or off; connect accounts; run agents.
- **Team** — upload videos and long recordings, fix caption words (but not take out words the rules flag), draft replies, DM keywords and text posts, book shoots, log numbers, add watchlist and trend creators, mark manual posts done. Can't change anything once it's approved.

An approval is refused if the words changed since the approver opened the page (someone edited them in between): reload, read, approve.

## Run it on a laptop (for trying it out)

Needs Node 20+ and ffmpeg.

```bash
npm install
cp .env.example .env        # set SESSION_SECRET and TOKEN_KEY to long random strings, APP_URL=http://localhost:3100
npm run migrate
npm run seed                # the five speakers, their accounts, watchlists, trend pool, teachers and playbook
npm run dev                 # the app, at http://localhost:3100
npm run worker              # in a second terminal: edits, posting, daily jobs
```

Posting to Instagram needs a public https address (Meta downloads the video from the hub), so real posting only works on the server. Set `DRY_RUN=1` to run everything except the final post.

## Going live

On Railway: see **RAILWAY.md**. On your own server: see **GOING-LIVE.md** — server setup in one script, then the platform apps (Meta, YouTube, LinkedIn, X) and the Claude API key.

## Checks

```bash
npm test          # rules check (incl. spoken forms and warnings), lane split, silence cutting, captions, winner logic, tracking links,
                  # the script writer, the agents, long-video timeline and flagged-sentence removal, clips, comment-to-DM guards,
                  # text posts, growth pace, the trial cap, the take's own words, restarts
npm run build
npm run edit-sample   # makes a test clip and runs the full edit on it
```
