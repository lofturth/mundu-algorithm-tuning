# Mündu algorithm-tuning test bench

Open `index.html` directly in a desktop browser. No installation, build, or server is required for the playable prototype. A letter simulates a successful retrieval; Escape skips. Backspace has no answer mechanic. Pause freezes physics and prompt timers; Reset starts a fresh session.

## Exact falling-time physics

Positions remain percentages increasing upward: 0% is the bottom and 100% is the reachable top. The formula uses normalized height `h = position / 100` and normalized speed `vTop = topFallingSpeed / 100`:

```text
gravityMultiplier = (1 - gravityReductionPercent / 100) ** (unlockedWordCount - 1)
v(h) = vTop * gravityMultiplier * [R - (R - 1) * h]
tau(h) = integral from 0 to h of 1 / v(u) du

fall: tauNew = max(0, tau(h) - elapsedSeconds)
kick: tauNew = min(tau(1), tau(h) + kickTime)
fieldFallTime = tau(1)
baselineKickTime = tau(kickHeightPercent / 100)
kickTime = baselineKickTime * retrievalMultiplier(t)
retrievalMultiplier(t) = 0.5 + 1.5 * exp(-1.5 * max(0, t))
newHeight = inverseTau(tauNew)
```

Tau measures the natural falling time from a height to the bottom. Adding a duration moves a word to a height from which it falls back to its old height in exactly that duration, provided the kick does not reach the ceiling. Kicks use the logical height immediately before retrieval. Both kicks and continuous falling use the same analytic transformation. Positions clamp to 0–100%; excess time at a boundary is discarded, with no stored energy or headroom. Displayed-position smoothing is unchanged.

For `R > 1`, define `k = vTop * gravityMultiplier * (R - 1)` and `q = (R - 1) / R`:

```text
tau(h) = -log(1 - q*h) / k
h(tau) = R / (R - 1) * [1 - exp(-k*tau)]
```

The implementation uses `log1p`, `expm1`, and their stable small-argument ratios, avoiding subtraction of nearly equal values when R is close to 1. At `R = 1`, speed is constant: `tau = h / (vTop * gravityMultiplier)`, and `h = vTop * gravityMultiplier * tau`. The engine’s public helper inputs/outputs use percentage heights, while tau and durations use seconds.

The three main Tune controls are **Top falling speed** (percentage points/second), **Bottom-to-top multiplier R** (R ≥ 1), and **Kick height (%)**. Kick height is the screen height reached by a baseline 1× kick starting at 0%, independent of speed, R, or unlocked-word gravity reduction. Tune accepts 1–100%, in 0.1-point increments. The engine converts that reference height to exact falling time, not a fixed distance. The old percentage-of-field-time control is removed.

Defaults remain provisional, not optimized:

| Parameter | Default |
|---|---|
| Top falling speed | 1 percentage point/second |
| Bottom-to-top multiplier R | 5× |
| Kick height | 25% |
| Gravity reduction / new word | 5% (Tune range 0–10%, step 0.1%) |
| Derived bottom falling speed | 5 percentage points/second |
| NEW WORDS threshold | 50% |
| COMPLETION threshold | 90% |

With these defaults and one unlocked word, `fieldFallTime` is approximately **40.235948 seconds**, and baseline kick time is **5.578589 seconds**. A baseline 1× bottom kick reaches exactly **25% height**. The limiting 0.5× bottom kick reaches approximately **13.196601%**, and an immediate 2× bottom kick reaches 45%. Multipliers apply to baseline falling time, not screen height; excess time beyond the ceiling is discarded.

The engine recalculates baseline kick time as `timeCoordinate(kickHeightPercent, config, unlockedWordCount)` using current effective gravity. Changing top speed or gravity scales absolute seconds but preserves every kick destination for the same R, starting height and retrieval multiplier. Changing R preserves the configured baseline bottom height, but can change kicks from other heights and the effect of time multipliers. The reference height itself remains unchanged when other settings are tuned.

Each additional unlocked word multiplies all falling speeds by `1 - gravityReductionPercent / 100`. Locked words do not count; the prompted word does. At 5%, 1/5/10/20/30 unlocked words give 100.00% / 81.45% / 63.02% / 37.74% / 22.59% gravity. Each session starts with exactly one unlocked word. A new unlock immediately updates the effective multiplier for subsequent physics updates. Tune shows the live effective gravity beside the reduction control. Setting reduction to 0% gives the original unscaled gravity.

Field falling time and baseline kick time use the same effective gravity. Uniformly reducing speeds stretches both times by `1 / gravityMultiplier`, leaving exact reference-height kick destinations unchanged for the same height and retrieval multiplier. Changing gravity does not move words instantly or create stored kick energy. Timers and displayed-position smoothing keep their existing time scale; Pause freezes them as before.

A fresh prompt starts a two-second simulation-time timer. The Spanish hint still appears at two seconds, but it no longer changes the reward function. The shared `kickMultiplier(elapsedSeconds)` computes `0.5 + 1.5 * Math.exp(-1.5 * Math.max(0, elapsedSeconds))` for all retrievals. Rounded to three decimals, the multipliers at 0 / 0.5 / 1 / 1.5 / 2 / 3 / 4 seconds are 2.000 / 1.209 / 0.835 / 0.658 / 0.575 / 0.517 / 0.504. Reward decays continuously through the hint and approaches 0.5 asymptotically, with no hint-triggered clamp or randomness. It multiplies baseline falling-time displacement, never screen height. The existing hint-deadline floating-point tolerance remains limited to hint visibility.

Every retrieval or skip starts a fresh prompt and timer. Escape changes no positions, streaks, or successful retrieval count. It selects the lowest other active word for the next prompt; the skipped word becomes eligible again on the next action. With only one active word, Escape restarts that word's prompt. All active words continue falling normally.

Tune’s **Total words** control selects 1–30 words for the next Reset (default 10). The first selected number of entries from the 30-word sample vocabulary participate, and the field rebuilds its fixed slots for that size. Every session starts with exactly **one** unlocked word; there is no Starting words control. Progress includes all selected words, with locked words contributing zero. Dataset-order tie-breaking and lowest logical-position selection remain unchanged for ordinary retrievals. Unlocking requires every active word's logical **and** displayed position to be strictly above NEW WORDS, then unlocks exactly one next word at 0%. Completion requires all dataset words to be unlocked and both positions strictly above COMPLETION simultaneously. Completion freezes the session. Displayed-position settling uses a fixed response rate of 15/second and retains the reduced-motion option. Its speed is not adjustable in Tune.

The whole-number label beneath each word shows its completion height in field percentages (the lower of logical and displayed height), using the same 0–100% scale as Tune. Whole-number rounding can show 90% slightly before or after the exact 90% boundary; fading still requires strictly crossing it.

A compact kick graph beside the retrieval prompt displays the existing multiplier curve in magenta and a live cyan indicator. Its elapsed time comes directly from engine `time - selectedAt`; the same `kickMultiplier` used by gameplay determines the indicator and every sampled vertex of the smooth exponential curve. A dashed guide and point mark the two-second hint without a drop or discontinuity. Pause freezes it, and its time axis expands after four seconds to keep long waits visible. Ending a prompt hides its graph; because the game immediately creates the next prompt, its reset graph appears on the next animation frame. Completion keeps it hidden. There is no separate graph timer and no change to rewards or physics.

Overall progress still averages word progress toward the completion threshold, using the lower of logical and displayed positions. The cyan progress-history curve connects every recorded timestamped progress value with straight line segments, followed by the actual current progress as its live endpoint. No averaging, interpolation, or vertex reduction is applied. Sampling remains every 0.25 seconds on observed frames, with additional observations around actions and transitions. The graph geometry, colors, percentage label, ghosting, and completion overlay remain in `app.js`.

## Engine API

`physics.js` is DOM-free and exposes `MunduPhysics` in the browser and CommonJS exports in Node. The interactive test bench imports this engine.

```js
const Physics = require('./physics.js');
const session = Physics.createSession({
  wordCount: 25,
  // Alternatively: vocabulary: [['river', 'río'], ...]
  config: { motion: { topFallingSpeed: 1, bottomToTopMultiplier: 5, kickHeightPercent: 25, gravityReductionPercent: 5 } }
});
session.advance(0.1);       // Explicit simulation seconds.
session.retrieve();         // Successful; exponential reward from prompt elapsed time.
session.skip();             // No kick, no successful retrieval.
session.setPaused(true);
session.setPaused(false);
session.getProgress();      // 0–100% overall progress.
session.getLowestIndex();
session.isComplete();
const state = session.getState(); // Detached snapshot for inspection.
```

`advance()` returns `{unlockedIndex, completedNow}`. Retrieval and skip return action details (kind, index, word, latency, hint state, multiplier, requested `kickTime` in seconds, actual lift in percentage points, and transition fields), or null when frozen. `retrieve()` takes no correctness or timing flags. A new session resets gameplay.

`getState()` returns a detached, JSON-serializable inspection snapshot with all word positions/streaks/locks, configuration, elapsed time, computed unlocked-word count, effective gravity multiplier, effective field falling time and baseline kick time, selected prompt and timer, actual hint state, temporary skip exclusion, counts, and completion/pause state. Tune settings remain session-local and reload loads the new defaults. `Physics.derivedMotion(config)` reports the derived bottom speed, clamped 1× bottom lift (`baseKick`), `fieldFallTime`, and `baselineKickTime` in seconds. `fieldFallTime(config, unlockedWordCount)` and `baselineKickTime(config, unlockedWordCount)` are also exposed directly. `gravityMultiplier(config, unlockedWordCount)` exposes the reduction rule. Physics helpers accept an optional unlocked count (default one); pass the current count as the last argument for effective session calculations. The session always derives it from actual unlocked words, rather than a separate counter. `fullKick(position, config)` returns a clamped 1× lift; `retrievalLift` applies the response multiplier to time. `kickMultiplier(t)` is shared by physics and graph; `retrievalMultiplier` remains an alias for API compatibility. The legacy hint argument accepted by helper calls has no effect on reward strength. `timeCoordinate`, `positionAtTime`, and `reverseFallingTime` expose the analytic transformation. The returned `fullLift` is a 1× physical lift and must not be multiplied by the response multiplier; `kickTime` is the requested time before clamping. `configure(patch)` changes known configuration fields; the initial unlocked count is fixed at one. Deterministic replay uses a fresh session with the same configuration, time-step sequence, and actions. Displayed settling still has the existing timestep sensitivity.

Positions convert to screen coordinates only in rendering: `screenY = 502 - position * 442 / 100`. This preserves the original field and threshold locations.

## Verification and launch

From this directory:

```sh
node --test tests/*.test.cjs
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/` for the test bench, or open `index.html` directly. Tests use Node built-ins and cover linear falling speeds, exact kick/fall round trips, constant-speed and near-constant-speed stability, exponential reward values and hint continuity, reference-height kicks, unlocked-word gravity reduction, invariant kick destinations, hints, skipping, clamping, pause, unlocking, completion, deterministic replay, prototype integration, live tuning, and progress and reward graphs.

Tests use internal-state access through source instrumentation only to construct precise position/timer fixtures; the production engine exposes no state-writing API. `tests/legacy-fixtures.json` remains as action schedules for current prototype/engine parity tests; its historical snapshots are not used as expected current behavior.

The remaining application consists of `index.html`, `app.js`, `style.css`, and the shared `physics.js` engine. Live tuning applies to the current session. Historical explorers, automated simulation and parameter-sweep tools, and their generated results have been removed. Preview images in the repository document the interactive application's controls and visual changes.
