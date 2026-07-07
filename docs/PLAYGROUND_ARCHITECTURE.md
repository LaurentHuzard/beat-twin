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

## Current Browser Stack

- `packages/core` is the pure musical document model.
- `packages/commands` is the only mutation path for browser UI and future chat/LLM flows.
- `apps/playground` is a Vite React TypeScript app that dispatches commands and renders the resulting song state.
- `packages/audio-tone` schedules browser audition events and starts Tone.js only when preview playback is requested.
- `packages/adapters`, `packages/mcp`, `packages/ui`, and `packages/utils` are reserved extension points, not active implementations.

## Browser-First Flow

```text
User gesture or command draft
  -> BeatTwinCommand
  -> executeCommand()
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

`@beat-twin/commands` exports `BeatTwinCommand`, `executeCommand`, and `createCommandState`. Commands currently cover:

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

IDs are deterministic when callers inject `idFactory`. Browser callers can use `crypto.randomUUID`; tests use fixed IDs.

## Future Package Map

- `packages/audio-tone`: browser playback and auditioning from local `Song` state, without Bitwig or MCP writes.
- `packages/adapters/bitwig`: future home for Bitwig-specific translation after a compatibility pass.
- `packages/mcp`: future extracted MCP server wiring, if the root CLI grows too large.
- `packages/ui`: shared UI primitives once the playground repeats enough component patterns.
- `packages/utils`: small shared helpers only when duplication appears.

## Compatibility Rule

Sprint 0+1 must not break:

- root `beat-twin` package name and binary;
- MCP exports from `index.js`;
- existing policy gate behavior;
- existing Bitwig controller setup docs.

Any future Bitwig adapter extraction should be a separate tested migration with `node --check index.js` and the current offline MCP tests passing before and after.

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
