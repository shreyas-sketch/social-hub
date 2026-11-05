# Deploying on Railway

The repo has a `Dockerfile` and `railway.json`. Railway builds one image with
Node 22, ffmpeg and whisper.cpp (free captions), and runs **the web app and the worker
in the same service**. They have to share one SQLite database and one video folder,
and a Railway volume can only be attached to one service.

## Steps

1. **New project → Deploy from GitHub repo** → `shreyas-sketch/social-hub`, branch `main`.
   Railway finds `railway.json` and builds from the `Dockerfile`. The first build takes
   about 5–10 minutes (it compiles whisper.cpp).
2. **Add a volume:** service → right-click → *Attach volume*, **mount path `/data`**.
   The app refuses to start without it, because a deploy would otherwise wipe the
   database and all videos.
3. **Domain:** service → Settings → Networking → *Generate Domain* (or add your own).
   Use it for `APP_URL`.
4. **Variables:** service → Variables → *Raw Editor* → paste
   `deploy/railway/variables.env` and fill in the `<...>` values. At minimum,
   `APP_URL`, `SESSION_SECRET`, `TOKEN_KEY` and `SETUP_KEY`.
5. **Deploy**, then open `https://<APP_URL>/setup?key=<SETUP_KEY>` and create the owner account.
6. **Platform apps:** follow GOING-LIVE.md sections 2–7. Every redirect URL is
   `https://<APP_URL>/api/oauth/<meta|youtube|linkedin|x>/callback`.
7. Test with `DRY_RUN=1`, then set `DRY_RUN=0`.

## Size the service

- **Memory/CPU:** video edits (ffmpeg) and captions (whisper.cpp) are heavy. Aim for 8 GB RAM
  and 4+ vCPU (Railway Pro). On less, edits are slow and long sessions may run out of memory.
- **Volume:** long sessions are 5–10 GB each, which is roughly 25–50 GB a week for five speakers.
  Check your plan's volume size limit, and delete old recordings once their clips and long
  video are done.
- **Keep 1 replica.** Two copies would both run the worker against the same database.

## Good to know

- Health check: `/api/health`.
- On first boot the app creates the database and loads the five speakers, watchlists and
  playbook. Later deploys only migrate; they never re-add creators you removed.
- A copy of the database is written to `/data/backups` once a day (the last 14 are kept).
  Videos aren't in it. Railway's own volume backups cover the rest.
- If the web app or the worker crashes, the service exits and Railway restarts it.
  Posting work that was cut off is flagged for a person to check, never resent blindly.
- Captions are transcribed in English (whisper's `base.en` model, language set to English in
  `lib/edit/transcribe.ts`). Hindi or Hinglish speech will come out as rough English words.
