# Completed Beat Twin Orbit

## Loop

BT-LIVE-106 / GitHub #31 — add quantized MIDI loop recording and overdub to
the merged NanoDAW launcher.

## Target Outcome

A player can queue a fixed-length MIDI take from the computer keyboard or
on-screen pads, see the count-in and recording boundaries, layer an overdub,
and undo only the last take while the shared live clock continues.

## Planned Changes

- add a bounded browser-native note-input contract with keyboard/pad baseline;
- expose optional Web MIDI as a non-blocking adapter with honest availability;
- queue empty-slot recording on the next bar and overdub on the next active
  loop boundary for 1, 2, 4, or 8 bars;
- capture note-on/off beats from the same live controller clock;
- quantize note starts to an explicit sixteenth-note grid and normalize lengths
  inside the loop;
- materialize each completed take as one atomic `BeatTwinCommand[]` batch;
- create an empty-slot clip or overdub an existing active clip without replacing
  prior notes;
- retain one explicit `Undo last take` checkpoint independently of transport;
- discard interrupted takes and release held inputs on blur, hidden document,
  unmount, device disconnect, permission denial, and transport stop;
- keep audio recording, file input, external DAWs, and hidden persistent capture
  state out of scope.

## Product Contract

- `Song` remains the only persistent musical document; the capture buffer is
  ephemeral browser state until one successful atomic commit.
- One take yields exactly one document revision, autosave, and undo checkpoint.
- Empty-slot recording starts on the next exact bar; overdub starts on the next
  exact active-loop boundary. Both are observed from the live clock.
- Empty-slot recording creates one ordinary MIDI clip; overdub only appends
  ordinary MIDI notes to the selected existing clip.
- An interruption discards the whole uncommitted take. No partial take is
  applied and held input is always released locally.
- Web MIDI permission or device failure never disables keyboard or pad input.
- Captured notes are bounded to MIDI 0-127 and cannot escape the chosen loop.

## Verification Plan

- focused quantization, lifecycle, input-adapter, command-batch, store, and UI
  tests;
- `pnpm test`;
- `pnpm typecheck`;
- `pnpm nanodaw:test`;
- `pnpm --filter @beat-twin/playground build`;
- `pnpm smoke:packages`;
- `git diff --check`;
- real-browser desktop and narrow QA covering pads, keyboard, count-in, record,
  overdub, undo-last-take, focus-loss recovery, reload, console health, and
  honest optional-Web-MIDI absence;
- adversarial review for clock drift, boundary rounding, late note-off, stuck
  input, interrupted commit, duplicate identity, history granularity, and
  transport/runtime ownership.

## Current State

BT-LIVE-106 is complete on `agent/bt-live-106-midi-recording`. Deterministic,
build, package-smoke, adversarial-review, and real-browser gates pass. The human
has explicitly authorized push, PR creation, CI-gated squash merge, and issue
closure for this loop.

## Human Gates

- Only BT-LIVE-106 was authorized for this implementation loop.
- Browser-local MIDI capture and playback of the committed clip are proven.
  Live input monitoring, microphone/audio recording, and external DAW writes
  remain out of scope.
- Push, PR creation, CI-gated squash merge, and issue closure were explicitly
  authorized on 2026-07-19. No deployment or external write was authorized.

## Exit Condition

Met. The bounded capture flow passes deterministic and real-browser gates, each
take is atomic and undoable, failure paths discard safely, and Orbit
documentation is aligned for publication.

## Next Activation Signal

BT-AUDIO-200 is the next eligible product tranche. It requires its own bounded
Orbit plan before audio-clip or sample implementation begins.
