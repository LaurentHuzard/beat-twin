# Local LLM to DAW: first dual-target vertical slice

## Outcome

From the Android chat, the user can ask:

> Create an instrument track named Acid Pulse with a four-bar syncopated A minor clip at 132 BPM.

The user explicitly selects either `minidaw` or `bitwig`. Beat Twin inspects that target, compiles the same SongPatch into canonical `BeatTwinCommand[]`, returns a target-aware preview, and requires confirmation.

After execution, the selected target contains the semantically equivalent result:

- tempo set to 132 BPM;
- one instrument track named `Acid Pulse`;
- one four-bar MIDI clip;
- a valid bounded MIDI pattern.

The Mini-DAW path works without Bitwig installed. The Bitwig path runs against a disposable project. Neither path requires a DAW-specific prompt or LLM tool.

## Product flow

1. The S25 pairs with the Beat Twin Agent Gateway.
2. The client calls `list_daw_targets`.
3. The user selects `minidaw` or `bitwig`.
4. Beat Twin requests the selected adapter's health, capabilities, snapshot, and revision.
5. Gemma emits a constrained `propose_song_patch` call.
6. Beat Twin validates the SongPatch against canonical musical rules and target capabilities.
7. Beat Twin compiles it into `BeatTwinCommand[]`.
8. The gateway returns a target-aware preview and short-lived `planId`.
9. The user confirms the exact displayed plan.
10. The gateway rechecks target ID, capability version, revision, expiry, confirmation, and scopes.
11. The selected adapter executes and records one result per command.
12. The client displays success, partial success, unsupported capability, or failure without guessing.

## Target-independent API

### `GET /v1/health`

Returns gateway status and configured adapter health summaries without mutation.

### `GET /v1/daws`

Lists configured DAW targets and capability versions.

Example:

```json
{
  "targets": [
    {
      "id": "minidaw",
      "connected": true,
      "capabilityVersion": "1"
    },
    {
      "id": "bitwig",
      "connected": false,
      "capabilityVersion": "1"
    }
  ]
}
```

### `GET /v1/sessions/:dawId`

Returns a normalized read-only snapshot, revision, and capabilities for the selected target.

### `POST /v1/plans`

Creates a side-effect-free plan.

Example:

```json
{
  "dawId": "minidaw",
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

The server owns executable IDs. The model cannot choose adapter method names.

### `POST /v1/plans/:planId/confirm`

Creates a single-use confirmation token for the exact target and preview.

### `POST /v1/plans/:planId/execute`

Executes the confirmed plan through its recorded adapter. The request cannot replace the target or commands.

## Initial portable capability

Both reference adapters must support the first portable subset:

- inspect normalized session;
- set tempo;
- create one instrument track;
- create one MIDI clip;
- add 1 to 64 notes.

Limits:

- clip length from 1 to 16 bars;
- MIDI pitch and velocity from 0 to 127;
- positive note lengths;
- no note may exceed clip bounds;
- tempo from 40 to 240 BPM;
- one active execution per paired client;
- plan expiry after five minutes.

Deferred capabilities include devices, presets, mixer writes, scenes, audio files, recording, and rendering.

## Package map

```text
apps/gateway
  authenticated transport, pairing, target registry, and plan store

apps/android
  Compose chat, LiteRT-LM, target selection, and high-level tools

apps/playground
  standalone Mini-DAW plus explicit connected-control mode

packages/agent-contract
  versioned SongPatch, preview, target, and result schemas

packages/daw-contract
  DawAdapter, capabilities, snapshots, plans, and execution reports

packages/adapters/minidaw
  @beat-twin/commands reference adapter

packages/adapters/bitwig
  canonical command to TCP/JSON-RPC adapter

packages/commands
  canonical BeatTwinCommand validation and semantics
```

The Android build may remain a separate Gradle project. Shared wire contracts are generated from versioned JSON Schema.

## Acceptance criteria

### Beat Twin Gateway

- rejects unauthenticated target, session, plan, and execution requests;
- contains no target-specific mutation logic;
- never forwards mobile payloads directly to a DAW;
- records adapter ID and capability version in every plan;
- rejects adapter switching or capability drift after planning;
- creates deterministic commands and previews from identical validated input;
- requires explicit confirmation before execution;
- logs plan and command IDs without auth secrets.

### Gemma Android client

- runs Gemma locally;
- lists and selects configured targets;
- declares only target-independent high-level functions;
- uses the same prompt and SongPatch format for Mini-DAW and Bitwig;
- renders target name, preview, warnings, and unsupported capabilities;
- handles disconnects and partial execution results.

### MiniDawAdapter

- works with Bitwig closed or absent;
- applies canonical commands through the existing command executor;
- preserves Playground standalone mode;
- accepts remote control only after explicit connected-mode opt-in;
- synchronizes resulting immutable state to the Playground;
- uses existing command history for recovery where supported.

### BitwigAdapter

- keeps the controller on `127.0.0.1`;
- translates only declared canonical capabilities;
- preserves root MCP behavior and existing policy gates;
- creates the expected track, clip, tempo, and notes in a disposable project;
- stops on error and reports the partial boundary;
- does not define LLM or planning behavior.

### Conformance

Given the same accepted SongPatch:

- both adapters receive equivalent canonical command semantics;
- both resulting normalized snapshots contain the expected tempo, track, clip, and notes;
- unsupported differences are declared as capabilities rather than silently ignored.

### Tests

Offline coverage includes:

- adapter capability negotiation;
- shared adapter conformance;
- schema acceptance and rejection;
- note and clip bounds;
- plan target binding;
- capability-version drift;
- policy computation;
- plan expiry;
- stale revisions;
- confirmation reuse;
- command compilation;
- authentication and revocation;
- partial execution reporting.

Manual live smokes cover:

1. S25 -> Beat Twin -> Mini-DAW;
2. S25 -> Beat Twin -> Bitwig.

## Delivery order

1. Define `DawAdapter`, capabilities, normalized snapshot, and conformance fixtures.
2. Add the authenticated DAW-agnostic gateway.
3. Implement `MiniDawAdapter` and Playground connected mode.
4. Extract and implement `BitwigAdapter` without breaking root MCP.
5. Build Android pairing, target selection, and `inspect_session`.
6. Add SongPatch planning, preview, confirmation, and execution.
7. Run the same S25 prompt against both targets.

## Deferred

- modifying existing clips beyond the portable subset;
- velocity humanization and density transformations;
- device and preset selection;
- arrangement generation;
- Ableton Live and Ardour adapters;
- voice input;
- remote access outside the LAN;
- automatic cross-adapter conversion;
- automatic rollback for external DAWs.
