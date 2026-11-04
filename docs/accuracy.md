# Accuracy: definition, protocol and results

This document is in two parts. The first part, "Pre-registration", was committed and pushed (tag `prereg-1`) before any scored round-2 call was made, and is not edited afterwards; anything learned later is appended below it under "Later additions" and marked as such. The second part holds the method in full and the tables that `npm run eval:score -- --report` regenerates from the saved runs with zero API calls.

## Pre-registration

Committed before any scored round-2 call. Tag `prereg-1`. The label file hash is at the end of this section.

### P1. What is measured

The strategists' timecoded notes on the example package are the ground truth. The tool is scored on how many of the moments the strategists stopped the video for it also flags, at the same point and for the same reason, and on how many of its own notes are worth keeping. Nothing else about the notes (wording, severity, the suggested fix) is scored.

### P2. Split

- Dev (tuning): every cut with a saved model run from round 1: Bound to the Demon King E04 v1 (155.1 s, 12 notes), E04 v2 (157.2 s, 12 notes, carried from v1), The Haunted Crew E01 v2 (87.3 s, 38 notes), The Villain's Therapist E01 v1 (210.0 s, 24 notes). 86 notes.
- Held-out (reported): every cut with no saved model run: Everyone But Her E12 v2 (165.6 s, 7 notes, carried from v1's 5), E12 v3 (165.8 s, 14 notes, carried from v2), Bound to the Demon King E06 v2 (156.1 s, 16 notes, v1 has none), The Villain's Therapist E01 v2 (184.6 s, 10 notes, carried from v1's 24). 47 notes.
- Shakedown only, never scored: Bound to the Demon King E04 v3 (129.0 s, 0 notes of its own, carries dev notes). Used for the schema and option spike.
- Not used: every other cut (0 to 5 notes).
- The "unseen footage" slice is Everyone But Her E12 v2 and v3 plus Bound E06 v2 (37 notes), reported beside the pooled held-out number. The Villain's Therapist E01 v2 is a recut of dev footage and is disclosed as such.

### P3. Prior contact with the held-out cuts, as of this commit

- Everyone But Her E12 v2 and v3: an unseen series. No saved model run, never run in the app, never quoted in a prompt. The note counts and timestamps were read during planning; the note texts were read once, for labelling, before this commit. v3's carried input is v2's notes, which are held-out ground truth, fed as model input only after the freeze.
- Bound to the Demon King E06 v2: the same series and bible as dev E04. No saved run, never run in the app, never quoted in a prompt. v1 has no notes, so no carried input. The note texts were read once, for labelling.
- The Villain's Therapist E01 v2: a recut of dev footage (E01 v1), and its carried input is E01 v1's notes, which are dev notes. No saved run, never run in the app, never quoted in a prompt. The round-1 miss analysis that motivated the delivery and sound lens was done on E01 v1, not v2. The note texts were read once, for labelling.
- Global: the round-1 prompt's style examples paraphrased notes from Bound E04 v1 and v2 (both dev). They were replaced by invented examples before this commit; a five-word overlap scan of every tracked file against every package note prints nothing. Round-1 in-app reviews touched only Bound E04 v4 and The Haunted Crew E01 v3, which are in no set. Exemplar notes shown to the model in the evaluation come from dev cuts of other series than the cut under review, so no held-out cut sees notes from its own series in the frozen configuration.

### P4. Moments

Walk a cut's strategist notes in time order; a note joins the open moment if it is within 4 s of that moment's FIRST note, otherwise it opens a new moment. Time only, no labels. A moment's family set is the union of its notes' hand-labelled topic families. A moment is observable if any of its notes is labelled observable or unclear; a moment whose notes are all direction or needs-context forms the ceiling slice (reported, never the headline). Under this rule the dev set has 58 moments and the held-out set about 38; The Haunted Crew E01 v2 alone has 17.

### P5. Hit sources

Every AI note; and, on v2 and later, the `newTimecode` of every `not_fixed` verdict on a carried note, taking the hand label of the carried note as its family. `unclear` and `fixed` verdicts are never hit sources. Every hit source enters the validity denominator. (A `restates` note type was considered and not built; see docs/decisions.md.)

### P6. Matching

Candidate pairs are (hit source, moment) with the source within 6 s of any note of the moment and the source's family in the moment's family set. Pairs are assigned greedily by distance, ties to the earlier hit source, one source per moment and one moment per source. The family map, written once in `scripts/eval/score.mts`:

| AI category | May match strategist families |
|---|---|
| clarity | clarity, story-logic |
| pacing | pacing |
| continuity | continuity |
| character | character, emotion |
| performance | delivery, emotion, sound |
| sound | sound, delivery |
| hook, cliffhanger | hook, ending |

The AI never files `other` (a human-only category). Labels are joined to notes by cut and the float `time` field. Rendering artefacts (a pasted-in or morphing figure) are labelled continuity; abrupt transitions pacing; "where are we", "whose camera" and "what is this" clarity; "how does she know" story-logic.

### P7. Coverage

- Automatic coverage = matched moments / moments, micro-pooled (all moments of the set in one ratio); macro (the mean of per-cut rates) beside it.
- Headline = confirmed coverage on held-out run 1: moments whose matched pair the user judged "same" (same shot, same problem), divided by ALL held-out moments, micro, with its Wilson 95% interval.
- Reported beside it: automatic coverage with its floor; confirmed coverage of observable moments (the ceiling paragraph); note-level recall (each strategist note on its own); the time-only match as the loose bound; the sensitivity grid (windows 3, 6, 10 s; anchor widths 0 and 4 s); the share of confirmed hits that came from carried-derived sources, as the slice "headline excluding carried-derived hits"; and the number of cross-category pairs recovered by the human check (a "same" judgment on an unmatched moment using only a source the automatic rule left unmatched).

The headline is written in one fixed sentence: "On the four held-out cuts the tool flagged C of M strategist moments at the same point for the same reason, checked by watching (X%, 95% interval L to U); by the automatic rule it matched A% against S% for evenly spaced dummy notes; V% of its own notes were worth keeping". No accuracy number appears in the write-up, the README, the PDF or the email without its floor and validity in the same sentence, and no sentence compares a confirmed number with an automatic floor.

### P8. Floors

Computed for every run from its own hit sources, with zero calls: F1 = the run's timecodes circularly shifted by a uniform random offset, 1000 draws with a fixed seed, mean matched share; F2 = an evenly spaced grid at the run's hit-source count, carrying the run's categories in time order. Every automatic coverage number is printed with max(F1 mean, F2) beside it and as lift over that floor; a lever is credited only by lift. Trigger: if on the step-1 baseline the higher floor comes within 10 points of the model on dev, or exceeds 50% on any dev cut, every automatic number is reported as lift over floor everywhere, including the headline sentence.

### P9. Validity

Each AI note and each `not_fixed` verdict used as a hit source is judged once, at its timecode, on one question: the moment exists, the claim can be checked on screen or audio, and a strategist would act on it (valid or not). Validity = valid / judged, held-out run 1, micro. "Same" and "related" pair labels affect coverage only, never validity. Items are shuffled across cuts before judging. During tuning the guard is 15 randomly sampled unmatched AI notes per dev iteration (10 for exploratory arms), judged the same way; a lever is dropped under 11 of 15 (7 of 10). The time-matched share is reported only as a loose bound.

### P10. Verdict agreement

On every carried cut, each verdict is labelled right, wrong or cannot tell by watching; reported as its own column, outside the headline, with the automatic evidence rate (a strategist note on the new cut within 6 s of the verdict's `newTimecode` in the same family).

### P11. Uncertainty

Wilson 95% interval on every micro rate; a bootstrap over cuts (2000 resamples) for the headline; run 2 reported beside run 1, never averaged in. With about 38 held-out moments, a tool whose true coverage is exactly 70% shows at least 70% only about half the time, which is why this document promises a pre-registered number with an interval, not "at least 70%".

"Reached 70%" is said only if run 1's confirmed coverage of all held-out moments is at least 70% AND run 1's validity is at least 70%. "Consistent with 70%" may be said when the interval contains 70. If run 2 falls under 70, the same paragraph says so.

Degenerate cases: a run with zero AI notes counts as 0% coverage and validity n/a; a cut with an empty slice is left out of that slice's macro mean and the exclusion is printed.

### P12. Tuning decisions

- The baseline is the purged round-1 prompt (arm P: the round-1 text with its examples replaced, the note cap lifted) run on the dev set after this commit, on 3.6 Flash and on 3.8 Flash; every lever is judged against the baseline on the same model, never against the round-1 runs.
- Arms A (round-2 text, flat notes schema) and AB (A plus a shot list per block) run on 3.6 Flash with the same seed on all four dev cuts; the winner is confirmed on 3.8 Flash. They are attributed by mechanism (notes per cut and per block, empty-block share, boundary share, the paired per-moment table), read as direction only.
- The schema (AB) is kept only if all hold: notes per cut reach at least 12, or at least 1.5 times arm A, on 2 of the 3 dev cuts without carried notes; labelled validity at least 11 of 15; the paired difference against A is not negative and AB's lift over its floor is at least A's; generate time on the longest dev cut at most 150 s with finishReason STOP on every cut; boundary share at most 25%.
- Keep rule for every later lever: pooled micro lift over the floor, against the baseline on the same model, gains at least 10 points on one run, or at least 5 points on each of two runs of the same configuration; the gain shows on at least 3 of the 4 dev cuts; the guard passes. The result is recorded as "attributed by mechanism; coverage direction consistent or not", never as a significant gain.
- Every result, kept or dropped, goes into docs/decisions.md.

### P13. Held-out procedure

The frozen `PROMPT_VERSION` is pushed in a second commit before the run. Held-out runs use 3.8 Flash with `--pin` (no fallback model). Run 1 is the headline. A call that errors, times out or returns invalid JSON is resumed with identical configuration and logged in the ledger; a completed run is never rerun. Nothing in this section changes after the first held-out call. Run 2, if quota allows, is reported beside run 1.

### P14. Labels

- Strategist labels: one entry per note with cut, time, topic family and kind. Families: clarity, story-logic, pacing, continuity, delivery, sound, character, emotion, hook, ending, other. Kind rule: observable = a first-time viewer given this cut, the bible and the cast could point at a frame or sound and agree it is a problem; direction = a taste or story preference with no defect on screen; needs-context = requires earlier episodes or production intent; unclear = cannot decide. A keyword scaffold proposes a family and marks it so the correction rate can be stated; it never proposes a kind. The labels were written before any scored round-2 call.
- The label file lives outside the repository (`eval/labels/strategist-labels.json`, git-ignored) and carries no note text; it travels only in the emailed bundle. Its SHA-256 is recorded here: `<label hash: filled by npm run eval:score -- --export-labels>`. Later corrections go in a separate corrections file and the headline is reported with and without them.
- Judgment files (validity, pair labels, verdict labels, guard samples) are separate from the strategist labels, also outside the repository, also in the bundle.

### P15. Known app-eval differences

The app sends carried notes with their real category and severity; the evaluation sends them as `other` / `medium`. The app sends the notes already on the cut as ALREADY NOTED; the evaluation sends none. The app picks exemplars from the same series first; the evaluation picks from dev cuts of other series only. Parity is not claimed; the evaluation measures the model and the prompt, the app adds triage.

### P16. Quota facts as understood at this commit

About 20 generateContent calls per Pacific day per Flash model on the free tier (3.7 and 3.8 Flash share one quota); failed calls are assumed to count; the quota resets at midnight Pacific, 12:00 Tbilisi while the US is on standard time. These figures were observed in round 1 and are unverified against the provider's published table; the ledger stops every sweep at 15 calls per model per reset.

### P17. Shakedown spike, before this commit (unscored, Flash-Lite, Bound E04 v3, 4 calls)

- The worst-case request shape (13 cast names in the enums, 24 open-note aliases, arm AB with the shot list, static media processing set explicitly) was accepted: 41 s generate, finishReason STOP, 13 blocks and 89 shot lines listed, 5 notes, 24 verdicts (the 12 synthetic aliases all came back `unclear`). No option was rejected.
- Clipping through `videoMetadata` (40 s to 85 s at 2 fps) was accepted: every note and every new timecode fell inside the span and timecodes stayed absolute, but the model treated the end of the span as the end of the episode (a cliffhanger note at 83 s). Input tokens 21054 against 25696 for the whole cut at the default rate, which is consistent with about 15 thousand tokens of video per cut at 1 frame per second. A windowed design would have to tell the model where the window sits in the episode; see docs/decisions.md D14.
- Per-part media resolution "medium" on the video part gave exactly the input token count of the default request (25696 in both). As sent, the medium resolution arm is a null arm and is dropped from the exploratory arms unless the request-level setting behaves differently; that is a zero-cost check to run on Flash-Lite before any resolution arm is reported.
- On this cut every arm-AB note sat at a listed shot start (shot-start share 100%, boundary share 20%, one note outside its block). This is the diagnostic that step 2 reads on the dev set before the schema can be kept.

## Later additions

(Appended after the pre-registration, each marked with what it adds.)

## Method in full

The scorer (`scripts/eval/score.mts`) replays every saved run under `data/eval/` with zero calls. For each run it builds the moments from the package's `notes.json` and the label file, the hit sources from the run's normalized notes and verdicts, the greedy matching, the two floors, the sensitivity grid, the miss list by family and kind, the verdict evidence rate, the signed offsets of matched pairs and the arm-AB diagnostics (the share of timecodes within 0.5 s of a 10 s boundary, the share at a listed shot start, notes outside their block). With a judgment file for the run's group it adds confirmed coverage, validity and verdict agreement. `--report` regenerates the tables below.

Reproduction: `npm run eval:score` over the saved runs reproduces every table exactly; `npm run eval:run -- --set dev --model gemini-3.6-flash --pin` lands within the measured run-to-run spread (the seed is 1000 plus the run index, so run 1 sends the same request again and run 2 is a different draw; temperature stays at its default).

Cost line: list prices as read from the provider's pricing page on 2026-10-19 (3.8 Flash and 3.6 Flash: $0.75 per million input tokens, $3.75 per million output tokens including thoughts; Flash-Lite: $0.30 and $2.50). The provider has announced that the 3.8 and 3.6 Flash rates double on 2027-01-01. The free tier bills $0.

## Tables

<!-- eval:score tables start -->

(Not generated yet: run `npm run eval:score -- --report` after the first scored run.)

<!-- eval:score tables end -->
