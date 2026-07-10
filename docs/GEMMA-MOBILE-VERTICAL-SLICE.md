# Gateway to S25 provider: first dual-target Agent-mode vertical slice

The historical filename is retained for existing links. This slice does not
include a native Android client.

## Outcome

From NanoDAW Agent mode, the user selects `nanodaw` or `bitwig` and asks:

> Create an instrument track named Acid Pulse with a 16-beat syncopated A minor
> clip at 132 BPM.

The Beat Twin Gateway on the laptop sends the conversation and three safe tools
to the LiteRT-LM OpenAI-compatible API on the S25. Gemma may inspect and return
a `SongPatchV1`, but it cannot preview, confirm, or execute.

Beat Twin validates the proposal, materializes every executable ID, compiles an
immutable target-bound plan, and displays a side-effect-free preview. Only an
explicit human confirmation can route the plan to `NanoDawAdapter` or
`BitwigAdapter`.

The resulting execution report verifies tempo, track, clip length, and notes.
The same SongPatch is replanned and confirmed separately for each target.

## Product flow

1. NanoDAW Agent mode connects to the laptop Gateway on loopback with a
   revocable token.
2. The user selects `nanodaw` or `bitwig` before starting the run.
3. The Gateway inspects the selected adapter's health, capabilities, snapshot,
   and revision.
4. The Gateway calls LiteRT-LM on the S25 at its configured port `9379`.
5. Gemma uses at most `list_daw_targets`, `inspect_session`, and
   `propose_song_patch` during a loop bounded to four steps.
6. No adapter mutation occurs during that model loop.
7. Beat Twin validates `SongPatchV1` and compiles
   `ExecutableBeatTwinCommand[]` with server-owned IDs.
8. Beat Twin creates an `ExecutablePlan`, digest, required scopes, warnings,
   and deterministic preview bound to the selected target and base revision.
9. The browser shows the exact diff and may audition projected NanoDAW state
   without committing it.
10. The user explicitly confirms the exact plan.
11. The Gateway exchanges that confirmation for a single-use token valid for
    thirty seconds.
12. Execution rechecks auth, target, capability version, base revision, digest,
    expiry, policy scopes, and adapter health.
13. The recorded adapter executes once and returns a verifiable report.

## Target-independent API

### `POST /v1/pair`

Pairs a local client and returns revocable authentication material. Secrets are
never written to audit logs.

### `GET /v1/health`

Returns Gateway, provider, and configured-adapter health without mutation.

### `GET /v1/daws`

Lists configured targets and capability versions.

```json
{
  "targets": [
    {
      "id": "nanodaw",
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

Returns the normalized read-only snapshot, revision, and capabilities for the
selected target.

### `POST /v1/agent/runs`

Starts a bounded provider loop for one fixed target and user request. The
request does not contain executable commands.

Example validated model proposal:

```json
{
  "version": 1,
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
        "startBeat": 0.25,
        "lengthBeats": 0.25
      }
    ]
  }
}
```

The Gateway returns a stored plan and preview. Plans expire after two minutes.

### `POST /v1/plans/:planId/confirm`

Records explicit human confirmation of the stored plan digest and returns a
single-use confirmation valid for thirty seconds.

### `POST /v1/plans/:planId/execute`

Executes the stored plan through its recorded adapter. The request cannot
replace commands, change the target, alter scopes, or extend expiry.

### WebSocket `/v1/nanodaw/sessions`

Connects the browser-owned NanoDAW session to the Gateway. It carries snapshots,
revisions, and immutable executable batches; it is not a second song store.

## SongPatchV1 bounds

The first portable slice accepts only:

- one instrument track;
- one MIDI clip from 1 to 16 beats in 4/4;
- 1 to 16 notes;
- note starts and lengths quantized to 1/16 note boundaries;
- optional tempo from 40 to 240 BPM;
- pitch from 0 to 127;
- velocity from 1 to 127;
- track and clip names up to 64 characters.

Every note must have a positive duration and fit within the clip. Unknown fields
and command names are rejected. Playback, recording, device, mixer, scene,
audio, file, preset, and rendering operations are outside the contract.

## Executable plan

Compilation is deterministic and side-effect free:

```text
SongPatchV1
  -> strict schema and musical validation
  -> adapter capability validation
  -> ID materialization
  -> ExecutableBeatTwinCommand[]
  -> ExecutablePlan
```

The plan records the adapter ID, capability version, base revision, commands,
required scopes, digest, timestamps, preview, warnings, and per-command result
slots. A target switch or capability/revision change requires a fresh plan and
fresh confirmation.

## NanoDawAdapter acceptance

- The browser remains the only owner of song state.
- The Gateway proxies inspection and execution through the authenticated
  WebSocket; it never operates on a second authoritative copy.
- Preview and projected audition do not mutate the song.
- Execution sends one batch with `requestId`, `expectedRevision`, and fully
  materialized commands.
- The browser validates the full batch before mutation.
- A valid batch creates one revision, one autosave, and one undo checkpoint.
- An invalid or stale batch creates none of them.
- Duplicate request IDs cannot apply the plan twice.
- Standalone NanoDAW remains unchanged when connected mode is disabled.

## BitwigAdapter acceptance

- Read-only health, capabilities, and inspection remain available independently
  of write enablement.
- The historical 57-tool MCP surface and policy behavior remain compatible.
- The controller bridge remains on loopback and must authenticate writes.
- Bounds, required scopes, target identity, and plan freshness are checked
  before the first mutation.
- Stable identifiers for the intended track and clip are resolved and bound to
  the plan before preview; execution never relies on the current selection.
- It reads back notes from that exact target and compares them with the plan.
- It stops on the first failure and reports the precise partial boundary.
- It never automatically retries after a possible mutation.
- Clip naming is reported as an explicit capability gap when the API cannot
  verify it.
- Live writes use a disposable Bitwig project.

## Gateway and provider acceptance

- The Gateway listens on loopback and rejects unauthenticated requests.
- Pairing tokens are high entropy, revocable, and absent from logs.
- Request size, quotas, plan counts, and concurrent runs are bounded.
- The provider loop has at most four steps.
- Gemma receives only `list_daw_targets`, `inspect_session`, and
  `propose_song_patch`.
- No `confirm`, `execute`, transport, or adapter protocol tool is exposed.
- A real sanitized S25 `tool_calls` response is captured before provider-loop
  implementation; prompt-enforced JSON is not a fallback.
- Plans expire after two minutes and confirmations after thirty seconds.
- Confirmation is exact and single-use.
- Audit is fail-closed and contains no secret or raw auth material.

## Conformance and tests

Offline coverage includes:

- SongPatch schema acceptance and rejection;
- 1/16 quantization, MIDI, tempo, name, note-count, and clip-length bounds;
- executable ID materialization;
- strict all-command validation before NanoDAW mutation;
- one revision/autosave/undo checkpoint per valid batch;
- stale revision and duplicate request rejection;
- adapter and capability-version binding;
- plan and confirmation expiry;
- confirmation reuse;
- policy computation;
- unknown or malformed provider tool calls;
- the four-step model-loop limit;
- Bitwig write blocking before authentication and readback;
- honest partial-execution reporting.

Manual live gates cover:

1. a real S25 `tool_calls` fixture;
2. Gateway -> S25 provider -> Gateway -> NanoDAW with visible atomic browser
   mutation;
3. Gateway -> S25 provider -> Gateway -> Bitwig with authenticated bridge and
   verified readback;
4. the same SongPatch replanned and confirmed separately for both targets.

The only required manual interventions are starting LiteRT-LM on the S25 and
activating the Beat Twin controller in a disposable Bitwig project.

## Delivery order

1. Strict executable commands, batches, revisions, and stable errors.
2. DAW contract and fake-adapter conformance.
3. SongPatchV1 contract, compilation, and deterministic preview.
4. Real S25 fixture and OpenAI-compatible provider client.
5. Loopback Gateway, pairing, quotas, policy, plan store, and audit.
6. NanoDawAdapter memory port, browser proxy, and connected Agent mode.
7. BitwigAdapter read-only extraction and 57-tool compatibility snapshot.
8. Bitwig bridge authentication, target identity, strict writes, and readback.
9. Exact confirmation, idempotent execution, and dual-target routing.
10. E2E smokes and closeout documentation.

## Deferred

- modifying existing clips beyond the portable subset;
- playback, recording, device, mixer, scene, audio, or file operations;
- arrangement generation and arbitrary transformations;
- Ableton Live and Ardour adapters;
- automatic rollback for external DAWs;
- public-network access;
- autonomous background work;
- a native Android application.
