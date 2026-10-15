# Rendering performance investigation

The old renderer rewrote the complete progress-history SVG path on every frame.
Each frame mapped the growing history into several temporary arrays and formatted
all coordinates again. At 60 Hz and ten minutes of history, it reprocessed roughly
2,400 recorded vertices per frame. Every frame also rewrote unchanged word labels,
visibility, styling, hint text and accessibility labels, regenerated the 97-point
kick curve, and obtained two detached engine snapshots (including JSON cloning).
The requestAnimationFrame loop continued requesting callbacks while paused or complete.

No per-frame layout measurements or duplicate registered input handlers were found.
The CSS has a small blinking cursor and brief state-change animations, rather than
an expensive continuous full-chart effect. Input handlers still advance to the
input timestamp before applying an action. These findings identify concrete waste;
they do not prove the precise breakdown of the reported 107% Chrome CPU usage.

The optimized renderer:

- Appends recorded trace vertices only when new observations arrive. It scales their
  time coordinates using SVG and updates a separate live segment every frame.
  All raw observations, simultaneous timestamps and straight connecting segments remain.
  Resize handling preserves the original line weight under the chart's viewBox scale.
- Writes SVG attributes, text and classes only when their values change, and reuses
  the existing engine snapshot for rendering. The kick curve is cached while its
  time window is unchanged; its live indicator and expanding time axis still update.
- Cancels callbacks when paused, complete or hidden. Resume/reset requests at most
  one callback, and returning to a visible tab excludes hidden elapsed time.
- Leaves physics.js, tuning defaults and the simulation timestep schedule unchanged.
  Active sessions still advance/render at display refresh and advance at input times.
  A word resting at the floor is not treated as a frozen session: its response timer,
  hint, reward graph and history continue normally.

## Reproducible measurements

Run from the repository root with Node (no additional dependencies):

```sh
node tests/render-benchmark.cjs 7d5c84c
node tests/render-benchmark.cjs
```

The benchmark runs the actual app and engine in the existing minimal DOM harness.
It measures 600 scheduled frames at 60 Hz, starting with either zero or 600 seconds
of synthetic raw history. One warmup and five fresh-host measured runs are used per
case. It checks that each run advances ten simulation seconds. Results from this
investigation using Node v24.14.0:

| Starting history | Before median (range), ms | After median (range), ms | Attribute writes before / after |
| --- | --- | --- | --- |
| Fresh session | 219 (143–297) | 78 (76–82) | 123,600 / 5,095 |
| Ten minutes | 786 (672–839) | 112 (107–116) | 123,600 / 5,537 |

For ten minutes of history, total SVG path characters submitted fell from
23,858,746 to 3,430,249 over those 600 frames. Paused, completed and hidden sessions
have no queued animation callbacks, verified by scheduler regression tests.

These are JavaScript/DOM-call microbenchmarks, **not Chrome CPU percentages**.
The harness does not perform layout, SVG parsing, painting or GPU work, and timings
include VM/test-host overhead and vary with JIT and machine load. SVG still has to
paint the full retained history, and its memory/paint cost can grow with session
length. No samples are discarded to conceal that cost.

Reliable before/after Chrome renderer CPU or temperature measurements could not be
obtained with the available tools; Chrome was not available to browser automation.
The local page was exercised in the available in-app browser for retrieval, pause,
resume and reset. Automated tests additionally cover hidden-tab transitions,
completion/review, repeated resets, tuning, raw trace geometry and irregular frame
and input schedules against the unchanged engine. The reported 107% figure should
be rechecked in Chrome Task Manager after reloading the optimized local page, using
the same session duration, tuning settings, viewport and display refresh rate.
