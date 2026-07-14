# NanoDAW Live - Product And Architecture Reflection

Updated: 2026-07-14  
Status: Proposed  
Implementation target: local worktree branch `dev/nanodaw-standalone`

## Executive Summary

NanoDAW already has a strong deterministic editing foundation: an immutable song
model, a command-only mutation boundary, atomic batches, monotonic revisions,
undo/redo, browser-local persistence, note editing, pattern tools, and Tone.js
audition.

The missing piece is not more conventional DAW surface area. It is a live
performance runtime.

The proposed product direction is:

> A continuous musical clock around which the player can launch, replace,
> record, and transform loops without breaking the flow.

The smallest version that should feel like an instrument is:

- four tracks;
- four scenes;
- one active clip per track;
- quantized clip and scene launch;
- MIDI loop recording and overdub;
- four built-in sounds;
- volume, mute, and solo per track;
- four performance macros;
- one `Capture Jam` action that preserves the useful accident.

This is deliberately not a miniature clone of a desktop DAW. It is a compact
loop instrument built on NanoDAW's existing document model.

## 1. Current Product Assessment

### What NanoDAW already gets right

The current architecture has several assets worth protecting:

- `@beat-twin/core` owns a small, schema-versioned musical document;
- `@beat-twin/commands` is the only mutation path;
- command batches are materialized before execution and advance one revision;
- browser state remains authoritative;
- undo/redo and persistence operate on the same document boundary;
- the UI can create songs, tracks, clips, and notes;
- clip content can be duplicated, quantized, and transposed;
- Tone.js can schedule and audition MIDI notes;
- standalone operation does not require Bitwig, MCP, the Gateway, or the S25.

These choices make NanoDAW inspectable, testable, and safe for later agent
integration.

### Why it is not a live instrument yet

The current playback path auditions a selected clip. It does not provide a
persistent performance session.

The product currently lacks:

- continuous loop playback;
- a stable musical clock shared by all tracks;
- active and queued clip state;
- launch quantization;
- scene launch;
- per-track instruments and mix controls;
- live recording or overdub;
- performance-oriented visual feedback;
- a way to capture a jam as persistent musical data.

The interface is therefore effective as a miniature editor, but not yet as a
surface on which a player can build momentum.

## 2. The Essence Of A DAW For Live Use

A live DAW is best understood as a musical state machine rather than a linear
arrangement editor.

Its essential properties are:

1. **The clock continues.** Playback is not repeatedly rebuilt around each user
   gesture.
2. **Actions can be queued.** The player can decide now and hear the change at a
   musically valid boundary.
3. **Transitions are predictable.** Clip, scene, recording, and stop actions
   respect explicit launch quantization.
4. **State is legible.** The interface clearly distinguishes idle, queued,
   playing, recording, overdubbing, and stopping states.
5. **Useful accidents survive.** A performance can be captured without forcing
   the player to pre-author an arrangement.
6. **Failure does not kill the jam.** Optional integrations and non-critical UI
   errors must not stop the local musical runtime.

The linear timeline can remain useful, but it should become the memory of the
performance rather than the mandatory starting point.

## 3. Product Thesis

### North star

> Four tracks by four scenes, launchable on the beat, with enough sound and
> recording control to create a small evolving piece in a few minutes.

### The primary user loop

1. Start a new jam.
2. Launch a drum loop.
3. Queue a bass loop for the next bar.
4. Record a four-bar lead loop into an empty slot.
5. Launch a second scene as a variation.
6. move one or more performance macros;
7. capture the jam;
8. reload it later and continue playing.

The player should not need to expose JSON, inspect command logs, configure an
external DAW, or understand the agent architecture to complete this loop.

### Product boundary

NanoDAW Live should remain:

- browser-owned;
- local-first;
- MIDI-first;
- deterministic at the document boundary;
- useful with no external target;
- small enough to understand as a single instrument.

## 4. Minimum Playable Product

### Surface

| Area | Minimum capability |
| --- | --- |
| Transport | Persistent clock, BPM, 4/4 meter, play, stop, bar/beat position |
| Launcher | 4 tracks x 4 clip slots |
| Clip rule | At most one active clip per track |
| Scenes | Four rows launchable as coordinated musical states |
| Quantization | Immediate, next beat, or next bar; next bar is the default |
| Loop lengths | 1, 2, 4, or 8 bars |
| Instruments | Drums, mono bass, poly chords, lead |
| Mix | Volume, mute, and solo per track |
| Performance | Tone, Space, Echo, and Repeat macros |
| Recording | Quantized MIDI recording and overdub into a selected slot |
| Editing | A playable step grid plus the existing detailed note editor |
| Capture | Persist the performed clip state and performance events |
| Restore | Reload into a performance-ready state without external services |

### Slot gestures

The default interaction grammar should stay small:

- click or tap an empty slot: arm recording;
- click or tap a populated idle slot: queue launch;
- click or tap a playing slot: queue stop;
- long press or secondary action: open detailed editing;
- click or tap a scene header: queue the whole scene;
- duplicate gesture: create a variation in the next empty slot.

Every gesture must have immediate visual acknowledgement even when its musical
effect is quantized for a later boundary.

## 5. Explicit Non-Goals For The First Live Release

The following features are intentionally outside the first slice:

- audio recording;
- audio warping or time stretching;
- third-party plugin hosting;
- arbitrary audio and MIDI routing;
- nested groups;
- comping;
- full automation lanes;
- unlimited tracks or scenes;
- desktop-DAW parity;
- implicit Bitwig or Gateway startup;
- AI-generated changes applied directly to the currently audible clip.

Keeping these out is not a temporary quality compromise. It protects the product
from becoming a broad but unplayable DAW shell.

## 6. Required Architecture Shift

The current command model is appropriate for persistent song edits. It should
not also carry every high-frequency live gesture.

The architecture should explicitly separate three layers.

### 6.1 Persistent document state

`Song` and `BeatTwinCommand` continue to own durable musical content:

- tracks;
- clips;
- notes;
- tempo defaults;
- clip lengths;
- instrument assignments;
- persistent mixer defaults;
- captured performance data.

Document mutations:

- advance revisions;
- participate in undo/redo;
- autosave;
- remain suitable for adapter execution and agent preview.

### 6.2 Ephemeral performance state

A new `PerformanceState` should own live runtime facts:

```ts
type PerformanceState = {
  phase: "idle" | "playing" | "stopping";
  currentBeat: number;
  currentBar: number;
  launchQuantization: "immediate" | "beat" | "bar";
  activeClipByTrack: Readonly<Record<string, string | null>>;
  queuedClipByTrack: Readonly<Record<string, string | null>>;
  queuedStopByTrack: Readonly<Record<string, boolean>>;
  recordingSlot: { trackId: string; clipId: string } | null;
  overdubbingSlot: { trackId: string; clipId: string } | null;
  trackLevels: Readonly<Record<string, number>>;
  mutedTracks: ReadonlySet<string>;
  soloedTracks: ReadonlySet<string>;
  macroValues: Readonly<Record<string, number>>;
};
```

Representative `PerformanceAction` values are:

```text
StartTransport
StopTransport
LaunchClip
StopTrack
LaunchScene
ArmRecordSlot
StartOverdub
StopOverdub
SetTrackLevel
SetTrackMute
SetTrackSolo
SetMacro
```

These actions should be low-latency and should not create a document revision on
every gesture.

### 6.3 Capture boundary

`CaptureJam` converts selected ephemeral performance history into persistent
song data in one explicit operation.

A capture should be:

- deterministic from its input event log;
- materialized before document mutation;
- one atomic command batch;
- one revision;
- one autosave;
- one undo checkpoint.

This preserves the strengths of the current command system without making the
live runtime sluggish or revision-heavy.

## 7. Persistent Audio Runtime

The Tone.js engine should become a long-lived service rather than a disposable
single-clip preview.

It needs:

- one shared transport clock;
- one audio chain per track;
- stable scheduling across clip transitions;
- quantized activation and deactivation;
- event cancellation that does not reset unrelated tracks;
- clear lifecycle methods for start, stop, suspend, resume, and dispose;
- deterministic scheduler tests that do not require Web Audio;
- browser integration tests for real audio-context and autoplay behavior.

### Timing invariants

The live engine should enforce these rules:

1. Queued actions resolve to an exact target beat before scheduling.
2. A track never has two audible clip loops at the same time unless a future
   crossfade feature explicitly permits it.
3. Repeated launch requests for the same target coalesce.
4. A queued replacement cannot leave the previous clip hanging after the launch
   boundary.
5. Stopping one track does not stop the global clock.
6. UI state is derived from the same scheduled transition records used by the
   engine, not from optimistic labels disconnected from audio reality.

## 8. Sound Design Boundary

The first live version needs distinct roles, not an open-ended synthesizer lab.

Suggested built-in tracks:

| Track | Initial voice | Essential controls |
| --- | --- | --- |
| Drums | Small synthesized or bundled kit | tone, decay, drive |
| Bass | Mono synth | cutoff, resonance, glide |
| Chords | Poly synth | tone, envelope, space |
| Lead | Mono/poly lead | tone, delay send, glide |

The four global performance macros should have predictable musical behavior:

- **Tone:** coordinated filter movement;
- **Space:** reverb send or decay;
- **Echo:** tempo-synced delay send and feedback within safe bounds;
- **Repeat:** quantized rhythmic repeat or stutter.

Macro automation can be captured later, but the first implementation must keep
all values bounded and click-safe.

## 9. UI Direction

The launcher becomes the primary surface. The existing timeline, command log,
JSON storage panel, and numerical note editor become secondary drawers or debug
surfaces.

The most important UI states are:

```text
empty
idle
queued
playing
record-queued
recording
overdubbing
stop-queued
error
```

Color alone must not carry state. Text, iconography, animation, and accessible
labels should agree.

The interface should remain functional on a laptop and on a narrow touch screen.
Touch targets must be large enough for performance, and no primary action should
require hover.

## 10. Definition Of Fun

The product is not ready merely because every control works independently.

The decisive acceptance performance is:

> Two tracks loop together. A variation is queued for the next bar. The music
> continues without a discontinuity. A third loop is recorded and overdubbed.
> A scene change is queued and executes on time. A macro is moved during the
> transition. The jam is captured, the page is reloaded, and the session returns
> in a state from which playing can immediately continue.

This flow must work:

- with Bitwig stopped;
- with no MCP process;
- with no Gateway process;
- with no S25 endpoint;
- without uncaught console errors;
- without a hidden second owner of song state.

## 11. Delivery Strategy

The recommended delivery order is:

```text
performance contract and clock
  -> persistent per-track audio graph
  -> 2 x 2 launcher vertical slice
  -> 4 x 4 launcher and scenes
  -> playable step editor and variations
  -> MIDI recording and overdub
  -> mixer and performance macros
  -> Capture Jam and restore
  -> real-browser live QA and hardening
```

The 2 x 2 launcher is the first product gate. It must prove uninterrupted,
quantized replacement between two clips on two separate tracks before the UI is
expanded to 4 x 4.

## 12. Estimation Method

Ticket estimates use four independent signals.

### Complexity

- `S`: isolated and mechanically bounded;
- `M`: one subsystem with moderate integration;
- `L`: multiple files or layers with meaningful test work;
- `XL`: cross-layer timing, state, persistence, or migration risk.

### Token budget

The token range estimates total agent context consumption for a serious
implementation pass, including:

- repository and ticket reading;
- design reasoning;
- code generation and editing;
- test construction;
- debugging iterations;
- self-review and delivery summary.

It is a planning heuristic, not an API billing promise. A task should be split if
it repeatedly exceeds the upper bound without producing a reviewable slice.

### Model profile

- `Codex / reasoning high`: architecture, audio timing, concurrency, state
  machines, persistence, and cross-package migrations;
- `Codex / reasoning medium`: bounded UI, styles, fixtures, and straightforward
  command plumbing after contracts are frozen;
- `GPT-5.6 Pro / review`: independent architecture, musical-product, and failure
  mode review for high-risk slices.

### Human effort

Human effort measures focused engineering time including local review and manual
browser validation:

- `S`: up to one day;
- `M`: one to two days;
- `L`: two to four days;
- `XL`: four to seven days.

Agent token estimates do not remove the need for human listening tests. Timing,
feel, and musical usefulness are product properties, not only test assertions.

## 13. Ticket Map

The implementation tickets are maintained as GitHub issues using the
`BT-LIVE-*` identifiers. Each issue includes priority, dependencies, complexity,
token budget, model profile, human effort, acceptance criteria, and validation
requirements.

## 14. Guardrails

- Standalone remains the default and must stay useful when every optional target
  is absent.
- The browser remains the sole owner of NanoDAW song state.
- Live runtime state must not silently become a second persistent song model.
- High-frequency gestures must not flood document revisions or undo history.
- Audio failures must be surfaced without corrupting the song document.
- Agent proposals may prepare a variation in a non-audible slot, but must never
  replace an audible clip without explicit preview and confirmation.
- Existing Bitwig and Gateway safety boundaries remain unchanged.

## Decision

Proceed with a launcher-first, MIDI-first NanoDAW Live core. Preserve the current
immutable document and command system, add a separate ephemeral performance
runtime, and prove the concept through a 2 x 2 quantized launcher before scaling
the surface.
