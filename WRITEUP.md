# Microdrama Review Tool: write-up (round 2)

## Result

On the four held-out cuts the tool flagged 1 of 38 strategist moments at the same point for the same reason, checked by watching (3%, 95% interval 0 to 13). By the automatic rule it matched 2 of 38 (5%) against 11% for evenly spaced dummy notes. The validity of its own notes was not judged (section 1 says why). A second run on the same cuts matched 2 of 38 again.

That is far from 70%. No change I measured on the tuning cuts moved the automatic number clear of its chance floor, and the sections below show how that was established and what I would try next.

Round 1, rescored under the same rule on the four cuts it was tuned on: 8 of 58 moments (14%) against a floor of 13% for dummy notes, which is chance. Its time-only numbers (42%, 38% and 21% of notes "hit", 71% to 100% "precision") measured nothing, because an evenly spaced grid with the same number of notes scored 45% under them.

## 1. What accuracy means here and how it was measured

The strategists' timecoded notes on the example package are the ground truth. Notes within 4 s of the first note of a moment form one moment (38 notes on one 87 s cut become 17 moments; chaining them would have made 4). The tool scores a hit when one of its notes, or the new timecode of a "not fixed" verdict on a carried note, lies within 6 s of the moment and belongs to the same topic family (clarity, pacing, continuity, delivery, sound, character, emotion, hook, ending). Pairs are assigned closest first, one note per moment. Every automatic number is printed beside its chance floor: the higher of the tool's own timecodes shifted at random (1000 draws) and an evenly spaced grid with the same note count. The headline is human-confirmed: a matched pair counts only if, watching the cut, it is the same shot and the same problem.

The split is mechanical. Every cut with a saved model run from round 1 is a tuning cut (Bound E04 v1 and v2, Haunted Crew E01 v2, Villain's Therapist E01 v1; 86 notes, 58 moments). Every cut with none is held out (Everyone But Her E12 v2 and v3, Bound E06 v2, Villain's Therapist E01 v2; 47 notes, 38 moments). Prior contact with the held-out cuts is listed in docs/accuracy.md at cut level. The definition, the split, the contact list and the hash of the label file were committed and pushed (tag `prereg-1`) before any scored call, and the prompt was frozen and pushed again before the first held-out call.

Limits, stated before the numbers mattered. The topic families were assigned from note text alone, so the "observable" slice is an estimate; the headline counts all moments. With 38 moments the 95% interval is about plus or minus 15 points, so a tool whose true coverage is 70% would show 70% or more only about half the time.

Three things changed after the pre-registration, each recorded as a dated amendment in docs/accuracy.md before the result it affects was known. The pre-registered reporting model, 3.8 Flash, answered 3 of 74 calls between Nov 4 and Nov 8, so the held-out runs were made on 3.6 Flash, the fallback the plan named. A 15-note validity check per tuning arm was skipped for arms that already failed the coverage rule. And the held-out judging was cut to the 10 labels that decide confirmed coverage: once the automatic rule had matched 2 of 38, the confirmed figure could not exceed 26%, so the validity of the tool's 23 notes and its 36 verdicts on carried notes were not judged.

## 2. What round 1 got wrong

The metric could not tell the tool from a metronome: with notes 2 s apart on a rough cut, most of the timeline lies within 6 s of some note, so any timecode "hit". The code kept only the first 12 notes of an answer while the write-up said 20. The prompt asked for "10 to 25 notes" and, two lines later, said zero notes was valid and never to add a note to reach a number; the model wrote 4 to 9. Its style examples paraphrased strategist notes from Bound E04, which were then counted as test material. And the model read the bible as a rulebook (it wrote about bell boards and camera rules) where the strategists watched like a first-time viewer and wrote "whose camera is this", "what is this", "I cannot hear her".

## 3. What changed, and what each change did

Every lever was measured on the four tuning cuts against the purged round-1 prompt on the same model, with lift over the floor as the score. The keep rule, written before any of these numbers existed, was 10 points of lift with the gain on at least 3 of the 4 cuts. The frozen configuration's own run-to-run spread on these cuts is 5 points pooled (6 moments, then 3) and up to 22 points on one cut, which is the noise any lever had to beat.

| Change | Model | Notes per cut | Matched (floor) | Lift | Calls per cut | Result |
|---|---|---|---|---|---|---|
| Baseline: round-1 text, invented examples, no 12-note cap | 3.6 Flash | 3 to 8 | 10% (10%) | 0 | 1 | frozen |
| A: first-time viewer; delivery, sound, rendering, transition lenses; density target; no "zero is valid" | 3.6 Flash | 2 to 7 | 12% (11%) | 1 | 1 | dropped |
| AB: A plus a shot list per 10 s block | 3.6 Flash | 4 to 8 | 16% (14%) | 2 | 1 | dropped |
| A plus 15 team notes from other series | 3.6 Flash | 4 to 7 | 9% (16%) | -7 | 1 | dropped |
| A problem slot per listed shot | Flash-Lite | 1 to 2 | 5% (2%) | 3 | 1 | dropped |
| Windowed passes (whole cut plus 40 s windows) | Flash-Lite | 12 to 18 | 26% (24%) | 2 | 5 to 7 | not frozen |
| Baseline, three of the four cuts | 3.8 Flash | 3 to 7 | 25% (17%) | 8 | 1 | side table |
| 2 or 3 fps, medium resolution, high thinking | Flash-Lite | 2 to 3 | one cut each | none | 1 | observation |

What the table says. The note count did not move: every one-call variant wrote 1 to 8 notes per cut where strategists wrote 7 to 38. Removing "zero is valid" and asking for a note every 8 to 12 seconds did not change it, and with a shot list the model listed 44 to 66 shots per cut and still wrote 4 to 8 notes. Windowed passes did triple the notes, and the extra notes landed no better than an evenly spaced grid, so density alone is not the bottleneck. What is missing is the lens. On the held-out cuts the 36 missed moments are clarity (where are we, what is this), delivery, continuity and story logic, 30 of them visible on screen, while most of the tool's notes check shots against the rules in the series bible. The rebuilt persona aimed at exactly this and did not measurably change it. The one clear positive lift, 8 points for 3.8 Flash on three tuning cuts, comes from a model that answered 3 of 74 calls, so it is a reason to try again rather than a result.

Held-out, frozen configuration, 3.6 Flash: run 1 confirmed 1 of 38 (the match is a "not fixed" verdict on a carried note; without carried-note hits it is 0 of 38), automatic 2 of 38 under an 11% floor; run 2 automatic 2 of 38 under the same floor. Series memory, the same-series notes the frozen configuration withholds, added for Bound E06 v2 alone: 1 of 12 moments against 0 of 12, one call, outside the headline.

## 4. What I would try next, and the trade-offs behind the decisions

Ranked by expected gain over cost:
1. Narrower questions. One call per question a strategist asks (is it clear where we are and whose camera this is; does each voice sound human and in character; does each cut follow from the last), instead of one call asked to be the whole strategist. The misses cluster in exactly these families, and a narrow question is the cheapest test of whether the model can see them at all.
2. 3.8 Flash on a paid key, at about $0.05 per cut at list price: the only lift measured outside the noise, on three cuts.
3. Windowed passes with the shot list carried between windows (5 to 7 calls per cut), combined with the narrow questions: measured to triple the notes.
4. Generate then verify: a second call keeps only notes it can confirm at the timecode. It doubles the calls and raises validity rather than coverage, so it comes after coverage moves.
5. A ranker trained on the team's keep and delete triage in the app, the cheapest validity gain once strategists use the drafts.

Trade-offs. One call per cut over passes: the free tier allows 20 calls per Flash model per day, failed calls included, so passes would have cost the iteration itself. 1 frame per second: the default; on one cut 2 fps cost 29% more input tokens and wrote 2 notes instead of 3. Drafts over open notes: the AI never writes into the strategist's list unasked, at the price of triage, which this round did not price because validity was not judged. Copies over pointers for carried notes: every cut keeps its own history and its own verdict. SQLite and local disk: one key is the whole setup. The free tier's terms allow the provider to use inputs to improve its products, which is why production belongs on a paid key; a full sweep of the package costs about $1.2 to $1.5 at list price with the round-1 prompt.

## What the tool is

One Next.js app with SQLite runs the review round end to end: the AI reviews a cut in one request, its notes land as drafts the strategist keeps or deletes, the next cut carries open notes forward with fixed or not-fixed verdicts, and approval waits for zero open notes. `npm run eval:score` reproduces every number here from the saved runs with no API call.
