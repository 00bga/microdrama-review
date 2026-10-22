# Microdrama Review Tool: write-up

## What I built

A single Next.js app (SQLite via Drizzle, uploads on local disk, Gemini via the official SDK) that runs the brief's review round end to end. Upload a cut; the AI reviews it with the cast photos and the series bible in one request; its notes land as untriaged drafts on a timeline under a 9:16 player, each with a timecode, category, severity, evidence and the character concerned. The strategist keeps, edits or deletes drafts, adds notes at the playhead and resolves them. The next cut is a new version: open notes are copied forward and the AI marks each carried note fixed or not fixed, with a rationale and its new timecode, which the strategist accepts or moves. Older versions are read only, two cuts play side by side with paired seeking, and approval waits for zero open notes. Each review shows its tokens and list price (the free tier bills nothing). The model id is a fallback list, since the free tier overloads at busy hours.

Choices: AI notes start as drafts, so the AI never writes into the strategist's list unasked. Carried notes are copies, so every cut keeps its history. The model watches the video itself, so there is no frame extraction and no ffmpeg. SQLite and local disk make one key the whole setup.

Blind runs against the strategist notes in the example package (Oct 22, gemini-3.8-flash; a hit is an AI note within 6 s of a strategist's):

| Cut | Strategist notes | AI notes | Hits | Precision |
|---|---|---|---|---|
| Bound to the Demon King, Ep 04 v1 | 12 | 7 | 5 (42%) | 71% |
| The Villain's Therapist, Ep 01 v1 | 24 | 9 | 9 (38%) | 100% |
| The Haunted Crew, Ep 01 v2 | 38 | 8 | 8 (21%) | 100% |

On Episode 04 v2 the AI assessed all 12 carried notes, relocated each, and called 7 fixed and 5 not fixed. A review takes 80 to 130 s and costs $0.05 to $0.07 at list price; `npm run eval:examples` reproduces the numbers.

## What I left out and why

Roles and login: one reviewer on one machine; roles would touch every write path for no gain in the round itself. Series memory: the bible covers the fixed facts; real memory needs per-episode summaries fed into later reviews, which belongs in the next step rather than half built. Chat with the AI: a note you cannot act on is noise, so the interface is the structured note. Deployment: the brief asks for a local run, 100 MB uploads sit badly on serverless limits, and a hosted free key would serve other people's cuts under terms meant for its holder. The AI writes at most 20 notes per cut, which caps recall on a rough cut with 38 strategist notes; precision stayed at 100% there, so the cap is the next knob, not the rubric.

## What I'd do next

Series memory: on approval, store a short AI summary (who knows what, open threads, wounds and props) and send earlier summaries with the next episode's review. A second pass at a higher frame rate around flagged moments for frame-accurate continuity. Learn from triage: kept, edited and deleted drafts are labelled data for the prompt, and later a small ranker. Match the strategists' voice, which is shorter and blunter than the AI's. Roles and a shared database once more than one person reviews.
