# Active Beat Twin Orbit

## Loop

BT-LIVE-105 / GitHub #30 — add a playable 16-step editor and safe
clip-variation workflow on the merged NanoDAW launcher.

## Target Outcome

A player can build a recognizable drum or pitched pattern without opening the
numeric editor, accent it through bounded velocities, duplicate it into the
next empty launcher slot, and trust undo, redo, autosave, reload, and live
playback timing.

## Planned Changes

- project exactly 16 steps from the selected browser-owned clip;
- provide bounded drum lanes and a bounded pitched-note mode;
- route toggles, accents, and batches only through `BeatTwinCommand` values;
- expose clip length and musical step resolution explicitly;
- duplicate to the next empty launcher slot without overwrite and with fully
  materialized clip/note IDs;
- retain the numeric note editor as a secondary precision surface;
- make keyboard, pointer, and touch gestures accessible without hover;
- make edits to active material audible at the next loop boundary while other
  tracks continue, with coherent queued edits, repeated edits, undo, and redo.

## Product Contract

- `Song` remains the only persistent musical document and the launcher/editor
  remain projections and command surfaces.
- One primary gesture produces one command/revision; a bounded multi-step
  gesture may produce one atomic batch.
- The 16-step grid uses explicit `stepBeats = clip.lengthBeats / 16`; no second
  pattern schema or unlimited resolution system is introduced.
- Drum lanes and pitched entry are bounded UI mappings onto ordinary MIDI
  notes.
- Duplicate never overwrites an occupied slot and reports a blocked state when
  no later slot is free.
- Active-clip document revisions replace only that track at its next loop
  boundary; unrelated tracks remain continuous. Stale or ambiguous runtime
  state fails closed.

## Verification Plan

- focused pure mapping, command, store, launcher, controller, and live-engine
  tests;
- `pnpm test`;
- `pnpm typecheck`;
- `pnpm nanodaw:test`;
- `pnpm --filter @beat-twin/playground build`;
- `pnpm smoke:packages`;
- `git diff --check`;
- desktop and narrow real-browser QA covering create rhythm, accent, duplicate,
  edit variation, undo, redo, save, reload, relaunch, console health, and touch
  sizing;
- adversarial review for command granularity, slot overwrite, ID reuse,
  material-revision races, cross-track interruption, stale async work, and
  accessibility.

## Current State

BT-LIVE-105 is complete on `agent/bt-live-105-step-editor`, based on merged
BT-LIVE-103 commit `829db14`. The implementation, deterministic suites,
production build, package smoke, desktop/narrow browser flow, simultaneous-drum
relaunch, and console gate pass. The browser and dev server are stopped and QA
artifacts removed. No Orbit Ready item remains on this branch.

## Human Gates

- Only one implementation branch and one `Orbit Ready` item may exist at once.
- Browser-local audio playback is in scope; external DAW writes remain out of
  scope.
- This loop may commit locally, but push, PR creation, merge, and live DAW
  writes require a separate human action.

## Exit Condition

Met locally. The bounded editor and variation flow pass deterministic and
real-browser gates, the active-edit timing rule is documented and tested, the
adversarial release blockers are resolved, and one local commit plus the Orbit
report are ready for human publication review.

## Next Activation Signal

After this loop is reviewed and merged, GitHub #31 may become Orbit Ready.
BT-AUDIO-200 remains parked behind #31.
