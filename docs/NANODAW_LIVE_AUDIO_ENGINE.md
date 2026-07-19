# NanoDAW Live Audio Engine

BT-LIVE-102 connects the ephemeral performance contract to one persistent,
browser-owned Tone.js clock. It does not add launcher UI; BT-LIVE-103 consumes
this boundary.

## Ownership

```text
Song (persistent document, immutable snapshots)
  -> PerformanceState request (pending, identified, quantized target beat)
  -> LiveAudioController
  -> LiveAudioEngine (one clock, stable bus per track)
  -> material preparer selected by material kind
  -> scheduled Tone.js source
  -> identified engine observation
  -> PerformanceState (scheduled, then executed/cancelled/failed)
```

- `Song` is the only persistent musical document.
- `PerformanceState` owns requested, scheduled, and observed runtime facts. It
  is never saved as a second song.
- `LiveAudioEngine` owns the clock, scheduled handles, prepared sources, and
  per-track output buses. It never imports `Song` or assumes MIDI fields.
- `browserAudioRuntime.ts` owns the single browser engine promise plus an
  exclusive owner lease. Existing clip preview acquires `preview`; the future
  launcher controller acquires `live`. A second owner fails structurally, so
  preview cannot stop/reset a live performance and a controller cannot dispose
  the shared engine.

## Source-neutral material boundary

Every launch carries a `LiveClipMaterial` descriptor:

- `kind`: adapter registry key;
- `materialId`: content-addressed audible identity, independent from Song,
  track, clip, launcher slot, and note IDs;
- `version`: deterministic numeric hash of the same audible content, not the
  global Song revision;
- `clipId` and `lengthBeats`: generic loop identity and bounds.

MIDI is the only implemented adapter in this tranche. `LiveMidiClipMaterial`
adds an instrument ID and notes. The Tone preparer validates MIDI, creates the
voice, connects it to the track bus, and returns generic prepared events. A
later audio-clip or sample adapter can implement the same preparation result
without changing the engine, scheduler, transition requests, or controller
handshake. No speculative audio/sample payload is defined here.

Material preparation is asynchronous. After every preparation await, the
controller revalidates the exact transition/group and content identity before
acknowledging `MarkTransitionScheduled` or `MarkSceneScheduled`. If browser
state changed, or the acknowledgement is rejected/no-op, it cancels the engine
work immediately and suppresses an orphan cancellation observation.
Pending synchronization is a single-flight dirty drain: another request during
an await marks the pass dirty and guarantees a second scan before ownership is
released, including the empty-first-pass microtask edge.

`reconcileMaterial()` is the explicit hook after a persistent Song revision.
It compares active and scheduled engine material IDs with a canonical MIDI
identity made from adapter schema, instrument, loop length, and sorted audible
note fields. Renames, note IDs, and relocation do not rebuild sound. Scheduled
old material is cancelled and requeued with the same transition/group IDs and
target; active edited material is replaced at its next exact loop boundary.
Ambiguous ownership, partial scene cancellation, or missing active timing stops
and resets the live runtime and reports a structured reason to the launcher.
Late/stale engine observations are identity- and material-checked before reducer
dispatch.

## Timing and track isolation

- All target positions are absolute musical beats on one clock.
- A scene is prepared and scheduled as one batch with at most one transition
  per track.
- Each track has one stable bus plus an active source and optional pending
  source.
- Replacing a clip adds a cutoff at the replacement boundary. Cancelling the
  replacement removes that cutoff so the prior loop continues.
- Boundary callbacks propagate Tone's exact `audioTime` into source release.
  Polyphonic Tone voices receive `releaseAll(audioTime)`. Drum notes own stable
  voices per note/lane so different lanes remain exactly simultaneous. A same
  lane/time duplicate and same-time notes on monophonic bass/lead use a
  deterministic first-note-wins policy instead of shifting either event.
  Voices without `releaseAll` fall back to `triggerRelease(audioTime)`.
  Node disposal is deferred until just after that audio time, outside the
  look-ahead callback. Deferred dispose is idempotent; an immediate lifecycle
  cleanup cancels its timer and disposes synchronously.
- Stopping one track disposes only that track source. It does not stop the
  clock or another track.
- Loop recurrence is scheduled from the immutable activation beat, avoiding a
  wall-clock drift accumulator.
- Each recurring event owns one `scheduleRepeatAtBeat` handle. The Tone adapter
  maps it to `Transport.scheduleRepeat`, forwards Tone's callback audio time,
  and tracks the corresponding occurrence beat for cutoff checks. No new
  transport event is scheduled from inside an audio callback.
- Requests that miss their target during asynchronous preparation fail closed
  with a structured `schedule_failed` error.
- The controller exposes the active clip's engine-owned activation beat and
  loop length to the MIDI recorder. Overdub derives its strictly-future target
  from that phase anchor instead of assuming that a global bar is clip-local
  beat zero. Missing, stale, or mismatched timing fails closed.

The generic scheduler validates that every prepared event fits completely
inside the loop. Notes that overrun the material tail are rejected rather than
silently leaking into the next occurrence.

## Lifecycle and errors

The engine lifecycle is `new -> initialized -> ready -> running`, with explicit
`suspended`, `stopped`, `blocked`, and terminal `disposed` phases. Initialization
sets tempo; `unlock()` is called only from a browser user gesture; reset and
dispose cancel handles, release voices, and dispose owned buses.

Normal transport stop uses the identified performance handshake:
`StopTransport -> MarkTransportStopScheduled -> ObserveTransportStopped`.
`emergencyStop()` is deliberately a fail-safe API: it stops the engine and
dispatches `ResetPerformance` immediately so runtime state cannot remain
`playing` while audio is stopped.

Failures use stable codes (`autoplay_rejected`, `tone_unavailable`,
`invalid_state`, `invalid_request`, `material_not_ready`,
`unsupported_material`, `schedule_failed`, and `disposed`). Browser autoplay
rejection therefore remains recoverable by another explicit user gesture.
Tempo is fixed for one live controller lifetime. Editing Song BPM while live
fails closed with a visible structured error; the next explicit Start live
initializes the engine with the edited BPM.

## Preview compatibility

The existing Play Preview action now schedules its single MIDI clip through
the live engine under an exclusive `preview` lease. It resets only after that
lease is acquired, unlocks audio, schedules at beat zero, and starts the same
transport. Stop releases the lease. If `live` already owns the engine, preview
fails without touching its transport or graph.
Preview `play` and `stop` operations are serialized. Two rapid Play requests
therefore stop/release in order and leave the latest audition running instead
of racing for the reserved lease.

## Validation boundary

Deterministic tests cover two tracks over 32 beats, exact replacement and
track-local stop, cancellation/retry, material preparation races, transport
stop identity, autoplay errors, cleanup, and preview ordering. A real browser
gate must still use the visible Play Preview button for the user gesture and
record console/autoplay behavior. The first two-track browser smoke exposed a
Tone nested-scheduling warning. Recurrence now uses `scheduleRepeat`; a second
gate isolated the remaining warning to replacement teardown, so release uses
the callback time and dispose is deferred outside the callback. The console
gate must be repeated on that corrected implementation. Listening quality and
uninterrupted audible continuity remain a human gate; automated tests must not
claim them.
