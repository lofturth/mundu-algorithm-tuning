# Mündu visual experiment

Open `index.html` directly in a desktop browser. No server, installation, or build is required. Press a letter for a successful retrieval, Backspace for a mistake, and use Pause, Reset, or Tune as before.

## Physics API

`physics.js` is DOM-free. It exposes `MunduPhysics` through a classic browser script and `module.exports` in Node, keeping direct `file://` opening compatible.

```js
const Physics = require('./physics.js');
const session = Physics.createSession({
  wordCount: 25,
  // Alternatively: vocabulary: [['river', 'río'], ...]
  config: { unlock: { initialCount: 3 } }
});
session.advance(0.1);           // Explicit elapsed seconds.
session.retrieve();             // Selects the lowest unlocked word; response time sets lift.
session.retrieve(false);        // Mistake: reset selected streak, no lift.
session.setPaused(true);        // advance/retrieve are frozen while paused.
session.setPaused(false);
session.getProgress();          // 0–100, averaged over the entire vocabulary.
session.getLowestIndex();
session.isComplete();
const checkpoint = session.getState();
const restored = Physics.restoreSession(JSON.parse(JSON.stringify(checkpoint)));
```

`getState()` returns a detached snapshot containing words, logical and response positions, streaks, unlock state, session time, response timer, pause/completion flags, answer count, last retrieval, and the full physics configuration. `restore(snapshot)` also restores an existing session. `configure(patch)` updates configuration without resetting words; changes to `unlock.initialCount` apply when creating the next session. `{recheckCompletion: true}` preserves the existing finish-line tuning behavior.

`advance()` returns `{unlockedIndex, completedNow}`. `retrieve()` returns the selected word, latency, actual lift, and the same transition fields, or `null` if frozen. Completion freezes the engine. Create a new session to reset it.

All defaults are centralized in `Physics.DEFAULTS`; the prototype takes editable copies for Tune. The current default starts **one** word, preserving the latest prototype. Three initially active words remain supported, including when the vocabulary contains fewer than three words.

The numeric `shown` response position is retained because the existing threshold, ghosting, and progress rules wait for both it and logical `depth`. Its settling uses explicit time steps, not DOM animation. `instantPosition` preserves reduced-motion behavior. Reproducibility means the same checkpoint, configuration, time-step sequence, and inputs produce the same state. The original settling calculation remains step-size sensitive; it has not been replaced with new physics.

## Verification

From this directory, run:

```sh
node --test tests/physics.test.cjs tests/prototype.test.cjs
```

Tests use only Node built-ins. `legacy-fixtures.json` contains states recorded from the unmodified prototype, covering default, three-word, and reduced-motion sessions. Physics tests and the actual browser-script adapter are compared against those traces. The lightweight DOM host verifies JavaScript integration and referenced HTML elements; it does not render CSS or verify browser layout.

Rendering, progress history/smoothing, colors, flashes, input events, and the completion dialog remain in `app.js`. No simulator has been added.
