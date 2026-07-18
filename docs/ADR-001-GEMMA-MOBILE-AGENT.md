# ADR-001: S25 provider, Agent Gateway, and DAW adapter boundary

- Status: Accepted
- Date: 2026-07-10
- Owners: Beat Twin maintainers
- Historical filename: retained to avoid breaking existing links; a native Android agent is not part of this decision

## Context

Beat Twin has two real musical surfaces today:

- the browser NanoDAW, whose React store owns the complete song state;
- the historical Bitwig MCP and loopback JSON-RPC bridge.

The first Agent-mode proof uses Gemma through LiteRT-LM's
OpenAI-compatible server on a Samsung S25. The model runtime is a provider for
the laptop Gateway, not an Android client that connects to a DAW.

The architecture must preserve four boundaries:

1. The browser remains the only owner of NanoDAW state.
2. The model may inspect and propose, but never confirm or execute.
3. A portable proposal is compiled before any adapter-specific operation.
4. Bitwig writes remain closed until the controller path is authenticated and
   its result can be verified.

## Decision

Beat Twin is the DAW-agnostic orchestrator on the laptop.

```text
NanoDAW Agent mode
  -> Beat Twin Gateway on laptop loopback
  -> LiteRT-LM OpenAI-compatible API on the S25, port 9379
  -> Gemma tool_calls: list, inspect, or propose only
  -> SongPatchV1 validation
  -> ExecutableBeatTwinCommand[]
  -> ExecutablePlan and side-effect-free preview
  -> explicit human confirmation
  -> NanoDawAdapter | BitwigAdapter
  -> verifiable ExecutionReport
```

The S25 performs inference. It never connects directly to NanoDAW, Bitwig, or
their transports. The Gateway calls the S25 provider and remains responsible
for target selection, validation, policy, preview, confirmation, routing,
idempotence, and audit.

## Command runtime boundary

`@beat-twin/commands` remains the pure NanoDAW musical mutation foundation,
but raw authoring commands are not executable plans.

The portable runtime boundary is:

```text
SongPatchV1
  -> validated musical intent
  -> ExecutableBeatTwinCommand[] with every ID materialized
  -> ExecutablePlan bound to one adapter and one snapshot
```

The command runtime adds these public concepts:

```ts
type CommandSnapshot = {
  song: Song;
  revision: number;
};

type ExecuteCommandBatchInput = {
  requestId: string;
  expectedRevision: number;
  commands: ExecutableBeatTwinCommand[];
};
```

`executeCommandBatch()` validates the complete batch before mutation. For
NanoDAW, a valid remote batch produces exactly one new revision, one autosave,
and one undo checkpoint. Any invalid command rejects the whole batch.

Stable command errors are:

- `invalid_command`;
- `stale_revision`;
- `unsupported_capability`;
- `policy_blocked`;
- `partial_execution`.

The existing single-command API remains available through a backward-compatible
wrapper. UI selection, chat messages, audition, history rendering, and audit
records are deliberately outside the musical command contract.

## DAW adapter contract

```ts
interface DawAdapter {
  readonly id: "nanodaw" | "bitwig";
  health(): Promise<DawHealth>;
  capabilities(): Promise<DawCapabilities>;
  inspect(): Promise<DawSnapshot>;
  execute(plan: ExecutablePlan): Promise<ExecutionReport>;
}
```

An executable plan contains at least:

- `adapterId` and `capabilityVersion`;
- `baseRevision` from the inspected snapshot;
- materialized executable commands;
- required scopes;
- a digest covering the immutable plan and preview;
- creation and expiration timestamps;
- stable plan and request IDs;
- one structured result per attempted command.

An adapter never parses natural language, changes targets, chooses additional
commands, or elevates authority. Unsupported capabilities fail before the
first mutation.

## SongPatchV1

The initial proposal contract is intentionally narrow:

- exactly one instrument track;
- one MIDI clip from 1 to 16 beats, assuming 4/4;
- 1 to 16 notes;
- note starts and lengths quantized to 1/16 note boundaries;
- optional tempo from 40 to 240 BPM;
- MIDI pitch from 0 to 127;
- velocity from 1 to 127;
- track and clip names limited to 64 characters.

Playback, recording, devices, mixer changes, scenes, audio, files, presets, and
rendering are not part of `SongPatchV1`.

## Model-visible tools

Gemma receives exactly three target-independent tools:

- `list_daw_targets`;
- `inspect_session`;
- `propose_song_patch`.

There is no model tool for preview, confirmation, execution, undo, transport,
or low-level DAW mutation. No adapter execution occurs during the model loop.
The Gateway compiles a returned SongPatch only after the loop has ended.

`TOOL_SPECS` remains the historical 57-tool Bitwig MCP surface and its existing
policy classification. It must remain backward compatible, but it is neither
the universal agent language nor the portable adapter contract.

## Provider gate

LiteRT-LM documents `/v1/models`, `/v1/chat/completions`, and port `9379`, but
the exact `tool_calls` shape must be proven against the configured S25 runtime.

Before implementing the agent loop, the project captures a successful real S25
response as a sanitized fixture and locks parsing tests to it. If the provider
does not return a usable `tool_calls` response, Agent Gateway implementation
stops at that gate. Prompt-enforced JSON is not a fallback.

The model loop is non-streaming first and bounded to four steps.

## Agent Gateway

The Gateway listens on laptop loopback. It uses revocable high-entropy tokens,
request-size limits, quotas, fail-closed policy checks, and secret-free audit
events.

Minimum API:

- `POST /v1/pair`;
- `GET /v1/health`;
- `GET /v1/daws`;
- `GET /v1/sessions/:dawId`;
- `POST /v1/agent/runs`;
- `POST /v1/plans/:planId/confirm`;
- `POST /v1/plans/:planId/execute`;
- WebSocket `/v1/nanodaw/sessions`.

Plans expire after two minutes. Human confirmations are single-use and expire
after thirty seconds. Confirmation and execution requests identify only the
stored plan; they cannot submit replacement commands or a different target.

## NanoDAW ownership and execution

The browser is the sole source of truth for NanoDAW song state. The Gateway
must not maintain a second authoritative song copy.

In connected mode, the browser opens an authenticated WebSocket session to the
Gateway. `NanoDawAdapter` uses that session as a proxy:

1. inspect the browser-owned snapshot and revision;
2. compile and preview without mutation;
3. after human confirmation, send one immutable command batch with the expected
   revision and request ID;
4. let the browser validate and commit atomically through its existing command
   executor;
5. receive the new revision and execution report.

A stale revision, duplicate request, disconnect, or invalid command never
creates a second mutation path. Standalone NanoDAW behavior remains unchanged
when connected mode is disabled.

Audition before confirmation uses projected state locally and never commits the
plan.

## Bitwig execution boundary

`BitwigAdapter` preserves the existing MCP server and all 57 historical tool
definitions. BT-212 implements the required gates: controller authentication,
strict pre-dispatch musical bounds, generation-aware target binding before
preview, read-only clip readiness polling, and exact target/note readback.
Read-only inspection remains available without authentication.

Bitwig may not support atomic multi-operation execution. It stops after the
first failure and returns an honest `partial_execution` boundary with no
automatic retry after a mutation. The live write smoke uses a disposable
project. Clip naming remains an explicit capability gap if the controller API
cannot set it reliably.

## Failure and recovery

NanoDAW batches are atomic and create one undo checkpoint. Bitwig execution is
reported as partial whenever a verified all-or-nothing result is unavailable.

Execution is idempotent by request ID. The Gateway never automatically retries
after a target may have mutated. Reports distinguish rejected-before-mutation,
complete success, and partial execution.

## Native Android application

A native Android app is deferred. If built later, it is an optional independent
client of the laptop Gateway and does not bundle Gemma, LiteRT-LM, or another
LLM runtime. The S25 provider proof does not depend on an Android UI project.

## Non-goals

- autonomous or background execution;
- a model tool that confirms or executes plans;
- direct S25-to-DAW communication;
- a second server-side copy of NanoDAW song state;
- reuse of raw Bitwig MCP calls as the portable agent language;
- arbitrary model-generated code;
- playback, recording, device, mixer, scene, audio, or file operations in the
  first SongPatch contract;
- pretending Bitwig execution is atomic;
- automatic retry or rollback after an uncertain external-DAW mutation;
- public-internet exposure;
- an Android application in the critical path.

## Acceptance criteria

This decision is accepted for implementation when:

1. a real sanitized S25 fixture proves the expected `tool_calls` shape;
2. invalid NanoDAW batches leave song, revision, autosave, and undo unchanged;
3. a fake adapter passes the shared contract, revision, expiry, and idempotence
   suite;
4. Gemma can only list, inspect, and propose;
5. preview and projected audition occur without mutation;
6. human confirmation is exact, single-use, and short-lived;
7. NanoDAW applies the confirmed plan once through its browser-owned state;
8. Bitwig writes remain unavailable until authentication, identity, bounds, and
   readback gates are proven;
9. the same SongPatch is replanned and confirmed separately for NanoDAW and
   Bitwig;
10. execution reports and audit logs contain no secrets and never hide partial
    results.
