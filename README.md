# Microdrama Review Tool

A local web app for reviewing cuts of vertical microdrama episodes. Every cut gets timecoded notes from an AI pass (Google Gemini watching the video with the cast reference images) and from human strategists, on one timeline. A new cut is a new version: open notes carry over, the AI reports whether each one was fixed, and the two cuts can be compared side by side. Episodes move from pending to in review to approved.

Built for the Foxelli take-home task (AI Engineer, Technical Product Owner).

## Quickstart

Requirements: Node 22 or 24 LTS, npm, and a free Google AI Studio API key (no card needed: https://aistudio.google.com/apikey).

```bash
git clone https://github.com/00bga/microdrama-review.git
cd microdrama-review
npm install
cp .env.example .env     # paste your key into GOOGLE_API_KEY
npm run dev
```

Open http://127.0.0.1:3000. The server binds to this machine only; there is no login.

| Variable | Required | Meaning |
|---|---|---|
| `GOOGLE_API_KEY` | yes | Google AI Studio key. `GEMINI_API_KEY` works as an alias. |
| `GEMINI_MODEL` | no | Model id for reviews. Default `gemini-3.8-flash`; `gemini-3.5-flash-lite` is cheaper with a higher daily quota. `npm run models` lists what your key can call. |

Variables already set in your shell override `.env`.

## How a review round works

1. Create a series and add its cast references: a name, a short description and one clear face per member.
2. Upload the first cut of an episode (H.264 MP4 works everywhere). The episode starts as **pending**.
3. Run the AI review. The cut goes to Gemini through the Files API together with the cast images; the answer is JSON with `MM:SS` timecodes and lands as **draft** notes on the timeline. The episode becomes **in review**.
4. Triage: keep, edit or delete each draft; add your own notes at the playhead; resolve what is done. Human notes are never touched by a re-run; a re-run replaces only untriaged drafts.
5. Upload the next cut. Open notes carry over as ghost markers at their old time. Run the AI again: it judges each carried note as fixed, not fixed or unclear, with its new position in the cut. Accept moves the marker, or move it to the playhead yourself. Compare shows the previous cut beside the new one with paired seeking.
6. Approve the episode once no open notes remain. A newer cut reopens it.

Keyboard in the workspace: Space plays or pauses, J and K jump to the previous or next note, N adds a note at the playhead.

## Where data lives

Everything is in the git-ignored `data/` folder: `app.db` (SQLite), `uploads/videos/` and `uploads/cast/`. Delete the folder to start from scratch; the schema is recreated on the next start.

## Architecture

```
browser (React, one client island per workspace)
   |  pages render on the server from SQLite; small writes are Server Actions
   |  uploads, video streaming (HTTP Range) and the AI job are Route Handlers
Next.js 16 (App Router, TypeScript, Tailwind)
   |-- src/db          Drizzle schema + migrations, one SQLite handle per process
   |-- src/lib/prompt  rubric, rules, JSON schema, request assembly, prompt version hash
   |-- src/lib/gemini  Files API upload and polling, one generateContent call, error mapping
   |-- src/lib/review-job   the job: context, upload, call, validate, store (fenced by run id)
   |-- src/lib/review-output  lenient validation of the model's JSON, timecode clamping
   |-- src/app/api     Route Handlers
   |-- src/app/actions.ts   Server Actions (notes, approval, cast)
   data/               SQLite database and uploaded files (not committed)
```

The AI pass sends the whole cut (Gemini samples it at 1 frame per second with audio), the cast images inline, the notes already on the cut (so they are not repeated) and, for a later cut, the carried-over notes to re-check. The response schema forces `MM:SS` anchors, a category, a severity, evidence and an explicit hook and cliffhanger verdict, so the model is not pushed to invent notes: zero notes is a valid answer.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` / `npm run start` | develop, build, run the production build |
| `npm run lint` | ESLint with the Next.js and React Compiler rules |
| `npm run models` | list the models your key can call with `generateContent` |
| `npm run review:cli -- --video cut.mp4 --cast "Mira=mira.png"` | run one review outside the app with the same request shape; `--save run.json` keeps the result |
| `npm run db:generate` | generate a migration after a schema change |

## Free tier notes

- Quotas are per Google Cloud project and the daily quota resets at midnight Pacific time. The exact limits for your account are shown in AI Studio. The app never retries a rate-limited call; it shows the message and you run it again.
- The cost line under a review is the list price of the call (tokens times the public per-token price). A free-tier key is billed nothing.
- On the free tier Google may use prompts and responses to improve its products, as described in the Gemini API Additional Terms (https://ai.google.dev/gemini-api/terms). Check the terms for your region and use a paid key for confidential cuts.

## Known limits

- Local single-user tool: no accounts, no roles, no deployment.
- One reference image per cast member; the AI sees the cut at 1 frame per second, so a glitch shorter than a second can be missed.
- Model output varies between runs. Notes are drafts for a strategist, not verdicts.
- Uploads are capped at 300 MB and 10 minutes. HEVC `.mov` files play only where the browser supports them; export H.264 MP4.
- A re-run of the AI review replaces the untriaged drafts of that cut and re-judges the carried notes; kept and human notes stay.
