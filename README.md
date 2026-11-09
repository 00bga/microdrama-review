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

Open http://127.0.0.1:3000. The server binds to this machine only; there is no login. If port 3000 is taken: `npm run dev -- -p 3100`.

`npm install` needs no compiler: the SQLite driver downloads a prebuilt binary for your platform. Only when that download is blocked does it fall back to building from source, which needs the usual native build tools.

| Variable | Required | Meaning |
|---|---|---|
| `GOOGLE_API_KEY` | yes | Google AI Studio key. `GEMINI_API_KEY` works as an alias. |
| `GEMINI_MODEL` | no | One model id, or several separated by commas: the next one is tried when the one before is overloaded (503 or 504) or hangs. Default `gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite`; Flash-Lite is cheaper and the least often overloaded, so it closes the list. `npm run models` lists what your key can call. |

Variables already set in your shell override `.env`.

## How a review round works

1. Create a series, paste its bible (logline, tone, visual rules, non-negotiables, who the characters are) and add the cast references: a name, a short description and one clear face per member. The bible goes to the AI with every review of the series, so a character who drifts from it gets a note that quotes the rule.
2. Upload the first cut of an episode (H.264 MP4 works everywhere). The episode starts as **pending**.
3. Run the AI review. The cut goes to Gemini through the Files API together with the cast images; the answer is JSON with `MM:SS` timecodes and lands as **draft** notes on the timeline. A review takes one to two minutes; the banner shows the stage. The episode becomes **in review**.
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

The AI pass sends the whole cut (by default the API samples it at 1 frame per second, with audio), the cast images inline, the series bible, the notes already on the cut (so they are not repeated) and, for a later cut, the carried-over notes to re-check. The response schema forces `MM:SS` anchors, a category, a severity, evidence and an explicit hook and cliffhanger verdict. The default instruction text is the round-1 prompt with its style examples replaced by invented ones (arm P), because none of the rebuilt variants measured better on the tuning cuts. The variants stay selectable: `GEMINI_ARM=A` (a first-time phone viewer with delivery, sound, rendering and transition lenses and a density target), `AB` (A plus a shot list per 10 s block before the notes) or `AC` (a problem slot per listed shot), and `GEMINI_EXEMPLARS` (up to 15) adds strategist notes from other episodes as a style sample. Every variant was measured; see [docs/accuracy.md](docs/accuracy.md) and [docs/decisions.md](docs/decisions.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` / `npm run start` | develop, build, run the production build |
| `npm run lint` | ESLint with the Next.js and React Compiler rules |
| `npm run models` | list the models your key can call with `generateContent` |
| `npm run review:cli -- --video cut.mp4 --cast "Mira=mira.png"` | run one review outside the app with the same request shape; `--bible bible.txt` adds the series rules, `--save run.json` keeps the result |
| `npm run import:examples` | load the example package (below) into the app |
| `npm run eval:run -- --set dev --model gemini-3.6-flash --pin` | blind reviews of a set of example cuts (or one `--cut`), one JSON per run under `data/eval/`; keyed on cut, prompt version and run index; stops at the first failure and prints the resume command; `--list` shows the cuts |
| `npm run eval:score` | scores every saved run against the strategists' notes with zero API calls (moments, chance floors, intervals); `--report` rewrites the tables in docs/accuracy.md; `--scaffold`, `--judgments` and the export flags write the label and judgment files; `--budget` shows the calls used today |
| `npm run eval:check` | unit checks for the scorer's pure functions |
| `npm run eval:scan` | confidentiality check: no tracked file shares five consecutive words with a note from the example package |
| `npm run db:generate` | generate a migration after a schema change |

## Trying it with the example package

The review tool ships without media. If you have the example package (one folder per series with `series.json`, a `cast/` folder and one folder per episode holding `v1.mp4`, `v2.mp4` ... and `notes.json`), put it next to the app as `microdrama-review-examples/` (git-ignored) and run:

```bash
npm run import:examples     # every series, cast and bible; every cut in order; the strategists' notes as human notes
npm run dev                 # then open a series, pick an episode and press Run AI review on its latest cut
```

Older cuts stay read only with their own notes; the latest cut carries the open notes forward, exactly as if the cuts had been uploaded one by one. The import is safe to repeat: a series that already exists is skipped.

`npm run eval:run -- --cut "Bound to the Demon King/Episode 04/v1" --model gemini-3.6-flash --pin` reviews one cut blind (without that cut's strategist notes) and saves the run under `data/eval/`; `npm run eval:score` then scores every saved run against the strategists' notes with zero API calls. For v2 and later the previous cut's notes go in as carried notes, so the fixed / not fixed verdicts can be read against what the strategists wrote next. How accuracy is defined, which cuts were tuned on and which were held out, and where the numbers land is in [docs/accuracy.md](docs/accuracy.md).

A database written by this version should not be opened with the code at the `submission` tag (round 1): that build indexes category styles directly and does not know the `sound` category added since.

## Accuracy

On the four held-out cuts the frozen configuration (3.6 Flash, one call per cut) flagged 1 of 38 strategist moments at the same point for the same reason, checked by watching (3%, 95% interval 0 to 13). By the automatic rule it matched 2 of 38 (5%) against 11% for evenly spaced dummy notes. The validity of its own notes was not judged. That is far from the 70% target; [WRITEUP.md](WRITEUP.md) explains why and what was tried, and [docs/accuracy.md](docs/accuracy.md) holds the definition, the pre-registration and every table.

The saved runs, the strategist label file and the judgment file describe the confidential example package, so they are not in the repository; they travel with the submission bundle. With them in place (`data/eval/`, `eval/labels/`, `eval/judgments/`), this prints the headline with no API call:

```bash
npm run eval:score -- --config a8a8b0e6 --model gemini-3.6-flash --run-index 1 --set test
npm run eval:score -- --report   # regenerates every table in docs/accuracy.md
```

## Design decisions

The reasoning behind the main choices, each measured where a number exists; the full list with options and measurements is in [docs/decisions.md](docs/decisions.md), the accuracy protocol and its results in [docs/accuracy.md](docs/accuracy.md).

- The model watches the whole cut in one call (video, audio, cast photos, bible): no frame extraction, no ffmpeg, one key is the whole setup.
- AI notes land as drafts a strategist keeps or deletes, so the AI never writes into the note list unasked; the cost is triage, which is priced in the write-up.
- Carried notes are copies with their own fixed / not fixed verdict and new timecode, so every cut keeps its history.
- Accuracy is defined before it is measured: the definition, the tuning and held-out split, the prior-contact list and the hash of the label file were committed and tagged before any scored call.
- A number is never printed alone: automatic coverage always sits beside its chance floor, the human-confirmed figure beside the validity of the tool's own notes.
- Round 1's time-only metric scored at chance under this rule, which is why the definition changed; the write-up says so.
- The prompt was rebuilt as a first-time phone viewer with delivery, sound, rendering and transition lenses and measured as separate arms (text alone, text plus a shot list per block, a problem slot per shot); none beat the round-1 text over its chance floor, so the app ships the round-1 text with invented examples and keeps the arms selectable.
- A note the model restates at the new timecode of its own verdict is dropped as a duplicate, counted and shown.
- Every call, failed ones included, goes into a ledger that stops a sweep before it passes the free tier's daily limit.
- Windowed passes were built and measured on Flash-Lite (three times the notes, no lift over the floor); generate-then-verify was costed and left for a paid key.

## Free tier notes

- Quotas are per Google Cloud project and per model. In October 2026 a new free key allowed 20 requests a day for each Flash model, failed calls included, and the counter reset at midnight Pacific time; AI Studio shows the limits for your account. When one model in the list is out of quota the app moves on to the next; when all are, it says so and tells you when the quota resets.
- At busy hours the free tier answers 503 "high demand" for the newest Flash models, sometimes for an hour. The fallback list in `GEMINI_MODEL` covers it; when every listed model is overloaded the review fails with a message that says so, and the next run starts from the cached upload.
- The cost line under a review is the list price of the call (tokens times the public per-token price). A free-tier key is billed nothing.
- On the free tier Google may use prompts and responses to improve its products, as described in the Gemini API Additional Terms (https://ai.google.dev/gemini-api/terms). Check the terms for your region and use a paid key for confidential cuts.

## Known limits

- Local single-user tool: no accounts, no roles, no deployment.
- One reference image per cast member; by default the AI sees the cut at 1 frame per second (`GEMINI_FPS` raises it; what that changed is measured in docs/accuracy.md), so a glitch shorter than a second can be missed.
- Model output varies between runs. Notes are drafts for a strategist, not verdicts.
- Uploads are capped at 300 MB and 10 minutes. HEVC `.mov` files play only where the browser supports them; export H.264 MP4.
- A re-run of the AI review replaces the untriaged drafts of that cut and re-judges the carried notes; kept and human notes stay.
