# Mündu visual experiment

Open `index.html` directly in a desktop browser. No installation, build, or server is required for the playable prototype. A letter simulates a successful retrieval; Escape skips. Backspace has no answer mechanic. Pause freezes physics and prompt timers; Reset starts a fresh session.

## Exact falling-time physics

Positions remain percentages increasing upward: 0% is the bottom and 100% is the reachable top. The formula uses normalized height `h = position / 100` and normalized speed `vTop = topFallingSpeed / 100`:

```text
v(h) = vTop * [R - (R - 1) * h]
tau(h) = integral from 0 to h of 1 / v(u) du

fall: tauNew = max(0, tau(h) - elapsedSeconds)
kick: tauNew = min(tau(1), tau(h) + kickTime)
fieldFallTime = tau(1)
baselineKickTime = fieldFallTime * kickStrengthPercent / 100
kickTime = baselineKickTime * retrievalMultiplier(t)
retrievalMultiplier(t) = hintVisible ? 0.5 : 2 - t / 2
newHeight = inverseTau(tauNew)
```

Tau measures the natural falling time from a height to the bottom. Adding a duration moves a word to a height from which it falls back to its old height in exactly that duration, provided the kick does not reach the ceiling. Kicks use the logical height immediately before retrieval. Both kicks and continuous falling use the same analytic transformation. Positions clamp to 0–100%; excess time at a boundary is discarded, with no stored energy or headroom. Displayed-position smoothing is unchanged.

For `R > 1`, define `k = vTop * (R - 1)` and `q = (R - 1) / R`:

```text
tau(h) = -log(1 - q*h) / k
h(tau) = R / (R - 1) * [1 - exp(-k*tau)]
```

The implementation uses `log1p`, `expm1`, and their stable small-argument ratios, avoiding subtraction of nearly equal values when R is close to 1. At `R = 1`, speed is constant: `tau = h / vTop`, and `h = vTop * tau`. The engine’s public helper inputs/outputs use percentage heights, while tau and durations use seconds.

The three main Tune controls remain **Top falling speed** (percentage points/second), **Bottom-to-top multiplier R** (R ≥ 1), and **Kick strength (% of field)**. Strength measures a percentage of the complete field’s top-to-bottom falling time, not percentage of screen height. The old seconds control is removed. Tune accepts 0.1–200% of field, including values above 100%. No independent kick-strength control exists.

Defaults remain provisional, not optimized:

| Parameter | Default |
|---|---|
| Top falling speed | 1 percentage point/second |
| Bottom-to-top multiplier R | 10× |
| Kick strength | 50% of field falling time |
| Derived bottom falling speed | 10 percentage points/second |
| NEW WORDS threshold | 50% |
| COMPLETION threshold | 90% |

With these defaults, `fieldFallTime` is approximately **25.584279 seconds**, and the 50% baseline kick time is **12.792139 seconds**. From the bottom, a baseline 1× kick rises to **75.974693% height**; a hinted 0.5× kick rises to **48.628742%**, and an immediate 2× kick reaches 100%. A 1.5× kick reverses 75% of field falling time. Multipliers apply to time, not vertical distance. Excess time above the ceiling is discarded.

The engine recalculates field falling time and baseline kick time from the current speeds on every calculation. Changing top falling speed changes absolute kick seconds but preserves the same kick heights for a fixed R, starting position and retrieval multiplier. Changing R changes the height/time mapping while retaining the configured percentage of total field time. The strength percentage does not change when speeds are tuned.

A fresh prompt starts a two-second simulation-time timer. The Spanish hint appears at two seconds. `hintVisible` is the authoritative engine state. Before the hint, t is seconds since this prompt began: at 0, 0.5, 1, and 1.5 seconds the multiplier is 2, 1.75, 1.5, and 1.25; it approaches 1 just before two seconds. After the hint it is always 0.5, regardless of delay. No randomness is used. Negligible floating-point clock conversion noise is tolerated at the hint deadline; this adds no meaningful grace period.

Every retrieval or skip starts a fresh prompt and timer. Escape changes no positions, streaks, or successful retrieval count. It selects the lowest other active word for the next prompt; the skipped word becomes eligible again on the next action. With only one active word, Escape restarts that word's prompt. All active words continue falling normally.

The initial active count remains **one**. Dataset-order tie-breaking and lowest logical-position selection remain unchanged for ordinary retrievals. Unlocking requires every active word's logical **and** displayed position to be strictly above NEW WORDS, then unlocks exactly one next word at 0%. Completion requires all dataset words to be unlocked and both positions strictly above COMPLETION simultaneously. Completion freezes the session. Displayed-position settling retains the response rate of 15/second and the reduced-motion option.

The whole-number label beneath each word shows its completion height in field percentages (the lower of logical and displayed height), using the same 0–100% scale as Tune. Whole-number rounding can show 90% slightly before or after the exact 90% boundary; fading still requires strictly crossing it.

Overall progress still averages word progress toward the completion threshold, using the lower of logical and displayed positions. The complete timestamped history, visual smoothing, percentage label, ghosting, and completion overlay remain in `app.js`.

## Engine API

`physics.js` is DOM-free and exposes `MunduPhysics` in the browser and CommonJS exports in Node. The playable prototype and simulator both import this engine.

```js
const Physics = require('./physics.js');
const session = Physics.createSession({
  wordCount: 25,
  // Alternatively: vocabulary: [['river', 'río'], ...]
  config: { motion: { topFallingSpeed: 1, bottomToTopMultiplier: 10, kickStrengthPercent: 50 } }
});
session.advance(0.1);       // Explicit simulation seconds.
session.retrieve();         // Successful; speed-scaled/half kick from actual hint state.
session.skip();             // No kick, no successful retrieval.
session.setPaused(true);
session.setPaused(false);
session.getProgress();      // 0–100% overall progress.
session.getLowestIndex();
session.isComplete();
const checkpoint = session.getState();
const restored = Physics.restoreSession(checkpoint);
```

`advance()` returns `{unlockedIndex, completedNow}`. Retrieval and skip return action details (kind, index, word, latency, hint state, multiplier, requested `kickTime` in seconds, actual lift in percentage points, and transition fields), or null when frozen. `retrieve()` takes no correctness or timing flags. A new session resets gameplay.

`getState()` returns a detached, JSON-serializable version-7 checkpoint, tagged `field-falling-time-percent-v5`, with all word positions/streaks/locks, configuration, elapsed time, selected prompt and timer, actual hint state, temporary skip exclusion, counts, and completion/pause state. Earlier-model checkpoints, the old `kickCompensationSeconds` and `ratio` settings, and independent `baseKick`/`baseFallingSpeed` configuration fields are rejected rather than silently reinterpreted. `Physics.derivedMotion(config)` reports the derived bottom speed, clamped 1× bottom lift (`baseKick`), `fieldFallTime`, and `baselineKickTime` in seconds. `fieldFallTime(config)` and `baselineKickTime(config)` are also exposed directly. `fullKick(position, config)` returns a clamped 1× lift; `retrievalLift` applies the response multiplier to time. `timeCoordinate`, `positionAtTime`, and `reverseFallingTime` expose the analytic transformation. The returned `fullLift` is a 1× physical lift and must not be multiplied by the response multiplier; `kickTime` is the requested time before clamping. `restore(snapshot)` also restores an existing session. `configure(patch)` changes known configuration fields; initial active count takes effect on a new session. Reproducibility requires the same checkpoint, configuration, time-step sequence, and actions. Displayed settling still has the existing timestep sensitivity.

Positions convert to screen coordinates only in rendering: `screenY = 502 - position * 442 / 100`. This preserves the original field and threshold locations.

## Verification and launch

From this directory:

```sh
node --test tests/*.test.cjs
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/` for the game, or open `index.html` directly. Tests use Node built-ins and cover linear falling speeds, exact kick/fall round trips, constant-speed and near-constant-speed stability, field-percentage kicks, speed-invariant normalized kicks, hints, skipping, clamping, pause, unlocking, completion, deterministic checkpoints, prototype integration, simulator parity, and saved explorer data. Only short focused simulations run in tests; the full grid and parameter sweep are not rerun.

Historical fixtures `tests/fixtures/physics-before-normalization.cjs` and `physics-normalized-legacy.cjs` test the prior coordinate conversion against one another. They are never loaded by the current game or simulator, and do not assert that the new model behaves like the old one.

## Simulator and legacy results

`simulator.cjs` uses the current engine, including the two-second hint. Its `runSimulation({wordCount, intervalSeconds, stepSeconds, maxTimeSeconds, physicsConfig})` API supports deterministic runs and explicit overrides. The default experiment grid remains sizes 5–30 in steps of 5, intervals 2/5/10/15 seconds, a 1/60-second timestep, and a one-hour limit. The first answer follows one full interval. Completion freezes immediately; unfinished runs have no completion time. `node simulator.cjs` explicitly runs that grid using the new model; it has not been run as part of this change.

**Existing `simulation-results.txt` and `sweep-results/` are legacy physics measurements.** They used the former fixed kick and independently configured falling speeds. They do not measure the shared-linear/hint model.

The 3D explorer at `http://127.0.0.1:8765/explorer/` remains an unchanged-data historical instrument and is clearly labeled LEGACY PHYSICS RESULTS. See `explorer/README.md`. Its 150 sampled configurations and 3,600 scenario records have not been regenerated. `sweep-analysis.cjs` can still analyze those saved records without running simulations. The old four-parameter `parameter-sweep.cjs` now refuses to execute against the new model, preventing misleading measurements; a new-model sweep is outside this task.
