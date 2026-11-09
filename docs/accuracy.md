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

Walk a cut's strategist notes in time order; a note joins the open moment if it is within 4 s of that moment's FIRST note, otherwise it opens a new moment. Time only, no labels. A moment's family set is the union of its notes' hand-labelled topic families. A moment is observable if any of its notes is labelled observable or unclear; a moment whose notes are all direction or needs-context forms the ceiling slice (reported, never the headline). Under this rule the dev set has 58 moments (37 observable, 21 in the ceiling slice) and the held-out set 38 (32 observable, 6 in the ceiling slice); The Haunted Crew E01 v2 alone has 17.

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

- Strategist labels: one entry per note with cut, time, topic family and kind. Families: clarity, story-logic, pacing, continuity, delivery, sound, character, emotion, hook, ending, other. Kind rule: observable = a first-time viewer given this cut, the bible and the cast could point at a frame or sound and agree it is a problem; direction = a taste or story preference with no defect on screen; needs-context = requires earlier episodes or production intent; unclear = cannot decide. How they were made: a keyword scaffold proposed a family per note; families and kinds were then assigned from the note text alone, in one pass, without watching the cuts and without a second person checking them, before any scored round-2 call. 38 of the 138 keyword proposals were changed in that pass (28%). A kind the text alone could not decide is unclear (5 notes). Because no one watched the cuts to label them, the observable slice is a text-based estimate; the headline does not depend on kinds.
- The label file lives outside the repository (`eval/labels/strategist-labels.json`, git-ignored) and carries no note text; it travels only in the emailed bundle. Its SHA-256 is recorded here: `b2ab932a53aaff3b7b7e2864510560fc09ffa8da76d912b117d05d0ea71b0fbe` (138 labels: 86 dev, 47 held-out, 5 on the carried-source cut Everyone But Her E12 v1). Later corrections go in a separate corrections file and the headline is reported with and without them.
- Judgment files (validity, pair labels, verdict labels, guard samples) are separate from the strategist labels, also outside the repository, also in the bundle.

### P15. Known app-eval differences

The app sends carried notes with their real category and severity; the evaluation sends them as `other` / `medium`. The app sends the notes already on the cut as ALREADY NOTED; the evaluation sends none. The app picks exemplars from the same series first; the evaluation picks from dev cuts of other series only. Parity is not claimed; the evaluation measures the model and the prompt, the app adds triage.

### P16. Quota facts as understood at this commit

About 20 generateContent calls per Pacific day per Flash model on the free tier (3.7 and 3.8 Flash share one quota); failed calls are assumed to count; the quota resets at midnight Pacific, 12:00 Tbilisi while the US is on standard time. These figures were observed in round 1 and are unverified against the provider's published table; the ledger stops every sweep at 15 calls per model per reset.

### P17. The round-1 runs under this rule (zero calls, before this commit)

The four round-1 3.8 Flash dev runs, rescored with the labels: 8 of 58 moments matched (14%, Wilson 7 to 25) against a floor of 13% (shift 13%, grid 10%), lift 0 points; time-only 41%; note-level recall 12%. Round 1 was at chance under this rule, which is the reason the definition changed.

### P18. Shakedown spike, before this commit (unscored, Flash-Lite, Bound E04 v3, 4 calls)

- The worst-case request shape (13 cast names in the enums, 24 open-note aliases, arm AB with the shot list, static media processing set explicitly) was accepted: 41 s generate, finishReason STOP, 13 blocks and 89 shot lines listed, 5 notes, 24 verdicts (the 12 synthetic aliases all came back `unclear`). No option was rejected.
- Clipping through `videoMetadata` (40 s to 85 s at 2 fps) was accepted: every note and every new timecode fell inside the span and timecodes stayed absolute, but the model treated the end of the span as the end of the episode (a cliffhanger note at 83 s). Input tokens 21054 against 25696 for the whole cut at the default rate, which is consistent with about 15 thousand tokens of video per cut at 1 frame per second. A windowed design would have to tell the model where the window sits in the episode; see docs/decisions.md D14.
- Per-part media resolution "medium" on the video part gave exactly the input token count of the default request (25696 in both). As sent, the medium resolution arm is a null arm and is dropped from the exploratory arms unless the request-level setting behaves differently; that is a zero-cost check to run on Flash-Lite before any resolution arm is reported.
- On this cut every arm-AB note sat at a listed shot start (shot-start share 100%, boundary share 20%, one note outside its block). This is the diagnostic that step 2 reads on the dev set before the schema can be kept.

## Later additions

(Appended after the pre-registration, each marked with what it adds.)

- Added after `prereg-1`, 2026-11-04, verified quota (amends P16): AI Studio's rate-limit view for this key, 28-day peak usage, shows 3.8 Flash and 3.6 Flash at 20 requests per day, 5 per minute and 250K input tokens per minute each, and Flash-Lite at 500 requests per day, 15 per minute and 250K tokens per minute. The Oct 22 peaks read 22 of 20 on 3.8 Flash and 21 of 20 on 3.6 Flash, which confirms that failed calls count against the day. P16 understated the Flash-Lite quota; the ledger reserve for Flash-Lite is raised to 100 calls per Pacific day, the Flash reserves stay at 15. Nothing in the protocol changes.
- Added after `prereg-1`, 2026-11-04, echoed carried notes (amends P5 in one direction): on Bound E04 v2, arm AB on Flash-Lite answered every one of the 12 carried notes with `not_fixed` and wrote a new note within 2 s of each new timecode, despite the instruction not to. Such a note is the carried note restated, not a second claim: it cannot cover a second moment (matching is one to one) but it would inflate the hit-source count, the validity denominator and the chance floor. From this point the scorer drops a note that lies within 2 s of the new timecode of a `not_fixed` verdict from the hit sources, prints the count per cut as "echo", and `--keep-echoes` restores the P5 reading; every table states which reading it uses. This is conservative for coverage (the matched count cannot rise) and is reported with and without on the held-out run. The app will drop the same notes at ingestion, counted, so a strategist never sees a carried note twice.
- Added 2026-11-06, exploratory observations on Flash-Lite (The Haunted Crew E01 v2, baseline text, one call each; closes the resolution question of P18): frame rate 2 gives 25811 input tokens against 19995 at the default and 2 notes (3 at the default); frame rate 3 gives 31553 tokens and 2 notes; medium resolution gives exactly 19995 tokens, so it is a null arm as sent; thinking "high" shows zero thought tokens on this model and 3 notes. None is a lever on this model, and a single call on one cut carries no lift worth printing.
- Added 2026-11-06, the arms on 3.6 Flash (P12 applied; the numbers are in docs/decisions.md D13): baseline 6 of 58 (10%, floor 11%), arm A 7 (12%, floor 13%), arm AB 9 (16%, floor 14%); 20 to 23 notes over the four cuts in every arm. Neither arm meets the keep rule. A fourth arm, a problem slot per listed shot (AC), was screened on Flash-Lite and dropped (D24).
- Added 2026-11-06, windowed passes measured on Flash-Lite (D25; adds a measured row to what D14 had only described): 23 calls for the four dev cuts, notes per cut 17, 18, 12 and 16, 15 of 58 moments (26%, Wilson 16 to 38) against a floor of 25%, lift 1 to 2 points. The runner mode is `--windows`; a windowed run has its own prompt version.
- Added 2026-11-06, the validity guard (amends P9 and P12; D27): the 15-note guard is judged only for an arm that passes the coverage rule, because it decides nothing for an arm the rule already drops; no arm has passed it, so no guard was judged. The frozen configuration's validity is measured in full on the held-out run as P9 requires.
- Added 2026-11-06, the freeze (P13 applied; D28): the frozen configuration is arm P with 0 exemplars, prompt version `a8a8b0e6`, default sampling, on 3.6 Flash with `--pin`. No lever met the keep rule of P12: on 3.6 Flash the baseline matched 6 of 58 dev moments (floor 11%), arm A 7 (floor 13%), arm AB 9 (floor 14%), arm A with 15 exemplars 5 (floor 16%); on Flash-Lite arm AC 3 (floor 4%) and windowed passes 15 (floor 25%). The frozen version is the one the app ships (`DEFAULT_PROMPT_CONFIG`). The held-out run 1 label is `frozen`; run 2, if quota allows, `frozen-r2`; the dev spread of the frozen configuration `frozen-dev-r2`; the series-memory run on Bound E06 v2 `series-memory`. One more app-eval difference for P15: the app falls through its model list on overload, the evaluation pins one model.
- Added 2026-11-06, the reporting model (amends P13; D26): the held-out run is made on 3.6 Flash with `--pin`, because the ledger shows 3.8 Flash answering 0 of 33 calls between 2026-11-04 16:06 and 2026-11-06 17:15 Tbilisi (3.6 Flash 13 of 37, Flash-Lite 53 of 63). Every other line of P13 stands. If 3.8 Flash answers later, its table is added beside the 3.6 table and does not replace it.

- Added 2026-11-07, held-out run 1 (P13 as amended; 4 successful calls on 3.6 Flash after 5 overloaded ones, the last at 13:44 Tbilisi): 4 or 5 notes per cut, 23 hit sources; automatic coverage 2 of 38 moments (5%, Wilson 1 to 17) against a floor of 11%, lift -5 points; confirmed by watching 1 of 38 (3%, Wilson 0 to 13, bootstrap over cuts 0 to 11). The one confirmed match is the `not_fixed` verdict on a carried note of Everyone But Her E12 v2; excluding carried-derived hits the confirmed coverage is 0 of 38. No cross-category pair was recovered (0 of 8 candidates). Missed moments: 36, of which 30 observable; by family clarity 6, delivery 6, continuity 5, story logic 4.
- Added 2026-11-10, the scope of the held-out judgments (amends P9, P10 and P14; D29): only the labels that decide confirmed coverage were made, the 2 time-matched pairs (1 same, 1 related) and the 8 cross-category candidates (0 same). The validity of the 23 hit sources and the 36 verdicts on carried notes were not judged. The decision was made after the automatic held-out number was printed and before any label was written; at that point the confirmed figure could not exceed 10 of 38 (26%) whatever the labels. Seven of the ten labels were decided from the two note texts, which describe different problems; three by watching. Consequences: validity is reported as not judged, so the headline sentence carries no validity clause and says so; verdict agreement is reported only as the automatic evidence rate (1 of the 5 `not_fixed` verdicts has a strategist note in the same family within 6 s of its new timecode); "reached 70%" and "consistent with 70%" cannot be said.
- Added 2026-11-08, held-out run 2 and the spread (P11): run 2 on the held-out cuts matched 2 of 38 (5%) against a floor of 11%, not judged, reported beside run 1 and never averaged in. The frozen configuration's second run on the tuning cuts matched 3 of 58 (5%, floor 10%) against 6 of 58 (10%, floor 10%) in run 1: a run-to-run spread of 5 points pooled and up to 22 points on one cut (Bound E04 v2, 2 of 9 then 0 of 9). Series memory (D28 labels; same-series notes added for Bound E06 v2 only): 1 of 12 moments (8%, floor 8%) against 0 of 12 in held-out run 1, one call, outside the headline.
- Added 2026-11-10, 3.8 Flash (D26 follow-up): after 0 of 33 calls between Nov 4 and Nov 6, it answered 3 tuning cuts of the frozen configuration on Nov 7 (Bound E04 v1 and v2, Haunted Crew E01 v2): 9 of 36 moments (25%, Wilson 14 to 41) against a floor of 17%, lift 8 points. The fourth tuning cut and the held-out cuts got no answer through the Nov 8 reserve; the ledger shows 3 of 74 calls answered on 3.8 Flash since Nov 4 (3.6 Flash 29 of 60, Flash-Lite 57 of 67). The 3.8 rows are a side table on three tuning cuts, not a held-out result.
- Added 2026-11-10, scorer changes after the held-out run (no number in the tables moved; the scorer at the freeze commit prints the same tuning figures): the judgment export accepts an empty cell as "not judged" instead of refusing the file; confirmed figures are computed only for the cuts a judgment file covers, since the frozen configuration's tuning runs share its group key and were never judged; `--report` writes one table per set, so tuning and held-out cuts of one configuration are never pooled. The prose figures added on 2026-11-06 were computed with an earlier scorer build and differ from the regenerated tables by up to 2 points in the floor (baseline floor 11% there, 10% in the tables; arm A 13% there, 11% here); no decision depends on the difference, and the tables below are the reference.

## Method in full

The scorer (`scripts/eval/score.mts`) replays every saved run under `data/eval/` with zero calls. For each run it builds the moments from the package's `notes.json` and the label file, the hit sources from the run's normalized notes and verdicts, the greedy matching, the two floors, the sensitivity grid, the miss list by family and kind, the verdict evidence rate, the signed offsets of matched pairs and the arm-AB diagnostics (the share of timecodes within 0.5 s of a 10 s boundary, the share at a listed shot start, notes outside their block). With a judgment file for the run's group it adds confirmed coverage, validity and verdict agreement. `--report` regenerates the tables below.

Reproduction: `npm run eval:score` over the saved runs reproduces every table exactly; `npm run eval:run -- --set dev --model gemini-3.6-flash --pin` lands within the measured run-to-run spread (the seed is 1000 plus the run index, so run 1 sends the same request again and run 2 is a different draw; temperature stays at its default).

Cost line: list prices as read from the provider's pricing page on 2026-10-19 (3.8 Flash and 3.6 Flash: $0.75 per million input tokens, $3.75 per million output tokens including thoughts; Flash-Lite: $0.30 and $2.50). The provider has announced that the 3.8 and 3.6 Flash rates double on 2027-01-01. The free tier bills $0.

## Tables

<!-- eval:score tables start -->

Generated by `npm run eval:score -- --report` (window 6 s, anchor 4 s). Counts and percentages only.

### gemini-3.5-flash-lite, prompt c610cd0d (round-1), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 2 | 0 | 2 | 12 | 10 | 1 | 10% | 1% / 0% | 9 | 10% | 8% | n/a | n/a |
| Bound to the Demon King/Episode 04/v2 | 5 | 2 | 8 | 12 | 9 | 0 | 0% | 8% / 11% | -11 | 33% | 0% | n/a | n/a |
| Pooled (micro) | 7 | 2 | 10 | 24 | 19 | 1 | 5% (95% 1 to 25) | 5% / 5% | 0 | 21% | 4% | n/a | |

Macro (mean of per-cut coverage): 5%. Observable moments: 7%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 0%; window 3 s, anchor 4 s: 0%; window 6 s, anchor 0 s: 5%; window 6 s, anchor 4 s: 5%; window 10 s, anchor 0 s: 5%; window 10 s, anchor 4 s: 5%.

### gemini-3.5-flash-lite, prompt cbebfa12 (round-1), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 5 | 0 | 5 | 12 | 10 | 0 | 0% | 3% / 10% | -10 | 30% | 0% | n/a | n/a |
| Pooled (micro) | 5 | 0 | 5 | 12 | 10 | 0 | 0% (95% 0 to 28) | 3% / 10% | -10 | 30% | 0% | n/a | |

Macro (mean of per-cut coverage): 0%. Observable moments: 0%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 0%; window 3 s, anchor 4 s: 0%; window 6 s, anchor 0 s: 0%; window 6 s, anchor 4 s: 0%; window 10 s, anchor 0 s: 10%; window 10 s, anchor 4 s: 10%.

### gemini-3.6-flash, prompt cbebfa12 (round-1), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 8 | 0 | 8 | 12 | 10 | 4 | 40% | 11% / 10% | 29 | 60% | 33% | n/a | n/a |
| Bound to the Demon King/Episode 04/v2 | 4 | 0 | 12 | 12 | 9 | 2 | 22% | 15% / 11% | 7 | 44% | 17% | n/a | n/a |
| The Haunted Crew/Episode 01/v2 | 5 | 0 | 5 | 38 | 17 | 2 | 12% | 9% / 24% | -12 | 24% | 5% | n/a | n/a |
| Pooled (micro) | 17 | 0 | 25 | 62 | 36 | 8 | 22% (95% 12 to 38) | 11% / 17% | 6 | 39% | 13% | n/a | |

Macro (mean of per-cut coverage): 25%. Observable moments: 25%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 11%; window 3 s, anchor 4 s: 17%; window 6 s, anchor 0 s: 17%; window 6 s, anchor 4 s: 22%; window 10 s, anchor 0 s: 17%; window 10 s, anchor 4 s: 25%.

### gemini-3.5-flash, prompt 3f0bef42 (round-1), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 9 | 0 | 9 | 12 | 10 | 3 | 30% | 21% / 30% | 0 | 50% | 17% | n/a | n/a |
| Pooled (micro) | 9 | 0 | 9 | 12 | 10 | 3 | 30% (95% 11 to 60) | 21% / 30% | 0 | 50% | 17% | n/a | |

Macro (mean of per-cut coverage): 30%. Observable moments: 38%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 20%; window 3 s, anchor 4 s: 20%; window 6 s, anchor 0 s: 20%; window 6 s, anchor 4 s: 30%; window 10 s, anchor 0 s: 50%; window 10 s, anchor 4 s: 60%.

### gemini-3.5-flash-lite, prompt 6599019d (round-1), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| The Haunted Crew/Episode 01/v2 | 4 | 0 | 4 | 38 | 17 | 2 | 12% | 4% / 6% | 6 | 24% | 5% | n/a | n/a |
| Pooled (micro) | 4 | 0 | 4 | 38 | 17 | 2 | 12% (95% 3 to 34) | 4% / 6% | 6 | 24% | 5% | n/a | |

Macro (mean of per-cut coverage): 12%. Observable moments: 12%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 0%; window 3 s, anchor 4 s: 6%; window 6 s, anchor 0 s: 6%; window 6 s, anchor 4 s: 12%; window 10 s, anchor 0 s: 6%; window 10 s, anchor 4 s: 18%.

### gemini-3.8-flash, prompt 6599019d (round-1), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 7 | 0 | 7 | 12 | 10 | 2 | 20% | 20% / 10% | 0 | 50% | 25% | n/a | n/a |
| Bound to the Demon King/Episode 04/v2 | 4 | 1 | 8 | 12 | 9 | 0 | 0% | 8% / 0% | -8 | 33% | 0% | n/a | n/a |
| The Haunted Crew/Episode 01/v2 | 8 | 0 | 8 | 38 | 17 | 4 | 24% | 23% / 29% | -6 | 41% | 13% | n/a | n/a |
| The Villain's Therapist/Episode 01/v1 | 9 | 0 | 9 | 24 | 22 | 2 | 9% | 5% / 0% | 4 | 41% | 8% | n/a | n/a |
| Pooled (micro) | 28 | 1 | 32 | 86 | 58 | 8 | 14% (95% 7 to 25) | 13% / 10% | 1 | 41% | 12% | n/a | |

Macro (mean of per-cut coverage): 13%. Observable moments: 14%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 10%; window 3 s, anchor 4 s: 14%; window 6 s, anchor 0 s: 12%; window 6 s, anchor 4 s: 14%; window 10 s, anchor 0 s: 12%; window 10 s, anchor 4 s: 16%.

### gemini-3.5-flash-lite, prompt 559f0a86 (spike-default, arm-A), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 4 | 0 | 4 | 12 | 10 | 0 | 0% | 6% / 10% | -10 | 20% | 0% | n/a | 22.4 |
| Bound to the Demon King/Episode 04/v2 | 5 | 3 | 5 | 12 | 9 | 0 | 0% | 4% / 11% | -11 | 11% | 0% | n/a | 23.9 |
| The Haunted Crew/Episode 01/v2 | 3 | 0 | 3 | 38 | 17 | 3 | 18% | 4% / 0% | 14 | 18% | 5% | n/a | 11.5 |
| The Villain's Therapist/Episode 01/v1 | 3 | 0 | 3 | 24 | 22 | 2 | 9% | 3% / 0% | 6 | 9% | 8% | n/a | 21.5 |
| Pooled (micro) | 15 | 3 | 15 | 86 | 58 | 5 | 9% (95% 4 to 19) | 4% / 3% | 5 | 14% | 5% | n/a | |

Macro (mean of per-cut coverage): 7%. Observable moments: 11%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 2%; window 3 s, anchor 4 s: 3%; window 6 s, anchor 0 s: 5%; window 6 s, anchor 4 s: 9%; window 10 s, anchor 0 s: 10%; window 10 s, anchor 4 s: 14%.

### gemini-3.5-flash-lite, prompt a8a8b0e6 (arm-P), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 3 | 0 | 3 | 12 | 10 | 2 | 20% | 9% / 20% | 0 | 20% | 17% | n/a | 26.7 |
| Bound to the Demon King/Episode 04/v2 | 6 | 1 | 6 | 12 | 9 | 1 | 11% | 7% / 0% | 4 | 11% | 8% | n/a | 46.2 |
| The Haunted Crew/Episode 01/v2 | 3 | 0 | 3 | 38 | 17 | 2 | 12% | 3% / 0% | 9 | 18% | 5% | n/a | 29.7 |
| The Villain's Therapist/Episode 01/v1 | 6 | 0 | 6 | 24 | 22 | 1 | 5% | 4% / 5% | 0 | 27% | 4% | n/a | 22.4 |
| Pooled (micro) | 18 | 1 | 18 | 86 | 58 | 6 | 10% (95% 5 to 21) | 5% / 5% | 5 | 21% | 7% | n/a | |

Macro (mean of per-cut coverage): 12%. Observable moments: 14%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 5%; window 3 s, anchor 4 s: 7%; window 6 s, anchor 0 s: 9%; window 6 s, anchor 4 s: 10%; window 10 s, anchor 0 s: 9%; window 10 s, anchor 4 s: 10%.

### gemini-3.5-flash-lite, prompt 9a4f1302 (arm-AB), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 4 | 0 | 4 | 12 | 10 | 1 | 10% | 9% / 10% | 0 | 30% | 8% | n/a | 33.4 |
| Bound to the Demon King/Episode 04/v2 | 12 | 12 | 12 | 12 | 9 | 3 | 33% | 18% / 11% | 15 | 67% | 25% | n/a | 45.5 |
| The Haunted Crew/Episode 01/v2 | 2 | 0 | 2 | 38 | 17 | 1 | 6% | 2% / 0% | 4 | 12% | 3% | n/a | 18.8 |
| The Villain's Therapist/Episode 01/v1 | 2 | 0 | 2 | 24 | 22 | 2 | 9% | 4% / 9% | 0 | 9% | 8% | n/a | 36 |
| Pooled (micro) | 20 | 12 | 20 | 86 | 58 | 7 | 12% (95% 6 to 23) | 6% / 7% | 5 | 22% | 8% | n/a | |

Macro (mean of per-cut coverage): 15%. Observable moments: 14%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 7%; window 3 s, anchor 4 s: 9%; window 6 s, anchor 0 s: 9%; window 6 s, anchor 4 s: 12%; window 10 s, anchor 0 s: 10%; window 10 s, anchor 4 s: 12%.

### gemini-3.6-flash, prompt a8a8b0e6 (baseline-purged, frozen), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 5 | 0 | 5 | 12 | 10 | 2 | 20% | 11% / 10% | 9 | 40% | 17% | n/a | 66.2 |
| Bound to the Demon King/Episode 04/v2 | 3 | 0 | 10 | 12 | 9 | 2 | 22% | 11% / 0% | 11 | 44% | 17% | n/a | 40.2 |
| The Haunted Crew/Episode 01/v2 | 8 | 0 | 8 | 38 | 17 | 2 | 12% | 18% / 18% | -6 | 47% | 5% | n/a | 55.3 |
| The Villain's Therapist/Episode 01/v1 | 5 | 0 | 5 | 24 | 22 | 0 | 0% | 4% / 5% | -5 | 18% | 0% | n/a | 60.3 |
| Pooled (micro) | 21 | 0 | 28 | 86 | 58 | 6 | 10% (95% 5 to 21) | 10% / 9% | 0 | 34% | 7% | n/a | |

Macro (mean of per-cut coverage): 13%. Observable moments: 16%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 5%; window 3 s, anchor 4 s: 7%; window 6 s, anchor 0 s: 9%; window 6 s, anchor 4 s: 10%; window 10 s, anchor 0 s: 12%; window 10 s, anchor 4 s: 14%.

### gemini-3.6-flash, prompt a8a8b0e6 (baseline-purged, frozen), run 1, test

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 06/v2 | 5 | 0 | 5 | 16 | 12 | 0 | 0% | 4% / 8% | -8 | 25% | 0% | n/a | 38.5 |
| Everyone But Her/Episode 12/v2 | 4 | 1 | 5 | 7 | 5 | 1 | 20% | 11% / 20% | 0 | 20% | 14% | n/a | 82.2 |
| Everyone But Her/Episode 12/v3 | 4 | 1 | 8 | 14 | 12 | 1 | 8% | 8% / 17% | -8 | 33% | 7% | n/a | 65.7 |
| The Villain's Therapist/Episode 01/v2 | 5 | 0 | 5 | 10 | 9 | 0 | 0% | 1% / 0% | -1 | 0% | 0% | n/a | 49.1 |
| Pooled (micro) | 18 | 2 | 23 | 47 | 38 | 2 | 5% (95% 1 to 17) | 5% / 11% | -5 | 21% | 4% | n/a | |

Macro (mean of per-cut coverage): 7%. Observable moments: 6%.

Confirmed by watching: 1 of 38 moments, 3% (Wilson 0 to 13; bootstrap over cuts 0 to 11). Observable slice 3%. Hits from carried-derived sources: 1; excluding them 0%. Cross-category pairs recovered by the human check: 0.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 3%; window 3 s, anchor 4 s: 3%; window 6 s, anchor 0 s: 5%; window 6 s, anchor 4 s: 5%; window 10 s, anchor 0 s: 8%; window 10 s, anchor 4 s: 8%.

### gemini-3.6-flash, prompt 559f0a86 (arm-A), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 6 | 0 | 6 | 12 | 10 | 2 | 20% | 13% / 20% | 0 | 50% | 17% | n/a | 52 |
| Bound to the Demon King/Episode 04/v2 | 2 | 0 | 9 | 12 | 9 | 1 | 11% | 12% / 22% | -11 | 33% | 8% | n/a | 41.7 |
| The Haunted Crew/Episode 01/v2 | 5 | 0 | 5 | 38 | 17 | 3 | 18% | 13% / 6% | 5 | 29% | 8% | n/a | 143.8 |
| The Villain's Therapist/Episode 01/v1 | 7 | 0 | 7 | 24 | 22 | 1 | 5% | 7% / 0% | -2 | 32% | 4% | n/a | 57.7 |
| Pooled (micro) | 20 | 0 | 27 | 86 | 58 | 7 | 12% (95% 6 to 23) | 11% / 9% | 1 | 34% | 8% | n/a | |

Macro (mean of per-cut coverage): 13%. Observable moments: 16%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 5%; window 3 s, anchor 4 s: 7%; window 6 s, anchor 0 s: 9%; window 6 s, anchor 4 s: 12%; window 10 s, anchor 0 s: 10%; window 10 s, anchor 4 s: 16%.

### gemini-3.5-flash-lite, prompt 52b78312 (arm-A-ex15), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 4 | 0 | 4 | 12 | 10 | 0 | 0% | 8% / 10% | -10 | 20% | 0% | n/a | 23.3 |
| Bound to the Demon King/Episode 04/v2 | 3 | 5 | 13 | 12 | 9 | 3 | 33% | 22% / 44% | -11 | 78% | 25% | n/a | 38.2 |
| The Haunted Crew/Episode 01/v2 | 9 | 0 | 9 | 38 | 17 | 5 | 29% | 22% / 29% | 0 | 53% | 13% | n/a | 13.4 |
| The Villain's Therapist/Episode 01/v1 | 3 | 0 | 3 | 24 | 22 | 2 | 9% | 2% / 0% | 7 | 14% | 8% | n/a | 20.7 |
| Pooled (micro) | 19 | 5 | 29 | 86 | 58 | 10 | 17% (95% 10 to 29) | 12% / 17% | 0 | 36% | 12% | n/a | |

Macro (mean of per-cut coverage): 18%. Observable moments: 22%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 10%; window 3 s, anchor 4 s: 16%; window 6 s, anchor 0 s: 10%; window 6 s, anchor 4 s: 17%; window 10 s, anchor 0 s: 14%; window 10 s, anchor 4 s: 19%.

### gemini-3.6-flash, prompt 9a4f1302 (arm-AB), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 6 | 0 | 6 | 12 | 10 | 2 | 20% | 12% / 10% | 8 | 40% | 17% | n/a | 57.6 |
| Bound to the Demon King/Episode 04/v2 | 4 | 0 | 10 | 12 | 9 | 1 | 11% | 16% / 22% | -11 | 56% | 8% | n/a | 85.6 |
| The Haunted Crew/Episode 01/v2 | 8 | 0 | 8 | 38 | 17 | 5 | 29% | 20% / 24% | 6 | 47% | 11% | n/a | 46.9 |
| The Villain's Therapist/Episode 01/v1 | 5 | 0 | 5 | 24 | 22 | 1 | 5% | 5% / 5% | 0 | 23% | 4% | n/a | 50.9 |
| Pooled (micro) | 23 | 0 | 29 | 86 | 58 | 9 | 16% (95% 8 to 27) | 12% / 14% | 2 | 38% | 9% | n/a | |

Macro (mean of per-cut coverage): 16%. Observable moments: 22%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 7%; window 3 s, anchor 4 s: 10%; window 6 s, anchor 0 s: 10%; window 6 s, anchor 4 s: 16%; window 10 s, anchor 0 s: 14%; window 10 s, anchor 4 s: 19%.

### gemini-3.5-flash-lite, prompt db95ec7e (fps2), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| The Haunted Crew/Episode 01/v2 | 2 | 0 | 2 | 38 | 17 | 2 | 12% | 2% / 0% | 10 | 12% | 5% | n/a | 15.9 |
| Pooled (micro) | 2 | 0 | 2 | 38 | 17 | 2 | 12% (95% 3 to 34) | 2% / 0% | 10 | 12% | 5% | n/a | |

Macro (mean of per-cut coverage): 12%. Observable moments: 12%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 0%; window 3 s, anchor 4 s: 6%; window 6 s, anchor 0 s: 6%; window 6 s, anchor 4 s: 12%; window 10 s, anchor 0 s: 6%; window 10 s, anchor 4 s: 12%.

### gemini-3.5-flash-lite, prompt 3fb8f82a (fps3), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| The Haunted Crew/Episode 01/v2 | 2 | 0 | 2 | 38 | 17 | 2 | 12% | 2% / 0% | 10 | 12% | 5% | n/a | 19.2 |
| Pooled (micro) | 2 | 0 | 2 | 38 | 17 | 2 | 12% (95% 3 to 34) | 2% / 0% | 10 | 12% | 5% | n/a | |

Macro (mean of per-cut coverage): 12%. Observable moments: 12%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 0%; window 3 s, anchor 4 s: 6%; window 6 s, anchor 0 s: 6%; window 6 s, anchor 4 s: 12%; window 10 s, anchor 0 s: 6%; window 10 s, anchor 4 s: 12%.

### gemini-3.5-flash-lite, prompt 4df8ed6d (res-medium), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| The Haunted Crew/Episode 01/v2 | 4 | 0 | 4 | 38 | 17 | 2 | 12% | 10% / 18% | -6 | 24% | 5% | n/a | 11.9 |
| Pooled (micro) | 4 | 0 | 4 | 38 | 17 | 2 | 12% (95% 3 to 34) | 10% / 18% | -6 | 24% | 5% | n/a | |

Macro (mean of per-cut coverage): 12%. Observable moments: 12%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 6%; window 3 s, anchor 4 s: 12%; window 6 s, anchor 0 s: 6%; window 6 s, anchor 4 s: 12%; window 10 s, anchor 0 s: 6%; window 10 s, anchor 4 s: 12%.

### gemini-3.5-flash-lite, prompt 7fd6ad6d (think-high), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| The Haunted Crew/Episode 01/v2 | 3 | 0 | 3 | 38 | 17 | 2 | 12% | 3% / 0% | 9 | 18% | 5% | n/a | 4.1 |
| Pooled (micro) | 3 | 0 | 3 | 38 | 17 | 2 | 12% (95% 3 to 34) | 3% / 0% | 9 | 18% | 5% | n/a | |

Macro (mean of per-cut coverage): 12%. Observable moments: 12%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 0%; window 3 s, anchor 4 s: 6%; window 6 s, anchor 0 s: 6%; window 6 s, anchor 4 s: 12%; window 10 s, anchor 0 s: 6%; window 10 s, anchor 4 s: 18%.

### gemini-3.5-flash-lite, prompt 23bcbf4a (arm-AC), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 1 | 0 | 1 | 12 | 10 | 0 | 0% | 2% / 10% | -10 | 0% | 0% | n/a | 55 |
| Bound to the Demon King/Episode 04/v2 | 2 | 2 | 4 | 12 | 9 | 1 | 11% | 5% / 0% | 6 | 33% | 8% | n/a | 23.7 |
| The Haunted Crew/Episode 01/v2 | 1 | 0 | 1 | 38 | 17 | 1 | 6% | 1% / 0% | 5 | 6% | 3% | n/a | 13.1 |
| The Villain's Therapist/Episode 01/v1 | 1 | 0 | 1 | 24 | 22 | 1 | 5% | 2% / 0% | 2 | 5% | 4% | n/a | 16 |
| Pooled (micro) | 5 | 2 | 7 | 86 | 58 | 3 | 5% (95% 2 to 14) | 2% / 2% | 3 | 9% | 3% | n/a | |

Macro (mean of per-cut coverage): 5%. Observable moments: 5%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 3%; window 3 s, anchor 4 s: 5%; window 6 s, anchor 0 s: 3%; window 6 s, anchor 4 s: 5%; window 10 s, anchor 0 s: 5%; window 10 s, anchor 4 s: 7%.

### gemini-3.6-flash, prompt 52b78312 (arm-A-ex15), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 7 | 0 | 7 | 12 | 10 | 1 | 10% | 16% / 30% | -20 | 40% | 8% | n/a | 37.7 |
| Bound to the Demon King/Episode 04/v2 | 4 | 1 | 11 | 12 | 9 | 2 | 22% | 18% / 33% | -11 | 56% | 17% | n/a | 60.7 |
| The Haunted Crew/Episode 01/v2 | 4 | 0 | 4 | 38 | 17 | 2 | 12% | 12% / 12% | 0 | 24% | 5% | n/a | 33.9 |
| The Villain's Therapist/Episode 01/v1 | 4 | 0 | 4 | 24 | 22 | 0 | 0% | 1% / 5% | -5 | 18% | 0% | n/a | 35.2 |
| Pooled (micro) | 19 | 1 | 26 | 86 | 58 | 5 | 9% (95% 4 to 19) | 9% / 16% | -7 | 29% | 6% | n/a | |

Macro (mean of per-cut coverage): 11%. Observable moments: 14%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 5%; window 3 s, anchor 4 s: 7%; window 6 s, anchor 0 s: 7%; window 6 s, anchor 4 s: 9%; window 10 s, anchor 0 s: 7%; window 10 s, anchor 4 s: 10%.

### gemini-3.5-flash-lite, prompt 714997e0 (windows-P), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 17 | 0 | 17 | 12 | 10 | 3 | 30% | 28% / 30% | 0 | 70% | 33% | n/a | 52.9 |
| Bound to the Demon King/Episode 04/v2 | 18 | 1 | 20 | 12 | 9 | 1 | 11% | 25% / 22% | -14 | 44% | 8% | n/a | 44.5 |
| The Haunted Crew/Episode 01/v2 | 12 | 0 | 12 | 38 | 17 | 6 | 35% | 17% / 29% | 6 | 65% | 16% | n/a | 25.1 |
| The Villain's Therapist/Episode 01/v1 | 16 | 0 | 16 | 24 | 22 | 5 | 23% | 20% / 18% | 3 | 55% | 21% | n/a | 64.1 |
| Pooled (micro) | 63 | 1 | 65 | 86 | 58 | 15 | 26% (95% 16 to 38) | 21% / 24% | 2 | 59% | 19% | n/a | |

Macro (mean of per-cut coverage): 25%. Observable moments: 32%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 10%; window 3 s, anchor 4 s: 19%; window 6 s, anchor 0 s: 21%; window 6 s, anchor 4 s: 26%; window 10 s, anchor 0 s: 28%; window 10 s, anchor 4 s: 36%.

### gemini-3.6-flash, prompt a8a8b0e6 (frozen-dev-r2, frozen-r2), run 2, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 6 | 0 | 6 | 12 | 10 | 2 | 20% | 10% / 20% | 0 | 30% | 8% | n/a | 82.2 |
| Bound to the Demon King/Episode 04/v2 | 2 | 0 | 10 | 12 | 9 | 0 | 0% | 11% / 0% | -11 | 33% | 0% | n/a | 67.3 |
| The Haunted Crew/Episode 01/v2 | 5 | 0 | 5 | 38 | 17 | 1 | 6% | 10% / 18% | -12 | 24% | 3% | n/a | 50.5 |
| The Villain's Therapist/Episode 01/v1 | 5 | 0 | 5 | 24 | 22 | 0 | 0% | 5% / 5% | -5 | 14% | 0% | n/a | 53.8 |
| Pooled (micro) | 18 | 0 | 26 | 86 | 58 | 3 | 5% (95% 2 to 14) | 8% / 10% | -5 | 22% | 2% | n/a | |

Macro (mean of per-cut coverage): 6%. Observable moments: 8%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 2%; window 3 s, anchor 4 s: 3%; window 6 s, anchor 0 s: 2%; window 6 s, anchor 4 s: 5%; window 10 s, anchor 0 s: 7%; window 10 s, anchor 4 s: 9%.

### gemini-3.6-flash, prompt a8a8b0e6 (frozen-dev-r2, frozen-r2), run 2, test

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 06/v2 | 4 | 0 | 4 | 16 | 12 | 0 | 0% | 5% / 8% | -8 | 17% | 0% | n/a | 62.4 |
| Everyone But Her/Episode 12/v2 | 5 | 1 | 9 | 7 | 5 | 2 | 40% | 20% / 20% | 20 | 60% | 43% | n/a | 72.8 |
| Everyone But Her/Episode 12/v3 | 4 | 1 | 7 | 14 | 12 | 0 | 0% | 7% / 8% | -8 | 33% | 0% | n/a | 31.1 |
| The Villain's Therapist/Episode 01/v2 | 4 | 1 | 6 | 10 | 9 | 0 | 0% | 6% / 11% | -11 | 22% | 0% | n/a | 33.9 |
| Pooled (micro) | 17 | 3 | 26 | 47 | 38 | 2 | 5% (95% 1 to 17) | 8% / 11% | -5 | 29% | 6% | n/a | |

Macro (mean of per-cut coverage): 10%. Observable moments: 6%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 3%; window 3 s, anchor 4 s: 3%; window 6 s, anchor 0 s: 5%; window 6 s, anchor 4 s: 5%; window 10 s, anchor 0 s: 11%; window 10 s, anchor 4 s: 11%.

### gemini-3.6-flash, prompt 45251708 (series-memory), run 1, test

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 06/v2 | 4 | 0 | 4 | 16 | 12 | 1 | 8% | 8% / 8% | 0 | 17% | 6% | n/a | 106.2 |
| Pooled (micro) | 4 | 0 | 4 | 16 | 12 | 1 | 8% (95% 1 to 35) | 8% / 8% | 0 | 17% | 6% | n/a | |

Macro (mean of per-cut coverage): 8%. Observable moments: 10%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 8%; window 3 s, anchor 4 s: 8%; window 6 s, anchor 0 s: 8%; window 6 s, anchor 4 s: 8%; window 10 s, anchor 0 s: 17%; window 10 s, anchor 4 s: 17%.

### gemini-3.8-flash, prompt a8a8b0e6 (baseline-purged), run 1, dev

| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bound to the Demon King/Episode 04/v1 | 7 | 0 | 7 | 12 | 10 | 3 | 30% | 19% / 10% | 11 | 30% | 25% | n/a | 172.8 |
| Bound to the Demon King/Episode 04/v2 | 3 | 0 | 7 | 12 | 9 | 1 | 11% | 7% / 0% | 4 | 44% | 8% | n/a | 93 |
| The Haunted Crew/Episode 01/v2 | 7 | 0 | 7 | 38 | 17 | 5 | 29% | 21% / 29% | 0 | 35% | 13% | n/a | 122.7 |
| Pooled (micro) | 17 | 0 | 21 | 62 | 36 | 9 | 25% (95% 14 to 41) | 17% / 17% | 8 | 36% | 15% | n/a | |

Macro (mean of per-cut coverage): 24%. Observable moments: 28%.

Sensitivity (automatic coverage): window 3 s, anchor 0 s: 14%; window 3 s, anchor 4 s: 19%; window 6 s, anchor 0 s: 17%; window 6 s, anchor 4 s: 25%; window 10 s, anchor 0 s: 17%; window 10 s, anchor 4 s: 25%.

<!-- eval:score tables end -->
