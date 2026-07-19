# Active Beat Twin Orbit

## Loop

BT-LIVE-102 / GitHub #27 — connect the reviewed performance contract to one
persistent browser-owned clock and per-track audio graph on
`agent/bt-live-102-audio-engine`.

## Target Outcome

NanoDAW can keep at least two tracks looping on one clock while a clip on one
track is launched, replaced, or stopped on its resolved musical boundary
without resetting the clock or interrupting the other track. Audio observations
must drive the performance reducer through the exact transition identity.

## Planned Changes

- pure fake-clock scheduler tests for concurrent looping, replacement, stop,
  cleanup, coalescence, and disposal;
- one long-lived audio engine with a stable bus and source handle per track;
- source-neutral `LiveClipMaterial` and preparation boundary so future audio
  clips and samples do not require a second engine;
- one controller binding Song snapshots to the BT-LIVE-101 request, schedule,
  cancellation, execution, and failure handshake;
- compatibility for the existing single-clip preview without a second Tone
  transport owner;
- real-browser autoplay, lifecycle, console, and listening evidence;
- Orbit queue, report, and verification evidence.

## Product Contract

- One browser-owned musical clock and audio engine serve every live track.
- `Song` remains the only persistent musical document; prepared material is an
  immutable versioned snapshot, never a second mutable song.
- A clip becomes active only after the engine observes execution for the same
  transition ID; scheduling and audible execution remain distinct.
- Replacing or stopping one track cannot reset transport or cancel unrelated
  track events.
- Every source handle is cancellable, stoppable, disposable, and attached to a
  stable per-track output boundary.
- The launch API is generic by material kind/ID/version. MIDI is the only
  implemented material in this loop, but audio clips and samples remain a
  compatible later adapter.
- No launcher redesign, MIDI recording, Capture Jam, Bitwig, Gateway, MCP, or
  S25 change is in scope.

## Verification Plan

- focused fake-clock scheduler and engine lifecycle tests;
- `pnpm test`;
- `pnpm typecheck`;
- `pnpm nanodaw:test`;
- `pnpm --filter @beat-twin/playground build`;
- `pnpm smoke:packages`;
- `git diff --check`;
- desktop real-browser autoplay/recovery and console checks;
- manual listening run with two contrasting loops for at least 32 bars,
  replacement and stop/relaunch on one track while the other continues;
- adversarial review for transport ownership, timing conversion, orphaned
  events, late preparation, cancellation acknowledgement, and source cleanup.

## Human Gates

- The user authorized #27 as the next item in the dependency-ordered sequence
  #26, #27, #28, #30, and #31.
- Only one implementation branch and one `Orbit Ready` item may exist at once.
- Browser-local audio playback is in scope; external DAW writes are not.
- No merge, publication, deployment, external DAW write, or branch deletion is
  authorized.

## Exit Condition

Pending the human listening gate only. Deterministic two-track timing,
track-local replacement/stop, cleanup, package/type/build checks, independent
adversarial code review, visible Preview behavior, real Tone two-track trace,
and the zero-error/zero-warning browser console gate pass locally. The loop
exits only after a human listening run is recorded honestly and the Orbit
report clears #27.

## Next Activation Signal

After this loop reaches its exit condition, activate GitHub #28 for the 2 x 2
launcher, followed by #30 and #31. Preserve the source-neutral engine contract
for the indispensable later BT-AUDIO-200 audio-clip and sample tranche. Parallel
agents may analyze or review future slices but may not implement them before
their dependency gate opens.
