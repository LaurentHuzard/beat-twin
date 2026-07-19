# Active Beat Twin Orbit

## Loop

BT-LIVE-101 / GitHub #26 — separate the ephemeral performance runtime from
persistent song commands on `agent/bt-live-101-performance-runtime`.

## Target Outcome

NanoDAW owns one pure, deterministic performance state machine for transport,
quantized launch, stop, scene, recording-state, mixer, and macro gestures while
`Song`, command revisions, autosave, undo, and redo remain untouched until an
explicit future capture boundary.

## Planned Changes

- pure performance state and quantization contract;
- reducer tests covering transport, launch replacement/cancellation, stop,
  scenes, recording/overdub state, mute, solo, and bounded macros;
- Playground store integration with no second song model;
- live-runtime ownership and capture-boundary documentation;
- Orbit queue, report, and verification evidence.

## Product Contract

- `Song` remains the only persistent musical document.
- The browser owns both song and ephemeral performance state.
- Performance actions do not create revisions, autosaves, or undo checkpoints.
- At most one active clip and one pending transition exist per track.
- Equivalent pending launches coalesce; replacement and cancellation are
  deterministic before their target boundary.
- No Tone.js scheduling, launcher redesign, MIDI access, Capture Jam, Bitwig,
  Gateway, MCP, or S25 change is in scope.

## Verification Plan

- focused pure reducer and quantization tests;
- `pnpm test`;
- `pnpm typecheck`;
- `pnpm nanodaw:test`;
- `pnpm smoke:packages`;
- `git diff --check`;
- adversarial review for state ownership, revision flooding, transition
  identity, and cross-track isolation.

## Human Gates

- The user authorized movement of GitHub #26 into `Orbit Ready` and named #27,
  #28, #30, and #31 as the dependency-ordered continuation sequence.
- Only one implementation branch and one `Orbit Ready` item may exist at once.
- No merge, publication, deployment, live DAW write, or branch deletion is
  authorized by this loop.

## Exit Condition

Met locally on 2026-07-19. The bounded reducer and store boundary are covered by
focused tests, the required offline suite passes, the architecture and Orbit
report are written, and `Orbit Ready` has been cleared before any activation of
#27. No live audio, listening, merge, publication, or deployment proof is
claimed.

## Next Activation Signal

After human review of this local tranche, activate GitHub #27, then #28, #30,
and #31 in that exact dependency order. #27 must consume the identified
request/schedule/observation handshake and must not promote queued clips from
clock movement alone. It must also treat `clipId` as source-neutral rather than
locking the runtime to MIDI, so the indispensable later audio-clip and sample
tranche can reuse the same performance state machine. Parallel agents may
analyze or review future slices but may not implement them before their
dependency gate opens.
