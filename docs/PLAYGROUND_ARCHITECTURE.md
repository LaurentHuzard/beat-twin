# Playground Architecture

This document describes the browser-first target introduced in Sprint 0+1. The
existing Bitwig MCP server in `index.js` remains the compatibility anchor and is
not moved in this slice. Sprint 2 browser playback and audition boundaries live
in [`SPRINT-2-BROWSER-AUDITION.md`](SPRINT-2-BROWSER-AUDITION.md). Sprint 3
note editing boundaries live in [`SPRINT-3-NOTE-EDITOR.md`](SPRINT-3-NOTE-EDITOR.md).
Sprint 4 browser-local save/load boundaries live in
[`SPRINT-4-SAVE-LOAD.md`](SPRINT-4-SAVE-LOAD.md).
Sprint 5 pattern tool boundaries live in
[`SPRINT-5-PATTERN-TOOLS.md`](SPRINT-5-PATTERN-TOOLS.md).
Sprint 6 local undo/redo boundaries live in
[`SPRINT-6-UNDO-REDO.md`](SPRINT-6-UNDO-REDO.md).
Sprint 7 keyboard shortcut boundaries live in
[`SPRINT-7-KEYBOARD-SHORTCUTS.md`](SPRINT-7-KEYBOARD-SHORTCUTS.md).
Sprint 8 timeline selection feedback lives in
[`SPRINT-8-TIMELINE-SELECTION.md`](SPRINT-8-TIMELINE-SELECTION.md).
Sprint 9 command palette boundaries live in
[`SPRINT-9-COMMAND-PALETTE.md`](SPRINT-9-COMMAND-PALETTE.md).
Sprint 10 draft command parser boundaries live in
[`SPRINT-10-DRAFT-COMMAND-PARSER.md`](SPRINT-10-DRAFT-COMMAND-PARSER.md).
The ephemeral live performance reducer, audio-observation handshake, and future
capture boundary live in
[`NANODAW_LIVE_RUNTIME_ARCHITECTURE.md`](NANODAW_LIVE_RUNTIME_ARCHITECTURE.md).
The persistent browser clock, source-neutral material preparation boundary, and
per-track audio graph live in
[`NANODAW_LIVE_AUDIO_ENGINE.md`](NANODAW_LIVE_AUDIO_ENGINE.md).

## Current Browser Stack

- `packages/core` is the pure musical document model.
- `packages/commands` is the only mutation path for browser UI and future chat/LLM flows.
- `apps/playground` is a Vite React TypeScript app that dispatches commands and renders the resulting song state.
- `packages/audio-tone` owns the pure live scheduler and persistent browser
  audio engine. Tone.js is still loaded lazily only when playback is requested.
- `packages/adapters/nanodaw` and `packages/adapters/bitwig` implement the two
  current DAW targets.
- `packages/mcp` implements the reusable NanoDAW MCP schemas, service, and
  transport; `apps/nanodaw-mcp` owns its process composition and lifecycle.
- `packages/ui` and `packages/utils` remain reserved until real cross-feature or
  cross-package reuse justifies them.

## Browser-First Flow

```text
User gesture or command draft
  -> BeatTwinCommand
  -> executeCommand() compatibility wrapper
  -> or materializeCommandBatch() preview
  -> executeCommandBatch(ExecutableBeatTwinCommand[])
  -> immutable Song state
  -> optional local CommandState history snapshot
  -> React/Zustand render
  -> optional browser-local serializeSong() persistence
```

The browser surface should not mutate song objects directly. It should always dispatch a `BeatTwinCommand`, receive command events, and render the next immutable state.

## Core Model

The core model uses musical units that are stable across browser and DAW integrations:

- tempo is BPM;
- timeline positions are absolute beats;
- clip starts are absolute beats;
- note starts are relative to the clip pattern;
- note lengths and clip lengths are beats.

The serializer is schema-versioned so later imports, exports, and Bitwig adapters can reject incompatible data instead of guessing.

## Command Boundary

`@beat-twin/commands` exports the historical single-command wrapper plus the
strict `materializeCommandBatch()` / `executeCommandBatch()` boundary. Remote
plans execute only fully materialized `ExecutableBeatTwinCommand[]`; a batch
advances the monotonic session revision exactly once. Commands currently cover:

- `CreateSong`;
- `CreateTrack`;
- `CreateClip`;
- `AddNote`;
- `UpdateNote`;
- `RemoveNote`;
- `DuplicateClip`;
- `QuantizeClip`;
- `TransposeClip`;
- `SetTempo`;
- `StartPlayback`;
- `StopPlayback`;
- `SetPlayhead`.

IDs are deterministic when callers inject `idFactory`. Browser callers can use
`crypto.randomUUID`; tests use fixed IDs. Materialization is side-effect free,
and execution rejects stale revisions before mutation.

## Package Map

- `packages/audio-tone`: browser playback and auditioning from local `Song` state, without Bitwig or MCP writes.
- `packages/daw-contract`: versioned adapter, capability, plan, report, and conformance contracts.
- `packages/agent-contract`: strict `SongPatchV1` validation, compilation, and preview.
- `packages/adapters/nanodaw`: transactional memory adapter and abstract browser-owned port.
- `packages/gateway-http`: typed loopback HTTP delivery and authenticated
  browser WebSocket proxy for that browser-owned port; it keeps no song
  snapshot. `apps/gateway` remains a compatibility facade. See
  [`BROWSER_NANODAW_WEBSOCKET.md`](BROWSER_NANODAW_WEBSOCKET.md).
- `packages/adapters/bitwig`: authenticated, target-bound launcher-slot
  translation with strict musical bounds, stop-first-failure semantics, and
  exact note readback.
- `packages/mcp`: standalone NanoDAW catalog, inspection, and plan-preparation
  MCP surface. `apps/nanodaw-mcp` composes Gateway delivery, browser proxy,
  pairing, plans, adapter, stdio, and shutdown without changing the tool
  contract.
- `packages/retention`: bounded, injected process-lifetime storage primitives
  used by idempotency and safety registries. See
  [`ADR-003-PROCESS-LIFETIME-RETENTION.md`](ADR-003-PROCESS-LIFETIME-RETENTION.md).
- `packages/ui`: shared UI primitives once the playground repeats enough component patterns.
- `packages/utils`: small shared helpers only when duplication appears.

## Compatibility Rule

Sprint 0+1 must not break:

- root `beat-twin` package name and binary;
- MCP exports from `index.js`;
- existing policy gate behavior;
- existing Bitwig controller setup docs.

The portable Bitwig adapter now lives in `packages/adapters/bitwig`, while the
historical root MCP path remains the compatibility anchor. Any further root
modularization must keep `node --check index.js`, the 57-tool snapshot, policy
tests, and protocol tests passing before and after.

Browser audition follows the same compatibility rule. It must not import
`index.js`, call the local Bitwig TCP bridge, or treat browser preview controls
as DAW transport controls.

Browser note editing follows that rule too. It mutates only the local `Song`
document through `BeatTwinCommand` events; it is not Bitwig clip writing.

Browser save/load also follows the same rule. It serializes local `Song` state
with `@beat-twin/core`, stores it in browser `localStorage`, and validates
imports with `deserializeSong()` before replacing the Playground document.

Browser pattern tools follow the same rule. Duplicate, quantize, and transpose
operate on local immutable `Song` state through command events only.

Browser undo/redo stays local too. It restores previous `CommandState` snapshots
inside the Playground store, then reuses the existing local save path for the
restored song.

Browser keyboard shortcuts invoke existing local Playground actions only, and
are ignored while focus is inside editable fields.

Browser timeline selection feedback is derived from local `Song` state only. It
highlights selected tracks and clips, summarizes track/clip/note counts, and
draws clip-local note markers without adding a new mutation path.

Browser command palette actions are another local UI entry point to the same
Playground store actions. They do not parse chat text, call Bitwig, or bypass
`BeatTwinCommand` for song mutations.

Browser command drafts use a small deterministic parser for known action
phrases only. Unknown or context-blocked drafts are reported in the local
command log instead of being guessed or sent to an external service.

Live performance gestures use a separate pure `PerformanceState` reducer in
the same browser store. That state contains opaque song IDs and runtime facts,
not a second `Song`. Its actions do not enter command history or persistence,
and active clip state changes only after an identified audio execution is
observed. The complete ownership and capture rules are documented in
[`NANODAW_LIVE_RUNTIME_ARCHITECTURE.md`](NANODAW_LIVE_RUNTIME_ARCHITECTURE.md).
The controller binds those identified transitions to one live engine. Preview
and the future launcher share the same browser singleton through mutually
exclusive owner leases; neither may reset or dispose the other's runtime.
Transition material is immutable and versioned, async preparation is cancelled
if browser state changes before its schedule acknowledgement, and
`reconcileMaterial()` removes old engine work after persistent edits. See
[`NANODAW_LIVE_AUDIO_ENGINE.md`](NANODAW_LIVE_AUDIO_ENGINE.md).

## Validation

Immediate pure checks:

```bash
rtk proxy node --test packages/core/test/*.test.ts packages/commands/test/*.test.ts packages/audio-tone/test/*.test.ts
```

Compatibility checks:

```bash
rtk proxy node --check index.js
rtk proxy node --test tests/session-inspect.test.js tests/policy-gate.test.js tests/arrangement-plan.test.js
```

Protocol smoke still needs an environment that allows local TCP listen on `127.0.0.1`:

```bash
rtk proxy node --test --test-isolation=none tests/protocol-smoke.test.js
```

Once `pnpm` can access its local database/store, run:

```bash
rtk proxy pnpm test
rtk proxy pnpm --filter @beat-twin/playground test
rtk proxy pnpm --filter @beat-twin/playground build
```
