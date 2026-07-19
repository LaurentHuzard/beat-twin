# BT-LIVE-102 — Persistent Live Audio Engine

Date: 2026-07-19
Branch: `agent/bt-live-102-audio-engine`
Worktree: `/tmp/beat-twin-orbit-27`
Base: BT-LIVE-101 local commit `6c669ab`
Issue: GitHub #27

## Outcome

The implementation is locally complete and passed independent adversarial code
review plus the real-browser functional and console gates. No push, PR, merge,
deployment, MCP write, Gateway call, or external DAW write was performed in
this loop.

NanoDAW now has:

- one generic persistent audio engine with a stable bus per track;
- deterministic recurring loop scheduling on a shared beat clock;
- independent track launch, replacement, stop, cancellation, and cleanup;
- source-neutral versioned material descriptors and async preparer contract;
- one concrete MIDI/Tone adapter, with no invented audio/sample payload;
- structured lifecycle/autoplay/material/scheduling errors;
- a controller for the exact BT-LIVE-101 pending -> scheduled -> observed
  handshake, including scene and identified transport-stop batches;
- compensation when material/runtime state changes while preparation awaits or
  a schedule acknowledgement fails;
- one browser singleton guarded by mutually exclusive `preview` / `live`
  leases; controllers subscribe to but never dispose that shared engine;
- a fail-safe `emergencyStop()` that reconciles engine and performance state;
- `reconcileMaterial()` cleanup for scheduled/active sources from an older
  persistent material revision, plus stale-observation fail-safe reset;
- a single-flight dirty drain that cannot lose a pending request during async
  preparation or the empty-pass microtask boundary;
- serialized preview operations so the latest rapid Play request succeeds;
- one Tone `scheduleRepeat` handle per recurring event, with no transport
  scheduling performed from inside a scheduled callback;
- boundary-time voice release plus deferred, idempotent Tone node disposal
  outside the look-ahead callback, using exact-time `triggerRelease` for
  monophonic voices when `releaseAll` is unavailable.

## Deterministic evidence

Passing during implementation:

- `pnpm run build:packages`;
- `pnpm --filter @beat-twin/audio-tone test` (all four then-current test files);
- `pnpm --filter @beat-twin/audio-tone build`;
- `pnpm typecheck`;
- `pnpm --filter @beat-twin/playground exec tsc -b`;
- `pnpm --filter @beat-twin/playground test` — 8 files, 79 tests;
- `pnpm --filter @beat-twin/playground build`;
- `pnpm smoke:packages`;
- `git diff --check`.

The focused engine suite proves two tracks sharing one clock for 32 beats,
replacement and stop on track A while track B continues, retry coalescence,
cancellation recovery, autoplay failure, unsupported future material, reset,
dispose, and identified transport stop/cancel. Controller tests cover scene
batching, material-version races, failed/no-op schedule acknowledgement, and
emergency reconciliation. They also cover partial scene ownership, stale
execution observations, document mutation during unlock, current-beat scene
failure reporting, and shared-engine disposal boundaries. Preview tests prove
schedule-before-start ordering and exclusive owner leases through the shared
engine, including rapid double-Play ordering.

The first real-browser gate passed Preview with zero errors. Its two-track
smoke also reached A+B active, A replaced, A stopped, and B continuing, but
Tone reported that events were being scheduled inside a scheduled callback.
That warning was treated as a failed console gate: recursive recurrence was
replaced with `LiveAudioPort.scheduleRepeatAtBeat` / Tone
`Transport.scheduleRepeat`. Fake-clock tests assert zero scheduling calls from
callbacks, and a Tone-port test verifies repeat interval/start conversion and
occurrence beats. A browser console recheck of this corrected snapshot remains
required.

That recheck removed the recurrence warning but reproduced it only when track A
was replaced. The remaining callback work was source teardown: `releaseAll()`
had no scheduled time and the voice was disposed immediately. The engine now
passes the boundary callback `audioTime` through `clearSource`; the Tone MIDI
adapter releases at that exact time and schedules idempotent disposal just
after it. Tests assert exact 4 s / 8 s replacement and stop times at 120 BPM,
plus deferred disposal and immediate timer cancellation.

The final fresh-browser run passed the visible Create Demo -> Play Preview ->
Stop Preview flow, then exercised the real Tone singleton with two tracks. The
trace observed A+B active, A replaced at beat 3, A stopped at beat 5, and B
still active after beat 6. Every transition carried the expected ID and the
final console contained zero errors and zero warnings. The browser runner was
Playwright CLI because the Browser plugin was not available.

`pnpm test` was rerun with local-listen access: all 176 tests passed, including
the Gateway, WebSocket, protocol, audio-engine, adapter, MCP, and security
suites. NanoDAW, typecheck, build, package smoke, and diff checks also passed.

The final independent adversarial review passed after the engine in-flight
reservation, unlock lifecycle generation, exclusive browser leases, material
reconciliation, stale-observation fail-safe reset, partial-scene cleanup,
single-flight dirty drain, and serialized preview operations were covered.

## Human listening decision

On 2026-07-19, the user explicitly answered `JE valide` to the requested human
listening gate and authorized the resulting branches to be pushed, proposed,
and merged. No additional subjective listening notes were supplied, so this
report records the approval without inventing observations that were not
stated.

The human gate is therefore cleared. BT-LIVE-102 may leave `Orbit Ready`, and
GitHub #28 / BT-LIVE-103 may become the unique authorized implementation item.

## Scope guard

No launcher redesign, MIDI capture, Capture Jam, audio/sample playback adapter,
Bitwig bridge, Gateway, MCP, S25, or persistent Song mutation was added.
