# Mündu 3D Physics Explorer — legacy physics results

**Historical data only:** these results measure the former fixed-kick model with independently configured top/bottom falling speeds. They do not measure the current shared-linear physics model or two-second hint/half-kick rules. The saved records are preserved without regeneration.

This separate, dependency-free browser instrument reads `../sweep-results/results.json`. It never imports `physics.js` or runs a simulation. A perspective-projected Canvas 3D plot keeps installation and network/CDN dependencies out of the workflow.

Start a local server from the standalone prototype directory:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open **http://127.0.0.1:8765/explorer/**. Alternatively, from any directory:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory "/Users/lofturgudmundsson/Documents/Codex/2026-10-11/files-mentioned-by-the-user-mundu/outputs/mundu-visual-experiment"
```

A server is required because browsers restrict JSON fetches from `file://`. No build or package installation is required.

- Drag the scatterplot to rotate. Scroll/trackpad pinch to zoom; touch pinch also zooms. Reset View restores the camera. Keyboard arrows rotate and +/- zoom while the canvas is focused.
- Hover for filtered statistics; click a point to inspect it. The configuration dropdown provides keyboard access to every point, including overlapping points.
- Completion-threshold slider selects 60%, 70%, 80%, or 90%. Vocabulary size and retrieval interval filters support individual values or All.
- Completion rate is equally weighted over the selected scenarios. Effort is the **median successful retrieval count per word among completed scenarios**; time is the **median completion time among completed scenarios**. With a single selected scenario these are its actual values. Unfinished counts never become completed effort or completion time. Legends show the current numeric range; completion-rate colors always cover 0–100%.
- A magenta ring marks mixed completed/unfinished selections. All-unfinished points show a cross; effort/time metrics render them hollow gray, since no completed value exists. Numeric colors describe outcomes, not an ideal difficulty score.
- The details panel always contains the full 24-scenario record and an effort chart with separate lines per interval. Unfinished points break lines, and their vocabulary sizes are listed below the chart.
- Neighborhoods are valid grid combinations one adjacent step away in exactly one of the four parameters. Solid buttons identify actual tested neighbors; dashed entries identify untested combinations. Invalid bottom-speed < top-speed combinations are excluded. Neighbor rates use the current vocabulary/interval filters. Clicking a tested neighbor at another completion threshold moves the threshold slider. Cloud links connect only sampled neighbors in the visible slice, with no inferred values.

Run data-model tests with Node built-ins:

```sh
node --test tests/explorer*.test.cjs
```

Run that command from the prototype directory. Tests use saved data only, checking filtering, aggregation, selection, neighborhoods, and chart gaps. The explorer covers 150 sampled configurations, not the entire 460-configuration valid grid. It does not interpolate missing points. Point overlap and labels can occur at some viewing angles; rotate the cloud or use the configuration picker. It is a lightweight Canvas perspective renderer, not a general-purpose WebGL plotting library.
