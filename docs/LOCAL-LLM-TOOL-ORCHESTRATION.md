# Local LLM Tool Orchestration

## Decision

The Beat Twin Gateway runs on the laptop and calls the S25 as an
OpenAI-compatible inference provider. The phone does not run the Gateway and
does not connect directly to a DAW.

```text
NanoDAW Agent mode
  -> Beat Twin Gateway on laptop loopback
  -> LiteRT-LM /v1/chat/completions on S25:9379
  -> Gemma list, inspect, or propose tool call
  -> SongPatchV1
  -> ExecutableBeatTwinCommand[]
  -> ExecutablePlan and preview
  -> human confirmation
  -> NanoDawAdapter | BitwigAdapter
  -> ExecutionReport
```

The provider interprets creative language and proposes bounded musical intent.
Beat Twin owns schemas, target capabilities, executable IDs, policy, preview,
confirmation, routing, idempotence, and audit.

## Why this shape

- The browser remains the sole owner of NanoDAW state.
- Provider choice stays independent from DAW choice.
- Gemma cannot turn a model loop into a mutation loop.
- One portable proposal can be replanned for different adapters.
- Existing Bitwig MCP compatibility does not define the new agent language.
- Preview and confirmation remain human-verifiable Gateway/UI operations.

## Provider topology

```text
Samsung S25
  LiteRT-LM OpenAI-compatible server
  configured Gemma model
  http://PHONE_IP:9379/v1
        ^
        | trusted provider connection
        |
Laptop
  NanoDAW browser Agent mode
        -> loopback Beat Twin Gateway
        -> provider client
        -> plan compiler and policy
        -> NanoDAW WebSocket proxy or Bitwig loopback adapter
```

Suggested future provider configuration:

```env
BEAT_TWIN_LLM_BASE_URL=http://192.168.x.x:9379/v1
BEAT_TWIN_LLM_MODEL=gemma-model-id
BEAT_TWIN_LLM_API_KEY=local-unused
BEAT_TWIN_AGENT_MAX_STEPS=4
```

The API key is optional for a trusted local provider, but the Gateway's own
client tokens are always high entropy and revocable.

## Provider fixture gate

LiteRT-LM documents these relevant server endpoints:

- `GET /v1/models`;
- `POST /v1/chat/completions`;
- default port `9379`.

References:

- <https://developers.google.com/edge/litert-lm/cli/openai_server>
- <https://github.com/google-ai-edge/LiteRT-LM/blob/main/README.md>

The documentation does not lock the exact `tool_calls` response shape for the
configured S25 build and model. G1 completed this gate with `gemma4-e2b` on
2026-07-14 by following this sequence:

1. start LiteRT-LM on the real S25;
2. request a harmless tool call with the exact future client payload;
3. sanitize secrets and device-specific data;
4. commit the response as a provider contract fixture;
5. test normalization and malformed-response rejection against that fixture.

If a real response does not contain a usable `tool_calls` structure, the Agent
Gateway stops at this gate. It must not fall back to prompt-enforced JSON or
extract commands from prose.

## Model-visible tools

Gemma receives exactly three tools.

### `list_daw_targets`

Returns configured target IDs, health summaries, and capability versions. It
does not select a target or mutate state.

### `inspect_session`

Returns a normalized read-only snapshot for the target fixed by the Agent run.
Paths, secrets, and target-specific protocol details are redacted.

### `propose_song_patch`

Returns one bounded `SongPatchV1` proposal. It does not create, confirm, or
execute a plan.

There are deliberately no model tools named or equivalent to:

- `preview_plan`;
- `confirm_plan`;
- `execute_plan`;
- `undo`;
- transport or playback operations;
- Bitwig JSON-RPC methods;
- raw NanoDAW commands.

## SongPatchV1

The proposal schema accepts only:

- one instrument track;
- one clip from 1 to 16 beats with a 4/4 assumption;
- 1 to 16 notes;
- starts and lengths quantized to 1/16 note boundaries;
- optional tempo from 40 to 240 BPM;
- pitch from 0 to 127;
- velocity from 1 to 127;
- names no longer than 64 characters.

Unknown fields are rejected. Playback, recording, devices, mixer, scenes,
audio, files, presets, and rendering are excluded.

The model never chooses executable IDs, adapter methods, policy scopes,
confirmation tokens, plan lifetime, or execution order.

## Bounded model loop

The provider loop is non-streaming first and limited to four steps. It may call
read tools and finish with a SongPatch proposal, but it cannot execute an
adapter operation.

```ts
for (let step = 0; step < 4; step += 1) {
  const response = await provider.complete({
    messages,
    tools: MODEL_TOOL_SPECS,
  });

  const calls = normalizeRealProviderToolCalls(response);
  if (calls.length === 0) return { message: response.message };

  for (const rawCall of calls) {
    const call = validateModelToolCall(rawCall);

    if (call.name === "list_daw_targets") {
      messages.push(asToolResult(await listDawTargets()));
      continue;
    }

    if (call.name === "inspect_session") {
      messages.push(asToolResult(await inspectFixedTarget()));
      continue;
    }

    if (call.name === "propose_song_patch") {
      return { songPatch: validateSongPatchV1(call.arguments) };
    }
  }
}

throw new AgentLoopError("step_limit");
```

Only after the loop returns a valid SongPatch does Beat Twin compile and store
an executable plan. Compilation and preview still do not mutate a DAW.

## Historical MCP surface

`TOOL_SPECS` is the existing 57-tool Bitwig MCP catalogue in `index.js`. It is
the compatibility source of truth for the current MCP server and its policy
classes only.

It is not:

- the model-visible Agent-mode catalogue;
- the portable command language;
- the DAW adapter contract;
- a source from which Gemma write tools are projected.

Extraction work may share validation helpers or protocol metadata when useful,
but the 57 names, schemas, visibility, and policy behavior must retain a
snapshot compatibility test.

## Portable execution boundary

```text
SongPatchV1
  -> strict validation
  -> capability-aware compilation
  -> ExecutableBeatTwinCommand[]
  -> ExecutablePlan
  -> adapter execution after confirmation
```

All IDs are materialized before preview. A plan is immutable and records:

- adapter ID;
- capability version;
- base revision;
- executable commands;
- required scopes;
- digest and deterministic preview;
- stable plan and request IDs;
- creation time and two-minute expiry.

Confirmation is created by explicit UI action, is bound to the plan digest,
expires after thirty seconds, and can be used only once. Execution accepts no
replacement command array and no target override.

## NanoDAW transport

The Gateway never owns an authoritative NanoDAW song. The browser connects to
`/v1/nanodaw/sessions` over an authenticated WebSocket and exposes a narrow
session port for inspection and exact batch execution.

A remote mutation contains:

- one `requestId`;
- one `expectedRevision`;
- one immutable `ExecutableBeatTwinCommand[]` batch.

The browser validates the complete batch and commits it through the same
command executor used by local UI operations. Success creates one revision,
one autosave, and one undo checkpoint. Failure creates none. Projected audition
before confirmation remains local and non-mutating.

## Bitwig transport

BT-212 adds an authenticated Agent-mode path alongside the historical 57-tool
MCP surface. Read-only inspection remains available without a secret. Writes
require a controller preference secret matching `BITWIG_BRIDGE_SECRET` and are
limited by the `bitwig-launcher-v1` capability:

- one empty selected launcher slot is captured before preview with controller,
  project, position, scene, and target-generation identity;
- one instrument track, one 1-16 beat clip, 1-16 sixteenth-grid notes, MIDI
  bounds, track-name bounds, and 40-240 BPM are validated before authentication;
- every mutation carries the confirmed target binding;
- clip readiness is polled read-only after creation; the creation call itself
  is never retried;
- exact target, tempo, clip length, track name, and notes are read back before
  success is reported.

The adapter stops at the first failure, reports `partial_execution` honestly,
and never automatically retries after a possible mutation. Existing
`pnpm smoke:read-only` diagnostics and the root MCP path remain intact.
The first live write remains a separate BT-213 human-gated check in a disposable
Bitwig project; BT-212's evidence is deterministic and does not claim that run.

## Gateway safety

- Listen on loopback.
- Require pairing before target or session data is returned.
- Use revocable high-entropy tokens.
- Never log tokens, provider secrets, or unredacted workstation paths.
- Limit request sizes, concurrent runs, tool steps, plans, and executions.
- Store plans for at most two minutes.
- Store single-use confirmations for at most thirty seconds.
- Fail closed on unknown tools, malformed arguments, policy uncertainty,
  capability drift, stale revisions, expiry, digest mismatch, or wrong target.
- Never retry automatically after a mutation may have occurred.
- Keep provider calls separate from adapter execution.

## Delivery slices

### Slice 0: Real provider fixture

- Capture the S25 `tool_calls` response.
- Lock normalization tests to the sanitized fixture.
- Stop if the contract is not usable without prompt-JSON parsing.

### Slice 1: Provider and agent contract

- Implement the OpenAI-compatible client.
- Define the three model tools and `SongPatchV1`.
- Enforce a four-step, no-execution model loop.

### Slice 2: Portable compiler

- Materialize executable IDs.
- Compile `SongPatchV1` into `ExecutableBeatTwinCommand[]` and an immutable
  `ExecutablePlan`.
- Produce deterministic, non-mutating previews.

### Slice 3: Gateway policy and plan lifecycle

- Add pairing, quotas, audit, plan storage, expiry, exact confirmation, and
  idempotent execution.

### Slice 4: NanoDAW browser proxy

- Add the authenticated session WebSocket.
- Keep state ownership in the browser.
- Prove atomic batch, revision, autosave, and single-undo semantics.

### Slice 5: Bitwig adapter

- Preserve the 57-tool MCP snapshot and read-only smoke.
- Add bridge authentication, target identity, strict bounds, and note readback
  before enabling any Agent-mode write.

## Acceptance scenario

Given LiteRT-LM running on the S25 and NanoDAW Agent mode open on the laptop:

1. the user selects `nanodaw` and requests a bounded pattern;
2. the Gateway calls the S25 provider;
3. Gemma lists, inspects, and proposes a SongPatch without mutation;
4. Beat Twin compiles and shows an exact preview;
5. the user confirms once;
6. NanoDAW commits one atomic browser-owned batch and returns a verified report;
7. the same SongPatch is replanned and separately confirmed for `bitwig`;
8. Bitwig execution remains blocked unless bridge authentication, target
   identity, bounds, scopes, and readback are all available;
9. success or partial execution is reported without guessing.

## Deferred Android client

A future native Android application may consume the Gateway as a normal client.
It is independent from this provider architecture and does not embed Gemma,
LiteRT-LM, or any other LLM runtime.
