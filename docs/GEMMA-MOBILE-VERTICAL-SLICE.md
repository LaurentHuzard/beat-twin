# Gemma Mobile Agent: first vertical slice

## Outcome

From the Android chat, the user can ask:

> Create an instrument track named Acid Pulse with a four-bar syncopated A minor clip at 132 BPM.

Beat Twin returns a preview. After explicit confirmation, the disposable Bitwig project contains:

- tempo set to 132 BPM;
- one instrument track named `Acid Pulse`;
- one four-bar clip;
- a valid bounded MIDI pattern.

This is the first end-to-end write slice. It is intentionally narrower than a general Bitwig copilot.

## Product flow

1. The phone pairs with the workstation gateway.
2. The client requests a read-only session snapshot.
3. Gemma emits a constrained `propose_song_patch` call.
4. The gateway validates and compiles the patch into `BeatTwinCommand[]`.
5. The gateway returns a preview and a short-lived `planId`.
6. The user confirms the displayed plan.
7. The client calls `execute_plan(planId, confirmationToken)`.
8. The gateway rechecks the session revision and write policies.
9. The Bitwig adapter applies commands in order and records each result.
10. The client displays success, partial success, or failure without guessing.

## Initial API

### `GET /v1/health`

Returns gateway, authentication, and Bitwig bridge status without mutating Bitwig.

### `GET /v1/session`

Returns a normalized, read-only snapshot with a revision identifier.

### `POST /v1/plans`

Accepts a bounded `SongPatch` and creates a side-effect-free plan.

Example:

```json
{
  "baseRevision": "session-revision",
  "intent": "create_pattern",
  "tempo": 132,
  "track": {
    "kind": "instrument",
    "name": "Acid Pulse"
  },
  "clip": {
    "name": "A minor pulse",
    "lengthBeats": 16,
    "notes": [
      {
        "pitch": 45,
        "velocity": 104,
        "startBeat": 0,
        "lengthBeats": 0.5
      }
    ]
  }
}
```

The server owns IDs. The model cannot choose executable method names.

### `POST /v1/plans/:planId/confirm`

Creates a single-use confirmation token after returning the exact preview to the client.

### `POST /v1/plans/:planId/execute`

Executes the already confirmed, non-expired plan. It does not accept replacement commands.

## Limits for the first slice

- one new instrument track;
- one new MIDI clip;
- 1 to 64 notes;
- clip length from 1 to 16 bars;
- MIDI pitch and velocity from 0 to 127;
- positive note lengths;
- no note may exceed clip bounds;
- optional tempo from 40 to 240 BPM;
- no devices, presets, mixer writes, scenes, audio files, or recording;
- one active execution per paired client;
- plan expiry after five minutes.

## Required policies

- read access for inspection;
- `application_write` for instrument-track creation;
- `clip_write` for clip and note creation;
- `transport` only if tempo remains classified there.

The gateway must reject the plan before any mutation when a required policy is disabled.

## Package map

Proposed locations:

```text
apps/gateway
  HTTP/WebSocket transport, pairing, plan store

apps/android
  Compose chat, LiteRT-LM integration, tool calling

packages/agent-contract
  versioned request, patch, preview, and result schemas

packages/adapters/bitwig
  snapshot import and command execution

packages/commands
  canonical BeatTwinCommand validation and execution semantics
```

The Android build may remain a separate Gradle project while the shared wire contract is generated from versioned JSON Schema.

## Acceptance criteria

### Gateway

- rejects every unauthenticated session or plan request;
- never forwards mobile payloads directly to the controller;
- produces the same plan for the same validated patch and base snapshot;
- rejects stale revisions and expired plans;
- exposes no write endpoint without confirmation;
- logs plan and command IDs without auth secrets.

### Android

- runs Gemma locally;
- declares only the approved high-level functions;
- renders the plan summary before presenting confirmation;
- makes destructive ambiguity visible rather than silently choosing;
- handles gateway disconnects and partial execution results.

### Bitwig adapter

- keeps the controller on `127.0.0.1`;
- creates the expected track, clip, and notes in a disposable project;
- returns one structured result per low-level operation;
- stops after an error and reports the partial boundary;
- preserves the existing root MCP behavior.

### Tests

Offline tests cover:

- schema acceptance and rejection;
- note and clip bounds;
- policy computation;
- plan expiry;
- stale session revision;
- confirmation reuse;
- command compilation;
- partial execution reporting;
- authentication and token revocation.

A manual live smoke covers the complete S25-to-Bitwig path.

## Delivery order

1. Read-only authenticated gateway.
2. Android pairing and `inspect_session`.
3. Plan schema, compilation, and preview.
4. Controlled Bitwig execution.
5. Live smoke and recovery documentation.

## Deferred

- modifying an existing Bitwig clip;
- velocity humanization and density transformations;
- device and preset selection;
- arrangement generation;
- voice input;
- remote access outside the LAN;
- automatic rollback.
