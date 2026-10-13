# Mündu parameter-space findings

150 sampled configurations × six vocabulary sizes × four retrieval intervals = **3,600 deterministic runs**. **870 completed (24.2%); 2,730 reached the one-hour limit.**

## Experiment and reproducibility

Ranges: kick 15/25/35/45/55 percentage points; top speed 0.1/0.3/0.5/0.7/1.0 percentage points/second; bottom speed 0.5/1.0/1.5/2.0/3.0 percentage points/second; completion 60/70/80/90%.
500 Cartesian combinations exist; 40 with bottom speed below top speed are excluded, leaving 460. Seed 20261012 selects 150 without replacement after a full Fisher–Yates shuffle. It is a dispersed sample, not the first 150 or a ranking by completion speed.
Every run uses the unmodified normalized physics engine, lowest active word, successful answers only, NEW WORDS = 20900/442% (47.2850678733%), one initial word, unchanged displayed settling, and the original strict simultaneous completion rule. First answer occurs after one full interval. All runs use 1/60-second updates and a 3,600-second limit; there is no early stall cutoff.
The eight-run benchmark took 0.321 seconds and predicted 144.5 seconds. The actual sweep took 145.136 seconds. No larger timestep was used.
43 automated tests passed, including shared-engine overrides, default isolation, deterministic sampling/runs, direct replay correctness, completed/unfinished records, and existing prototype/normalization tests. All 3,600 saved records also passed consistency checks.

## Completion rates

| Words | Every 2 s | Every 5 s | Every 10 s | Every 15 s |
|---:|---:|---:|---:|---:|
| 5 | 146/150 (97.3%) | 98/150 (65.3%) | 42/150 (28.0%) | 20/150 (13.3%) |
| 10 | 115/150 (76.7%) | 51/150 (34.0%) | 17/150 (11.3%) | 6/150 (4.0%) |
| 15 | 98/150 (65.3%) | 30/150 (20.0%) | 8/150 (5.3%) | 2/150 (1.3%) |
| 20 | 74/150 (49.3%) | 23/150 (15.3%) | 7/150 (4.7%) | 0/150 (0.0%) |
| 25 | 57/150 (38.0%) | 13/150 (8.7%) | 2/150 (1.3%) | 0/150 (0.0%) |
| 30 | 51/150 (34.0%) | 8/150 (5.3%) | 2/150 (1.3%) | 0/150 (0.0%) |

## Difficulty examples and promising tradeoffs

These labels describe tradeoffs for discussion, not an ideal-difficulty score. Completion is not evidence of learning quality.
- **Potentially too easy: C377** — kick 55, top 0.1, bottom 1.5, completion 60%. Completes 21/24 scenarios. Five words require exactly 10 answers at every tested interval; 30 words at 2 seconds require 60 answers and 02:00.02. This is forgiving but often offers only two answers per word.
- **Sustained effort: C094** — kick 25, top 0.1, bottom 0.5, completion 70%. Completes 14/24. Completed runs use 3.2–7.84 retrievals/word (median 4.1); all sizes finish at 2 seconds, and sizes through 25 finish at 5 seconds.
- **More movement and fewer answers: C190** — kick 35, top 0.1, bottom 1.0, completion 70%. Also completes 14/24, but uses 3–4.4 retrievals/word (median 3). At 2 seconds it scales exactly three answers per word across all six sizes; at 5 seconds effort increases with size.
- **Broader pace tolerance, less practice: C283** — kick 45, top 0.1, bottom 1.0, completion 80%. Completes 16/24, including every size at 2 and 5 seconds. Completed effort is 2–4.33 retrievals/word (median 2.63). The larger kick compensates for the higher completion line, but small fast games can still finish with two answers per word.
- **Too difficult for this tested learner: C040** — kick 15, top 0.3, bottom 3.0, completion 90%. Completes 0/24. Even five words at 2 seconds reach the limit with 1,800 answers, only four unlocked words, and final progress 3.09%. C076, C088, and C092 also complete 0/24.

## Scaling and cliffs

**Smooth scaling exists away from boundaries.** C190 at 2 seconds completes 5/10/15/20/25/30 words in 15/30/45/60/75/90 answers, approximately 30/60/90/120/150/180 seconds. At 5 seconds, answers rise to 15/30/54/74/108, followed by an unfinished 30-word run. C094 at 5 seconds rises from 19 answers for five words to 196 for 25, then fails at 30.
**One adjacent top-speed change can remove many successful scenarios.** C377 → C397 changes only top speed from 0.1 to 0.3; completed scenarios drop from 21/24 to 14/24. Thirty words at 5 seconds change from 60 answers in 05:00.02 to unfinished after 720 answers, 29 unlocked words, and 23.00% final progress. Fifteen words at 10 seconds change from 30 answers in 05:00.03 to unfinished after 360 answers.
**Bottom speed can impose a separate unlocking/progress cliff.** C095 → C099 keeps kick 25, top 0.1, completion 80% while bottom speed rises from 0.5 to 1.0; completion drops from 13/24 to 8/24. Ten words at 10 seconds go from 116 answers in 19:20.03 to unfinished with only five unlocked words.
The top cap creates a structural limit: even a word kicked to 100% can stay above completion for at most `(100 - completion) / topSpeed` seconds. With N words and interval I, a necessary logical-position condition for simultaneous completion is `(N - 1) × I × topSpeed < 100 - completion`. Equality fails because completion is strict. Displayed settling and progress/unlocking dynamics impose further limits, so satisfying this bound is not sufficient. For 30 words at 15 seconds, the smallest tested top speed still loses 43.5 percentage points between oldest and newest answers; even the lowest completion threshold leaves only 40 points of headroom. This explains why none of those runs complete.

## Regions rather than isolated points

There are 163 sampled pairs differing in exactly one adjacent grid value. **51 sampled configurations complete all six sizes at 2 seconds**; 49 adjacency edges connect configurations in that group. Its largest connected sampled component contains 20 configurations, including C094, C190, and C283.
For example, C094 → C095 changes completion from 70% to 80% (14 → 13 successful scenarios); C094 → C098 raises bottom speed from 0.5 to 1.0 (14 → 10). C098 → C190 raises kick from 25 to 35 (10 → 14). C190 → C191 raises completion to 80% (14 → 11), then C191 → C283 raises kick to 45 (11 → 16). Each remains successful for all six sizes at 2 seconds. This is evidence for connected workable regions for fast retrievals, not a unique lucky point.
Robustness across slower paces is much narrower. Only eight sampled configurations complete 30 words at 5 seconds, two at 10 seconds, and none at 15 seconds. The 150-point sample covers 32.6% of the valid grid; missing neighbors are untested, so this does not establish a smooth continuous region between grid points. Per-parameter marginal rates mix other settings and should not be interpreted as isolated causal effects.

## Complete results for the three promising examples

Cells show **completion time mm:ss.ss / successful retrievals**. Unfinished cells show **U / retrievals / unlocked words / final progress%**; each U ran for 60:00.00. Completed cells have all words unlocked and 100% final progress.

### C094: kick 25, top 0.1, bottom 0.5, completion 70%

| Words | Every 2 s | Every 5 s | Every 10 s | Every 15 s |
|---:|---|---|---|---|
| 5 | 00:32.02 / 16 | 01:35.02 / 19 | 03:30.02 / 21 | 06:45.03 / 27 |
| 10 | 01:16.02 / 38 | 03:20.02 / 40 | 10:20.02 / 62 | U / 240 / 8 / 5.63% |
| 15 | 01:58.02 / 59 | 05:45.02 / 69 | U / 360 / 13 / 6.22% | U / 240 / 8 / 3.75% |
| 20 | 02:40.02 / 80 | 09:45.02 / 117 | U / 360 / 13 / 4.67% | U / 240 / 8 / 2.81% |
| 25 | 03:20.02 / 100 | 16:20.02 / 196 | U / 360 / 13 / 3.73% | U / 240 / 8 / 2.25% |
| 30 | 04:14.02 / 127 | U / 720 / 28 / 6.81% | U / 360 / 13 / 3.11% | U / 240 / 8 / 1.88% |

### C190: kick 35, top 0.1, bottom 1, completion 70%

| Words | Every 2 s | Every 5 s | Every 10 s | Every 15 s |
|---:|---|---|---|---|
| 5 | 00:30.02 / 15 | 01:15.02 / 15 | 02:40.03 / 16 | 05:15.12 / 21 |
| 10 | 01:00.02 / 30 | 02:30.03 / 30 | 07:20.03 / 44 | U / 240 / 6 / 6.04% |
| 15 | 01:30.02 / 45 | 04:30.02 / 54 | U / 360 / 14 / 6.92% | U / 240 / 6 / 4.02% |
| 20 | 02:00.02 / 60 | 06:10.02 / 74 | U / 360 / 14 / 5.19% | U / 240 / 6 / 3.02% |
| 25 | 02:30.03 / 75 | 09:00.03 / 108 | U / 360 / 14 / 4.15% | U / 240 / 6 / 2.41% |
| 30 | 03:00.02 / 90 | U / 720 / 30 / 7.70% | U / 360 / 14 / 3.46% | U / 240 / 6 / 2.01% |

### C283: kick 45, top 0.1, bottom 1, completion 80%

| Words | Every 2 s | Every 5 s | Every 10 s | Every 15 s |
|---:|---|---|---|---|
| 5 | 00:20.12 / 10 | 00:50.13 / 10 | 02:20.02 / 14 | 03:45.03 / 15 |
| 10 | 00:40.12 / 20 | 02:00.02 / 24 | 05:00.03 / 30 | U / 240 / 9 / 10.38% |
| 15 | 01:00.12 / 30 | 03:40.02 / 44 | 10:50.02 / 65 | U / 240 / 9 / 6.92% |
| 20 | 01:20.12 / 40 | 05:00.02 / 60 | U / 360 / 17 / 8.48% | U / 240 / 9 / 5.19% |
| 25 | 01:48.02 / 54 | 06:50.02 / 82 | U / 360 / 17 / 6.78% | U / 240 / 9 / 4.15% |
| 30 | 02:28.02 / 74 | 09:00.02 / 108 | U / 360 / 17 / 5.65% | U / 240 / 9 / 3.46% |

## Files and rerun command

`results.json` includes full-precision measurements, exact effective engine configurations, engine SHA-256, per-size and per-interval summaries, and runtime metadata. `results.csv` contains all 3,600 measurements. `summary.md` compares all 150 configurations. `configuration-details.md` gives all 24 outcomes for every sampled configuration. `analysis.json` contains sampled neighbor comparisons and marginal summaries.

From the prototype directory:

```sh
node parameter-sweep.cjs --samples 150 --seed 20261012 --limit 3600 --step 0.016666666666666666
node sweep-analysis.cjs
node --test tests/*.test.cjs
```

Outcomes and selection reproduce exactly on the same runtime/engine; wall-clock timings vary. Unfinished is censored at one hour, not proof that a run can never finish. All answers are successful with constant intervals: these results do not predict errors, fatigue, variable response times, or vocabulary mastery. No visual-interface or physics-rule changes were made.
