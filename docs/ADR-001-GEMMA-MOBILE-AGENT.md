# ADR-001: Local LLM and DAW adapter boundary

- Status: Proposed
- Date: 2026-07-10
- Owners: Beat Twin maintainers
- Decision scope: local LLM clients, Beat Twin orchestration, and DAW-agnostic execution

## Context

Beat Twin is not an agent dedicated to Bitwig. Its product boundary is:

```text
Local LLM
  -> Beat Twin
  -> selected DAW
```

The first local LLM client is Gemma 4 running on a Samsung S25. The first two execution targets are:

- the Beat Twin browser NanoDAW, which allows the concept to be tested without a paid DAW;
- Bitwig Studio, which proves that the same orchestration can control an external production DAW.

Ableton Live and Ardour are later adapters, not separate agent products.

Beat Twin already has useful canonical foundations:

- a pure musical document model in `@beat-twin/core`;
- a typed mutation language in `@beat-twin/commands`;
- a browser NanoDAW in `apps/playground`;
- a policy-gated MCP and TCP/JSON-RPC bridge to Bitwig.

The missing boundary is a DAW contract between Beat Twin plans and target-specific execution.

## Decision

Beat Twin is the DAW-agnostic orchestrator.

The local LLM interprets creative language and proposes intent. Beat Twin owns session inspection, capability negotiation, validation, preview, authorization, routing, execution reporting, and audit events. A selected DAW adapter owns only target-specific inspection and command translation.

```text
Gemma 4 on S25
  -> authenticated Beat Twin Agent Gateway
  -> intent and SongPatch validation
  -> canonical BeatTwinCommand[]
  -> capability and policy checks
  -> selected DawAdapter
       -> NanoDAW
       -> Bitwig
       -> Ableton Live (later)
       -> Ardour (later)
```

The LLM never receives or emits raw Bitwig JSON-RPC, Tone.js calls, Ableton APIs, OSC messages, controller-script methods, or arbitrary executable code.

## Canonical command boundary

`@beat-twin/commands` remains the canonical mutation language for all targets.

Initial portable commands include:

- `CreateSong`
- `CreateTrack`
- `CreateClip`
- `AddNote`
- `UpdateNote`
- `RemoveNote`
- `DuplicateClip`
- `QuantizeClip`
- `TransposeClip`
- `SetTempo`
- `StartPlayback`
- `StopPlayback`
- `SetPlayhead`

DAW-specific features must not leak into the canonical command set without a target-independent musical meaning.

## DAW adapter contract

A `DawAdapter` provides a narrow runtime contract:

```ts
interface DawAdapter {
  readonly id: string;
  health(): Promise<DawHealth>;
  capabilities(): Promise<DawCapabilities>;
  inspect(): Promise<DawSnapshot>;
  execute(plan: ExecutablePlan): Promise<ExecutionReport>;
}
```

The exact TypeScript types are implementation work, but the semantic rules are fixed:

- `capabilities()` declares supported commands, limits, scopes, and recovery support;
- `inspect()` returns a normalized snapshot and revision;
- `execute()` accepts only a previously validated canonical plan;
- execution returns one structured result per command;
- adapters never parse natural language;
- adapters never elevate permissions;
- unsupported commands are rejected before the first mutation.

An adapter may expose richer target-specific diagnostics, but those diagnostics cannot become an alternate mutation path.

## Target selection

A Beat Twin session has one explicit target adapter.

The initial CLI/server default may be selected with:

```text
BEAT_TWIN_DAW=nanodaw
BEAT_TWIN_DAW=bitwig
```

Later clients may select among configured adapters per session. A plan records the adapter ID and capability version used to create it. It cannot be executed against another adapter without being rebuilt and confirmed again.

## NanoDAW adapter

The NanoDAW is the native reference adapter, not a Bitwig preview.

`NanoDawAdapter` wraps the existing `@beat-twin/commands` and `@beat-twin/core` state. It must preserve the browser app's current standalone mode.

When remote control is enabled, the browser app registers an authenticated connected session with the Beat Twin Gateway. The adapter applies canonical commands through the same command executor used by local UI actions and synchronizes the resulting immutable state back to the app.

The NanoDAW path must work without Bitwig, MCP, or any proprietary DAW.

## Bitwig adapter

`BitwigAdapter` translates normalized snapshots and canonical commands to the existing TCP/JSON-RPC controller protocol.

It must:

- preserve the root `index.js` MCP compatibility surface;
- keep the controller bridge on `127.0.0.1`;
- retain existing write-policy gates;
- report partial execution honestly;
- reject commands not represented by its declared capabilities.

Bitwig is one adapter and must not define the orchestration model.

## Local LLM client

The first client is a native Android chat running Gemma 4 on the S25 through LiteRT-LM.

The model receives a small high-level tool surface:

- `list_daw_targets`
- `inspect_session`
- `propose_song_patch`
- `preview_plan`
- `execute_plan`

The same tool definitions and SongPatch should work with either the NanoDAW or Bitwig selected.

The phone stores pairing material securely and never connects directly to any DAW.

## Beat Twin Agent Gateway

A workstation gateway provides an authenticated HTTP/WebSocket API.

Responsibilities:

- pairing, token verification, and revocation;
- target selection and capability discovery;
- health and connection diagnostics;
- normalized session inspection;
- schema validation;
- side-effect-free plan creation;
- deterministic preview;
- policy evaluation;
- explicit per-plan confirmation;
- routing to the selected adapter;
- structured execution and audit results.

The gateway does not contain DAW-specific mutation code.

## Agent and plan contract

Gemma may propose; only Beat Twin may validate and execute.

A plan contains:

- adapter ID and capability version;
- base session revision;
- bounded canonical commands;
- required scopes;
- a human-readable summary;
- warnings and assumptions;
- expiry and stable plan ID.

The gateway rejects:

- unknown command types;
- unsupported adapter capabilities;
- stale session revisions;
- adapter changes after planning;
- invalid musical values;
- plans exceeding configured limits;
- execution without explicit confirmation;
- execution requiring disabled scopes.

Plan creation is side-effect free. Confirmation and execution are separate requests.

## Policy and safety

The existing policy classes remain compatibility scopes while the shared capability model is introduced:

- `read`
- `transport`
- `mixer_write`
- `clip_write`
- `scene_write`
- `device_write`
- `application_write`

A confirmed plan cannot elevate the configured process or adapter authority.

Network constraints:

- require pairing before returning session data;
- use revocable high-entropy tokens;
- never log auth tokens;
- rate-limit requests and execution attempts;
- reject oversized payloads;
- redact workstation paths;
- keep the Bitwig controller on loopback;
- require explicit opt-in before the browser app accepts remote control.

## Failure and recovery

Execution is not assumed atomic.

A plan records all command results and the last successful command. An adapter declares whether it supports undo, compensation, or neither. Partial execution must be reported explicitly.

The NanoDAW may use immutable command-state history for recovery. Bitwig recovery remains manual until verified undo or compensating operations exist.

## Non-goals

- autonomous background composition;
- a separate agent implementation per DAW;
- direct phone-to-DAW communication;
- arbitrary model-generated code execution;
- forcing the NanoDAW to depend on Bitwig or the gateway in standalone mode;
- pretending every adapter has identical capabilities;
- automatic cross-adapter project conversion;
- public-internet exposure in the first slice.

## Consequences

### Positive

- one local-LLM contract can control several DAWs;
- the NanoDAW provides a free deterministic reference backend;
- Bitwig proves external-DAW integration without owning the architecture;
- future Ableton and Ardour support becomes adapter work;
- model prompts, validation, preview, and safety logic are reused;
- adapter conformance can be tested without a model.

### Costs

- a capability model and adapter conformance suite are required;
