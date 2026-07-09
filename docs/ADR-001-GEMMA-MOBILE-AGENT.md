# ADR-001: Gemma mobile agent boundary

- Status: Proposed
- Date: 2026-07-10
- Owners: Beat Twin maintainers
- Decision scope: mobile agent, workstation gateway, and Bitwig execution boundary

## Context

Beat Twin already has three useful boundaries:

- a pure musical document model in `@beat-twin/core`;
- a typed mutation path in `@beat-twin/commands`;
- a policy-gated MCP and TCP/JSON-RPC bridge to Bitwig.

The next product slice is a local chat running Gemma 4 on a Samsung S25. It must be able to inspect a Bitwig session and request creative changes without exposing the unauthenticated Bitwig controller port to the phone or allowing arbitrary model output to mutate the DAW.

The current root MCP server uses stdio and static environment policies. It is a compatibility surface for local MCP clients, not a network API for mobile devices.

## Decision

Gemma runs on the phone and acts as an intent planner. Beat Twin on the workstation remains the authority that validates, previews, authorizes, and executes every operation.

The mobile client never connects to the Bitwig controller TCP port and never emits raw Bitwig JSON-RPC methods.

```text
Android chat + Gemma 4
  -> authenticated LAN API
  -> Beat Twin Gateway
  -> plan validation and policy checks
  -> BeatTwinCommand[]
  -> Bitwig adapter
  -> existing 127.0.0.1 TCP bridge
  -> Bitwig Studio
```

## Components

### Android client

A small native Android application owns:

- the chat UI;
- on-device Gemma 4 inference through LiteRT-LM;
- constrained function calls;
- display of session summaries and change previews;
- explicit user confirmation before execution;
- storage of pairing material in Android secure storage.

The model receives a small high-level tool surface. It does not receive the existing low-level Bitwig tool list.

Initial tools:

- `inspect_session`
- `propose_song_patch`
- `preview_plan`
- `execute_plan`

### Beat Twin Gateway

A new workstation process provides an authenticated HTTP/WebSocket API for the mobile client.

Initial responsibilities:

- pairing and token verification;
- health and Bitwig connection diagnostics;
- read-only session inspection;
- schema validation;
- plan creation with stable IDs and expiry;
- preview generation;
- policy evaluation;
- execution after confirmation;
- structured results and audit events.

The gateway binds to a configured LAN interface. The existing Bitwig controller remains bound to `127.0.0.1`.

### Command boundary

`@beat-twin/commands` remains the canonical mutation language. Model output is translated into validated `BeatTwinCommand[]` before any DAW call.

The first adapter work must support both directions:

- `BitwigSnapshot -> Song / CommandState`
- `BeatTwinCommand[] -> Bitwig JSON-RPC operations`

The root `index.js` MCP compatibility surface must keep working during extraction.

## Agent contract

Gemma may create a proposal, but only Beat Twin may accept it.

A proposal contains:

- a base session revision;
- a bounded list of musical changes;
- required policy classes;
- a human-readable summary;
- warnings and assumptions.

The gateway rejects:

- unknown command types;
- stale session revisions;
- notes outside MIDI ranges;
- notes outside clip bounds;
- unsupported track or device operations;
- plans exceeding configured command or note limits;
- execution without an explicit confirmation token;
- execution requiring disabled policy classes.

Plan creation is side-effect free. Plan execution is a separate request.

## Policy model

The existing policy classes remain the maximum authority available to the process:

- `read`
- `transport`
- `mixer_write`
- `clip_write`
- `scene_write`
- `device_write`
- `application_write`

A confirmed plan cannot elevate the process beyond its configured policy. For the first write slice, only `application_write` and `clip_write` are required.

Confirmation is per plan and short lived. A global “trust every future model action” mode is not part of this decision.

## Network and security constraints

- Never expose the Bitwig controller port outside loopback.
- Require pairing before returning session data.
- Use a random high-entropy token; do not use a user-chosen password.
- Rate-limit inference-facing endpoints and execution attempts.
- Do not log raw auth tokens.
- Redact absolute workstation paths from mobile responses.
- Reject requests larger than configured limits.
- Support explicit token revocation.
- Treat LAN access as untrusted despite the local-first product shape.

TLS or a private overlay network can be added later. Initial development may use HTTP on a trusted development LAN, but authentication and loopback isolation are required from the first slice.

## Failure and recovery

A plan records the last successful command and all command results. Partial execution must be reported explicitly and must never be described as atomic.

Before broader arrangement writes, Beat Twin must add either:

- verified Bitwig undo integration; or
- compensating operations for each supported command.

The first slice runs against a disposable Bitwig project and documents manual undo.

## Non-goals

- autonomous background composition;
- direct MCP-over-the-internet exposure;
- direct phone-to-Bitwig communication;
- arbitrary code execution generated by the model;
- audio rendering or sample generation on the phone;
- unrestricted device browsing;
- multi-user collaboration;
- claiming transactional rollback before it exists.

## Consequences

### Positive

- the phone stays a private, offline-capable creative interface;
- existing command validation and policy work is reused;
- Bitwig remains isolated from model and network input;
- MCP compatibility is preserved;
- deterministic gateway tests can run without Gemma or Bitwig.

### Costs

- a new gateway and Android client must be maintained;
- live Bitwig state must be mapped into the core model;
- command execution is initially only partially reversible;
- model prompts and tool schemas become versioned API contracts.

## Validation

This decision is accepted when a paired S25 can:

1. inspect a running disposable Bitwig project;
2. propose a bounded four-bar MIDI creation plan;
3. show a deterministic preview;
4. require explicit confirmation;
5. create one instrument track, one clip, and its notes;
6. report every applied or failed operation;
7. leave the Bitwig TCP port reachable only through loopback.
