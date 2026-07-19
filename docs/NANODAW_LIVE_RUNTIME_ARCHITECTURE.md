# NanoDAW Live Runtime Architecture

Status: BT-LIVE-101 implemented offline; no live audio proof is claimed.

## Ownership Boundaries

NanoDAW keeps one browser owner but two deliberately separate reducers:

| Boundary | Owner | Durable | Mutation path |
| --- | --- | --- | --- |
| Persistent document | `CommandState` containing the single `Song` | Yes | `BeatTwinCommand` / command batch |
| Ephemeral performance | `PerformanceState` containing IDs and runtime facts only | No | `PerformanceAction` / pure reducer |
| Audio execution | Future browser-owned live audio engine | No | Schedules a resolved transition ID and reports its outcome |
| Capture | Future explicit capture command | Yes | One materialized command batch, revision, autosave, and undo checkpoint |

`PerformanceState` never embeds or copies `Song`, tracks, clips, notes, samples,
or audio payloads. Its `trackId` and `clipId` values are opaque references to
material owned by the persistent document. Consequently, performance-only
actions do not advance `CommandState.revision`, touch undo or redo, or invoke
browser persistence.

## Pure Runtime Contract

`apps/playground/src/performanceRuntime.ts` owns:

- `PerformanceState` and bounded `PerformanceAction` values;
- immediate, next-beat, and next-bar target resolution;
- transport intent and observed clock position;
- one active clip reference and one pending transition per track;
- one global recording/overdub target identified by track, slot, and an
  optional clip for empty-slot recording;
- level, mute, solo, and bounded macro runtime state;
- deterministic scene fan-out under one reserved parent `groupId`;
- reset of ephemeral state without a document mutation.

Quantized beat and bar targets are strictly future boundaries. A request made
exactly on beat 4 therefore resolves to beat 5 for beat quantization or beat 8
for four-beat bar quantization. The target is calculated once when the request
enters the reducer and retained on the identified transition.

## Request, Schedule, And Observation

The reducer does not infer audible state from elapsed time:

```text
LaunchClip / StopTrack / LaunchScene
  -> pending transition with caller-provided ID and exact target beat
  -> audio engine accepts work
  -> MarkTransitionScheduled with the same ID
  -> audio engine executes at the target
  -> ObserveTransitionExecuted with the same ID
  -> activeClipId changes
```

`AdvanceClock` only records an observed beat. It does not promote queued work
or claim that requested audio is audible. A scheduling or execution failure is
reported with `ObserveTransitionFailed`; the previously active clip remains
active. Only an exact retry carrying the same ID and payload is idempotent. A
different ID is a new request and deterministically replaces pending work. Work
that has already been scheduled rejects `CancelPendingTransition`; the audio
owner must cancel it and then report `ObserveTransitionCancelled` before a
replacement is queued.

`LaunchScene` prevalidates every slot and child ID, reserves its parent
`groupId`, and attaches that group to every child. Scheduling, pending
cancellation, engine cancellation, and failure use the atomic group actions
`MarkSceneScheduled`, `CancelPendingScene`, `ObserveSceneCancelled`, and
`ObserveSceneFailed`. Child scheduling, cancellation, and failure APIs reject
group members; execution remains observable per track because an audio engine
can report a real partial outcome.

Transport stop follows the same honesty rule. `StopTransport` reserves a
caller-provided ID and creates one `pending` stop with immutable request and
target beats. `MarkTransportStopScheduled` acknowledges engine ownership.
`CancelPendingTransportStop` refuses scheduled work; scheduled cancellation
must arrive through `ObserveTransportStopCancelled` with the matching ID. Only
a matching scheduled `ObserveTransportStopped` enters `idle` and clears active
runtime claims. `StartTransport` is idempotent while already playing, never
moves the beat backward, and cannot erase or escape an unresolved stop.

## Store Integration

The Playground Zustand store owns `commandState` and `performanceState` beside
one another. `dispatchPerformance()` invokes the pure reducer, then reconciles
its opaque references against a source-neutral `{version, clipIdsByTrack}`
projection of the current `Song`. Incremental document commands remove orphaned
runtime references. Full replacements through load, import, undo, redo, or a
new remote song reset the runtime and advance `materialVersion`. Neither path
turns performance gestures into command history, autosave, preview audio,
adapter, Gateway, MCP, or Bitwig calls.

There is intentionally no launcher UI and no Tone.js scheduling in this slice.
BT-LIVE-102 may connect a persistent clock and audio graph to the transition
handshake without changing document ownership.

## Capture Boundary

Capture Jam is not implemented. A future capture path must read an explicit,
bounded performance snapshot or event selection, materialize document commands
before mutation, and apply exactly one atomic command batch. It must not pass a
`PerformanceState` object to persistence or make live gestures implicit song
commands.

## Source-Agnostic Follow-Up

The runtime deliberately identifies playable material only by `clipId`. It
does not assume that a clip contains MIDI notes. BT-LIVE-102 and later audio
work must preserve this source-neutral transition contract so a future
audio-clip and sample tranche can schedule the same launch/stop lifecycle
without creating a parallel performance reducer.

## Offline Evidence

Focused pure tests cover transport, quantization boundaries, launch,
replacement, cancellation, schedule/observation, stop, scenes, recording,
overdub, mix, macros, reset, cross-track isolation, and store separation. These
tests prove deterministic state behavior only; they do not prove Tone.js audio,
browser timing, listening quality, or an external integration.
