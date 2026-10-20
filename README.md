# Microdrama Review Tool

Take-home task for the AI Engineer (Technical Product Owner) role at Foxelli.

## The task

Foxelli produces vertical microdramas where every shot is AI generated. Each 1 to 2 minute episode cut goes through a review round before it is approved: an AI pass drafts timecoded notes (hook, continuity, character consistency against cast reference images, pacing, cliffhanger), a strategist keeps, edits or adds notes on the same timeline, and every new cut becomes a new version that keeps the earlier notes and can be compared with the previous one. Episodes move from pending to in review to approved.

## How I am approaching it

- One Next.js app that runs locally with `npm install` and `npm run dev`. No deployment, no accounts, nothing paid.
- SQLite through Drizzle ORM. Uploaded cuts and cast images live in a git-ignored `data/` folder next to the database.
- Google Gemini watches the video natively and returns notes as JSON with MM:SS timecodes. The model id is an environment variable, so it can be swapped without a code change.
- AI notes arrive as drafts that a strategist keeps or discards. Re-running the AI never touches human notes.
- A new cut is a new version. Open notes carry forward, the AI reports whether each one was fixed, and both versions can be viewed side by side.
- Build order: the human-only round first (upload, notes, versions, approve), then the AI pass, then compare and polish. The end-to-end flow carries the most weight, so it lands and gets verified first.

## Status

In progress. Setup steps, architecture notes and the write-up will be added as the build lands.
